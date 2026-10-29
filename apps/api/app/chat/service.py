from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.chat.models import ChatMessage, ChatSession


def create_session(
    db: Session,
    user_id: int,
    *,
    title: str = "New chat",
    agent_id: str = "main",
    device_id: str | None = None,
    parent_session_id: str | None = None,
) -> ChatSession:
    session = ChatSession(
        id=str(uuid.uuid4()),
        user_id=user_id,
        device_id=device_id,
        title=title,
        agent_id=agent_id,
        parent_session_id=parent_session_id,
        status="idle",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def list_sessions(
    db: Session, user_id: int, *, device_id: str | None = None
) -> list[ChatSession]:
    q = db.query(ChatSession).filter(
        ChatSession.user_id == user_id,
        ChatSession.agent_id != "guide",
    )
    if device_id:
        q = q.filter(ChatSession.device_id == device_id)
    return q.order_by(
        ChatSession.pinned.desc(),
        ChatSession.pinned_at.desc(),
        ChatSession.updated_at.desc(),
    ).all()


def get_session(db: Session, user_id: int, session_id: str) -> ChatSession:
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session


def rename_session(db: Session, user_id: int, session_id: str, title: str) -> ChatSession:
    session = get_session(db, user_id, session_id)
    session.title = title.strip()[:200] or "New chat"
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def set_pinned(db: Session, user_id: int, session_id: str, pinned: bool) -> ChatSession:
    session = get_session(db, user_id, session_id)
    session.pinned = pinned
    session.pinned_at = datetime.utcnow() if pinned else None
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


# Deleting chats never touches TokenLedger: budget and subscription spend are summed from it,
# so usage must outlive the conversation.
def delete_session(db: Session, user_id: int, session_id: str) -> None:
    session = get_session(db, user_id, session_id)
    db.query(ChatMessage).filter(ChatMessage.session_id == session.id).delete()
    db.delete(session)
    db.commit()


def delete_sessions(db: Session, user_id: int, session_ids: list[str]) -> list[str]:
    """Delete the caller's sessions among `session_ids` in one transaction. Returns the ids deleted."""
    ids = [
        row.id
        for row in db.query(ChatSession.id).filter(
            ChatSession.user_id == user_id, ChatSession.id.in_(set(session_ids))
        )
    ]
    if not ids:
        return []
    db.query(ChatMessage).filter(ChatMessage.session_id.in_(ids)).delete(synchronize_session=False)
    db.query(ChatSession).filter(ChatSession.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return ids


def list_messages(db: Session, session_id: str) -> list[ChatMessage]:
    return (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.id.asc())
        .all()
    )
