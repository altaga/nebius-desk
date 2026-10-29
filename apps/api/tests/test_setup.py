"""Local USB/Docker setup endpoint — dummy Wi-Fi + Pair ID, no Jetson required."""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from app.config import get_settings
from app.main import create_app
from app.setup import pairing


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("DESK_CONFIG_DIR", str(tmp_path / "desk-config"))
    monkeypatch.setenv("BOARD_EMU", "1")
    get_settings.cache_clear()
    pairing.reset_for_tests()
    with TestClient(create_app()) as tc:
        yield tc
    pairing.reset_for_tests()
    get_settings.cache_clear()


def test_get_setup_unpaired(client: TestClient):
    resp = client.get("/setup")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    assert body["paired"] is False
    assert body["code"] is None
    assert body["has_password"] is False
    assert re.fullmatch(r"Jetson#[0-9A-F]{3}", body["name"] or "")
    assert body["factory_id"] == body["name"].split("#", 1)[1]
    again = client.get("/setup").json()
    assert again["name"] == body["name"]
    assert resp.headers.get("access-control-allow-private-network") == "true"


def test_post_setup_dummy_wifi_returns_pair_id(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    def fake_start(name: str) -> dict:
        _ = name
        pairing._STATE.update({"status": "pending", "code": "WXYZ-2345", "expires_at": 9_999_999_999.0, "error": None})
        return pairing.snapshot()

    monkeypatch.setattr(pairing, "start_or_resume", fake_start)
    resp = client.post(
        "/setup",
        json={"name": "Natasha", "password": "boardpass", "wifi_ssid": "DeskNet", "wifi_password": "airgap"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "Natasha"
    assert re.fullmatch(r"[0-9A-F]{3}", body["factory_id"] or "")
    assert body["has_password"] is True
    assert body["code"] == "WXYZ-2345"
    assert body["wifi"]["ssid"] == "DeskNet"
    assert body["wifi"]["dummy"] is True
    assert body["wifi"]["connected"] is True
    assert body["paired"] is False


def test_rejects_millie_name(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(pairing, "start_or_resume", lambda name: {})
    resp = client.post(
        "/setup",
        json={"name": "Millie", "password": "boardpass", "wifi_ssid": "DeskNet", "wifi_password": ""},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "board_name_reserved"


def test_options_private_network(client: TestClient):
    resp = client.options(
        "/setup",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Private-Network": "true",
        },
    )
    assert resp.status_code in {200, 204}
    assert resp.headers.get("access-control-allow-private-network") == "true"
