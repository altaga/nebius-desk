from __future__ import annotations

import socket
import uuid
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.chat.models import ChatSession
from app.devices.memory_md import memory_filename, memory_prompt, structure_memory
from app.devices.models import Device, DeviceMemory
from app.edge.monitor import snapshot


BOARD_NAME = "Millie"


def _repair_seed_hostname(device: Device) -> None:
    """An early seed stored the board label in the hostname column."""
    if (device.hostname or "").strip().lower() != "millie":
        return
    device.name = BOARD_NAME
    device.hostname = socket.gethostname().strip() or BOARD_NAME


def ensure_default_device(db: Session, user_id: int) -> Device:
    existing = (
        db.query(Device)
        .filter(Device.user_id == user_id)
        .order_by(Device.created_at.asc())
        .first()
    )
    if existing:
        _repair_seed_hostname(existing)
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing
    host = socket.gethostname().strip() or "jetson"
    device = Device(
        id=str(uuid.uuid4()),
        user_id=user_id,
        name=BOARD_NAME,
        hostname=host,
        kind="jetson",
        status="offline",
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


HEARTBEAT_WINDOW = timedelta(minutes=2)


def _refresh_presence(db: Session, devices: list[Device]) -> None:
    """A board is online only while a Jetson reports in. A plain PC running the API does not count."""
    now = datetime.utcnow()
    host = socket.gethostname().lower()
    on_jetson = snapshot()["jetson_online"]
    for d in devices:
        if on_jetson and (d.hostname or "").lower() == host:
            d.last_seen_at = now
        seen = d.last_seen_at
        d.status = "online" if seen and now - seen < HEARTBEAT_WINDOW else "offline"
        db.add(d)
    db.commit()


def list_devices(db: Session, user_id: int) -> list[tuple[Device, int]]:
    ensure_default_device(db, user_id)
    devices = (
        db.query(Device)
        .filter(Device.user_id == user_id)
        .order_by(Device.created_at.asc())
        .all()
    )
    _refresh_presence(db, devices)
    out: list[tuple[Device, int]] = []
    for d in devices:
        count = (
            db.query(ChatSession)
            .filter(ChatSession.user_id == user_id, ChatSession.device_id == d.id)
            .count()
        )
        out.append((d, count))
    return out


def get_device(db: Session, user_id: int, device_id: str) -> Device:
    """The named device, or the only device on this board when the cloud id differs."""
    owned = (
        db.query(Device)
        .filter(Device.user_id == user_id)
        .order_by(Device.created_at.asc())
        .all()
    )
    device = next((row for row in owned if row.id == device_id), None)
    if device is None and len(owned) == 1:
        device = owned[0]
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    return device


def rename_board(db: Session, user_id: int, device_id: str, name: str) -> Device:
    device = get_device(db, user_id, device_id)
    clean = name.strip()
    if not clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Board name is required")
    device.name = clean[:120]
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


def create_device(
    db: Session,
    user_id: int,
    *,
    name: str,
    hostname: str = "",
    kind: str = "jetson",
) -> Device:
    device = Device(
        id=str(uuid.uuid4()),
        user_id=user_id,
        name=name,
        hostname=hostname or name,
        kind=kind,
        status="unknown",
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


def list_memory(db: Session, user_id: int, device_id: str) -> list[DeviceMemory]:
    device = get_device(db, user_id, device_id)
    return (
        db.query(DeviceMemory)
        .filter(DeviceMemory.device_id == device.id, DeviceMemory.user_id == user_id)
        .order_by(DeviceMemory.updated_at.desc())
        .all()
    )


def add_memory(
    db: Session,
    user_id: int,
    device_id: str,
    *,
    title: str,
    content: str,
) -> DeviceMemory:
    device = get_device(db, user_id, device_id)
    name, markdown = structure_memory(title, content)
    entry = DeviceMemory(
        device_id=device.id,
        user_id=user_id,
        title=name[:200],
        content=markdown,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def update_memory(
    db: Session,
    user_id: int,
    device_id: str,
    entry_id: int,
    *,
    title: str,
    content: str,
) -> DeviceMemory:
    device = get_device(db, user_id, device_id)
    entry = (
        db.query(DeviceMemory)
        .filter(
            DeviceMemory.id == entry_id,
            DeviceMemory.device_id == device.id,
            DeviceMemory.user_id == user_id,
        )
        .first()
    )
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memory not found")
    name, markdown = structure_memory(title, content)
    entry.title = name[:200]
    entry.content = markdown
    entry.updated_at = datetime.utcnow()
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def present_memory(entry: DeviceMemory) -> tuple[str, str]:
    """Title and markdown the client and the model both read."""
    return structure_memory(entry.title, entry.content, updated=entry.updated_at)


def memory_blob_for_prompt(db: Session, user_id: int, device_id: str, *, limit: int = 12) -> str:
    """Recent shared memory as markdown files for the system prompt."""
    entries = list_memory(db, user_id, device_id)[:limit]
    files = []
    for entry in reversed(entries):
        title, markdown = present_memory(entry)
        files.append((memory_filename(title), markdown))
    return memory_prompt(files)
