from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.models import User
from app.brains.mcp import handle as mcp_handle
from app.brains.schemas import BrainIn, BrainOut, EntryIn, EntryOut
from app.brains.service import add_entry, create_brain, delete_brain, delete_entry, list_brains, profile_body
from app.db import get_db

router = APIRouter(prefix="/brains", tags=["brains"])


def _out(db: Session, brain) -> BrainOut:
    return BrainOut(
        id=brain.id,
        name=brain.name,
        description=brain.description,
        device_id=brain.device_id,
        profile=profile_body(db, brain),
    )


@router.get("", response_model=list[BrainOut])
def api_list_brains(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[BrainOut]:
    return [_out(db, brain) for brain in list_brains(db, user.id)]


@router.post("", response_model=BrainOut)
def api_create_brain(
    body: BrainIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BrainOut:
    brain = create_brain(
        db,
        user.id,
        name=body.name,
        description=body.description,
        method=body.method,
        profile=body.profile,
        device_id=body.device_id,
    )
    return _out(db, brain)


@router.delete("/{brain_id}")
def api_delete_brain(
    brain_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    delete_brain(db, user.id, brain_id)
    return {"ok": True}


@router.post("/{brain_id}/entries", response_model=EntryOut)
def api_add_entry(
    brain_id: str,
    body: EntryIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> EntryOut:
    entry = add_entry(db, user.id, brain_id, title=body.title, body=body.body)
    return EntryOut(id=entry.id, title=entry.title, body=entry.body, updated_at=entry.updated_at)


@router.delete("/{brain_id}/entries/{entry_id}")
def api_delete_entry(
    brain_id: str,
    entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    delete_entry(db, user.id, brain_id, entry_id)
    return {"ok": True}


@router.post("/mcp")
def api_brains_mcp(
    message: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    return mcp_handle(db, user.id, message)
