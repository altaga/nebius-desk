"""Allowlisted guide actions (server-side enum)."""

from __future__ import annotations

import json
import re
from typing import Any

GUIDE_ACTION_TYPES = frozenset(
    {
        "open_chat",
        "open_machine",
        "open_terminal",
        "open_files",
        "open_health",
        "open_panel",
        "open_board",
        "open_plan",
        "open_nav",
        "highlight",
        "react",
    }
)

# Keep in sync with apps/web SAFE_REACTIONS — Nano routes these via the react tool.
GUIDE_EMOTIONS = frozenset(
    {
        "neutral",
        "happy",
        "excited",
        "love",
        "shy",
        "surprised",
        "relaxed",
        "sleepy",
        "wink",
        "thinking",
        "laugh",
        "cat",
        "determined",
        "smug",
        "apologetic",
        "pout",
        "flustered",
        "sad",
    }
)

GUIDE_TARGETS = frozenset(
    {
        "nav.open_machine",
        "nav.new_chat",
        "nav.pair",
        "machine.health",
        "machine.terminal",
        "machine.files",
        "panel.chat",
        "panel.board",
        "panel.plan",
        "board.status",
        "board.memory",
        "board.experts",
        "board.secrets",
        "chat.model_picker",
    }
)

_FENCE = re.compile(r"```guide\s*([\s\S]*?)```", re.I)


def _normalize(item: Any) -> dict | None:
    if not isinstance(item, dict):
        return None
    kind = item.get("type")
    if not isinstance(kind, str) or kind not in GUIDE_ACTION_TYPES:
        return None
    if kind == "highlight":
        target = item.get("target")
        if not isinstance(target, str) or target not in GUIDE_TARGETS:
            return None
        return {"type": "highlight", "target": target}
    if kind == "react":
        emotion = item.get("emotion") or item.get("name")
        if not isinstance(emotion, str) or emotion not in GUIDE_EMOTIONS:
            return None
        return {"type": "react", "emotion": emotion}
    return {"type": kind}


def gate_actions(raw: list[Any]) -> list[dict]:
    out: list[dict] = []
    for item in raw:
        clean = _normalize(item)
        if clean:
            out.append(clean)
    return out


def _ingest_actions_payload(parsed: Any, actions: list[dict]) -> bool:
    """Pull allowlisted actions from a parsed JSON value. Returns True if any were taken."""
    before = len(actions)
    if isinstance(parsed, list):
        actions.extend(gate_actions(parsed))
    elif isinstance(parsed, dict) and isinstance(parsed.get("actions"), list):
        actions.extend(gate_actions(parsed["actions"]))
    elif isinstance(parsed, dict) and isinstance(parsed.get("type"), str):
        actions.extend(gate_actions([parsed]))
    return len(actions) > before


def parse_guide_reply(text: str) -> tuple[str, list[dict]]:
    """Strip ```guide fences (and bare action JSON); return display text + allowlisted actions."""
    actions: list[dict] = []

    def _take(match: re.Match[str]) -> str:
        body = match.group(1).strip()
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            return ""
        _ingest_actions_payload(parsed, actions)
        return ""

    cleaned = _FENCE.sub(_take, text)
    # Drop an unclosed trailing fence so it never leaks into the bubble.
    cleaned = re.sub(r"```guide\s*[\s\S]*$", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()

    # Model sometimes emits only bare JSON with no fence.
    if not actions and cleaned.startswith(("{", "[")):
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            parsed = None
        if parsed is not None and _ingest_actions_payload(parsed, actions):
            cleaned = ""

    return cleaned, actions
