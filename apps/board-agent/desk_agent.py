"""Board side of Nebius Desk. Dials out to the cloud and serves the local API over that socket."""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import signal
import socket
import struct
import subprocess
import sys
import time
from pathlib import Path

import httpx
import websockets

CONFIG_DIR = Path.home() / ".config" / "nebius-desk"
CONFIG_PATH = CONFIG_DIR / "agent.json"
SECRET_PATH = CONFIG_DIR / "relay-secret"
API_BASE = "http://127.0.0.1:8000"
CHUNK = 16_384
API_DIR = Path.home() / "nebius-desk" / "apps" / "api"
CLOCK_FLOOR = 1_704_067_200
SEND_TIMEOUT = 8
BEAT_EVERY = 15
# Cloudflare can be quiet between beats; don't flap the socket too eagerly.
QUIET_LIMIT = 45


def _read_config() -> dict:
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_private(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    os.chmod(path, 0o600)


def relay_secret() -> str:
    if SECRET_PATH.exists():
        return SECRET_PATH.read_text(encoding="utf-8").strip()
    import secrets

    value = secrets.token_urlsafe(32)
    _write_private(SECRET_PATH, value + "\n")
    return value


def execution_env() -> dict[str, str]:
    python = API_DIR / ".venv" / "bin" / "python"
    if not python.is_file():
        return {}
    try:
        proc = subprocess.run(
            [
                str(python),
                "-c",
                "import json; from app.vault.runtime import export_map; print(json.dumps(export_map()))",
            ],
            cwd=str(API_DIR),
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {}
    if proc.returncode != 0:
        return {}
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(key): str(value) for key, value in data.items() if key and value}


def redact_bytes(data: bytes, secrets: list[bytes], hold: bytes) -> tuple[bytes, bytes]:
    combined = hold + data
    for secret in sorted(secrets, key=len, reverse=True):
        combined = combined.replace(secret, "••••".encode())
    keep = 0
    for secret in secrets:
        if len(secret) < 4:
            continue
        for size in range(min(len(secret) - 1, len(combined)), 0, -1):
            if combined.endswith(secret[:size]):
                keep = max(keep, size)
                break
    if keep:
        return combined[:-keep], combined[-keep:]
    return combined, b""


def clock_ready() -> bool:
    return time.time() >= CLOCK_FLOOR


def next_delay(exc: BaseException, delay: float) -> float:
    if "certificate" in str(exc).lower():
        return 2.0
    return min(max(delay, 1.0) * 2, 30.0)


def open_http() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(connect=10, read=300, write=60, pool=10))


def board_name() -> str:
    host = socket.gethostname().strip() or "jetson"
    return "Millie" if host.lower() == "millie" else host


