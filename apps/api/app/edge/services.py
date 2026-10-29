"""Discover live local *web pages* on the board (HTML apps + containers).

Machine → Services and chat Preview only surface operator UIs (Vite/Next/etc.).
Board infra APIs (Ollama, llama.cpp, desk FastAPI) stay hidden even if they speak HTTP.
"""

from __future__ import annotations

import json
import re
import subprocess
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# Desk / system listeners we never surface.
_SKIP_PORTS = frozenset({22, 53, 111, 631, 5353, 5355})
# Well-known board LLM / infra ports (not operator web apps).
_INFRA_PORTS = frozenset({11434})  # Ollama
_DESK_API_PORTS = frozenset({8000, 8080, 8787})
_API_SERVER = re.compile(r"(?i)\b(?:llama\.cpp|ollama|uvicorn|fastapi|aiohttp)\b")
_API_BODY = re.compile(
    r"(?i)(?:ollama is running|^\s*\{\s*\"error\"|^\s*\{\s*\"message\"|"
    r"OpenAI-compatible|not_found_error)"
)


def list_services(*, include_containers: bool = True) -> dict:
    pages: list[dict] = []
    for row in _listening_tcp():
        enriched = _enrich_as_page(row)
        if enriched:
            pages.append(enriched)
    pages.sort(key=lambda r: r.get("port") or 0)

    containers: list[dict] = []
    if include_containers:
        for c in _docker_ps():
            url = c.get("url")
            if not url:
                continue
            probe = _probe_http(f"{url}/")
            if not _is_html_page(probe):
                continue
            c = dict(c)
            c["http"] = True
            c["title"] = (probe or {}).get("title")
            c["status"] = (probe or {}).get("status")
            containers.append(c)

    previewable = [s for s in pages + containers if s.get("url")]
    return {
        "services": pages,
        "containers": containers,
        "previewable": previewable,
        "has_preview": bool(previewable),
    }


def _listening_tcp() -> list[dict]:
    rows = _from_ss() or _from_proc_net()
    out: list[dict] = []
    seen: set[int] = set()
    for row in rows:
        port = int(row.get("port") or 0)
        if not port or port in seen or port in _SKIP_PORTS or port in _INFRA_PORTS:
            continue
        if port in _DESK_API_PORTS and _looks_like_desk_api(port):
            continue
        seen.add(port)
        out.append(
            {
                "kind": "listener",
                "port": port,
                "bind": row.get("bind") or "0.0.0.0",
                "process": (row.get("process") or "").strip() or None,
            }
        )
    return out


