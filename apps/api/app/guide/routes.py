import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.models import User
from app.chat.routes import _local_device_id
from app.db import get_db
from app.guide.turns import stream_guide_turn

router = APIRouter(prefix="/guide", tags=["guide"])


class GuideMessageRequest(BaseModel):
    # Matches the cloud guide route cap (apps/cloud/src/guide/routes.ts).
    content: str = Field(min_length=1, max_length=4_000)
    session_id: str | None = None
    device_id: str | None = None


@router.post("/message/stream")
async def api_stream_guide(
    body: GuideMessageRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    """SSE guide chat: always Nano. Emits start → delta* → action* → done | error."""
    device_id = _local_device_id(db, user, body.device_id)

    async def events():
        async for event in stream_guide_turn(
            user.id, content=body.content, session_id=body.session_id, device_id=device_id
        ):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
