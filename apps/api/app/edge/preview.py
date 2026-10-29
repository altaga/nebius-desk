"""HTTP reverse proxy: desk UI ↔ board localhost web apps (interactive Preview)."""

from __future__ import annotations

import re
from urllib.parse import parse_qsl, quote, urlencode, urlsplit

import httpx
from fastapi import HTTPException, Request
from fastapi.responses import Response

from app.edge.services import list_services

_DESK_BASE = "__desk_base"
_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}
# Browsers must be allowed to iframe the proxied app inside the desk.
_STRIP_RESP = {
    "content-security-policy",
    "content-security-policy-report-only",
    "x-frame-options",
    "frame-options",
}
_ROOT_ATTR = re.compile(
    r"""(?i)(\b(?:src|href|action|poster)\s*=\s*)(?P<q>["'])/(?!/)(?P<path>[^"']*)(?P=q)"""
)
_ROOT_CSS = re.compile(r"""(?i)url\(\s*(?P<q>['"]?)/(?!/)(?P<path>[^)'"]*)(?P=q)\s*\)""")
# Vite modules use origin-absolute imports: from "/@vite/client", "/node_modules/…"
_ROOT_PATH_STR = re.compile(
    r"""(?P<q>["'`])/(?!/)(?P<path>[^"'`\\]*(?:\\.[^"'`\\]*)*)(?P=q)"""
)
_REWRITE_SUFFIXES = (
    ".html",
    ".htm",
    ".js",
    ".mjs",
    ".cjs",
    ".css",
    ".jsx",
    ".tsx",
    ".ts",
    ".map",
)
# Browser-facing prefix (BFF + device id). Board-local /api/edge/preview/N is not enough.
_PREVIEW_BASE_RE = re.compile(r"(/api/desk/v1/devices/[^/]+/api/edge/preview/\d+/?)")


def _allowed_ports() -> set[int]:
    snap = list_services()
    out: set[int] = set()
    for row in snap.get("services") or []:
        port = row.get("port")
        if isinstance(port, int) and 1 <= port <= 65535:
            out.add(port)
    for row in snap.get("previewable") or []:
        url = str(row.get("url") or "")
        m = re.search(r":(\d{2,5})\b", url)
        if m:
            out.add(int(m.group(1)))
    return out


def _target_url(port: int, path: str, query: str) -> str:
    clean = (path or "").lstrip("/")
    base = f"http://127.0.0.1:{port}/"
    if clean:
        base = f"http://127.0.0.1:{port}/{clean}"
    if query:
        return f"{base}?{query}"
    return base


def _filter_query(query: str) -> tuple[str, str | None]:
    """Drop desk-only params before forwarding to the app."""
    desk_base: str | None = None
    kept: list[tuple[str, str]] = []
    for k, v in parse_qsl(query, keep_blank_values=True):
        if k == _DESK_BASE:
            desk_base = v
            continue
        kept.append((k, v))
    return urlencode(kept), desk_base


def _normalize_prefix(desk_base: str) -> str:
    return desk_base if desk_base.endswith("/") else desk_base + "/"


def _desk_base_from_referer(referer: str | None) -> str | None:
    """Subresource requests omit __desk_base — recover it from the iframe Referer."""
    if not referer:
        return None
    parts = urlsplit(referer)
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        if key == _DESK_BASE and value.strip():
            return _normalize_prefix(value.strip())
    match = _PREVIEW_BASE_RE.search(parts.path or "")
    if match:
        return _normalize_prefix(match.group(1))
    return None


def _resolve_desk_base(request: Request, from_query: str | None) -> str | None:
    if from_query and from_query.strip():
        return _normalize_prefix(from_query.strip())
    header = (request.headers.get("x-desk-preview-base") or "").strip()
    if header:
        return _normalize_prefix(header)
    return _desk_base_from_referer(request.headers.get("referer"))


def _proxied_url(path: str, prefix: str) -> str:
    """Map a root-absolute app path onto the desk preview URL, carrying __desk_base.

    Subresource requests go through the BFF without Referer forwarding, so every
    rewritten asset URL must include __desk_base for the next hop to rewrite JS.
    """
    marker = prefix.lstrip("/")
    cleaned = (path or "").lstrip("/")
    if cleaned.startswith(marker):
        abs_path = "/" + cleaned
    else:
        abs_path = prefix + cleaned
    if f"{_DESK_BASE}=" in abs_path:
        return abs_path
    token = f"{_DESK_BASE}={quote(prefix, safe='')}"
    return f"{abs_path}&{token}" if "?" in abs_path else f"{abs_path}?{token}"


