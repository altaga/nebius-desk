from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class CreateSessionRequest(BaseModel):
    title: str = Field(default="New chat", max_length=200)
    agent_id: str = Field(default="main", max_length=64)
    device_id: str | None = None
    parent_session_id: str | None = None


class RenameSessionRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class PinSessionRequest(BaseModel):
    pinned: bool


class SessionOut(BaseModel):
    id: str
    title: str
    agent_id: str
    device_id: str | None = None
    parent_session_id: str | None
    status: str
    pinned: bool = False
    pinned_at: datetime | None = None
    updated_at: datetime | None = None


class SendMessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=100_000)
    session_id: str | None = None
    device_id: str | None = None
    model: Literal["auto", "local", "nano", "fast", "heavy", "ultra"] = "auto"


class MessageOut(BaseModel):
    role: str
    content: str
    meta: dict = Field(default_factory=dict)
    created_at: datetime | None = None


class ChatTurnResponse(BaseModel):
    session_id: str
    messages: list[MessageOut]
    telemetry: dict