class Agent:
    def __init__(self, cloud: str, device_token: str) -> None:
        self.cloud = cloud.rstrip("/")
        self.device_token = device_token
        self.secret = relay_secret()
        self.http = open_http()
        self.send_lock = asyncio.Lock()
        self.ws: websockets.ClientConnection | None = None
        self.last_rx = 0.0
        self.requests: dict[str, asyncio.Task] = {}
        self.terms: dict[str, tuple[int, int]] = {}
        self.term_secrets: list[bytes] = []
        self.term_hold: dict[str, bytes] = {}

    async def send(self, frame: dict) -> None:
        ws = self.ws
        if ws is None:
            raise ConnectionError("board socket down")
        try:
            async with self.send_lock:
                await asyncio.wait_for(ws.send(json.dumps(frame)), SEND_TIMEOUT)
        except asyncio.CancelledError:
            raise
        except (asyncio.TimeoutError, websockets.ConnectionClosed):
            await self.drop(ws)
            raise

    async def drop(self, ws: websockets.ClientConnection) -> None:
        if self.ws is ws:
            self.ws = None
        try:
            await ws.close()
        except Exception:
            return

    async def reset_http(self) -> None:
        old = self.http
        self.http = open_http()
        try:
            await asyncio.wait_for(old.aclose(), 3)
        except Exception:
            return

    async def connect_forever(self) -> None:
        url = self.cloud.replace("https://", "wss://").replace("http://", "ws://") + "/v1/agent/connect"
        delay = 1.0
        while True:
            if not clock_ready():
                print("waiting for clock", flush=True)
                await asyncio.sleep(5)
                continue
            try:
                await self.session(url)
                delay = 1.0
            except Exception as exc:  # noqa: BLE001 — keep dialing across network drops
                print(f"disconnected: {exc}", flush=True)
                delay = next_delay(exc, delay)
            finally:
                self.ws = None
                self.stop_all()
                await self.reset_http()
            await asyncio.sleep(delay)

    async def session(self, url: str) -> None:
        async with websockets.connect(
            url,
            additional_headers={"Authorization": f"Bearer {self.device_token}"},
            open_timeout=20,
            ping_interval=20,
            ping_timeout=10,
            max_size=2_000_000,
        ) as ws:
            self.ws = ws
            self.last_rx = time.monotonic()
            beat = asyncio.create_task(self.beats(ws))
            watch = asyncio.create_task(self.watch(ws))
            try:
                hello = {"t": "hello", "version": "1", "hostname": socket.gethostname()}
                if os.environ.get("BOARD_EMU", "").strip().lower() in {"1", "true", "yes"}:
                    hello["board_emu"] = True
                await self.send(hello)
                print("connected", flush=True)
                await self.read_frames(ws)
            finally:
                beat.cancel()
                watch.cancel()
                await asyncio.gather(beat, watch, return_exceptions=True)

    async def read_frames(self, ws: websockets.ClientConnection) -> None:
        async for raw in ws:
            self.last_rx = time.monotonic()
            if raw == "pong" or not isinstance(raw, str):
                continue
            try:
                frame = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if isinstance(frame, dict):
                self.on_frame(frame)

    async def beats(self, ws: websockets.ClientConnection) -> None:
        while self.ws is ws:
            await asyncio.sleep(BEAT_EVERY)
            if self.ws is not ws:
                return
            try:
                await self.send({"t": "beat"})
            except asyncio.CancelledError:
                raise
            except Exception:
                return

    async def watch(self, ws: websockets.ClientConnection) -> None:
        while self.ws is ws:
            await asyncio.sleep(5)
            if self.ws is not ws:
                return
            if time.monotonic() - self.last_rx <= QUIET_LIMIT:
                continue
            print("reconnecting: no reply from the desk", flush=True)
            await self.drop(ws)
            return

    def on_frame(self, frame: dict) -> None:
        kind = frame.get("t")
        if kind == "req":
            task = asyncio.create_task(self.proxy(frame))
            self.requests[frame["id"]] = task
            task.add_done_callback(lambda _t, i=frame["id"]: self.requests.pop(i, None))
        elif kind == "cancel":
            task = self.requests.pop(frame.get("id"), None)
            if task:
                task.cancel()
        elif kind == "term_open":
            self.open_term(frame)
        elif kind == "term_in":
            self.write_term(frame.get("sid", ""), frame.get("data", ""))
        elif kind == "term_resize":
            self.resize_term(frame.get("sid", ""), int(frame.get("cols") or 80), int(frame.get("rows") or 24))
        elif kind == "term_close":
            self.close_term(frame.get("sid", ""))

    async def proxy(self, frame: dict) -> None:
        req_id = frame["id"]
        headers = {k: v for k, v in (frame.get("headers") or {}).items()}
        user = frame.get("user") or {}
        headers["x-desk-user"] = str(user.get("username") or "")
        headers["x-desk-relay"] = self.secret
        body = base64.b64decode(frame["body"]) if frame.get("body") else None
        try:
            async with self.http.stream(
                frame.get("method") or "GET",
                API_BASE + (frame.get("path") or "/"),
                headers=headers,
                content=body,
            ) as resp:
                out_headers = {}
                content_type = resp.headers.get("content-type")
                if content_type:
                    out_headers["content-type"] = content_type
                await self.send({"t": "res", "id": req_id, "status": resp.status_code, "headers": out_headers})
                async for chunk in resp.aiter_bytes(CHUNK):
                    await self.send({"t": "chunk", "id": req_id, "b64": base64.b64encode(chunk).decode()})
            await self.send({"t": "end", "id": req_id})
        except asyncio.CancelledError:
            await self.finish(req_id, "cancelled")
            raise
        except Exception as exc:  # noqa: BLE001 — report it to the waiting caller
            await self.finish(req_id, str(exc)[:200])

    async def finish(self, req_id: str, error: str) -> None:
        if self.ws is None:
            return
        try:
            await self.send({"t": "end", "id": req_id, "error": error})
        except Exception:
            return

    def open_term(self, frame: dict) -> None:
        import pty

        sid = frame["sid"]
        hidden = execution_env()
        self.term_secrets = [value.encode() for value in hidden.values()]
        pid, fd = pty.fork()
        if pid == 0:
            os.environ["TERM"] = "xterm-256color"
            os.environ.update(hidden)
            os.chdir(os.path.expanduser("~"))
            os.execvp("bash", ["bash", "-l"])
        self.resize_fd(fd, int(frame.get("cols") or 100), int(frame.get("rows") or 30))
        self.terms[sid] = (pid, fd)
        loop = asyncio.get_running_loop()

        def readable() -> None:
            try:
                data = os.read(fd, CHUNK)
            except OSError:
                data = b""
            if not data:
                loop.remove_reader(fd)
                asyncio.create_task(self.term_exit(sid))
                return
            visible, self.term_hold[sid] = redact_bytes(data, self.term_secrets, self.term_hold.get(sid, b""))
            if visible:
                asyncio.create_task(self.send({"t": "term_out", "sid": sid, "b64": base64.b64encode(visible).decode()}))

        loop.add_reader(fd, readable)

    async def term_exit(self, sid: str) -> None:
        pair = self.terms.pop(sid, None)
        if not pair:
            return
        pid, fd = pair
        self.term_hold.pop(sid, None)
        os.close(fd)
        os.waitpid(pid, os.WNOHANG)
        await self.send({"t": "term_exit", "sid": sid, "code": None})

    def write_term(self, sid: str, data: str) -> None:
        pair = self.terms.get(sid)
        if pair and data:
            os.write(pair[1], data.encode())

    def resize_term(self, sid: str, cols: int, rows: int) -> None:
        pair = self.terms.get(sid)
        if pair:
            self.resize_fd(pair[1], cols, rows)

    @staticmethod
    def resize_fd(fd: int, cols: int, rows: int) -> None:
        import fcntl
        import termios

        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

    def close_term(self, sid: str) -> None:
        pair = self.terms.pop(sid, None)
        self.term_hold.pop(sid, None)
        if not pair:
            return
        pid, fd = pair
        try:
            asyncio.get_running_loop().remove_reader(fd)
        except (RuntimeError, ValueError):
            pass
        os.kill(pid, signal.SIGHUP)
        os.close(fd)

    def stop_all(self) -> None:
        for task in self.requests.values():
            task.cancel()
        self.requests.clear()
        for sid in list(self.terms):
            self.close_term(sid)


