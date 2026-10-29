"""E2E for P2: deploy/rollback recipes, checks, bakeoff, circuit breaker."""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from app.config import get_settings
from app.jobs.bakeoff import write_default_bakeoff
from app.jobs.checks import write_default_checks
from app.jobs.recipes import write_default_recipes
from app.jobs.verify import write_default_verify
from app.main import create_app
from app.router.types import RoutePlan, RouteResult, TextDelta
from app.tools import breaker
from app.tools.tavily import web_search


def _plan() -> RoutePlan:
    return RoutePlan(
        route="local",
        model="test-model",
        intent="ops",
        messages=[],
        thinking=False,
        original_tokens=8,
        compressed=False,
        compression_tokens=0,
        note="e2e-p2",
        selector="rules",
        selector_reason="test",
        selector_ms=1,
    )


def _result(reply: str) -> RouteResult:
    return RouteResult(
        reply=reply,
        route="local",
        model="test-model",
        intent="ops",
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
    breaker.reset()
    yield root
    get_settings.cache_clear()
    breaker.reset()


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


def _stream(client: TestClient, token: str, content: str, *, approve: bool = False) -> list[dict]:
    import app.chat.turns as turns_mod

    orig = turns_mod.wait_decision

    async def auto_wait(item, *, timeout: float = 120.0):
        item.decision = "approve" if approve else "deny"
        item.event.set()
        return item.decision

    turns_mod.wait_decision = auto_wait  # type: ignore[assignment]
    events: list[dict] = []
    try:
        with client.stream(
            "POST",
            "/api/chat/message/stream",
            headers={"Authorization": f"Bearer {token}"},
            json={"content": content, "session_id": None, "device_id": None, "model": "local"},
            timeout=60.0,
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
        turns_mod.wait_decision = orig  # type: ignore[assignment]
    return events


def _wait_job(client: TestClient, token: str, job_id: str, timeout_s: float = 25.0) -> dict:
    deadline = time.time() + timeout_s
    last = {}
    while time.time() < deadline:
        resp = client.get(f"/api/jobs/{job_id}", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        last = resp.json()
        if last.get("status") in ("done", "error"):
            return last
        time.sleep(0.15)
    raise AssertionError(f"job not finished: {last}")


def test_e2e_p2_deploy_ok(client: TestClient, desk_fs: Path, monkeypatch: pytest.MonkeyPatch):
    token = _login(client)
    write_default_recipes()
    write_default_verify(['python -c "print(1)"'])
    _install_llm(
        monkeypatch,
        [
            "Deploying.\n```deploy\n```\n",
            "Deploy finished.",
        ],
    )
    events = _stream(client, token, "deploy please", approve=True)
    assert any(e.get("type") == "approval" for e in events)
    deploy = next(e for e in events if e["type"] == "tool" and e.get("phase") != "start" and e.get("kind") == "deploy")
    assert deploy.get("ok") is True
    assert deploy.get("rolled_back") is False


def test_e2e_p2_deploy_rollback_on_verify_fail(client: TestClient, desk_fs: Path):
    token = _login(client)
    write_default_recipes(
        deploy=['python -c "print(\'deployed\')"'],
        rollback=['python -c "open(\'.desk/rolled\',\'w\').write(\'1\')"'],
    )
    write_default_verify(['python -c "raise SystemExit(1)"'])
    resp = client.post(
        "/api/jobs",
        headers={"Authorization": f"Bearer {token}"},
        json={"kind": "deploy", "payload": {}},
    )
    assert resp.status_code == 200, resp.text
    done = _wait_job(client, token, resp.json()["id"])
    assert done["status"] == "error"
    assert done["result"].get("rolled_back") is True
    assert (desk_fs / ".desk" / "rolled").is_file()


def test_e2e_p2_checks_and_bakeoff(client: TestClient, desk_fs: Path, monkeypatch: pytest.MonkeyPatch):
    token = _login(client)
    write_default_checks()
    # Closed local port — fails fast; bakeoff still records error_rate and writes the report.
    write_default_bakeoff([{"name": "closed", "url": "http://127.0.0.1:9"}])
    _install_llm(
        monkeypatch,
        [
            "Gates.\n```checks\n```\n```bakeoff\nrepeats: 1\n```\n",
            "Checks and bakeoff done.",
        ],
    )
    events = _stream(client, token, "run checks and bakeoff")
    kinds = {e.get("kind") for e in events if e["type"] == "tool" and e.get("phase") != "start"}
    assert "checks" in kinds
    assert "bakeoff" in kinds
    checks = next(e for e in events if e.get("kind") == "checks" and e.get("phase") != "start")
    assert checks.get("ok") is True
    bake = next(e for e in events if e.get("kind") == "bakeoff" and e.get("phase") != "start")
    assert bake.get("ok") is True
    assert bake.get("results")
    assert (desk_fs / ".desk" / "bakeoff-report.md").is_file()


def test_e2e_p2_tavily_circuit_soft_fail(desk_fs: Path, monkeypatch: pytest.MonkeyPatch):
    """Breaker open → soft mock fallback, no exception."""
    import asyncio

    from app.db import SessionLocal

    breaker.reset("tavily")
    for _ in range(3):
        breaker.record_failure("tavily", "502", threshold=3)
    assert breaker.is_open("tavily")

    monkeypatch.setenv("TAVILY_API_KEY", "")
    # Force non-cloud path
    monkeypatch.setenv("DESK_CLOUD_URL", "")
    monkeypatch.setenv("DESK_DEVICE_TOKEN", "")
    get_settings.cache_clear()
    db = SessionLocal()
    try:
        data = asyncio.run(web_search(db, "hello"))
    finally:
        db.close()
        get_settings.cache_clear()
    assert data.get("dummy") is True
    assert data.get("circuit_open") is True
