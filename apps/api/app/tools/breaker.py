"""Circuit breaker for flaky external services — fail soft, don't kill the turn."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field


@dataclass
class _State:
    failures: int = 0
    opened_at: float | None = None
    last_error: str = ""


_LOCK = threading.Lock()
_STATES: dict[str, _State] = {}


@dataclass
class BreakerConfig:
    name: str
    failure_threshold: int = 3
    reset_after_s: float = 60.0


def _state(name: str) -> _State:
    with _LOCK:
        if name not in _STATES:
            _STATES[name] = _State()
        return _STATES[name]


def is_open(name: str, *, reset_after_s: float = 60.0) -> bool:
    st = _state(name)
    with _LOCK:
        if st.opened_at is None:
            return False
        if time.monotonic() - st.opened_at >= reset_after_s:
            st.opened_at = None
            st.failures = 0
            return False
        return True


def record_success(name: str) -> None:
    st = _state(name)
    with _LOCK:
        st.failures = 0
        st.opened_at = None
        st.last_error = ""


def record_failure(name: str, error: str, *, threshold: int = 3, reset_after_s: float = 60.0) -> bool:
    """Return True if the breaker is now open."""
    st = _state(name)
    with _LOCK:
        st.failures += 1
        st.last_error = (error or "")[:300]
        if st.failures >= threshold:
            st.opened_at = time.monotonic()
            return True
        return st.opened_at is not None


def status(name: str | None = None) -> dict:
    with _LOCK:
        if name:
            st = _STATES.get(name) or _State()
            return {
                "name": name,
                "open": st.opened_at is not None,
                "failures": st.failures,
                "last_error": st.last_error,
            }
        return {
            k: {
                "open": v.opened_at is not None,
                "failures": v.failures,
                "last_error": v.last_error,
            }
            for k, v in _STATES.items()
        }


def reset(name: str | None = None) -> None:
    with _LOCK:
        if name:
            _STATES.pop(name, None)
        else:
            _STATES.clear()
