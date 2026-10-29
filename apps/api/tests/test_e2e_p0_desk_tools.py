"""E2E for P0: tool loop + approval + work state through the real chat SSE path (mocked LLM).

Rule: each shipped P (phase) gets an e2e like this before calling the phase done.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from app.auth.models import User
from app.chat.approval import create_pending
from app.chat.approval import shell_needs_approval
from app.config import get_settings
from app.db import SessionLocal
from app.main import create_app
from app.router.types import RoutePlan, RouteResult, TextDelta


def _plan() -> RoutePlan:
    return RoutePlan(
        route="local",
        model="test-model",
        intent="code",
        messages=[],
        thinking=False,
        original_tokens=10,
        compressed=False,
        compression_tokens=0,
        note="e2e",
        selector="rules",
        selector_reason="test",
        selector_ms=1,
    )


def _result(reply: str) -> RouteResult:
    return RouteResult(
        reply=reply,
        route="local",
        model="test-model",
        intent="code",
        original_tokens=10,
        sent_tokens=10,
        saved_tokens=0,
        saved_pct=0.0,
        nebius_tokens=0,
        local_tokens=10,
        prompt_tokens=10,
        completion_tokens=5,
        cost_usd=0.0,
        latency_ms=1,
        context_window=4096,
    )


@pytest.fixture
def desk_fs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    root = tmp_path / "desk"
    root.mkdir()
    (root / "notes.txt").write_text("hello desk\n", encoding="utf-8")
    monkeypatch.setenv("DESK_FS_ROOT", str(root))
    get_settings.cache_clear()
    yield root
    get_settings.cache_clear()


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


def _install_llm_script(monkeypatch: pytest.MonkeyPatch, replies: list[str]) -> None:
    queue = list(replies)
    call_i = {"n": 0}

    async def fake_plan_route(*_a, **_k) -> RoutePlan:
        return _plan()

    async def fake_run_plan(_settings, _plan) -> AsyncIterator:
        idx = call_i["n"]
        call_i["n"] += 1
        text = queue[idx] if idx < len(queue) else "done."
        yield TextDelta(text=text, kind="text")
        yield _result(text)

    monkeypatch.setattr("app.chat.turns.plan_route", fake_plan_route)
    monkeypatch.setattr("app.chat.turns.run_plan", fake_run_plan)


def _stream(
    client: TestClient,
    token: str,
    body: dict,
    *,
    on_approval: str | None = None,
) -> list[dict]:
    """Drive SSE. Auto-resolve approvals in wait_decision (TestClient deadlocks on nested HTTP)."""
    events: list[dict] = []
    headers = {"Authorization": f"Bearer {token}"}
    import app.chat.turns as turns_mod

    orig_wait = turns_mod.wait_decision

    async def auto_wait(item, *, timeout: float = 120.0):
        if on_approval:
            item.decision = on_approval
            item.event.set()
            return on_approval
        return await orig_wait(item, timeout=min(timeout, 2.0))

    turns_mod.wait_decision = auto_wait  # type: ignore[assignment]
    try:
        with client.stream(
            "POST",
            "/api/chat/message/stream",
            headers=headers,
            json=body,
            timeout=30.0,
        ) as resp:
            assert resp.status_code == 200, resp.read()
            for line in resp.iter_lines():
                if not line.startswith("data: "):
                    continue
                ev = json.loads(line[6:])
                events.append(ev)
                if ev.get("type") in ("done", "error"):
                    break
    finally:
        turns_mod.wait_decision = orig_wait  # type: ignore[assignment]
    return events


def test_e2e_p0_safe_run_and_read(client: TestClient, desk_fs: Path, monkeypatch: pytest.MonkeyPatch):
    token = _login(client)
    assert not shell_needs_approval("echo p0-ok")
    _install_llm_script(
        monkeypatch,
        [
            "Checking files.\n```list\n.\n```\n```read\nnotes.txt\n```\n```run\necho p0-ok\n```\n",
            "Listed, read notes.txt, and the shell exited cleanly.",
        ],
    )
    events = _stream(
        client,
        token,
        {"content": "list and read notes, then echo", "session_id": None, "device_id": None, "model": "local"},
    )
    types = [e["type"] for e in events]
    assert "start" in types
    assert "tool" in types
    assert "approval" not in types
    assert "done" in types

    tools = [e for e in events if e["type"] == "tool" and e.get("phase") != "start"]
    kinds = {t.get("kind") for t in tools}
    assert {"list", "read", "run"} <= kinds
    read = next(t for t in tools if t.get("kind") == "read")
    assert read.get("ok") is True
    run = next(t for t in tools if t.get("kind") == "run")
    assert run.get("exit_code") == 0


def test_e2e_p0_approval_approve_runs_danger(
    client: TestClient, desk_fs: Path, monkeypatch: pytest.MonkeyPatch
):
    token = _login(client)
    danger = 'rm -rf "missing-p0-flag"'
    assert shell_needs_approval(danger)
    _install_llm_script(
        monkeypatch,
        [
            f"Cleaning.\n```run\n{danger}\n```\n",
            "Cleanup attempted after approval.",
        ],
    )
    events = _stream(
        client,
        token,
        {"content": "remove junk", "session_id": None, "device_id": None, "model": "local"},
        on_approval="approve",
    )
    types = [e["type"] for e in events]
    assert "approval" in types
    assert "approval_resolved" in types
    assert next(e for e in events if e["type"] == "approval_resolved")["decision"] == "approve"
    run_tools = [e for e in events if e["type"] == "tool" and e.get("phase") != "start" and e.get("kind") == "run"]
    assert run_tools and run_tools[-1].get("skipped") is not True
    assert "done" in types


def test_e2e_p0_approval_deny_skips(client: TestClient, desk_fs: Path, monkeypatch: pytest.MonkeyPatch):
    token = _login(client)
    danger = "git push origin main"
    assert shell_needs_approval(danger)
    _install_llm_script(
        monkeypatch,
        [
            f"Pushing.\n```run\n{danger}\n```\n",
            "Push was denied by the operator.",
        ],
    )
    events = _stream(
        client,
        token,
        {"content": "push please", "session_id": None, "device_id": None, "model": "local"},
        on_approval="deny",
    )
    assert any(e["type"] == "tool" and e.get("phase") != "start" and e.get("skipped") for e in events)
    assert any(e.get("type") == "approval_resolved" and e.get("decision") == "deny" for e in events)
    assert any(e.get("type") == "done" for e in events)


def test_e2e_p0_approval_http_endpoint(client: TestClient, desk_fs: Path):
    """POST /api/chat/approvals/:id works for the web Approve/Deny buttons."""
    token = _login(client)
    settings = get_settings()
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == settings.bootstrap_username).first()
        assert user is not None
        pending = create_pending(
            user_id=user.id,
            session_id="e2e-session",
            actions=[{"kind": "run", "command": "git push"}],
        )
    finally:
        db.close()
    resp = client.post(
        f"/api/chat/approvals/{pending.id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"decision": "deny"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["decision"] == "deny"
    assert pending.decision == "deny"
    assert pending.event.is_set()


def test_e2e_p0_work_state_persists(client: TestClient, desk_fs: Path, monkeypatch: pytest.MonkeyPatch):
    token = _login(client)
    body = "## Now\nShip P0 e2e\n\n## Done\n(none)\n\n## Blocked\n(none)\n\n## Next\nP1\n"
    _install_llm_script(
        monkeypatch,
        [
            f"Updating work.\n```work\n{body}\n```\n",
            "Work state saved.",
        ],
    )
    events = _stream(
        client,
        token,
        {"content": "update work state", "session_id": None, "device_id": None, "model": "local"},
    )
    work_events = [e for e in events if e["type"] == "tool" and e.get("phase") != "start" and e.get("kind") == "work"]
    assert work_events and work_events[0].get("ok") is True
    path = desk_fs / ".desk" / "WORK.md"
    assert path.is_file()
    text = path.read_text(encoding="utf-8")
    assert "kind: work" in text
    assert "Ship P0 e2e" in text
