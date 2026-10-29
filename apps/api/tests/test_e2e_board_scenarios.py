"""≥10 automated scenarios: mkdir/list/guardrails/factual replies through chat SSE.

Runs against a real TestClient + tmp desk FS; LLM is scripted. No manual click-through.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from app.chat.guardrails import (
    factual_reply_from_tools,
    is_fabricated_board_report,
    mkdir_target,
    strip_fabricated_board_report,
    wants_mkdir,
)
from app.chat.history import scrub_history, wants_file_list
from app.chat.run_tools import equality_checks
from app.config import get_settings
from app.edge.identity import board_identity
from app.main import create_app
from app.router.types import RoutePlan, RouteResult, TextDelta

ALICE_JUNK = (
    "```bash\nmkdir -p /home/millie/Projects\n```\n\n"
    "**Board Summary**\n\n"
    "| Board | Operator | Current Action |\n"
    "|-------|----------|----------------|\n"
    "| Kratos | Alice    | `status`       |\n"
    "| Kratos | Bob      | `deploy`       |\n\n"
    "**Next Steps**\n1. Alice waits.\n"
)


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
    root = tmp_path / "home"
    root.mkdir()
    (root / "Desktop").mkdir()
    (root / ".bashrc").write_text("# rc\n", encoding="utf-8")
    (root / "notes.txt").write_text("hello\n", encoding="utf-8")
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
    queue = list(replies)
    n = {"i": 0}

    async def fake_plan(*_a, **_k) -> RoutePlan:
        return _plan()

    async def fake_run(_settings, _plan) -> AsyncIterator:
        idx = n["i"]
        n["i"] += 1
        text = queue[idx] if idx < len(queue) else "done."
        yield TextDelta(text=text, kind="text")
        yield _result(text)

    monkeypatch.setattr("app.chat.turns.plan_route", fake_plan)
    monkeypatch.setattr("app.chat.turns.run_plan", fake_run)


def _stream(client: TestClient, token: str, content: str) -> list[dict]:
    events: list[dict] = []
    with client.stream(
        "POST",
        "/api/chat/message/stream",
        headers={"Authorization": f"Bearer {token}"},
        json={"content": content, "session_id": None, "device_id": None, "model": "local"},
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
    return events


def _done_text(events: list[dict]) -> str:
    done = next(e for e in events if e["type"] == "done")
    return (done.get("message") or {}).get("content") or ""


def _deltas(events: list[dict]) -> str:
    return "".join(e.get("text") or "" for e in events if e.get("type") == "delta" and e.get("kind") == "text")


# --- unit scenarios -----------------------------------------------------------------


def test_s01_mkdir_target_projects():
    assert mkdir_target("Crea una carpeta llamada /Projects") == "Projects"


def test_s02_mkdir_target_rejects_garbage():
    assert mkdir_target("hola qué tal") is None


def test_s03_fabricated_alice_detected():
    assert is_fabricated_board_report(ALICE_JUNK)


def test_s04_strip_fabricated_keeps_prefix_drops_ops_table():
    cleaned = strip_fabricated_board_report(ALICE_JUNK)
    assert "Alice" not in cleaned
    assert "Board Summary" not in cleaned
    assert "Ignored" not in cleaned


def test_s05_factual_list_reply():
    text = factual_reply_from_tools(
        [
            {
                "kind": "list",
                "ok": True,
                "path": ".",
                "entries": [
                    {"name": "Desktop", "kind": "dir"},
                    {"name": ".bashrc", "kind": "file"},
                ],
            }
        ]
    )
    assert "Desktop/" in text and ".bashrc" in text
    assert "Folders:" in text
    assert "Ignored" not in text


def test_s06_factual_run_ok():
    text = factual_reply_from_tools(
        [
            {
                "kind": "run",
                "exit_code": 0,
                "command": "python -c \"…Path('Projects').mkdir…\"",
                "stdout": "created Projects\n",
                "stderr": "",
            }
        ]
    )
    assert "Projects" in text
    assert "Done" in text or "created" in text.lower()


def test_s07_equality_ignores_home_list():
    assert equality_checks("name me the folders actually on home", ["TEST"]) == []


def test_s08_wants_file_list_home():
    assert wants_file_list("name me the folders actually on home")
    assert wants_mkdir("Crea una carpeta llamada Projects")


def test_s09_history_drops_secret_zombies_for_files():
    hist = [
        {"role": "user", "content": "is TEST equal to testo?"},
        {"role": "assistant", "content": "I am Millie, running Nemotron Nano on Nebius.\nThe TEST secret is not equal to 'testo'."},
    ]
    cleaned = scrub_history(hist, "list files in home")
    assert all("TEST secret" not in (m.get("content") or "") for m in cleaned)


def test_s10_identity_triad_fields():
    row = board_identity("Kratos")
    assert row["fleet_name"] == "Kratos"
    assert row["hostname"] and row["os_user"] and row["home"]
    assert "Millie is the UI guide" in row["legend"]


# --- e2e SSE scenarios ----------------------------------------------------------------


def test_s11_e2e_mkdir_despite_alice_junk(client: TestClient, desk_fs: Path, monkeypatch: pytest.MonkeyPatch):
    token = _login(client)
    _install_llm(monkeypatch, [ALICE_JUNK])
    events = _stream(client, token, "Crea una carpeta llamada /Projects")
    assert any(e.get("type") == "error" for e in events) is False
    assert any(e.get("type") == "done" for e in events)
    runs = [e for e in events if e.get("type") == "tool" and e.get("phase") != "start" and e.get("kind") == "run"]
    assert runs, events
    assert runs[0].get("exit_code") == 0
    assert (desk_fs / "Projects").is_dir()
    text = _done_text(events) or _deltas(events)
    assert "Alice" not in text
    assert "Ignored" not in text
    assert "Projects" in text
    assert ".venv" not in text and "pathlib" not in text


def test_s12_e2e_list_home_despite_alice_junk(client: TestClient, desk_fs: Path, monkeypatch: pytest.MonkeyPatch):
    token = _login(client)
    _install_llm(monkeypatch, [ALICE_JUNK])
    events = _stream(client, token, "name me the folders actually on home")
    assert any(e.get("type") == "done" for e in events)
    lists = [e for e in events if e.get("type") == "tool" and e.get("phase") != "start" and e.get("kind") == "list"]
    assert lists and lists[0].get("ok") is True
    text = _done_text(events) or _deltas(events)
    assert "Desktop" in text
    assert ".bashrc" in text
    assert "Carpetas:" in text or "home" in text.lower()
    assert "Alice" not in text
    assert "Ignored" not in text


def test_s13_e2e_explicit_list_fence(client: TestClient, desk_fs: Path, monkeypatch: pytest.MonkeyPatch):
    token = _login(client)
    _install_llm(monkeypatch, ["Listing.\n```list\n.\n```\n"])
    events = _stream(client, token, "list the desk root please")
    text = _done_text(events) or _deltas(events)
    assert "notes.txt" in text
    assert "Alice" not in text


def test_s14_e2e_read_file(client: TestClient, desk_fs: Path, monkeypatch: pytest.MonkeyPatch):
    token = _login(client)
    _install_llm(monkeypatch, ["Reading.\n```read\nnotes.txt\n```\n"])
    events = _stream(client, token, "read notes.txt")
    text = _done_text(events) or _deltas(events)
    assert "hello" in text
    reads = [e for e in events if e.get("type") == "tool" and e.get("phase") != "start" and e.get("kind") == "read"]
    assert reads and reads[0].get("ok") is True


def test_s15_e2e_safe_echo_run(client: TestClient, desk_fs: Path, monkeypatch: pytest.MonkeyPatch):
    token = _login(client)
    _install_llm(monkeypatch, ["Running.\n```run\necho desk-scenario-ok\n```\n"])
    events = _stream(client, token, "echo a marker")
    runs = [e for e in events if e.get("type") == "tool" and e.get("phase") != "start" and e.get("kind") == "run"]
    assert runs and runs[0].get("exit_code") == 0
    text = _done_text(events) or _deltas(events)
    assert "desk-scenario-ok" in text or "ok" in text.lower()
