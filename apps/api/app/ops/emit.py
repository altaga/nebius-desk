"""Fire-and-forget ops events to the cloud Worker (privacy applied server-side)."""

from __future__ import annotations

import logging
import secrets
import threading
import time
from typing import Any

import httpx

from app.cloudlink import cloud_config

log = logging.getLogger(__name__)


def new_trace_id() -> str:
    return f"req_{secrets.token_hex(10)}"


def _len_bucket(text: str) -> str:
    n = len((text or "").strip())
    if n <= 20:
        return "0-20"
    if n <= 80:
        return "21-80"
    if n <= 200:
        return "81-200"
    if n <= 500:
        return "201-500"
    return "500+"


def _guess_lang(text: str) -> str:
    t = (text or "").lower()
    if any(c in t for c in "áéíóúñ¿¡") or any(
        w in t for w in ("hola", "gracias", "abre", "terminal", "ayuda", "ayúdame")
    ):
        return "es"
    if any(w in t for w in (" the ", "please", "open", "thanks", "hello", "help")):
        return "en"
    return "und"


def chat_features(input_text: str, output_text: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "msg_len": _len_bucket(input_text),
        "reply_len": _len_bucket(output_text),
        "lang": _guess_lang(input_text),
        "has_run_fence": "```run" in (output_text or ""),
    }
    if extra:
        out.update(extra)
    return out


def tool_features(item: dict[str, Any]) -> dict[str, Any]:
    """Privacy-safe tool summary; cloud strips command for non-admin."""
    kind = item.get("kind")
    features: dict[str, Any] = {
        "tool_kind": kind,
        "ok": item.get("ok"),
        "exit_code": item.get("exit_code"),
        "timed_out": bool(item.get("timed_out")),
        "skipped": bool(item.get("skipped")),
        "approval": "skipped" if item.get("skipped") else "none",
    }
    if item.get("reason"):
        features["reason"] = str(item.get("reason"))[:80]
    cmd = item.get("command")
    if isinstance(cmd, str) and cmd.strip():
        features["command_preview"] = cmd.strip()[:160]
    out = (item.get("stdout") or "")[:0]  # length only
    err = item.get("stderr") or ""
    features["stdout_len"] = _len_bucket(str(item.get("stdout") or out))
    features["stderr_len"] = _len_bucket(str(err))
    return features


def emit_ops(event: dict[str, Any]) -> None:
    """Non-blocking. Cloud decides full vs redacted from the device owner's username."""
    try:
        from app.ops.local import record_local

        record_local(event)
    except Exception:  # noqa: BLE001
        pass
    cloud = cloud_config()
    if not cloud:
        log.info(
            "ops_local %s",
            {k: event.get(k) for k in ("kind", "status", "error_code", "route", "model", "trace_id", "phase")},
        )
        return

    def _send() -> None:
        url, token = cloud
        try:
            httpx.post(
                f"{url}/v1/ops/ingest",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=event,
                timeout=3.0,
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("ops_ingest_failed: %s", type(exc).__name__)

    threading.Thread(target=_send, daemon=True).start()


def emit_tool_results(
    *,
    trace_id: str,
    session_id: str | None,
    results: list[dict[str, Any]],
) -> None:
    """One ops row per tool attempt — easy to read as a timeline."""
    for item in results or []:
        kind = item.get("kind") or "tool"
        skipped = bool(item.get("skipped"))
        ok = item.get("ok")
        if skipped:
            status = "skipped"
            error_code = str(item.get("reason") or "approval_required")[:80]
        elif ok is False or (item.get("exit_code") not in (None, 0) and kind == "run"):
            status = "error"
            error_code = str(item.get("error") or f"exit_{item.get('exit_code')}" or "tool_failed")[:80]
        else:
            status = "ok"
            error_code = None
        emit_ops(
            {
                "kind": "tool",
                "status": status,
                "error_code": error_code,
                "phase": "result",
                "trace_id": trace_id,
                "session_id": session_id,
                "route": str(kind)[:40],
                "path": (item.get("path") or None),
                "features": tool_features(item),
                "note": f"{kind}:{status}",
            }
        )
        # tiny stagger so cloud timestamps / ids stay ordered under load
        time.sleep(0.01)
