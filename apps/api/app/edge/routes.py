from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.models import User
from app.db import get_db
from app.edge.cli import run_command
from app.vault.service import secret_map
from app.edge.files import (
    create_file,
    delete_entry,
    edit_file,
    list_dir,
    mkdir,
    raw_file,
    read_file,
    rename_entry,
    upload_file,
    write_file,
)
from app.config import get_settings
from app.edge.monitor import snapshot
from app.edge.preview import proxy_localhost
from app.edge.services import list_services
from app.subscription.service import is_active as subscription_active

router = APIRouter(prefix="/edge", tags=["edge"])


def _require_plan(db: Session, user: User) -> None:
    if not subscription_active(db, user.id):
        raise HTTPException(status_code=402, detail={"error": "subscription_inactive"})


class CliRequest(BaseModel):
    command: str = Field(min_length=1, max_length=4000)


class WriteRequest(BaseModel):
    path: str = Field(min_length=1, max_length=500)
    content: str = Field(max_length=200_000)


class EditRequest(BaseModel):
    path: str = Field(min_length=1, max_length=500)
    old: str = Field(min_length=1, max_length=200_000)
    new: str = Field(max_length=200_000)


class MkdirRequest(BaseModel):
    path: str = Field(min_length=1, max_length=500)


class CreateFileRequest(BaseModel):
    path: str = Field(min_length=1, max_length=500)


class RenameFileRequest(BaseModel):
    path: str = Field(min_length=1, max_length=500)
    name: str = Field(min_length=1, max_length=255)


class DeleteFileRequest(BaseModel):
    path: str = Field(min_length=1, max_length=500)


class UploadFileRequest(BaseModel):
    path: str = Field(min_length=1, max_length=500)
    content_b64: str = Field(default="", max_length=2_800_000)
    overwrite: bool = True


@router.get("/capabilities")
def edge_capabilities(user: User = Depends(get_current_user)) -> dict:
    """Cheap probe for the desk UI — no subscription gate (board-emu still answers)."""
    _ = user
    if get_settings().board_emu:
        return {
            "board_emu": True,
            "local": False,
            "auto": False,
            "models": ["nano", "fast", "heavy"],
        }
    return {
        "board_emu": False,
        "local": True,
        "auto": True,
        "models": ["auto", "local", "nano", "fast", "heavy"],
    }


@router.get("/stats")
@router.get("/health")
def edge_health(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    _require_plan(db, user)
    return snapshot()


@router.get("/services")
def edge_services(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Live localhost HTTP listeners + docker containers on the board."""
    _require_plan(db, user)
    return list_services()


@router.api_route("/preview/{port}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
@router.api_route(
    "/preview/{port}/{path:path}",
    methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
)
async def edge_preview(
    port: int,
    request: Request,
    path: str = "",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Interactive Preview: reverse-proxy a board localhost web port into the desk iframe."""
    _require_plan(db, user)
    _ = user
    return await proxy_localhost(port, path, request)


@router.post("/cli")
def edge_cli(
    body: CliRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    _require_plan(db, user)
    return run_command(body.command, secrets=secret_map(db, user.id))


@router.get("/files")
def edge_list_files(
    path: str = "",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    _require_plan(db, user)
    return list_dir(path)


@router.get("/files/read")
def edge_read_file(
    path: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    _require_plan(db, user)
    return read_file(path)


@router.get("/files/raw")
def edge_raw_file(
    path: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FileResponse:
    _require_plan(db, user)
    target, media = raw_file(path)
    return FileResponse(target, media_type=media, headers={"Cache-Control": "private, max-age=60"})


@router.put("/files")
def edge_write_file(
    body: WriteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    _require_plan(db, user)
    return write_file(body.path, body.content)


@router.post("/files/upload")
def edge_upload_file(
    body: UploadFileRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    _require_plan(db, user)
    return upload_file(body.path, body.content_b64, overwrite=body.overwrite)


@router.post("/files/edit")
def edge_edit_file(
    body: EditRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    _require_plan(db, user)
    return edit_file(body.path, body.old, body.new)


@router.post("/files/mkdir")
def edge_mkdir(
    body: MkdirRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    _require_plan(db, user)
    return mkdir(body.path)


@router.post("/files/create")
def edge_create_file(
    body: CreateFileRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    _require_plan(db, user)
    return create_file(body.path)


@router.post("/files/rename")
def edge_rename_file(
    body: RenameFileRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    _require_plan(db, user)
    return rename_entry(body.path, body.name)


@router.post("/files/delete")
def edge_delete_file(
    body: DeleteFileRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    _require_plan(db, user)
    return delete_entry(body.path)
