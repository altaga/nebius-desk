from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.models import User
from app.db import get_db
from app.jobs import runner
from app.jobs.service import (
    cancel_job,
    dismiss_job,
    enqueue,
    get_job,
    job_out,
    list_jobs,
    list_notices,
    mark_notice_read,
    notice_out,
)

router = APIRouter(prefix="/jobs", tags=["jobs"])


class EnqueueRequest(BaseModel):
    kind: str = Field(
        pattern="^(shell|verify|probe|health|deploy|checks|bakeoff|record|research)$"
    )
    payload: dict = Field(default_factory=dict)
    notify_session_id: str | None = None


@router.get("")
async def api_list_jobs(
    limit: int = 40,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    rows = list_jobs(db, user.id, limit=limit)
    return {"jobs": [job_out(j) for j in rows]}


@router.get("/notices")
def api_list_notices(
    unread: bool = False,
    limit: int = 30,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    rows = list_notices(db, user.id, unread_only=unread, limit=limit)
    return {"notices": [notice_out(n) for n in rows], "unread": sum(1 for n in rows if not n.read)}


@router.post("/notices/{notice_id}/read")
def api_read_notice(
    notice_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    row = mark_notice_read(db, user.id, notice_id)
    if not row:
        raise HTTPException(status_code=404, detail="Notice not found")
    return notice_out(row)


@router.get("/{job_id}")
def api_get_job(
    job_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    job = get_job(db, user.id, job_id)
    if not job or job.status == "dismissed":
        raise HTTPException(status_code=404, detail="Job not found")
    return job_out(job)


@router.post("/{job_id}/cancel")
def api_cancel_job(
    job_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    job = cancel_job(db, user.id, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job_out(job)


@router.delete("/{job_id}")
def api_dismiss_job(
    job_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Stop if still running, then hide from the Agents list."""
    job = dismiss_job(db, user.id, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"ok": True, "id": job_id, "status": "dismissed"}


@router.post("")
async def api_enqueue(
    body: EnqueueRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    job = enqueue(
        db,
        user_id=user.id,
        kind=body.kind,
        payload=body.payload,
        notify_session_id=body.notify_session_id,
    )
    await runner.submit(job.id)
    return job_out(job)
