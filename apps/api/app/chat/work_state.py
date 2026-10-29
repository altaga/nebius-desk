"""Durable work state on the board disk — survives chat context compression."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from app.edge.files import resolve_path, write_file

WORK_REL = ".desk/WORK.md"

_DEFAULT = """---
kind: work
updated: {when}
---

# Work state

## Now

(none)

## Done

(none)

## Blocked

(none)

## Next

(none)
"""


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def work_path() -> Path:
    return resolve_path(WORK_REL)


def read_work_state() -> str:
    path = work_path()
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def ensure_work_state() -> str:
    path = work_path()
    if path.is_file():
        return path.read_text(encoding="utf-8", errors="replace")
    body = _DEFAULT.format(when=_today())
    write_file(WORK_REL, body)
    return body


def write_work_state(body: str) -> dict:
    text = (body or "").strip()
    if not text:
        raise ValueError("Work state body is empty")
    if "kind: work" not in text[:400]:
        text = f"---\nkind: work\nupdated: {_today()}\n---\n\n{text}\n"
    elif "updated:" not in text[:400]:
        text = text.replace("---\n", f"---\nupdated: {_today()}\n", 1)
    result = write_file(WORK_REL, text if text.endswith("\n") else text + "\n")
    return {"path": WORK_REL, "bytes": result["bytes"]}


def work_prompt_blob() -> str:
    raw = read_work_state().strip()
    if not raw:
        return (
            "Work state file `.desk/WORK.md` is empty. "
            "Only update it with a ```work fence for real multi-step operator work "
            "(sections Now / Done / Blocked / Next). "
            "Never invent operators, teams, or pending-action dashboards."
        )
    # Cap so a polluted WORK.md cannot dominate Nano's attention.
    body = raw if len(raw) <= 2500 else raw[:2500] + "\n…(truncated)…"
    return (
        "Durable work state on this board (`.desk/WORK.md`). "
        "Only trust what is written here — never invent Alice/Bob/Carol or pending-action tables. "
        "Update with a ```work fence only when Now/Done/Blocked/Next truly change.\n\n"
        f"```markdown\n{body}\n```"
    )
