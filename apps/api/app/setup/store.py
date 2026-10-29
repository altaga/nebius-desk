"""Board setup file — name, password hash, dummy Wi-Fi. Never stores secrets in plaintext."""

from __future__ import annotations

import json
import os
import re
import secrets
import threading
from pathlib import Path
from typing import Any

from app.auth.security import hash_password, verify_password

_FACTORY_ID = re.compile(r"^[0-9A-F]{3}$")

_LOCK = threading.Lock()
_FORBIDDEN = {"millie"}


def config_dir() -> Path:
    override = (os.environ.get("DESK_CONFIG_DIR") or "").strip()
    if override:
        return Path(override)
    return Path.home() / ".config" / "nebius-desk"


def board_path() -> Path:
    return config_dir() / "board.json"


def agent_path() -> Path:
    return config_dir() / "agent.json"


def is_paired() -> bool:
    path = agent_path()
    if not path.is_file():
        return False
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return bool(isinstance(data, dict) and data.get("device_token") and data.get("device_id"))


def _write_private(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def ensure_factory_id() -> str:
    """Stable 3-hex onboard tag. Unpaired boards show as Jetson#A3F."""
    row = load_board()
    tag = str(row.get("factory_id") or "").strip().upper()
    if _FACTORY_ID.fullmatch(tag):
        return tag
    tag = f"{secrets.randbits(12):03X}"
    row["factory_id"] = tag
    save_board(row)
    return tag


def factory_name(tag: str | None = None) -> str:
    return f"Jetson#{tag or ensure_factory_id()}"


def ensure_relay_secret() -> str:
    path = config_dir() / "relay-secret"
    if path.is_file():
        try:
            return path.read_text(encoding="utf-8").strip()
        except OSError:
            pass
    value = secrets.token_urlsafe(32)
    _write_private(path, value + "\n")
    return value


def write_agent(cloud_url: str, device_id: str, device_token: str) -> None:
    ensure_relay_secret()
    payload = {"cloud_url": cloud_url, "device_id": device_id, "device_token": device_token}
    _write_private(agent_path(), json.dumps(payload) + "\n")


def load_board() -> dict[str, Any]:
    path = board_path()
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def save_board(data: dict[str, Any]) -> dict[str, Any]:
    path = board_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    return data


def normalize_name(raw: str) -> str:
    name = " ".join((raw or "").split())
    if not name:
        raise ValueError("board_name_required")
    if len(name) > 40:
        raise ValueError("board_name_too_long")
    if name.lower() in _FORBIDDEN:
        raise ValueError("board_name_reserved")
    return name


def set_credentials(name: str, password: str, wifi: dict[str, Any] | None) -> dict[str, Any]:
    if len(password) < 4:
        raise ValueError("board_password_short")
    row = load_board()
    row["name"] = normalize_name(name)
    row["password_hash"] = hash_password(password)
    if wifi is not None:
        row["wifi"] = wifi
    return save_board(row)


def check_password(plain: str) -> bool:
    hashed = str(load_board().get("password_hash") or "")
    return bool(hashed) and verify_password(plain, hashed)


def public_board(*, prefer_custom: bool = False) -> dict[str, Any]:
    row = load_board()
    wifi = row.get("wifi") if isinstance(row.get("wifi"), dict) else None
    paired = is_paired()
    tag = ensure_factory_id()
    custom = str(row.get("name") or "").strip()
    show_custom = custom and (paired or prefer_custom)
    return {
        "name": custom if show_custom else factory_name(tag),
        "factory_id": tag,
        "has_password": bool(row.get("password_hash")),
        "wifi": wifi,
        "paired": paired,
    }