def _from_ss() -> list[dict]:
    try:
        proc = subprocess.run(
            ["ss", "-ltnp"],
            capture_output=True,
            text=True,
            timeout=4,
            check=False,
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return []
    if proc.returncode != 0 or not proc.stdout:
        return []
    rows: list[dict] = []
    for line in proc.stdout.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 4:
            continue
        local = parts[3]
        if ":" not in local:
            continue
        host, _, port_s = local.rpartition(":")
        if not port_s.isdigit():
            continue
        port = int(port_s)
        bind = host.strip("[]") or "0.0.0.0"
        if bind not in ("0.0.0.0", "*", "::", "::1", "127.0.0.1"):
            if not bind.startswith("127.") and bind != "localhost":
                continue
        m = re.search(r'"([^"]+)"', line)
        rows.append({"port": port, "bind": bind, "process": m.group(1) if m else None})
    return rows


def _from_proc_net() -> list[dict]:
    rows: list[dict] = []
    try:
        text = open("/proc/net/tcp", encoding="utf-8").read()
    except OSError:
        return []
    for line in text.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 4 or parts[3] != "0A":
            continue
        local = parts[1]
        if ":" not in local:
            continue
        ip_hex, port_hex = local.split(":")
        port = int(port_hex, 16)
        try:
            raw = bytes.fromhex(ip_hex)
            ip = ".".join(str(b) for b in raw[::-1])
        except ValueError:
            continue
        if ip not in ("0.0.0.0", "127.0.0.1"):
            continue
        rows.append({"port": port, "bind": ip, "process": None})
    return rows


def _enrich_as_page(row: dict) -> dict | None:
    port = int(row["port"])
    probe = _probe_http(f"http://127.0.0.1:{port}/")
    if not _is_html_page(probe):
        return None
    assert probe is not None
    return {
        "kind": "listener",
        "port": port,
        "bind": row.get("bind") or "0.0.0.0",
        "process": row.get("process"),
        "http": True,
        "likely_web": True,
        "status": probe.get("status"),
        "title": probe.get("title"),
        "server": probe.get("server"),
        "url": f"http://127.0.0.1:{port}",
    }


def _is_html_page(probe: dict | None) -> bool:
    """True only for operator-facing HTML UIs — not JSON/API backends."""
    if not probe:
        return False
    ct = (probe.get("content_type") or "").lower()
    body = probe.get("body") or ""
    server = (probe.get("server") or "").lower()
    if _API_SERVER.search(server):
        return False
    if _API_BODY.search(body):
        return False
    if "ollama" in body.lower():
        return False
    if "application/json" in ct and "<html" not in body.lower() and "<!doctype" not in body.lower():
        return False
    if "text/plain" in ct and "<html" not in body.lower():
        # Ollama and many APIs answer plain text — not a page.
        return False
    if "text/html" in ct:
        return True
    low = body.lower()
    if "<html" in low or "<!doctype html" in low:
        return True
    if probe.get("title"):
        return True
    return False


def _probe_http(url: str) -> dict | None:
    req = Request(url, method="GET", headers={"User-Agent": "Nebius Desk/services"})
    try:
        with urlopen(req, timeout=1.2) as resp:
            raw = resp.read(8192)
            headers = {k.lower(): v for k, v in resp.headers.items()}
            status = getattr(resp, "status", None) or 200
    except HTTPError as exc:
        try:
            raw = exc.read(8192) if hasattr(exc, "read") else b""
        except Exception:  # noqa: BLE001
            raw = b""
        headers = {k.lower(): v for k, v in (exc.headers.items() if exc.headers else [])}
        status = exc.code
    except (URLError, TimeoutError, OSError, ValueError):
        return None
    body = raw.decode("utf-8", errors="ignore") if raw else ""
    title = None
    m = re.search(r"(?is)<title[^>]*>(.*?)</title>", body)
    if m:
        title = re.sub(r"\s+", " ", m.group(1)).strip()[:120] or None
    return {
        "status": status,
        "title": title,
        "server": headers.get("server"),
        "content_type": headers.get("content-type") or "",
        "body": body[:2000],
    }


def _looks_like_desk_api(port: int) -> bool:
    url = f"http://127.0.0.1:{port}/health"
    try:
        with urlopen(Request(url, method="GET"), timeout=0.6) as resp:
            body = resp.read(200).decode("utf-8", errors="ignore")
    except Exception:  # noqa: BLE001
        return False
    return '"ok"' in body or "llm_mode" in body


def _docker_ps() -> list[dict]:
    try:
        proc = subprocess.run(
            ["docker", "ps", "--format", "{{json .}}"],
            capture_output=True,
            text=True,
            timeout=4,
            check=False,
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return []
    if proc.returncode != 0 or not proc.stdout.strip():
        return []
    out: list[dict] = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        ports = row.get("Ports") or ""
        names = (row.get("Names") or row.get("Name") or "").strip()
        image = (row.get("Image") or "").strip()
        out.append(
            {
                "kind": "container",
                "id": (row.get("ID") or "")[:12],
                "name": names,
                "image": image,
                "status": row.get("Status") or "",
                "ports": ports,
                "url": _url_from_docker_ports(ports),
            }
        )
    return out


def _url_from_docker_ports(ports: str) -> str | None:
    m = re.search(r"(?:0\.0\.0\.0|127\.0\.0\.1|\[::\]):(\d+)->", ports or "")
    if not m:
        return None
    port = int(m.group(1))
    if port in _INFRA_PORTS or port in _SKIP_PORTS:
        return None
    return f"http://127.0.0.1:{port}"
