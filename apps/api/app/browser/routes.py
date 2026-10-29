from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.models import User
from app.browser import runtime
from app.db import get_db

router = APIRouter(prefix="/browser", tags=["browser"])


class BrowseRequest(BaseModel):
    action: str = Field(min_length=1, max_length=32)
    url: str | None = None
    selector: str | None = None
    text: str | None = Field(default=None, max_length=2000)
    headed: bool = False
    # Live preview input (action="interact"); x/y are fractions of the viewport.
    input: str | None = Field(default=None, max_length=16)
    x: float | None = None
    y: float | None = None
    dy: float | None = None
    key: str | None = Field(default=None, max_length=32)
    width: int | None = None
    height: int | None = None


@router.get("/status")
def api_browser_status(user: User = Depends(get_current_user)) -> dict:
    return runtime.status_for(user.id)


@router.get("/artifacts")
def api_browser_artifacts(
    limit: int = 40,
    _user: User = Depends(get_current_user),
) -> dict:
    return {"artifacts": runtime.list_artifacts(limit=limit)}


@router.get("/artifacts/file")
def api_browser_artifact_file(
    path: str,
    _user: User = Depends(get_current_user),
) -> Response:
    try:
        data, media = runtime.artifact_bytes(path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Artifact not found") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(content=data, media_type=media)


@router.post("/action")
def api_browser_action(
    body: BrowseRequest,
    user: User = Depends(get_current_user),
    _db: Session = Depends(get_db),
) -> dict:
    params = {
        "url": body.url,
        "selector": body.selector,
        "text": body.text,
        "headed": body.headed,
        "input": body.input,
        "x": body.x,
        "y": body.y,
        "dy": body.dy,
        "key": body.key,
        "width": body.width,
        "height": body.height,
    }
    try:
        return runtime.run_action(user.id, body.action, params)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/warm")
def api_browser_warm(user: User = Depends(get_current_user)) -> dict:
    """Pre-start Chromium so the first Live preview is not a cold launch."""
    try:
        return runtime.warm_session(user.id)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/close")
def api_browser_close(user: User = Depends(get_current_user)) -> dict:
    return runtime.close_session(user.id)
