"""How the board reaches the central service. Tokens stay in the agent's config, not in git."""

from __future__ import annotations

import json
from pathlib import Path

from app.config import get_settings

CONFIG_DIR = Path.home() / ".config" / "nebius-desk"


def _agent_file() -> dict:
    try:
        data = json.loads((CONFIG_DIR / "agent.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def cloud_config() -> tuple[str, str] | None:
    """(cloud base url, device token), or None when this board is not paired."""
    settings = get_settings()
    saved = _agent_file()
    url = (settings.desk_cloud_url or str(saved.get("cloud_url") or "")).rstrip("/")
    token = settings.desk_device_token or str(saved.get("device_token") or "")
    if url and token:
        return url, token
    return None


def relay_secret() -> str:
    settings = get_settings()
    if settings.desk_relay_secret:
        return settings.desk_relay_secret
    try:
        return (CONFIG_DIR / "relay-secret").read_text(encoding="utf-8").strip()
    except OSError:
        return ""
