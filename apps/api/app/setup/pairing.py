"""Start / poll cloud pairing from the board API so the Web UI can read the Pair ID."""

from __future__ import annotations

import os
import socket
import threading
import time
from typing import Any

import httpx

from app.config import get_settings
from app.setup.store import is_paired, write_agent

_LOCK = threading.Lock()
_IDLE = {
    "status": "idle",
    "code": None,
    "poll_token": None,
    "expires_at": 0.0,
    "device_id": None,
    "error": None,
}
_STATE: dict[str, Any] = dict(_IDLE)


def reset_for_tests() -> None:
    with _LOCK:
        _STATE.clear()
        _STATE.update(_IDLE)


def cloud_base() -> str:
    settings = get_settings()
    return (settings.desk_cloud_url or settings.cloud_url or os.environ.get("CLOUD_URL") or "").rstrip("/")


def snapshot() -> dict[str, Any]:
    if is_paired():
        return {"status": "paired", "code": None, "expires_in": None, "device_id": _STATE.get("device_id"), "error": None}
    now = time.time()
    with _LOCK:
        expires_at = float(_STATE.get("expires_at") or 0)
        expires_in = max(0, int(expires_at - now)) if expires_at else None
        code = _STATE.get("code") if expires_at > now else None
        status = "pending" if code else (_STATE.get("status") if _STATE.get("status") != "pending" else "idle")
        return {
            "status": "paired" if _STATE.get("status") == "paired" else status,
            "code": code,
            "expires_in": expires_in if code else None,
            "device_id": _STATE.get("device_id"),
            "error": _STATE.get("error"),
        }


def start_or_resume(name: str) -> dict[str, Any]:
    current = snapshot()
    if current.get("status") == "paired":
        return current
    if current.get("code"):
        return current
    cloud = cloud_base()
    if not cloud:
        raise RuntimeError("cloud_url_missing")
    host = socket.gethostname().strip() or "jetson"
    with httpx.Client(timeout=20) as client:
        started = client.post(f"{cloud}/v1/pair/start", json={"name": name, "hostname": host})
        started.raise_for_status()
        data = started.json()
    code = str(data.get("code") or "")
    token = str(data.get("poll_token") or "")
    ttl = int(data.get("expires_in") or 600)
    if not code or not token:
        raise RuntimeError("pair_start_invalid")
    with _LOCK:
        _STATE.update(
            {
                "status": "pending",
                "code": code,
                "poll_token": token,
                "expires_at": time.time() + ttl,
                "device_id": None,
                "error": None,
            }
        )
    threading.Thread(target=_poll_until_claimed, args=(cloud, token, ttl), daemon=True).start()
    return snapshot()


def _poll_until_claimed(cloud: str, poll_token: str, ttl: int) -> None:
    deadline = time.time() + max(30, ttl)
    try:
        with httpx.Client(timeout=20) as client:
            while time.time() < deadline:
                polled = client.post(f"{cloud}/v1/pair/poll", json={"poll_token": poll_token})
                if polled.status_code == 410:
                    with _LOCK:
                        _STATE.update({"status": "expired", "code": None, "error": "pair_code_expired"})
                    return
                if polled.status_code >= 400:
                    time.sleep(2)
                    continue
                body = polled.json()
                if body.get("status") == "paired":
                    write_agent(cloud, str(body["device_id"]), str(body["device_token"]))
                    with _LOCK:
                        _STATE.update(
                            {
                                "status": "paired",
                                "code": None,
                                "poll_token": None,
                                "device_id": body.get("device_id"),
                                "error": None,
                            }
                        )
                    return
                time.sleep(2)
        with _LOCK:
            _STATE.update({"status": "expired", "code": None, "error": "pair_code_expired"})
    except httpx.HTTPError as exc:
        with _LOCK:
            _STATE.update({"status": "error", "error": str(exc)[:180]})
