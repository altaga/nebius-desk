"""One chat turn: persist the user message, route it, stream the answer, record real usage."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from datetime import datetime

from fastapi import HTTPException

from app.chat.models import ChatMessage, ChatSession
from app.chat.service import create_session, get_session, list_messages
from app.config import get_settings
from app.db import SessionLocal
from app.devices.models import Device
from app.brains.service import profiles_for_prompt
from app.devices.service import ensure_default_device, get_device, memory_blob_for_prompt
from app.vault.service import list_names as secret_names
from app.router.hybrid import RoutingError, plan_route, run_plan
from app.router.local_llm import LocalModelError
from app.router.nebius import NebiusError
from app.router.types import RouteResult, TextDelta, result_to_dict
from app.telemetry.service import record_turn, session_stats

log = logging.getLogger(__name__)


def clip_title(content: str, limit: int = 80) -> str:
    text = " ".join(content.split())
    if len(text) <= limit:
        return text or "New chat"
    head = text[:limit]
    if " " in head:
        head = head.rsplit(" ", 1)[0]
    return head.strip() or "New chat"


def _open_session(db, user_id: int, content: str, session_id: str | None, device_id: str | None) -> ChatSession:
    if session_id:
        session = get_session(db, user_id, session_id)
    else:
        if device_id:
            try:
                device_id = get_device(db, user_id, device_id).id
            except HTTPException:
                device_id = None
        device_id = device_id or ensure_default_device(db, user_id).id
        session = create_session(db, user_id, title=clip_title(content), device_id=device_id)
    if not session.title or session.title == "New chat":
        session.title = clip_title(content)
    session.status = "running"
    session.updated_at = datetime.utcnow()
    db.add(session)
    db.commit()
    return session


async def stream_turn(
    user_id: int, *, content: str, session_id: str | None, device_id: str | None, choice: str = "auto"
) -> AsyncIterator[dict]:
    settings = get_settings()
    db = SessionLocal()
    user_msg: ChatMessage | None = None
    try:
        session = _open_session(db, user_id, content, session_id, device_id)
        history = [
            {"role": m.role, "content": m.content}
            for m in list_messages(db, session.id)
            if m.role in ("user", "assistant")
        ]
        user_msg = ChatMessage(session_id=session.id, role="user", content=content)
        db.add(user_msg)
        db.commit()

        device = db.get(Device, session.device_id) if session.device_id else None
        plan = await plan_route(
            db,
            settings,
            user_text=content,
            history=history,
            shared_memory=memory_blob_for_prompt(db, user_id, device.id) if device else "",
            device_name=device.name if device else "edge device",
            desk_context=_desk_context(db, user_id, content, device.id if device else None),
            choice=choice,
            user_id=user_id,
        )
        yield {
            "type": "start",
            "session_id": session.id,
            "route": plan.route,
            "model": plan.model,
            "intent": plan.intent,
            "thinking": plan.thinking,
            "compressed": plan.compressed,
            "note": plan.note,
            "selector": plan.selector,
            "selector_reason": plan.selector_reason,
            "selector_ms": plan.selector_ms,
        }

        result: RouteResult | None = None
        async for event in run_plan(settings, plan):
            if isinstance(event, TextDelta):
                yield {"type": "delta", "kind": event.kind, "text": event.text}
            else:
                result = event
        if result is None or not result.reply:
            raise RoutingError("The model returned an empty answer.")

        meta = result_to_dict(result)
        assistant = ChatMessage(session_id=session.id, role="assistant", content=result.reply,
                                meta_json=json.dumps(meta))
        session.status = "idle"
        session.updated_at = datetime.utcnow()
        db.add_all([assistant, session])
        db.commit()
        record_turn(db, user_id=user_id, session_id=session.id, result=result)
        yield {
            "type": "done",
            "session_id": session.id,
            "message": {"role": "assistant", "content": result.reply, "meta": meta,
                        "created_at": assistant.created_at.isoformat() if assistant.created_at else None},
            "telemetry": session_stats(db, session.id),
        }
    except (RoutingError, NebiusError, LocalModelError) as exc:
        yield _failure(db, user_msg, str(exc))
    except Exception as exc:  # noqa: BLE001 — never leave the client hanging
        log.exception("Chat turn failed")
        yield _failure(db, user_msg, f"Unexpected error: {exc}")
    finally:
        db.close()


async def complete_turn(
    user_id: int,
    *,
    content: str,
    session_id: str | None = None,
    device_id: str | None = None,
    choice: str = "auto",
) -> dict:
    """Run a turn to completion; returns the `done` event or raises RoutingError."""
    async for event in stream_turn(
        user_id, content=content, session_id=session_id, device_id=device_id, choice=choice
    ):
        if event["type"] == "error":
            raise RoutingError(event["detail"])
        if event["type"] == "done":
            return event
    raise RoutingError("Turn ended without an answer.")


def _desk_context(db, user_id: int, content: str, device_id: str | None) -> str:
    parts: list[str] = []
    names = secret_names(db, user_id)
    if names:
        listed = ", ".join(names)
        parts.append(
            "Execution secrets are injected into shell commands on this board. "
            f"Their names are: {listed}. You do not know the values. "
            "Do not print them, ask for them, or try to read them back."
        )
    profiles = profiles_for_prompt(db, user_id, content, device_id=device_id)
    if profiles:
        parts.append(profiles)
    return "\n\n".join(parts)


def _failure(db, user_msg: ChatMessage | None, detail: str) -> dict:
    db.rollback()
    if user_msg is not None and user_msg.id is not None:
        db.query(ChatMessage).filter(ChatMessage.id == user_msg.id).delete()
        db.query(ChatSession).filter(ChatSession.id == user_msg.session_id).update({"status": "idle"})
        db.commit()
    return {"type": "error", "detail": detail}
