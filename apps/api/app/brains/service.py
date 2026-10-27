from __future__ import annotations

import re
import uuid
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.brains.models import Brain, BrainEntry
from app.brains.profile import called_names, profile_filename, profile_markdown, profiles_prompt
from app.devices.service import get_device

_WORD = re.compile(r"[a-z0-9]{3,}")


def list_brains(db: Session, user_id: int) -> list[Brain]:
    return db.query(Brain).filter(Brain.user_id == user_id).order_by(Brain.name.asc()).all()


def get_brain(db: Session, user_id: int, brain_id: str) -> Brain:
    brain = db.query(Brain).filter(Brain.id == brain_id, Brain.user_id == user_id).first()
    if brain is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Brain not found")
    return brain


def create_brain(
    db: Session,
    user_id: int,
    *,
    name: str,
    description: str = "",
    method: str = "",
    profile: str = "",
    device_id: str | None = None,
) -> Brain:
    clean = name.strip()
    if not clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Brain name is required")
    local_device = device_id
    if device_id:
        local_device = get_device(db, user_id, device_id).id
    angle = description.strip()[:300]
    brain = Brain(
        id=str(uuid.uuid4()),
        user_id=user_id,
        device_id=local_device,
        name=clean[:80],
        description=angle,
    )
    db.add(brain)
    db.flush()
    _write_profile(db, brain, profile_markdown(brain.name, angle, method, profile))
    db.commit()
    db.refresh(brain)
    return brain


def delete_brain(db: Session, user_id: int, brain_id: str) -> None:
    brain = get_brain(db, user_id, brain_id)
    db.query(BrainEntry).filter(BrainEntry.brain_id == brain.id).delete()
    db.delete(brain)
    db.commit()


def add_entry(db: Session, user_id: int, brain_id: str, *, title: str, body: str) -> BrainEntry:
    """Replace the expert profile. Brains do not collect notes."""
    brain = get_brain(db, user_id, brain_id)
    label = title.strip().lower()
    if label not in {"", "profile"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A brain stores one expert profile, not notes",
        )
    pasted = body if label == "profile" else ""
    markdown = profile_markdown(brain.name, brain.description, body, pasted)
    entry = _write_profile(db, brain, markdown)
    db.commit()
    db.refresh(entry)
    return entry


def profile_body(db: Session, brain: Brain) -> str:
    entry = (
        db.query(BrainEntry)
        .filter(BrainEntry.brain_id == brain.id, BrainEntry.title == "profile")
        .order_by(BrainEntry.updated_at.desc())
        .first()
    )
    if entry and entry.body.strip():
        return entry.body
    return profile_markdown(brain.name, brain.description, "")


def profiles_for_prompt(db: Session, user_id: int, content: str, device_id: str | None = None) -> str:
    brains = [
        brain
        for brain in list_brains(db, user_id)
        if not brain.device_id or brain.device_id == device_id
    ]
    if not brains:
        return ""
    wanted = set(called_names(content, [brain.name for brain in brains]))
    called = [
        (profile_filename(brain.name), profile_body(db, brain))
        for brain in brains
        if brain.name in wanted
    ]
    return profiles_prompt([brain.name for brain in brains], called)


def _write_profile(db: Session, brain: Brain, markdown: str) -> BrainEntry:
    db.query(BrainEntry).filter(BrainEntry.brain_id == brain.id).delete()
    entry = BrainEntry(brain_id=brain.id, title="profile", body=markdown)
    brain.updated_at = datetime.utcnow()
    db.add_all([entry, brain])
    return entry


def delete_entry(db: Session, user_id: int, brain_id: str, entry_id: int) -> None:
    get_brain(db, user_id, brain_id)
    deleted = (
        db.query(BrainEntry)
        .filter(BrainEntry.id == entry_id, BrainEntry.brain_id == brain_id)
        .delete()
    )
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    db.commit()


def search_profiles(db: Session, user_id: int, query: str, *, brain_name: str = "", limit: int = 4) -> list[Brain]:
    words = set(_WORD.findall(query.lower()))
    brains = list_brains(db, user_id)
    if brain_name:
        brains = [brain for brain in brains if brain.name.lower() == brain_name.lower()]
    if not words:
        return brains[:limit]
    scored: list[tuple[int, Brain]] = []
    for brain in brains:
        hay = f"{brain.name}\n{brain.description}\n{profile_body(db, brain)}".lower()
        score = sum(1 for word in words if word in hay)
        if score:
            scored.append((score, brain))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [brain for _, brain in scored[:limit]]
