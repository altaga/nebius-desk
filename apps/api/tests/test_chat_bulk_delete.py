"""Bulk chat delete: only the caller's sessions go, running turns are skipped, input is capped."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from app.auth.models import User
from app.chat import routes as chat_routes
from app.db import SessionLocal
from app.telemetry.models import TokenLedger
from app.chat.schemas import MAX_BULK_DELETE
from app.config import get_settings
from app.main import create_app


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("DESK_FS_ROOT", str(tmp_path))
    get_settings.cache_clear()
    with TestClient(create_app()) as tc:
        yield tc
    get_settings.cache_clear()


def _auth(client: TestClient) -> dict[str, str]:
    s = get_settings()
    resp = client.post(
        "/api/auth/login",
        json={"username": s.bootstrap_username, "password": s.bootstrap_password, "totp_code": ""},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _new(client: TestClient, h: dict[str, str], title: str) -> str:
    resp = client.post("/api/chat/sessions", json={"title": title}, headers=h)
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _ids(client: TestClient, h: dict[str, str]) -> set[str]:
    return {row["id"] for row in client.get("/api/chat/sessions", headers=h).json()}


def test_bulk_delete_removes_selected_and_ignores_unknown(client: TestClient):
    h = _auth(client)
    a, b, keep = (_new(client, h, t) for t in ("a", "b", "keep"))
    resp = client.post("/api/chat/sessions/bulk-delete", json={"ids": [a, b, "not-a-session"]}, headers=h)
    assert resp.status_code == 200, resp.text
    assert set(resp.json()["deleted"]) == {a, b}
    remaining = _ids(client, h)
    assert keep in remaining and not ({a, b} & remaining)


def test_bulk_delete_skips_running_turns(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    h = _auth(client)
    busy, idle = _new(client, h, "busy"), _new(client, h, "idle")
    monkeypatch.setattr(chat_routes, "session_turn_active", lambda sid: sid == busy)
    body = client.post("/api/chat/sessions/bulk-delete", json={"ids": [busy, idle]}, headers=h).json()
    assert body["deleted"] == [idle] and body["skipped_running"] == [busy]
    assert busy in _ids(client, h)


def test_deleting_chats_keeps_token_ledger(client: TestClient):
    h = _auth(client)
    one, many = _new(client, h, "single"), _new(client, h, "bulk")
    with SessionLocal() as db:
        user_id = db.query(User).filter(User.username == get_settings().bootstrap_username).one().id
        for sid in (one, many):
            db.add(TokenLedger(user_id=user_id, session_id=sid, day="2026-10-28", route="nebius", model="m", cost_usd=0.25))
        db.commit()
    assert client.delete(f"/api/chat/sessions/{one}", headers=h).status_code == 200
    assert client.post("/api/chat/sessions/bulk-delete", json={"ids": [many]}, headers=h).status_code == 200
    with SessionLocal() as db:
        kept = db.query(TokenLedger).filter(TokenLedger.session_id.in_([one, many])).count()
    assert kept == 2


def test_bulk_delete_validates_size(client: TestClient):
    h = _auth(client)
    assert client.post("/api/chat/sessions/bulk-delete", json={"ids": []}, headers=h).status_code == 422
    too_many = [f"s{i}" for i in range(MAX_BULK_DELETE + 1)]
    assert client.post("/api/chat/sessions/bulk-delete", json={"ids": too_many}, headers=h).status_code == 422
