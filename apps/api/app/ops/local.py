"""Board-local ops ring — aggregate when cloud ingest is offline."""

from __future__ import annotations

import threading
import time
from collections import Counter, deque
from typing import Any

_LOCK = threading.Lock()
_RING: deque[dict[str, Any]] = deque(maxlen=500)


def record_local(event: dict[str, Any]) -> None:
    row = {
        "ts": time.time(),
        "kind": event.get("kind"),
        "status": event.get("status"),
        "error_code": event.get("error_code"),
        "route": event.get("route"),
        "model": event.get("model"),
        "features": event.get("features") if isinstance(event.get("features"), dict) else {},
        "note": (event.get("note") or "")[:200],
    }
    with _LOCK:
        _RING.append(row)


def summary(*, hours: float = 24.0) -> dict[str, Any]:
    cutoff = time.time() - max(0.1, hours) * 3600
    with _LOCK:
        rows = [r for r in _RING if r["ts"] >= cutoff]
    by_kind = Counter(r.get("kind") or "?" for r in rows)
    by_status = Counter(r.get("status") or "?" for r in rows)
    errors = [r for r in rows if r.get("status") == "error"]
    return {
        "hours": hours,
        "total": len(rows),
        "by_kind": dict(by_kind),
        "by_status": dict(by_status),
        "error_count": len(errors),
        "recent_errors": errors[-20:],
    }
