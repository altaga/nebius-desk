from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.models import User
from app.db import get_db
from app.devices.schemas import (
    CreateDeviceRequest,
    DeviceOut,
    RenameBoardRequest,
    MemoryEntryOut,
    UpsertMemoryRequest,
)
from app.devices import service as devices_service

router = APIRouter(prefix="/devices", tags=["devices"])


def _memory_out(entry) -> MemoryEntryOut:
    title, markdown = devices_service.present_memory(entry)
    return MemoryEntryOut(
        id=entry.id,
        device_id=entry.device_id,
        title=title,
        content=markdown,
        updated_at=entry.updated_at,
    )


@router.get("", response_model=list[DeviceOut])
def api_list_devices(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[DeviceOut]:
    rows = devices_service.list_devices(db, user.id)
    return [
        DeviceOut(
            id=d.id,
            name=d.name,
            hostname=d.hostname,
            agent_name=d.agent_name or "millie",
            kind=d.kind,
            status=d.status,
            last_seen_at=d.last_seen_at,
            agent_count=count,
        )
        for d, count in rows
    ]


@router.post("", response_model=DeviceOut)
def api_create_device(
    body: CreateDeviceRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeviceOut:
    d = devices_service.create_device(
        db, user.id, name=body.name, hostname=body.hostname, kind=body.kind
    )
    return DeviceOut(
        id=d.id,
        name=d.name,
        hostname=d.hostname,
        agent_name=d.agent_name or "millie",
        kind=d.kind,
        status=d.status,
        last_seen_at=d.last_seen_at,
        agent_count=0,
    )


@router.patch("/{device_id}", response_model=DeviceOut)
def api_rename_board(
    device_id: str,
    body: RenameBoardRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeviceOut:
    d = devices_service.rename_board(db, user.id, device_id, body.name)
    return DeviceOut(
        id=d.id,
        name=d.name,
        hostname=d.hostname,
        agent_name=d.agent_name or "millie",
        kind=d.kind,
        status=d.status,
        last_seen_at=d.last_seen_at,
        agent_count=0,
    )


@router.get("/{device_id}", response_model=DeviceOut)
def api_get_device(
    device_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeviceOut:
    d = devices_service.get_device(db, user.id, device_id)
    count = devices_service.list_devices(db, user.id)
    agent_count = next((c for device, c in count if device.id == device_id), 0)
    return DeviceOut(
        id=d.id,
        name=d.name,
        hostname=d.hostname,
        agent_name=d.agent_name or "millie",
        kind=d.kind,
        status=d.status,
        last_seen_at=d.last_seen_at,
        agent_count=agent_count,
    )


@router.get("/{device_id}/memory", response_model=list[MemoryEntryOut])
def api_list_memory(
    device_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[MemoryEntryOut]:
    return [_memory_out(e) for e in devices_service.list_memory(db, user.id, device_id)]


@router.post("/{device_id}/memory", response_model=MemoryEntryOut)
def api_add_memory(
    device_id: str,
    body: UpsertMemoryRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MemoryEntryOut:
    e = devices_service.add_memory(
        db, user.id, device_id, title=body.title, content=body.content
    )
    return _memory_out(e)


@router.patch("/{device_id}/memory/{entry_id}", response_model=MemoryEntryOut)
def api_update_memory(
    device_id: str,
    entry_id: int,
    body: UpsertMemoryRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MemoryEntryOut:
    entry = devices_service.update_memory(
        db, user.id, device_id, entry_id, title=body.title, content=body.content
    )
    return _memory_out(entry)
