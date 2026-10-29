"""Headless Playwright sessions with screenshots on the desk FS."""

from __future__ import annotations

import base64
import logging
import queue
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypeVar

from app.edge.files import fs_root, resolve_path

log = logging.getLogger(__name__)

ARTIFACTS_REL = ".desk/browser"
T = TypeVar("T")

# sync_playwright binds greenlets to one OS thread — all PW calls must stay here.
_PW_JOBS: queue.Queue = queue.Queue()
_PW_THREAD: threading.Thread | None = None
_PW_THREAD_LOCK = threading.Lock()


def _pw_worker() -> None:
    while True:
        item = _PW_JOBS.get()
        if item is None:
            return
        fn, args, kwargs, out_q = item
        try:
            out_q.put(("ok", fn(*args, **kwargs)))
        except BaseException as exc:  # noqa: BLE001
            out_q.put(("err", exc))


def _ensure_pw_thread() -> None:
    global _PW_THREAD
    with _PW_THREAD_LOCK:
        if _PW_THREAD is not None and _PW_THREAD.is_alive():
            return
        _PW_THREAD = threading.Thread(target=_pw_worker, name="desk-playwright", daemon=True)
        _PW_THREAD.start()


def _on_pw_thread(fn: Callable[..., T], *args, timeout: float = 120.0, **kwargs) -> T:
    """Run fn on the dedicated Playwright thread (required by sync greenlets)."""
    _ensure_pw_thread()
    out_q: queue.Queue = queue.Queue(maxsize=1)
    _PW_JOBS.put((fn, args, kwargs, out_q))
    try:
        status, payload = out_q.get(timeout=timeout)
    except queue.Empty as exc:
        raise TimeoutError("Playwright worker timed out") from exc
    if status == "err":
        raise payload
    return payload


def playwright_available() -> tuple[bool, str]:
    try:
        import playwright  # noqa: F401
        from playwright.sync_api import sync_playwright  # noqa: F401
    except ImportError:
        return False, "Playwright not installed. pip install playwright && playwright install chromium"
    return True, "ok"


@dataclass
class BrowserSession:
    id: str
    user_id: int
    run_dir: Path
    headed: bool = False
    created_at: float = field(default_factory=time.monotonic)
    last_url: str = ""
    last_shot: str | None = None
    _pw: object | None = None
    _browser: object | None = None
    _page: object | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock)


_SESSIONS: dict[int, BrowserSession] = {}
_LOCK = threading.Lock()


def artifacts_root() -> Path:
    path = resolve_path(ARTIFACTS_REL)
    path.mkdir(parents=True, exist_ok=True)
    return path


def list_artifacts(limit: int = 40) -> list[dict]:
    root = artifacts_root()
    files: list[Path] = []
    for run in sorted(root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not run.is_dir():
            continue
        for child in sorted(run.glob("*"), key=lambda p: p.stat().st_mtime, reverse=True):
            if child.suffix.lower() in {".png", ".jpg", ".jpeg", ".webm", ".zip", ".json"}:
                files.append(child)
        if len(files) >= limit:
            break
    out = []
    for path in files[:limit]:
        rel = path.relative_to(fs_root()).as_posix()
        out.append(
            {
                "path": rel,
                "name": path.name,
                "run": path.parent.name,
                "bytes": path.stat().st_size,
                "mtime": path.stat().st_mtime,
                "kind": path.suffix.lstrip(".").lower(),
            }
        )
    return out


def artifact_bytes(rel: str) -> tuple[bytes, str]:
    path = resolve_path(rel)
    if not path.is_file():
        raise FileNotFoundError(rel)
    root = artifacts_root().resolve()
    if root not in path.resolve().parents and path.resolve() != root:
        raise PermissionError("not a browser artifact")
    media = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webm": "video/webm",
        ".zip": "application/zip",
        ".json": "application/json",
    }.get(path.suffix.lower(), "application/octet-stream")
    return path.read_bytes(), media


