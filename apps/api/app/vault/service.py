from __future__ import annotations

import re
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.vault.crypto import decrypt_value, encrypt_value
from app.vault.models import DeskSecret

NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
BLOCKED_NAMES = {
    "PATH",
    "HOME",
    "SHELL",
    "IFS",
    "ENV",
    "BASH_ENV",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "PYTHONPATH",
    "NODE_OPTIONS",
    "SSLKEYLOGFILE",
}


def _clean_name(name: str) -> str:
    clean = name.strip()
    if not NAME_RE.match(clean) or clean.upper() in BLOCKED_NAMES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid secret name")
    return clean


def list_names(db: Session, user_id: int) -> list[str]:
    rows = (
        db.query(DeskSecret)
        .filter(DeskSecret.user_id == user_id)
        .order_by(DeskSecret.name.asc())
        .all()
    )
    return [row.name for row in rows]


def put_secret(db: Session, user_id: int, name: str, value: str) -> str:
    clean = _clean_name(name)
    if not value or len(value) > 8000:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Secret value is empty or too long")
    row = (
        db.query(DeskSecret)
        .filter(DeskSecret.user_id == user_id, DeskSecret.name == clean)
        .first()
    )
    if row is None:
        row = DeskSecret(user_id=user_id, name=clean, ciphertext=encrypt_value(value))
    else:
        row.ciphertext = encrypt_value(value)
        row.updated_at = datetime.utcnow()
    db.add(row)
    db.commit()
    return clean


def delete_secret(db: Session, user_id: int, name: str) -> None:
    clean = _clean_name(name)
    db.query(DeskSecret).filter(DeskSecret.user_id == user_id, DeskSecret.name == clean).delete()
    db.commit()


def secret_map(db: Session, user_id: int | None = None) -> dict[str, str]:
    query = db.query(DeskSecret)
    if user_id is not None:
        query = query.filter(DeskSecret.user_id == user_id)
    found: dict[str, str] = {}
    for row in query.all():
        plain = decrypt_value(row.ciphertext)
        if plain:
            found[row.name] = plain
    return found


def secret_values(db: Session, user_id: int | None = None) -> list[str]:
    return list(secret_map(db, user_id).values())
