from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.models import User
from app.chat.service import create_session
from app.chat.turns import complete_turn
from app.db import get_db
from app.sessions.manager import multiplexer

router = APIRouter(prefix="/missions", tags=["missions"])


class ForkRequest(BaseModel):
    agent_id: str = "main"
    tasks: list[str] = Field(min_length=1, max_length=5)


@router.get("/threads")
async def list_threads(
    agent_id: str | None = None,
    _user: User = Depends(get_current_user),
) -> dict:
    return {"threads": await multiplexer.list_active(agent_id)}


@router.post("/fork")
async def fork_tasks(
    body: ForkRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Launch N parallel sub-sessions sharing the same base agent_id."""
    parent = create_session(db, user.id, title=f"Mission · {body.agent_id}", agent_id=body.agent_id)
    launched = []

    for task_text in body.tasks:

        async def factory(info, text=task_text, parent_id=parent.id):
            child = create_session(
                db,
                user.id,
                title=text[:60],
                agent_id=body.agent_id,
                parent_session_id=parent_id,
            )
            info.status = "running"
            done = await complete_turn(user.id, content=text, session_id=child.id)
            route = str(done["message"]["meta"].get("route", ""))
            info.route = route
            info.status = route or "done"
            return done["message"]["content"]

        info = await multiplexer.spawn(
            agent_id=body.agent_id,
            label=task_text[:80],
            coro_factory=factory,
        )
        launched.append(info.__dict__.copy())

    return {"parent_session_id": parent.id, "threads": launched}