def status_for(user_id: int) -> dict:
    ok, detail = playwright_available()
    with _LOCK:
        sess = _SESSIONS.get(user_id)
    return {
        "playwright": ok,
        "detail": detail,
        "session_id": sess.id if sess else None,
        "url": sess.last_url if sess else None,
        "last_shot": sess.last_shot if sess else None,
        "headed": bool(sess.headed) if sess else False,
        "artifacts": list_artifacts(12),
    }


def _get_or_open(user_id: int, *, headed: bool = False) -> BrowserSession:
    ok, detail = playwright_available()
    if not ok:
        raise RuntimeError(detail)
    with _LOCK:
        sess = _SESSIONS.get(user_id)
        if sess and sess._page is not None:
            return sess
        # Reuse a warm headless Chromium (API startup /browser/warm) — cold launch is costly.
        if not headed:
            for existing in _SESSIONS.values():
                if existing._page is not None and not existing.headed:
                    _SESSIONS[user_id] = existing
                    return existing
    from playwright.sync_api import sync_playwright

    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    run_dir = artifacts_root() / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    sess = BrowserSession(id=run_id, user_id=user_id, run_dir=run_dir, headed=headed)
    pw = sync_playwright().start()
    try:
        # Jetson-friendly: less shm pressure, faster headless bring-up.
        browser = pw.chromium.launch(
            headless=not headed,
            args=["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"],
        )
        # Smaller viewport = smaller JPEG for desk Live preview over the relay.
        page = browser.new_page(viewport={"width": 960, "height": 540})
    except Exception:
        pw.stop()
        raise
    sess._pw = pw
    sess._browser = browser
    sess._page = page
    with _LOCK:
        old = _SESSIONS.get(user_id)
        _SESSIONS[user_id] = sess
    if old and old is not sess and old.user_id == user_id:
        _close_silent(old)
    return sess


def _warm_impl(user_id: int) -> dict:
    """Start Chromium ahead of the first Preview click (cold start is the slow part)."""
    sess = _get_or_open(user_id, headed=False)
    return {"ok": True, "warm": True, "session_id": sess.id}


def warm_session(user_id: int) -> dict:
    if threading.current_thread() is _PW_THREAD:
        return _warm_impl(user_id)
    return _on_pw_thread(_warm_impl, user_id)


def _close_silent(sess: BrowserSession) -> None:
    with sess._lock:
        try:
            if sess._browser:
                sess._browser.close()  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001
            pass
        try:
            if sess._pw:
                sess._pw.stop()  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001
            pass
        sess._browser = None
        sess._page = None
        sess._pw = None


def _close_session_impl(user_id: int) -> dict:
    with _LOCK:
        sess = _SESSIONS.pop(user_id, None)
        if not sess:
            return {"ok": True, "closed": False}
        # Shared warm session may be aliased to several user ids — only kill when unused.
        if any(other is sess for other in _SESSIONS.values()):
            return {"ok": True, "closed": False, "shared": True, "session_id": sess.id}
    _close_silent(sess)
    return {"ok": True, "closed": True, "session_id": sess.id}


def close_session(user_id: int) -> dict:
    # Avoid deadlock when already on the Playwright worker.
    if threading.current_thread() is _PW_THREAD:
        return _close_session_impl(user_id)
    return _on_pw_thread(_close_session_impl, user_id)


def _shot(sess: BrowserSession, label: str = "shot") -> str:
    page = sess._page
    assert page is not None
    name = f"{int(time.time() * 1000)}-{label}.png"
    path = sess.run_dir / name
    page.screenshot(path=str(path), full_page=False)
    rel = path.relative_to(fs_root()).as_posix()
    sess.last_shot = rel
    return rel


def _shot_preview_jpeg(sess: BrowserSession, label: str = "preview") -> tuple[str, str]:
    """Compact JPEG + base64 for one-trip Live preview (skip artifact re-fetch)."""
    page = sess._page
    assert page is not None
    raw = page.screenshot(type="jpeg", quality=52, full_page=False)
    name = f"{int(time.time() * 1000)}-{label}.jpg"
    path = sess.run_dir / name
    path.write_bytes(raw)
    rel = path.relative_to(fs_root()).as_posix()
    sess.last_shot = rel
    return rel, base64.b64encode(raw).decode("ascii")