def _rewrite_root_path_strings(text: str, prefix: str) -> str:
    """Map origin-absolute "/…" string literals onto the desk preview prefix."""

    def repl(match: re.Match[str]) -> str:
        path = match.group("path")
        if not path or path.startswith("//"):
            return match.group(0)
        q = match.group("q")
        return f"{q}{_proxied_url(path, prefix)}{q}"

    return _ROOT_PATH_STR.sub(repl, text)


def _rewrite_attr_and_css(text: str, prefix: str) -> str:
    def attr_repl(match: re.Match[str]) -> str:
        q = match.group("q")
        return f"{match.group(1)}{q}{_proxied_url(match.group('path'), prefix)}{q}"

    def css_repl(match: re.Match[str]) -> str:
        q = match.group("q") or ""
        return f"url({q}{_proxied_url(match.group('path'), prefix)}{q})"

    text = _ROOT_ATTR.sub(attr_repl, text)
    return _ROOT_CSS.sub(css_repl, text)


def _rewrite_html(body: bytes, desk_base: str | None) -> bytes:
    if not desk_base:
        return body
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError:
        return body
    prefix = _normalize_prefix(desk_base)
    # Root-absolute URLs must be remapped — <base> does not affect "/…".
    text = _rewrite_attr_and_css(text, prefix)
    # Inline Vite bootstrap: import … from "/@react-refresh"
    text = _rewrite_root_path_strings(text, prefix)
    if "<base" not in text.lower():
        injection = f'<base href="{prefix}">'
        if re.search(r"(?i)<head[^>]*>", text):
            text = re.sub(r"(?i)<head([^>]*)>", rf"<head\1>{injection}", text, count=1)
        else:
            text = injection + text
    return text.encode("utf-8")


def _rewrite_text_asset(body: bytes, desk_base: str | None) -> bytes:
    """Rewrite root-absolute paths inside JS/CSS modules (Vite deps)."""
    if not desk_base:
        return body
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError:
        return body
    prefix = _normalize_prefix(desk_base)
    text = _rewrite_attr_and_css(text, prefix)
    text = _rewrite_root_path_strings(text, prefix)
    return text.encode("utf-8")


def _should_rewrite_asset(ctype: str, path: str) -> bool:
    c = (ctype or "").lower()
    if "text/css" in c or "javascript" in c or "ecmascript" in c:
        return True
    if "json" in c and path.lower().endswith(".map"):
        return True
    lower = (path or "").lower().split("?", 1)[0]
    return lower.endswith(_REWRITE_SUFFIXES)


async def proxy_localhost(port: int, path: str, request: Request) -> Response:
    if not (1 <= port <= 65535):
        raise HTTPException(status_code=400, detail="invalid port")
    allowed = _allowed_ports()
    if port not in allowed:
        raise HTTPException(
            status_code=404,
            detail="No previewable web service on that port. Start Vite/Next on the board first.",
        )

    fwd_query, desk_base_q = _filter_query(urlsplit(str(request.url)).query)
    desk_base = _resolve_desk_base(request, desk_base_q)
    target = _target_url(port, path, fwd_query)

    headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in _HOP_HEADERS and not k.lower().startswith("x-")
    }
    headers["host"] = f"127.0.0.1:{port}"
    # Avoid compressed bodies we then rewrite as text.
    headers.pop("accept-encoding", None)

    body = None if request.method in ("GET", "HEAD") else await request.body()
    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=30.0) as client:
            upstream = await client.request(
                request.method,
                target,
                headers=headers,
                content=body,
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"preview upstream: {exc}") from exc

    out_headers = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower() not in _HOP_HEADERS and k.lower() not in _STRIP_RESP
    }
    payload = upstream.content
    ctype = (upstream.headers.get("content-type") or "").lower()
    if "text/html" in ctype:
        payload = _rewrite_html(payload, desk_base)
        out_headers.pop("content-length", None)
    elif _should_rewrite_asset(ctype, path):
        payload = _rewrite_text_asset(payload, desk_base)
        out_headers.pop("content-length", None)

    # Keep Location redirects on the board localhost remapped into the desk proxy.
    loc = out_headers.get("location") or out_headers.get("Location")
    if loc and desk_base:
        parts = urlsplit(loc)
        if parts.hostname in (None, "127.0.0.1", "localhost"):
            suffix = parts.path or "/"
            if parts.query:
                suffix = f"{suffix}?{parts.query}"
            base = _normalize_prefix(desk_base)
            # Absolute path on localhost → under desk proxy.
            if suffix.startswith("/"):
                out_headers["location"] = base.rstrip("/") + suffix
            else:
                out_headers["location"] = base + suffix

    return Response(content=payload, status_code=upstream.status_code, headers=out_headers)
