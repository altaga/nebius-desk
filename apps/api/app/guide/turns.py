"""Guide turns: force Nano, use Clippy system prompt, emit allowlisted actions."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from datetime import datetime

from fastapi import HTTPException

from app.chat.models import ChatMessage, ChatSession
from app.chat.service import create_session, get_session, list_messages
from app.chat.turns import _failure, clip_title
from app.config import get_settings
from app.db import SessionLocal
from app.devices.models import Device
from app.devices.service import ensure_default_device, get_device
from app.guide.actions import parse_guide_reply
from app.guide.prompt import GUIDE_HISTORY_MESSAGES, guide_system_message
from app.router.hybrid import RoutingError, plan_route, run_plan
from app.router.local_llm import LocalModelError
from app.router.nebius import NebiusError
from app.router.types import RouteResult, TextDelta, result_to_dict
from app.telemetry.service import record_turn, session_stats

log = logging.getLogger(__name__)

GUIDE_AGENT = "guide"


def _open_guide_session(
    db, user_id: int, content: str, session_id: str | None, device_id: str | None
) -> ChatSession:
    if session_id:
        session = get_session(db, user_id, session_id)
        if session.agent_id != GUIDE_AGENT:
            raise HTTPException(status_code=400, detail="Not a guide session")
    else:
        if device_id:
            try:
                device_id = get_device(db, user_id, device_id).id
            except HTTPException:
                device_id = None
        device_id = device_id or ensure_default_device(db, user_id).id
        session = create_session(
            db,
            user_id,
            title=clip_title(content) or "Millie guide",
            agent_id=GUIDE_AGENT,
            device_id=device_id,
        )
    if not session.title or session.title == "New chat":
        session.title = clip_title(content) or "Millie guide"
    session.status = "running"
    session.updated_at = datetime.utcnow()
    db.add(session)
    db.commit()
    return session


async def stream_guide_turn(
    user_id: int, *, content: str, session_id: str | None, device_id: str | None
) -> AsyncIterator[dict]:
    settings = get_settings()
    db = SessionLocal()
    user_msg: ChatMessage | None = None
    try:
        session = _open_guide_session(db, user_id, content, session_id, device_id)
        # Cap history — Millie is a UI guide, not a long chat; saves input tokens every turn.
        history = [
            {"role": m.role, "content": m.content}
            for m in list_messages(db, session.id)
            if m.role in ("user", "assistant")
        ][-GUIDE_HISTORY_MESSAGES:]
        user_msg = ChatMessage(session_id=session.id, role="user", content=content)
        db.add(user_msg)
        db.commit()

        # Flush SSE immediately so the cloud relay does not hit board_timeout
        # while Nano routing/stream is still warming up.
        yield {
            "type": "start",
            "session_id": session.id,
            "route": "cloud",
            "model": "nano",
            "intent": "guide",
            "thinking": False,
            "compressed": False,
            "note": "routing",
            "selector": None,
            "selector_reason": None,
            "selector_ms": None,
        }

        device = db.get(Device, session.device_id) if session.device_id else None
        plan = await plan_route(
            db,
            settings,
            user_text=content,
            history=history,
            shared_memory="",
            device_name=device.name if device else "edge device",
            desk_context="",
            choice="nano",
            user_id=user_id,
            system_override=guide_system_message(),
            pin_identity=False,
        )

        result: RouteResult | None = None
        async for event in run_plan(settings, plan):
            if isinstance(event, TextDelta):
                # Stream raw; strip guide fences on done for storage/display.
                yield {"type": "delta", "kind": event.kind, "text": event.text}
            else:
                result = event
        if result is None or not result.reply:
            raise RoutingError("The model returned an empty answer.")

        display, actions = parse_guide_reply(result.reply)
        # Never fall back to raw reply — that leaks ```guide JSON into the bubble.
        # Persist the full model reply (with fence) so later turns still emit tools.
        meta = result_to_dict(result)
        meta["guide_actions"] = actions
        meta["display"] = display
        assistant = ChatMessage(
            session_id=session.id,
            role="assistant",
            content=result.reply,
            meta_json=json.dumps(meta),
        )
        session.status = "idle"
        session.updated_at = datetime.utcnow()
        db.add_all([assistant, session])
        db.commit()
        record_turn(db, user_id=user_id, session_id=session.id, result=result)
        for action in actions:
            yield {"type": "action", "action": action}
        yield {
            "type": "done",
            "session_id": session.id,
            "message": {
                "role": "assistant",
                "content": display,
                "meta": meta,
                "created_at": assistant.created_at.isoformat() if assistant.created_at else None,
            },
            "telemetry": session_stats(db, session.id),
            "actions": actions,
        }
    except (RoutingError, NebiusError, LocalModelError) as exc:
        yield _failure(db, user_msg, str(exc))
    except HTTPException as exc:
        yield _failure(db, user_msg, str(exc.detail))
    except Exception as exc:  # noqa: BLE001
        log.exception("Guide turn failed")
        yield _failure(db, user_msg, f"Unexpected error: {exc}")
    finally:
        db.close()