def _urls_match(a: str, b: str) -> bool:
    left = (a or "").strip().rstrip("/")
    right = (b or "").strip().rstrip("/")
    return bool(left) and left == right


def _wait_for_app_paint(page: object) -> None:
    try:
        page.wait_for_function(  # type: ignore[union-attr]
            """() => {
              const r = document.querySelector('#root, #app, [data-reactroot]');
              if (!r) return (document.body?.innerText || '').trim().length > 12;
              return r.childElementCount > 0 || (r.textContent || '').trim().length > 0;
            }""",
            timeout=5_000,
        )
    except Exception:  # noqa: BLE001
        page.wait_for_timeout(400)  # type: ignore[union-attr]


_VIEWPORT_MIN, _VIEWPORT_MAX = 240, 1920
_INTERACT_KEYS = {
    "Enter", "Backspace", "Tab", "Escape", "Delete", "Home", "End", "PageUp", "PageDown",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space",
}


def _apply_viewport(page: object, params: dict) -> None:
    width, height = params.get("width"), params.get("height")
    if not isinstance(width, int) or not isinstance(height, int):
        return
    width = max(_VIEWPORT_MIN, min(_VIEWPORT_MAX, width))
    height = max(_VIEWPORT_MIN, min(_VIEWPORT_MAX, height))
    current = page.viewport_size or {}  # type: ignore[union-attr]
    if current.get("width") != width or current.get("height") != height:
        page.set_viewport_size({"width": width, "height": height})  # type: ignore[union-attr]


def _interact(page: object, params: dict) -> str | None:
    """Apply one desk Live preview input. Returns an error string or None."""
    kind = str(params.get("input") or "").strip().lower()
    if kind == "click":
        x, y = params.get("x"), params.get("y")
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            return "x and y required"
        size = page.viewport_size or {"width": 960, "height": 540}  # type: ignore[union-attr]
        px = max(0.0, min(1.0, float(x))) * size["width"]
        py = max(0.0, min(1.0, float(y))) * size["height"]
        page.mouse.click(px, py)  # type: ignore[union-attr]
        return None
    if kind == "scroll":
        dy = params.get("dy")
        if not isinstance(dy, (int, float)):
            return "dy required"
        page.mouse.wheel(0, max(-4000.0, min(4000.0, float(dy))))  # type: ignore[union-attr]
        return None
    if kind == "key":
        key = str(params.get("key") or "")
        if key not in _INTERACT_KEYS:
            return f"unsupported key {key[:20]}"
        page.keyboard.press(key)  # type: ignore[union-attr]
        return None
    if kind == "text":
        text = str(params.get("text") or "")[:500]
        if not text:
            return "text required"
        page.keyboard.insert_text(text)  # type: ignore[union-attr]
        return None
    return f"unknown input {kind[:20]}"


def run_action(user_id: int, action: str, params: dict) -> dict:
    """Execute one browser action on the Playwright worker thread."""
    kind = (action or "").strip().lower()
    # Live preview must never sit for minutes on the relay (90s start timeout).
    timeout = 22.0 if kind in {"preview", "warm", "interact"} else 120.0
    return _on_pw_thread(_run_action_impl, user_id, action, params, timeout=timeout)


