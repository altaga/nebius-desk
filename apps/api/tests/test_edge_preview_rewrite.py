from urllib.parse import unquote

from app.edge.preview import (
    _DESK_BASE,
    _desk_base_from_referer,
    _proxied_url,
    _rewrite_html,
    _rewrite_text_asset,
)


def test_proxied_url_embeds_desk_base():
    prefix = "/api/desk/v1/devices/abc/api/edge/preview/5173/"
    url = _proxied_url("@vite/client", prefix)
    assert url.startswith(f"{prefix}@vite/client?")
    assert f"{_DESK_BASE}=" in url
    assert unquote(url.split(f"{_DESK_BASE}=", 1)[1]) == prefix
    # Idempotent when already tagged.
    assert _proxied_url(url.lstrip("/"), prefix) == url or _DESK_BASE in _proxied_url(
        url.lstrip("/"), prefix
    )


def test_rewrite_root_absolute_and_base():
    html = (
        b"<html><head></head><body>"
        b'<script src="/src/main.jsx"></script>'
        b'<a href="/about">x</a>'
        b"</body></html>"
    )
    prefix = "/api/desk/v1/devices/abc/api/edge/preview/5173/"
    out = _rewrite_html(html, prefix)
    text = out.decode()
    assert f'src="{prefix}src/main.jsx?{_DESK_BASE}=' in text
    assert f'href="{prefix}about?{_DESK_BASE}=' in text
    assert f'<base href="{prefix}">' in text


def test_rewrite_inline_vite_refresh_import():
    html = (
        b"<html><head>"
        b'<script type="module">import { injectIntoGlobalHook } from "/@react-refresh";</script>'
        b'<script type="module" src="/@vite/client"></script>'
        b"</head><body></body></html>"
    )
    prefix = "/api/desk/v1/devices/abc/api/edge/preview/5173/"
    text = _rewrite_html(html, prefix).decode()
    assert f'from "{prefix}@react-refresh?{_DESK_BASE}=' in text
    assert f'src="{prefix}@vite/client?{_DESK_BASE}=' in text


def test_rewrite_js_module_absolute_imports():
    js = b'import RefreshRuntime from "/@react-refresh";\nimport "/src/main.tsx";\n'
    prefix = "/api/desk/v1/devices/abc/api/edge/preview/5173/"
    text = _rewrite_text_asset(js, prefix).decode()
    assert f'from "{prefix}@react-refresh?{_DESK_BASE}=' in text
    assert f'import "{prefix}src/main.tsx?{_DESK_BASE}=' in text
    again = _rewrite_text_asset(text.encode(), prefix).decode()
    assert again.count(_DESK_BASE) == text.count(_DESK_BASE)


def test_desk_base_from_referer_path_and_query():
    prefix = "/api/desk/v1/devices/abc/api/edge/preview/5173/"
    assert (
        _desk_base_from_referer(f"https://desk.example{prefix}?__desk_base={prefix}")
        == prefix
    )
    assert _desk_base_from_referer(f"https://desk.example{prefix}@vite/client") == prefix
    assert _desk_base_from_referer("https://desk.example/dashboard") is None