async def pair(cloud: str, name: str) -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        started = await client.post(f"{cloud}/v1/pair/start", json={"name": name, "hostname": socket.gethostname()})
        started.raise_for_status()
        data = started.json()
        print(f"CODE {data['code']}", flush=True)
        deadline = time.time() + int(data.get("expires_in") or 600)
        while time.time() < deadline:
            polled = await client.post(f"{cloud}/v1/pair/poll", json={"poll_token": data["poll_token"]})
            body = polled.json()
            if body.get("status") == "paired":
                relay_secret()
                _write_private(
                    CONFIG_PATH,
                    json.dumps(
                        {"cloud_url": cloud, "device_id": body["device_id"], "device_token": body["device_token"]}
                    )
                    + "\n",
                )
                print("paired", flush=True)
                return
            await asyncio.sleep(2)
    raise SystemExit("pairing code expired")


def main() -> None:
    parser = argparse.ArgumentParser(description="Nebius Desk board agent")
    parser.add_argument("command", choices=("pair", "run"))
    parser.add_argument("--cloud", default="")
    parser.add_argument("--name", default="")
    args = parser.parse_args()
    if args.command == "pair":
        cloud = args.cloud or _read_config().get("cloud_url") or ""
        if not cloud:
            raise SystemExit("pass --cloud https://…")
        asyncio.run(pair(cloud.rstrip("/"), args.name or board_name()))
        return
    saved = _read_config()
    cloud = args.cloud or saved.get("cloud_url") or ""
    token = saved.get("device_token") or ""
    if not cloud or not token:
        raise SystemExit("not paired — run: desk_agent.py pair --cloud https://…")
    asyncio.run(Agent(str(cloud), str(token)).connect_forever())


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