def _run_action_impl(user_id: int, action: str, params: dict) -> dict:
    """Execute one browser action. Returns a tool-shaped dict."""
    action = (action or "").strip().lower()
    headed = bool(params.get("headed"))
    if action in ("close", "stop"):
        return {"kind": "browse", "ok": True, "action": "close", **_close_session_impl(user_id)}

    if action == "warm":
        return {"kind": "browse", "ok": True, "action": "warm", **_warm_impl(user_id)}

    sess = _get_or_open(user_id, headed=headed)
    with sess._lock:
        page = sess._page
        assert page is not None
        try:
            if action == "interact":
                _apply_viewport(page, params)
                problem = _interact(page, params)
                if problem:
                    return {"kind": "browse", "ok": False, "action": action, "error": problem}
                # Let React/Vite handlers settle before the frame (no networkidle — HMR socket).
                page.wait_for_timeout(180)
                sess.last_url = page.url
                shot, image_b64 = _shot_preview_jpeg(sess, "interact")
                return {
                    "kind": "browse",
                    "ok": True,
                    "action": "interact",
                    "url": sess.last_url,
                    "shot": shot,
                    "image_b64": image_b64,
                    "image_mime": "image/jpeg",
                }
            if action == "preview":
                url = str(params.get("url") or "").strip()
                if not url:
                    return {"kind": "browse", "ok": False, "action": action, "error": "url required"}
                _apply_viewport(page, params)
                # Always hard-load. Soft reshot kept a crashed ErrorBoundary visible after
                # the agent patched the app — Refresh must show the repair.
                if _urls_match(sess.last_url, url):
                    page.reload(wait_until="domcontentloaded", timeout=25_000)
                    reloaded = True
                else:
                    page.goto(url, wait_until="domcontentloaded", timeout=25_000)
                    reloaded = False
                _wait_for_app_paint(page)
                sess.last_url = page.url
                shot, image_b64 = _shot_preview_jpeg(sess, "preview")
                return {
                    "kind": "browse",
                    "ok": True,
                    "action": "preview",
                    "url": sess.last_url,
                    "shot": shot,
                    "image_b64": image_b64,
                    "image_mime": "image/jpeg",
                    "cached_nav": False,
                    "reloaded": reloaded,
                }
            if action in ("navigate", "goto", "open"):
                url = str(params.get("url") or "").strip()
                if not url:
                    return {"kind": "browse", "ok": False, "action": action, "error": "url required"}
                page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                sess.last_url = page.url
                shot = _shot(sess, "nav")
                return {
                    "kind": "browse",
                    "ok": True,
                    "action": action,
                    "url": sess.last_url,
                    "shot": shot,
                }
            if action in ("screenshot", "shot"):
                shot = _shot(sess, "manual")
                return {
                    "kind": "browse",
                    "ok": True,
                    "action": "screenshot",
                    "url": page.url,
                    "shot": shot,
                }
            if action == "snapshot":
                # Accessibility-ish text dump for the model.
                title = page.title()
                body = page.inner_text("body")[:6000]
                shot = _shot(sess, "snap")
                return {
                    "kind": "browse",
                    "ok": True,
                    "action": "snapshot",
                    "url": page.url,
                    "title": title,
                    "text": body,
                    "shot": shot,
                }
            if action == "click":
                sel = str(params.get("selector") or "").strip()
                if not sel:
                    return {"kind": "browse", "ok": False, "action": action, "error": "selector required"}
                page.click(sel, timeout=15_000)
                sess.last_url = page.url
                shot = _shot(sess, "click")
                return {
                    "kind": "browse",
                    "ok": True,
                    "action": "click",
                    "selector": sel,
                    "url": sess.last_url,
                    "shot": shot,
                }
            if action == "type":
                sel = str(params.get("selector") or "").strip()
                text = str(params.get("text") or "")
                if not sel:
                    return {"kind": "browse", "ok": False, "action": action, "error": "selector required"}
                page.fill(sel, text, timeout=15_000)
                shot = _shot(sess, "type")
                return {
                    "kind": "browse",
                    "ok": True,
                    "action": "type",
                    "selector": sel,
                    "url": page.url,
                    "shot": shot,
                }
            return {"kind": "browse", "ok": False, "action": action, "error": f"unknown action {action}"}
        except Exception as exc:  # noqa: BLE001
            log.exception("browser action %s failed", action)
            try:
                shot = _shot(sess, "error")
            except Exception:  # noqa: BLE001
                shot = sess.last_shot
            return {
                "kind": "browse",
                "ok": False,
                "action": action,
                "error": f"{type(exc).__name__}: {exc}",
                "shot": shot,
                "url": getattr(page, "url", None),
            }


def shot_data_url(rel: str | None) -> str | None:
    if not rel:
        return None
    try:
        raw, _media = artifact_bytes(rel)
    except (OSError, FileNotFoundError, PermissionError):
        return None
    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:image/png;base64,{b64}"
