"""E2E for P1: durable jobs, verify harness, probe, health, ops summary, notices."""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from app.config import get_settings
from app.jobs.verify import write_default_verify
from app.main import create_app
from app.ops.local import record_local, summary
from app.router.types import RoutePlan, RouteResult, TextDelta


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
        note="e2e-p1",
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
    return events


def _wait_job(client: TestClient, token: str, job_id: str, timeout_s: float = 20.0) -> dict:
    deadline = time.time() + timeout_s
    headers = {"Authorization": f"Bearer {token}"}
    last = {}
    while time.time() < deadline:
        resp = client.get(f"/api/jobs/{job_id}", headers=headers)
        assert resp.status_code == 200, resp.text
        last = resp.json()
        if last.get("status") in ("done", "error", "cancelled"):
            return last
        time.sleep(0.15)
    raise AssertionError(f"job {job_id} not finished: {last}")


def test_e2e_p1_health_and_probe_tools(client: TestClient, desk_fs: Path, monkeypatch: pytest.MonkeyPatch):
    token = _login(client)
    _install_llm(
        monkeypatch,
        [
            "Checking.\n```health\n```\n```probe\nhttps://example.com\n```\n",
            "Board is up; probe finished.",
        ],
    )
    events = _stream(client, token, "health and probe example.com")
    tools = [e for e in events if e["type"] == "tool" and e.get("phase") != "start"]
    kinds = {t.get("kind") for t in tools}
    assert "health" in kinds
    assert "probe" in kinds
    health = next(t for t in tools if t.get("kind") == "health")
    assert health.get("ok") is True
    assert "host" in health
    probe = next(t for t in tools if t.get("kind") == "probe")
    assert probe.get("verdict") in ("ok", "auth", "remote_service", "local_network", "unknown")
    assert any(e["type"] == "done" for e in events)


def test_e2e_p1_verify_harness(client: TestClient, desk_fs: Path, monkeypatch: pytest.MonkeyPatch):
    token = _login(client)
    write_default_verify(['python -c "print(1)"'])
    _install_llm(
        monkeypatch,
        [
            "Running verify.\n```verify\nrepeats: 2\n```\n",
            "Verify passed twice.",
        ],
    )
    events = _stream(client, token, "run verify twice")
    verify = next(e for e in events if e["type"] == "tool" and e.get("phase") != "start" and e.get("kind") == "verify")
    assert verify.get("ok") is True
    assert verify.get("pass_count") == 2
    assert verify.get("pass_rate") == 1.0


def test_e2e_p1_durable_job_and_notice(client: TestClient, desk_fs: Path):
    token = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    write_default_verify(['python -c "print(\'job-ok\')"'])
    resp = client.post(
        "/api/jobs",
        headers=headers,
        json={"kind": "verify", "payload": {"repeats": 2}},
    )
    assert resp.status_code == 200, resp.text
    job_id = resp.json()["id"]
    assert resp.json()["status"] == "queued"
    done = _wait_job(client, token, job_id)
    assert done["status"] == "done"
    assert done["result"].get("ok") is True
    assert done["result"].get("pass_count") == 2

    notices = client.get("/api/jobs/notices", headers=headers)
    assert notices.status_code == 200
    rows = notices.json()["notices"]
    assert any(n.get("job_id") == job_id for n in rows)


def test_e2e_p1_job_fence_enqueues(client: TestClient, desk_fs: Path, monkeypatch: pytest.MonkeyPatch):
    token = _login(client)
    write_default_verify(['python -c "print(1)"'])
    _install_llm(
        monkeypatch,
        [
            "Queue it.\n```job\nkind: verify\nrepeats: 1\n```\n",
            "Job is queued.",
        ],
    )
    events = _stream(client, token, "queue a verify job")
    job_ev = next(e for e in events if e["type"] == "tool" and e.get("phase") != "start" and e.get("kind") == "job")
    assert job_ev.get("ok") is True
    # Observation is in follow-up; job id is on the tool event via format — check list API.
    listed = client.get("/api/jobs", headers={"Authorization": f"Bearer {token}"})
    assert listed.status_code == 200
    assert len(listed.json()["jobs"]) >= 1


def test_e2e_p1_ops_summary(client: TestClient, desk_fs: Path):
    token = _login(client)
    record_local({"kind": "chat", "status": "ok", "note": "a"})
    record_local({"kind": "chat", "status": "error", "error_code": "x", "note": "b"})
    data = summary(hours=1)
    assert data["total"] >= 2
    assert data["by_status"].get("error", 0) >= 1
    resp = client.get(
        "/api/ops/summary?hours=1",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["total"] >= 2
