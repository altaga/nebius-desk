"""Background deep-research agent — multi-step search + synthesis on the board.

Meant to feel agentic and take ~30s of wall clock so Machine → Agents stays
"running" while the operator closes the browser (Persistencia beat).

Cloud Nebius gateway always streams SSE (forces stream:true) — never call it
with stream:false + resp.json() or you get JSONDecodeError on an empty/SSE body.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from datetime import datetime, timezone

import httpx

from app.cloudlink import cloud_config
from app.config import get_settings
from app.db import SessionLocal
from app.edge.files import write_file
from app.subscription.service import tavily_allowance
from app.tools.tavily import web_search

log = logging.getLogger(__name__)

RESEARCH_DIR = ".desk/research"
MIN_SECONDS_DEFAULT = 30.0
_ANGLES = (
    "overview key facts",
    "recent developments 2025 2026",
    "practical risks tradeoffs",
)


def _slug(topic: str) -> str:
    raw = re.sub(r"[^a-zA-Z0-9]+", "-", (topic or "research").strip().lower()).strip("-")
    return (raw[:48] or "research")


def _angles(topic: str) -> list[str]:
    t = topic.strip()
    return [f"{t} — {a}" for a in _ANGLES]


def _cancelled(job_id: str | None) -> bool:
    if not job_id:
        return False
    from app.jobs.service import is_cancelled

    db = SessionLocal()
    try:
        return is_cancelled(db, job_id)
    finally:
        db.close()


async def _search_all(topic: str, *, job_id: str | None = None) -> list[dict]:
    settings = get_settings()
    cap = tavily_allowance(settings.tavily_credit_cap)
    out: list[dict] = []
    db = SessionLocal()
    try:
        for q in _angles(topic):
            if _cancelled(job_id):
                return out
            data = await web_search(db, q, max_results=4, credit_cap=cap)
            hits = []
            for row in (data.get("results") or [])[:4]:
                hits.append(
                    {
                        "title": str(row.get("title") or "")[:200],
                        "url": str(row.get("url") or "")[:300],
                        "content": str(row.get("content") or "")[:500],
                    }
                )
            out.append({"query": q, "results": hits, "dummy": bool(data.get("dummy"))})
            # Pace steps so Agents stays visibly "running" even on mock Tavily.
            for _ in range(5):
                if _cancelled(job_id):
                    return out
                await asyncio.sleep(0.5)
    finally:
        db.close()
    return out


def _complete_stream(*, model: str, messages: list[dict], max_tokens: int = 1800) -> str:
    """Accumulate Nebius content from SSE (required by cloud gateway)."""
    settings = get_settings()
    cloud = cloud_config()
    if cloud:
        url = f"{cloud[0]}/v1/gateway/nebius/chat/completions"
        headers = {"Authorization": f"Bearer {cloud[1]}"}
    else:
        url = f"{settings.nebius_base_url.rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {settings.nebius_api_key}"}
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "stream_options": {"include_usage": True},
        "temperature": 0.4,
        "max_tokens": max_tokens,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    parts: list[str] = []
    timeout = httpx.Timeout(connect=15.0, read=120.0, write=30.0, pool=15.0)
    with httpx.Client(timeout=timeout) as client:
        with client.stream("POST", url, headers=headers, json=payload) as resp:
            if resp.status_code >= 400:
                body = resp.read().decode(errors="replace")[:300]
                raise RuntimeError(f"Token Factory HTTP {resp.status_code}: {body}")
            for line in resp.iter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                for choice in chunk.get("choices") or []:
                    delta = choice.get("delta") or {}
                    if delta.get("content"):
                        parts.append(str(delta["content"]))
    return "".join(parts).strip()


def _fallback_report(topic: str, searches: list[dict]) -> str:
    lines = [f"# Research: {topic}", "", "## Angles searched", ""]
    for block in searches:
        lines.append(f"### {block.get('query')}")
        hits = block.get("results") or []
        if not hits:
            lines.append("- (no hits)")
            continue
        for hit in hits[:4]:
            title = hit.get("title") or hit.get("url") or "source"
            url = hit.get("url") or ""
            snippet = (hit.get("content") or "").strip()
            lines.append(f"- [{title}]({url})" if url else f"- {title}")
            if snippet:
                lines.append(f"  {snippet[:280]}")
        lines.append("")
    lines.extend(
        [
            "## Next actions",
            "1. Skim the sources above.",
            "2. Ask Desk to deepen any angle that matters.",
            "3. Fold findings into `.desk/WORK.md` if this blocks active work.",
            "",
        ]
    )
    return "\n".join(lines)


def _synthesize(topic: str, searches: list[dict]) -> str:
    sources: list[str] = []
    for block in searches:
        for hit in block.get("results") or []:
            line = f"- {hit.get('title')} — {hit.get('url')}\n  {hit.get('content')}"
            sources.append(line)
    blob = "\n".join(sources[:12]) or "(no sources — write a cautious outline anyway)"
    settings = get_settings()
    model = settings.nebius_model_balanced or settings.nebius_model_fast
    try:
        text = _complete_stream(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a desk research agent on a Jetson board. Write a tight markdown brief "
                        "in English: title, 5–8 bullet findings, risks, and 3 next actions. Cite URLs "
                        "inline when present. No tool fences."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Topic: {topic}\n\nSources:\n{blob}",
                },
            ],
        )
    except Exception as exc:  # noqa: BLE001 — durable job must still leave an artifact
        log.warning("research synthesize failed: %s", exc)
        return _fallback_report(topic, searches) + f"\n_Note: synthesis error ({type(exc).__name__})._\n"
    if not text:
        return _fallback_report(topic, searches)
    return text


def run_research(
    *,
    topic: str,
    min_seconds: float | None = None,
    job_id: str | None = None,
) -> dict:
    topic = (topic or "").strip()
    if not topic:
        return {"ok": False, "error": "research job needs topic: …", "path": None}
    floor = MIN_SECONDS_DEFAULT if min_seconds is None else max(5.0, min(float(min_seconds), 120.0))
    t0 = time.monotonic()
    if _cancelled(job_id):
        return {"ok": False, "cancelled": True, "error": "Cancelled by operator", "path": None}
    try:
        searches = asyncio.run(_search_all(topic, job_id=job_id))
    except Exception as exc:  # noqa: BLE001
        log.exception("research search failed")
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}", "path": None}
    if _cancelled(job_id):
        return {
            "ok": False,
            "cancelled": True,
            "error": "Cancelled by operator",
            "path": None,
            "searches": [{"query": s["query"], "n": len(s.get("results") or [])} for s in searches],
        }
    report = _synthesize(topic, searches)
    if _cancelled(job_id):
        return {"ok": False, "cancelled": True, "error": "Cancelled by operator", "path": None}
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    rel = f"{RESEARCH_DIR}/{_slug(topic)}-{stamp}.md"
    write_file(rel, report.strip() + "\n")
    elapsed = time.monotonic() - t0
    while elapsed < floor:
        if _cancelled(job_id):
            return {
                "ok": True,
                "cancelled": True,
                "topic": topic,
                "path": rel,
                "angles": len(searches),
                "sources": sum(len(s.get("results") or []) for s in searches),
                "seconds": round(time.monotonic() - t0, 1),
            }
        time.sleep(min(0.5, floor - elapsed))
        elapsed = time.monotonic() - t0
    return {
        "ok": True,
        "topic": topic,
        "path": rel,
        "angles": len(searches),
        "sources": sum(len(s.get("results") or []) for s in searches),
        "seconds": round(time.monotonic() - t0, 1),
        "searches": [
            {"query": s["query"], "n": len(s.get("results") or []), "dummy": s.get("dummy")}
            for s in searches
        ],
    }
