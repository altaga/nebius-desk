"""Local export for the board agent. Not an HTTP route."""

from __future__ import annotations

from app.db import SessionLocal
from app.vault.service import secret_map


def export_map() -> dict[str, str]:
    db = SessionLocal()
    try:
        return secret_map(db)
    finally:
        db.close()
