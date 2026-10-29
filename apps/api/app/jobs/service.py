"""Enqueue / list / finish durable board jobs + desk notices."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from app.jobs.models import BoardJob, DeskNotice
from app.ops.emit import emit_ops

log = logging.getLogger(__name__)

_HIDDEN = ("dismissed",)


def enqueue(
    db: Session,
    *,
    user_id: int,
    kind: str,
    payload: dict,
    notify_session_id: str | None = None,
) -> BoardJob:
    job = BoardJob(
        id=str(uuid.uuid4()),
        user_id=user_id,
        kind=kind,
        status="queued",
        payload_json=json.dumps(payload or {}),
        notify_session_id=notify_session_id,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def get_job(db: Session, user_id: int, job_id: str) -> BoardJob | None:
    return (
        db.query(BoardJob)
        .filter(BoardJob.user_id == user_id, BoardJob.id == job_id)
        .first()
    )


def list_jobs(db: Session, user_id: int, *, limit: int = 40) -> list[BoardJob]:
    return (
        db.query(BoardJob)
        .filter(BoardJob.user_id == user_id, BoardJob.status.notin_(_HIDDEN))
        .order_by(BoardJob.created_at.desc())
        .limit(max(1, min(limit, 100)))
        .all()
    )


def is_cancelled(db: Session, job_id: str) -> bool:
    job = db.get(BoardJob, job_id)
    return not job or job.status in ("cancelled", "dismissed")


def cancel_job(db: Session, user_id: int, job_id: str) -> BoardJob | None:
    """Stop a queued/running job. No-op status change if already terminal."""
    job = get_job(db, user_id, job_id)
    if not job or job.status in _HIDDEN:
        return None
    if job.status in ("queued", "running"):
        job.status = "cancelled"
        job.error = job.error or "Cancelled by operator"
        job.finished_at = datetime.utcnow()
        db.add(job)
        db.commit()
        db.refresh(job)
    return job


def dismiss_job(db: Session, user_id: int, job_id: str) -> BoardJob | None:
    """Remove from Agents list. Cancels first if still active."""
    job = get_job(db, user_id, job_id)
    if not job or job.status in _HIDDEN:
        return None
    if job.status in ("queued", "running"):
        job.status = "cancelled"
        job.error = job.error or "Cancelled by operator"
        job.finished_at = datetime.utcnow()
    job.status = "dismissed"
    if not job.finished_at:
        job.finished_at = datetime.utcnow()
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def mark_running(db: Session, job: BoardJob) -> None:
    # Honour cancel that landed while queued.
    db.refresh(job)
    if job.status in ("cancelled", "dismissed"):
        return
    job.status = "running"
    job.started_at = datetime.utcnow()
    db.add(job)
    db.commit()


def _clean_report_excerpt(raw: str, *, max_bullets: int = 5) -> tuple[str | None, list[str]]:
    """Title + a few findings — never dump HTML comments or a raw file wall."""
    import re

    text = re.sub(r"<!--.*?-->", "", raw or "", flags=re.S).strip()
    text = re.sub(r"[【\[]([^】\]]{1,80})[】\]]", r"(\1)", text)
    title = None
    for line in text.splitlines():
        m = re.match(r"^#{1,3}\s+(.*\S)\s*$", line.strip())
        if m:
            title = m.group(1).strip()
            break
    bullets: list[str] = []
    for line in text.splitlines():
        m = re.match(r"^\s*[-*•]\s+(.*\S)\s*$", line)
        if not m:
            continue
        item = re.sub(r"\s+", " ", m.group(1)).strip()
        if len(item) > 160:
            item = item[:157].rstrip() + "…"
        bullets.append(item)
        if len(bullets) >= max_bullets:
            break
    return title, bullets


def _job_chat_summary(job: BoardJob, *, ok: bool, result: dict, error: str | None) -> str:
    kind = job.kind or "agent"
    label = {
        "research": "Research",
        "record": "Record",
        "verify": "Verify",
        "shell": "Shell",
        "deploy": "Deploy",
        "checks": "Checks",
        "bakeoff": "Bakeoff",
        "probe": "Probe",
        "health": "Health",
    }.get(kind, kind.capitalize())
    if not ok:
        return f"{label} agent failed.\n\n{error or 'Unknown error'}"

    if kind == "research":
        try:
            payload = json.loads(job.payload_json or "{}")
        except json.JSONDecodeError:
            payload = {}
        topic = result.get("topic") or (payload if isinstance(payload, dict) else {}).get("topic") or "topic"
        path = result.get("path") or ""
        sources = result.get("sources")
        angles = result.get("angles")
        lines = [f"**{label} agent finished**", "", f"Topic: {topic}"]
        meta_bits: list[str] = []
        if path:
            meta_bits.append(f"`{path}`")
        if sources is not None:
            meta_bits.append(f"{sources} sources" + (f" · {angles} angles" if angles else ""))
        if meta_bits:
            lines.append(" · ".join(meta_bits))

        title, bullets = None, []
        if path:
            try:
                from app.edge.files import resolve_path

                title, bullets = _clean_report_excerpt(
                    resolve_path(str(path)).read_text(encoding="utf-8")
                )
            except Exception:  # noqa: BLE001
                title, bullets = None, []
        if title:
            lines.extend(["", f"### {title}"])
        if bullets:
            lines.append("")
            lines.extend(f"- {b}" for b in bullets)
        lines.append("")
        lines.append(
            f"Full report in **Files** → `{path}`."
            if path
            else "Full report in **Files** → `.desk/research/`."
        )
        return "\n".join(lines)

    if kind == "record":
        path = result.get("path") or ""
        secs = result.get("seconds")
        return (
            f"**{label} agent finished**\n\n"
            f"Video: `{path}`" + (f" ({secs}s)" if secs is not None else "")
        )

    path = result.get("path") or result.get("report")
    if path:
        return f"**{label} agent finished**\n\nOutput: `{path}`"
    return f"**{label} agent finished** on the board."


def _post_job_to_chat(db: Session, job: BoardJob, *, ok: bool, result: dict, error: str | None) -> None:
    sid = (job.notify_session_id or "").strip()
    if not sid:
        return
    try:
        from app.chat.models import ChatMessage, ChatSession

        session = db.get(ChatSession, sid)
        if not session or session.user_id != job.user_id:
            return
        content = _job_chat_summary(job, ok=ok, result=result, error=error)
        meta = json.dumps(
            {
                "job_id": job.id,
                "job_kind": job.kind,
                "job_status": job.status,
                "source": "background_agent",
            }
        )
        db.add(
            ChatMessage(
                session_id=sid,
                role="assistant",
                content=content[:12000],
                meta_json=meta,
            )
        )
        session.updated_at = datetime.utcnow()
        db.add(session)
        db.commit()
    except Exception:  # noqa: BLE001 — never fail the job finish path
        log.exception("failed to post job result to chat session %s", sid)
        db.rollback()


def mark_finished(db: Session, job: BoardJob, *, ok: bool, result: dict, error: str | None = None) -> None:
    db.refresh(job)
    if job.status in ("cancelled", "dismissed"):
        # Operator stopped it mid-flight — keep cancelled, stash partial result.
        job.result_json = json.dumps(result or {})
        if error and not job.error:
            job.error = error[:2000]
        if not job.finished_at:
            job.finished_at = datetime.utcnow()
        db.add(job)
        db.commit()
        return
    job.status = "done" if ok else "error"
    job.result_json = json.dumps(result or {})
    job.error = (error or "")[:2000] or None
    job.finished_at = datetime.utcnow()
    db.add(job)
    db.commit()
    title = f"Job {job.kind} {'ok' if ok else 'failed'}"
    body = error or _job_chat_summary(job, ok=ok, result=result or {}, error=error)[:500]
    notice = DeskNotice(
        user_id=job.user_id,
        job_id=job.id,
        kind="job",
        title=title[:200],
        body=body[:4000],
        read=0,
    )
    db.add(notice)
    db.commit()
    _post_job_to_chat(db, job, ok=ok, result=result or {}, error=error)
    emit_ops(
        {
            "kind": "chat",
            "status": "ok" if ok else "error",
            "error_code": None if ok else "job_failed",
            "session_id": job.notify_session_id,
            "features": {"job_id": job.id, "job_kind": job.kind, "job_status": job.status},
            "note": title,
        }
    )


def list_notices(db: Session, user_id: int, *, unread_only: bool = False, limit: int = 30) -> list[DeskNotice]:
    q = db.query(DeskNotice).filter(DeskNotice.user_id == user_id)
    if unread_only:
        q = q.filter(DeskNotice.read == 0)
    return q.order_by(DeskNotice.created_at.desc()).limit(max(1, min(limit, 100))).all()


def mark_notice_read(db: Session, user_id: int, notice_id: int) -> DeskNotice | None:
    row = (
        db.query(DeskNotice)
        .filter(DeskNotice.user_id == user_id, DeskNotice.id == notice_id)
        .first()
    )
    if not row:
        return None
    row.read = 1
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def job_out(job: BoardJob) -> dict:
    try:
        payload = json.loads(job.payload_json or "{}")
    except json.JSONDecodeError:
        payload = {}
    try:
        result = json.loads(job.result_json or "{}")
    except json.JSONDecodeError:
        result = {}
    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "payload": payload,
        "result": result,
        "error": job.error,
        "notify_session_id": job.notify_session_id,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }


def notice_out(row: DeskNotice) -> dict:
    return {
        "id": row.id,
        "job_id": row.job_id,
        "kind": row.kind,
        "title": row.title,
        "body": row.body,
        "read": bool(row.read),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
