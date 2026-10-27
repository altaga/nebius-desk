"""Tavily web search. Empty key stays mocked. Live calls stop at the credit cap."""

from __future__ import annotations

import httpx
from sqlalchemy.orm import Session

from app.cloudlink import cloud_config
from app.config import get_settings
from app.tools.credits import BASIC_SEARCH_CREDITS, TavilyCapReached, credits_remaining, refund, reserve


def _mock(query: str) -> dict:
    return {
        "query": query,
        "dummy": True,
        "results": [
            {
                "title": f"[Tavily mock] Results for: {query}",
                "url": "https://tavily.com",
                "content": (
                    "Set TAVILY_API_KEY to enable real search. "
                    "This mock keeps the Best Use of Tavily demo path wired."
                ),
            }
        ],
    }


async def _basic_search(api_key: str, query: str, max_results: int) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://api.tavily.com/search",
            json={
                "api_key": api_key,
                "query": query,
                "max_results": max_results,
                "search_depth": "basic",
            },
        )
        resp.raise_for_status()
        return resp.json()


async def _cloud_search(url: str, token: str, query: str, max_results: int) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{url}/v1/gateway/tavily/search",
            headers={"Authorization": f"Bearer {token}"},
            json={"query": query, "max_results": max_results},
        )
    if resp.status_code == 402:
        detail = resp.json().get("detail") or {}
        raise TavilyCapReached(int(detail.get("credits_spent") or 0), int(detail.get("credit_cap") or 0))
    resp.raise_for_status()
    return resp.json()


async def web_search(db: Session, query: str, max_results: int = 5, credit_cap: int | None = None) -> dict:
    cloud = cloud_config()
    if cloud:
        return await _cloud_search(cloud[0], cloud[1], query, max_results)
    settings = get_settings()
    if not settings.tavily_api_key:
        return _mock(query)

    cap = settings.tavily_credit_cap if credit_cap is None else credit_cap
    remaining = reserve(db, cap, BASIC_SEARCH_CREDITS, query)
    try:
        data = await _basic_search(settings.tavily_api_key, query, max_results)
    except Exception:
        refund(db, BASIC_SEARCH_CREDITS, query)
        raise
    data["credits_charged"] = BASIC_SEARCH_CREDITS
    data["credits_remaining"] = remaining
    data["credit_cap"] = cap
    return data


def credit_status(db: Session) -> dict:
    settings = get_settings()
    cap = settings.tavily_credit_cap
    remaining = credits_remaining(db, cap)
    return {
        "tavily_credit_cap": cap,
        "tavily_credits_spent": cap - remaining,
        "tavily_credits_remaining": remaining,
    }
