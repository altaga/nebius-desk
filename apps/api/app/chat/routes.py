import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.models import User
from app.chat.models import ChatSession
from app.chat.approval import get_pending, pending_for_session, resolve as resolve_approval
from app.chat.schemas import (
    BulkDeleteSessionsRequest,
    ChatTurnResponse,
    CreateSessionRequest,
    MessageOut,
    PinSessionRequest,
    RenameSessionRequest,
    ResolveApprovalRequest,
    SendMessageRequest,
    SessionOut,
)
from app.chat.service import (
    create_session,
    delete_session,
    delete_sessions,
    get_session,
    list_messages,
    list_sessions,
    rename_session,
    set_pinned,
)
from app.chat.detached import iter_detached_turn, session_turn_active
from app.chat.turns import complete_turn
from app.db import get_db
from app.devices.service import get_device
from app.router.hybrid import RoutingError

router = APIRouter(prefix="/chat", tags=["chat"])


def _session_out(s: ChatSession) -> SessionOut:
    return SessionOut(
        id=s.id,
        title=s.title,
        agent_id=s.agent_id,
        device_id=s.device_id,
        parent_session_id=s.parent_session_id,
        status=s.status,
        pinned=bool(s.pinned),
        pinned_at=s.pinned_at,
        updated_at=s.updated_at,
    )


@router.post("/sessions", response_model=SessionOut)
def api_create_session(
    body: CreateSessionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionOut:
    s = create_session(
        db,
        user.id,
        title=body.title,
        agent_id=body.agent_id,
        device_id=_local_device_id(db, user, body.device_id),
        parent_session_id=body.parent_session_id,
    )
    return _session_out(s)


@router.get("/sessions", response_model=list[SessionOut])
def api_list_sessions(
    device_id: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[SessionOut]:
    local_device_id = _local_device_id(db, user, device_id)
    return [_session_out(s) for s in list_sessions(db, user.id, device_id=local_device_id)]


@router.patch("/sessions/{session_id}", response_model=SessionOut)
def api_rename_session(
    session_id: str,
    body: RenameSessionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionOut:
    return _session_out(rename_session(db, user.id, session_id, body.title))


@router.post("/sessions/{session_id}/pin", response_model=SessionOut)
def api_pin_session(
    session_id: str,
    body: PinSessionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionOut:
    return _session_out(set_pinned(db, user.id, session_id, body.pinned))


@router.delete("/sessions/{session_id}")
def api_delete_session(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    delete_session(db, user.id, session_id)
    return {"ok": True}


@router.post("/sessions/bulk-delete")
def api_bulk_delete_sessions(
    body: BulkDeleteSessionsRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    # A running turn would keep writing into a deleted session — leave those for later.
    busy = [sid for sid in body.ids if session_turn_active(sid)]
    deleted = delete_sessions(db, user.id, [sid for sid in body.ids if sid not in busy])
    return {"ok": True, "deleted": deleted, "skipped_running": busy}


@router.get("/sessions/{session_id}/messages", response_model=list[MessageOut])
def api_list_messages(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[MessageOut]:
    get_session(db, user.id, session_id)
    out: list[MessageOut] = []
    for m in list_messages(db, session_id):
        try:
            meta = json.loads(m.meta_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        out.append(MessageOut(role=m.role, content=m.content, meta=meta, created_at=m.created_at))
    return out


def _local_device_id(db: Session, user: User, device_id: str | None) -> str | None:
    """Cloud ids and the board's own id both address the single Jetson."""
    if not device_id:
        return device_id
    try:
        return get_device(db, user.id, device_id).id
    except HTTPException:
        return device_id


@router.post("/message/stream")
async def api_stream_message(
    body: SendMessageRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Server-sent events: start → delta* → [approval] → tool* → done | error.

    The turn keeps running on the board if the browser closes mid-command; reopen
    the chat to load the finished assistant message.
    """
    device_id = _local_device_id(db, user, body.device_id)

    async def events():
        async for event in iter_detached_turn(
            user.id,
            content=body.content,
            session_id=body.session_id,
            device_id=device_id,
            choice=body.model,
        ):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/sessions/{session_id}/status")
def api_session_status(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Cheap poll target after refresh — is the board still working this chat?"""
    session = get_session(db, user.id, session_id)
    pending = pending_for_session(session.id, user.id)
    out: dict = {
        "session_id": session.id,
        "status": session.status,
        "turn_active": session_turn_active(session.id) or session.status == "running",
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
        "pending_approval": None,
    }
    if pending is not None:
        out["pending_approval"] = {
            "approval_id": pending.id,
            "actions": pending.actions,
            "timeout_sec": 300,
        }
    return out


@router.post("/approvals/{approval_id}")
def api_resolve_approval(
    approval_id: str,
    body: ResolveApprovalRequest,
    user: User = Depends(get_current_user),
) -> dict:
    """Approve or deny a pending sensitive board action (unblocks the open SSE turn)."""
    if get_pending(approval_id) is None:
        raise HTTPException(status_code=404, detail="Approval not found or expired")
    try:
        item = resolve_approval(approval_id, user.id, body.decision)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "approval_id": item.id, "decision": item.decision}


@router.post("/message", response_model=ChatTurnResponse)
async def api_send_message(
    body: SendMessageRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ChatTurnResponse:
    """Non-streamed variant for simple clients."""
    try:
        done = await complete_turn(
            user.id,
            content=body.content,
            session_id=body.session_id,
            device_id=_local_device_id(db, user, body.device_id),
            choice=body.model,
        )
    except RoutingError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return ChatTurnResponse(
        session_id=done["session_id"],
        messages=[
            MessageOut(role="user", content=body.content),
            MessageOut(**done["message"]),
        ],
        telemetry=done["telemetry"],
    )
