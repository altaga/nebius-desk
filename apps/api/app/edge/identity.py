"""Board identity triad — never collapse these into one string.

  fleet_name  → Desk UI / fleet label (e.g. Kratos). Not the OS.
  hostname    → OS network name (e.g. millie). Leftover hostnames are common.
  os_user     → POSIX account that runs the API (e.g. altaga). Owns ~ and desk root.

Millie is only the waifu UI guide — never a board identity field.
"""

from __future__ import annotations

import getpass
import os
import platform
from pathlib import Path

from app.edge.files import fs_root


def host_identity() -> dict:
    home = Path.home().resolve()
    root = fs_root()
    try:
        user = getpass.getuser()
    except Exception:  # noqa: BLE001 — exotic containers
        user = os.environ.get("USER") or os.environ.get("USERNAME") or "unknown"
    return {
        "hostname": platform.node() or "unknown",
        "os_user": user,
        "home": str(home),
        "desk_root": str(root),
        "desk_root_is_home": root == home,
        "uid": getattr(os, "getuid", lambda: None)(),
    }


def board_identity(fleet_name: str | None = None) -> dict:
    host = host_identity()
    fleet = (fleet_name or "").strip() or None
    home_note = (
        "same as home — relative paths and list `.` are under this home"
        if host["desk_root_is_home"]
        else f"custom root {host['desk_root']}"
    )
    legend = (
        f"Board identity (do not mix): "
        f"fleet_name={fleet or '(unset)'} (Desk UI label); "
        f"hostname={host['hostname']} (OS network name — may be leftover); "
        f"os_user={host['os_user']} (POSIX account); "
        f"home={host['home']}; desk_root={host['desk_root']} ({home_note}). "
        "Millie is the UI guide avatar only — never the board. "
        "Never invent paths like /home/<hostname>; use os_user home / desk_root."
    )
    return {
        "fleet_name": fleet,
        **host,
        "legend": legend,
    }


def identity_prompt_blob(fleet_name: str | None = None) -> str:
    return board_identity(fleet_name)["legend"]
