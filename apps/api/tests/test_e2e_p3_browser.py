"""E2E for P3: Playwright browser tools + artifacts API (soft-fail without browsers)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from app.browser import runtime
from app.config import get_settings
from app.main import create_app
from app.router.types import RoutePlan, RouteResult, TextDelta


def _plan() -> RoutePlan:
    return RoutePlan(
        route="local",
        model="test-model",
        intent="browse",
        messages=[],
        thinking=False,
        original_tokens=8,
        compressed=False,
        compression_tokens=0,
        note="e2e-p3",
        selector="rules",
        selector_reason="test",
        selector_ms=1,
    )


def _result(reply: str) -> RouteResult:
    return RouteResult(
        reply=reply,
        route="local",
        model="test-model",
        intent="browse",
        original_tokens=8,
        sent_tokens=8,
        saved_tokens=0,
        saved_pct=0.0,
        nebius_tokens=0,
        local_tokens=8,
        prompt_tokens=8,
        completion_tokens=4,
        cost_usd=0.0,
        latency_ms=1,
        context_window=4096,
    )


@pytest.fixture
def desk_fs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    root = tmp_path / "desk"
    root.mkdir()
    monkeypatch.setenv("DESK_FS_ROOT", str(root))
    get_settings.cache_clear()
    yield root
    get_settings.cache_clear()
    # Close any leftover sessions from this user id space.
    for uid in list(getattr(runtime, "_SESSIONS", {})):
        runtime.close_session(uid)


@pytest.fixture
def client(desk_fs: Path) -> Iterator[TestClient]:
    app = create_app()
    with TestClient(app) as tc:
        yield tc


def _login(client: TestClient) -> str:
    settings = get_settings()
    resp = client.post(
        "/api/auth/login",
        json={
            "username": settings.bootstrap_username,
            "password": settings.bootstrap_password,
            "totp_code": "",
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _install_llm(monkeypatch: pytest.MonkeyPatch, replies: list[str]) -> None:
    call_i = {"n": 0}

    async def fake_plan_route(*_a, **_k) -> RoutePlan:
        return _plan()

    async def fake_run_plan(_settings, _plan) -> AsyncIterator:
        idx = call_i["n"]
        call_i["n"] += 1
        text = replies[idx] if idx < len(replies) else "done."
        yield TextDelta(text=text, kind="text")
        yield _result(text)

    monkeypatch.setattr("app.chat.turns.plan_route", fake_plan_route)
    monkeypatch.setattr("app.chat.turns.run_plan", fake_run_plan)


def _stream(client: TestClient, token: str, content: str) -> list[dict]:
    events: list[dict] = []
    with client.stream(
        "POST",
        "/api/chat/message/stream",
        headers={"Authorization": f"Bearer {token}"},
        json={"content": content, "session_id": None, "device_id": None, "model": "local"},
        timeout=90.0,
    ) as resp:
        assert resp.status_code == 200, resp.read()
        for line in resp.iter_lines():
            if not line.startswith("data: "):
                continue
            ev = json.loads(line[6:])
            events.append(ev)
            if ev.get("type") in ("done", "error"):
                break
    return events


def test_e2e_p3_browser_status(client: TestClient, desk_fs: Path):
    token = _login(client)
    resp = client.get("/api/browser/status", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert "playwright" in data
    assert "artifacts" in data
    assert isinstance(data["detail"], str)


def test_e2e_p3_browse_soft_fail_or_real(client: TestClient, desk_fs: Path, monkeypatch: pytest.MonkeyPatch):
    token = _login(client)
    ok, _detail = runtime.playwright_available()
    _install_llm(
        monkeypatch,
        [
            "Opening.\n```browse\naction: navigate\nurl: https://example.com\n```\n",
            "Done browsing.",
        ],
    )
    events = _stream(client, token, "open example.com in the board browser")
    browse = next(
        e for e in events if e["type"] == "tool" and e.get("kind") == "browse" and e.get("phase") != "start"
    )
    assert browse.get("action") == "navigate"
    if ok:
        # Real Chromium path — may still fail if browser binary missing.
        if browse.get("ok"):
            assert browse.get("shot")
            shot = desk_fs / Path(browse["shot"])
            # shot is relative to desk root
            assert (desk_fs / browse["shot"]).is_file() or shot.is_file()
            arts = client.get("/api/browser/artifacts", headers={"Authorization": f"Bearer {token}"})
            assert arts.status_code == 200
            assert any(a["kind"] == "png" for a in arts.json()["artifacts"])
        else:
            # Package present but chromium not installed — still a controlled soft error.
            assert browse.get("error")
    else:
        assert browse.get("ok") is False
        assert "playwright" in (browse.get("error") or "").lower()
    assert any(e["type"] == "done" for e in events)


def test_e2e_p3_artifact_file_roundtrip(client: TestClient, desk_fs: Path):
    token = _login(client)
    run = desk_fs / ".desk" / "browser" / "manual-run"
    run.mkdir(parents=True)
    png = run / "demo.png"
    # Minimal 1x1 PNG
    png.write_bytes(
        bytes.fromhex(
            "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
            "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
        )
    )
    rel = ".desk/browser/manual-run/demo.png"
    resp = client.get(
        f"/api/browser/artifacts/file?path={rel}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("image/")
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"
