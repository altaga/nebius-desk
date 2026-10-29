"""Probe pack — answer 'is it me or the service?' from the board's network."""

from __future__ import annotations

import socket
import ssl
import time
from urllib.parse import urlparse

import httpx

Verdict = str  # local_network | remote_service | auth | unknown | ok


def _host_port(target: str) -> tuple[str, int, str]:
    raw = (target or "").strip()
    if "://" not in raw:
        if raw.startswith("/") or raw.replace(".", "").isdigit() is False and ":" not in raw:
            # bare hostname → https
            raw = "https://" + raw
        elif ":" in raw and not raw.startswith("["):
            host, _, port = raw.partition(":")
            return host, int(port or 443), "tcp"
        else:
            raw = "https://" + raw
    parsed = urlparse(raw)
    host = parsed.hostname or ""
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return host, port, parsed.scheme or "https"


def probe_target(target: str, *, timeout_s: float = 8.0) -> dict:
    host, port, scheme = _host_port(target)
    out: dict = {
        "target": target.strip(),
        "host": host,
        "port": port,
        "scheme": scheme,
        "dns_ok": False,
        "tcp_ok": False,
        "tls_ok": None,
        "http_status": None,
        "latency_ms": None,
        "verdict": "unknown",
        "detail": "",
    }
    if not host:
        out["detail"] = "empty host"
        out["verdict"] = "unknown"
        return out

    t0 = time.monotonic()
    try:
        socket.getaddrinfo(host, port)
        out["dns_ok"] = True
    except OSError as exc:
        out["detail"] = f"dns failed: {exc}"
        out["verdict"] = "local_network"
        out["latency_ms"] = int((time.monotonic() - t0) * 1000)
        return out

    try:
        with socket.create_connection((host, port), timeout=timeout_s):
            out["tcp_ok"] = True
    except OSError as exc:
        out["detail"] = f"tcp failed: {exc}"
        out["verdict"] = "remote_service"
        out["latency_ms"] = int((time.monotonic() - t0) * 1000)
        return out

    if scheme in ("https", "tls"):
        try:
            ctx = ssl.create_default_context()
            with socket.create_connection((host, port), timeout=timeout_s) as sock:
                with ctx.wrap_socket(sock, server_hostname=host):
                    out["tls_ok"] = True
        except OSError as exc:
            out["tls_ok"] = False
            out["detail"] = f"tls failed: {exc}"
            out["verdict"] = "remote_service"
            out["latency_ms"] = int((time.monotonic() - t0) * 1000)
            return out

    if scheme in ("http", "https"):
        url = target.strip() if "://" in target else f"{scheme}://{host}:{port}/"
        try:
            with httpx.Client(timeout=timeout_s, follow_redirects=True) as client:
                resp = client.get(url)
            out["http_status"] = resp.status_code
            out["latency_ms"] = int((time.monotonic() - t0) * 1000)
            if resp.status_code in (401, 403):
                out["verdict"] = "auth"
                out["detail"] = f"HTTP {resp.status_code}"
            elif resp.status_code >= 500:
                out["verdict"] = "remote_service"
                out["detail"] = f"HTTP {resp.status_code}"
            elif resp.status_code >= 400:
                out["verdict"] = "remote_service"
                out["detail"] = f"HTTP {resp.status_code}"
            else:
                out["verdict"] = "ok"
                out["detail"] = f"HTTP {resp.status_code}"
            return out
        except httpx.HTTPError as exc:
            out["detail"] = f"http failed: {exc}"
            out["verdict"] = "remote_service"
            out["latency_ms"] = int((time.monotonic() - t0) * 1000)
            return out

    out["latency_ms"] = int((time.monotonic() - t0) * 1000)
    out["verdict"] = "ok"
    out["detail"] = "tcp ok"
    return out
