"""A ```search``` turn must answer from the results (second model pass), not just say "search listo"."""

from __future__ import annotations

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from app.chat.desk_tools import wants_web_search, web_query_from
from tests.test_e2e_p0_desk_tools import _install_llm_script, _login, _stream, client, desk_fs  # noqa: F401

HITS = {
    "results": [
        {"title": "Nebius Token Factory launch", "url": "https://nebius.com/blog/token-factory", "content": "Token Factory GA."},
        {"title": "Nebius AI Studio pricing", "url": "https://nebius.com/ai-studio", "content": "New pricing tiers."},
    ]
}


def _fake_search(monkeypatch: pytest.MonkeyPatch, data: dict) -> list[str]:
    seen: list[str] = []

    async def fake_web_search(_db, query, max_results=5, credit_cap=None):
        seen.append(query)
        return data

    monkeypatch.setattr("app.chat.desk_tools.web_search", fake_web_search)
    monkeypatch.setattr("app.chat.desk_tools.subscription_active", lambda *_a: True)
    return seen


def _answer(events: list[dict]) -> str:
    done = next(e for e in events if e["type"] == "done")
    return (done.get("message") or {}).get("content") or ""


def test_search_turn_answers_from_results(client: TestClient, desk_fs: Path, monkeypatch: pytest.MonkeyPatch):
    seen = _fake_search(monkeypatch, HITS)
    summary = "1. Token Factory ya está disponible ([Nebius Token Factory launch](https://nebius.com/blog/token-factory))."
    _install_llm_script(monkeypatch, ["```search\nNebius Token Factory news\n```", summary])
    events = _stream(client, _login(client), {"content": "busca novedades de Nebius", "session_id": None, "model": "local"})
    assert seen == ["Nebius Token Factory news"]
    assert _answer(events) == summary


def test_web_intent_and_query():
    assert wants_web_search("Busca en la web qué es la Jetson Orin Nano Super")
    assert wants_web_search("search the web for vite 6 release notes")
    assert wants_web_search("usa tavily para ver precios")
    assert not wants_web_search("busca el archivo notes.txt")
    assert not wants_web_search("buscar errores en el log")
    assert web_query_from("Busca en la web qué es la Jetson Orin Nano Super?") == "qué es la Jetson Orin Nano Super"
    assert web_query_from("Busca en la web con Tavily las novedades de Nebius") == "las novedades de Nebius"


def test_search_runs_even_when_model_only_parrots(client: TestClient, desk_fs: Path, monkeypatch: pytest.MonkeyPatch):
    seen = _fake_search(monkeypatch, HITS)
    _install_llm_script(monkeypatch, ["`search` listo.", "`search` listo.", "Resumen con [Nebius](https://nebius.com/ai-studio)."])
    events = _stream(
        client, _login(client), {"content": "Busca en la web qué es Nebius AI Studio", "session_id": None, "model": "local"}
    )
    assert seen == ["qué es Nebius AI Studio"]
    assert "[Nebius](https://nebius.com/ai-studio)" in _answer(events)


def test_search_falls_back_to_links_when_synthesis_is_empty(
    client: TestClient, desk_fs: Path, monkeypatch: pytest.MonkeyPatch
):
    _fake_search(monkeypatch, HITS)
    _install_llm_script(monkeypatch, ["```search\nNebius news\n```", "```search\nagain\n```"])
    answer = _answer(_stream(client, _login(client), {"content": "busca Nebius", "session_id": None, "model": "local"}))
    assert "[Nebius Token Factory launch](https://nebius.com/blog/token-factory)" in answer
    assert "listo" not in answer
