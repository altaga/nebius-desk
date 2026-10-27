"""Auto model selection: the Jetson's own model reads the request and picks a tier."""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass

import httpx

from app.config import Settings
from app.router.intent import route_tier
from app.router.local_llm import resolve_model

TIERS = ("local", "nano", "fast", "heavy", "ultra")

_SYSTEM = (
    "You route user requests to the cheapest model that will still answer them well.\n"
    "local: greetings, small talk, thanks, translation, reformatting, fixing typos, short rewrites, "
    "trivial facts. Free, runs on the device, weak at reasoning and long answers.\n"
    "fast: normal questions, explanations, summaries, everyday code help, comparisons. Cheap cloud model.\n"
    "heavy: multi-step reasoning, system or architecture design, hard debugging, math, long plans, "
    "anything where a wrong answer is costly. Expensive cloud model that thinks before answering.\n"
    'Reply only with JSON: {"route": "local|fast|heavy", "reason": "<at most 12 words>"}'
)


@dataclass
class Selection:
    tier: str
    selector: str  # "manual" | "jetson" | "rules"
    reason: str
    latency_ms: int = 0


def _parse(raw: str) -> tuple[str, str] | None:
    match = re.search(r"\{.*\}", raw, re.S)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    named = re.findall(r"local|fast|heavy", str(data.get("route", "")).lower())
    reason = " ".join(str(data.get("reason", "")).split())[:120]
    return (named[0], reason) if named else None


async def _ask_jetson(settings: Settings, user_text: str, history_turns: int) -> tuple[str, str] | None:
    context = f"(Conversation so far: {history_turns} messages.)\n" if history_turns else ""
    model = await resolve_model(settings) or settings.ollama_model
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": f"{context}Request:\n{user_text[:1500]}"},
        ],
        "stream": False,
        "format": "json",
        "keep_alive": "24h",
        "options": {"temperature": 0, "num_predict": 60},
    }
    async with httpx.AsyncClient(timeout=settings.selector_timeout_s) as client:
        resp = await client.post(f"{settings.ollama_base_url.rstrip('/')}/api/chat", json=payload)
        resp.raise_for_status()
        return _parse((resp.json().get("message") or {}).get("content", ""))


def _borderline(user_text: str) -> bool:
    words = len(re.findall(r"\S+", user_text))
    return 80 <= words <= 400 and "```" not in user_text


async def select_tier(
    settings: Settings, *, choice: str, user_text: str, history_turns: int, local_ok: bool
) -> Selection:
    if settings.board_emu:
        # Docker fake board: Nano / Lightning / Super only. Auto and Local are remapped.
        if choice in ("nano", "fast", "heavy", "ultra"):
            return Selection(choice, "manual", "chosen in the composer")
        if choice == "local":
            return Selection("nano", "manual", "board-emu has no local model — Nano")
        return Selection("nano", "manual", "board-emu has no Auto route — Nano")
    if choice in TIERS:
        return Selection(choice, "manual", "chosen in the composer")
    tier, reason = route_tier(user_text)
    if tier == "local" and not local_ok:
        return Selection("fast", "rules", "Jetson model offline — sent to Nebius")
    if tier != "fast" or not local_ok or not _borderline(user_text):
        return Selection(tier, "rules", reason)

    started = time.perf_counter()
    try:
        picked = await _ask_jetson(settings, user_text, history_turns)
    except httpx.HTTPError:
        picked = None
    elapsed = int((time.perf_counter() - started) * 1000)
    if not picked or picked[0] == "local":
        sel = Selection(tier, "rules", reason)
        sel.latency_ms = elapsed
        return sel
    return Selection(picked[0], "jetson", picked[1] or "picked by the Jetson", elapsed)
