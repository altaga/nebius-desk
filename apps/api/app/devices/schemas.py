from datetime import datetime

from pydantic import BaseModel, Field


class DeviceOut(BaseModel):
    id: str
    name: str
    hostname: str
    agent_name: str = "millie"
    kind: str
    status: str
    last_seen_at: datetime | None = None
    agent_count: int = 0


class RenameBoardRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class CreateDeviceRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    hostname: str = Field(default="", max_length=120)
    kind: str = Field(default="jetson", max_length=64)


class MemoryEntryOut(BaseModel):
    id: int
    device_id: str
    title: str
    content: str
    updated_at: datetime


class UpsertMemoryRequest(BaseModel):
    title: str = Field(default="", max_length=200)
    content: str = Field(min_length=1, max_length=50_000)
