"""In-process concurrent worker registry (Jetson asyncio)."""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class WorkerInfo:
    id: str
    agent_id: str
    label: str
    status: str = "queued"  # queued|running|local|nebius|done|error
    route: str = ""
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    result_preview: str = ""


class SessionMultiplexer:
    def __init__(self) -> None:
        self._workers: dict[str, WorkerInfo] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._lock = asyncio.Lock()

    async def list_active(self, agent_id: str | None = None) -> list[dict[str, Any]]:
        async with self._lock:
            items = list(self._workers.values())
        if agent_id:
            items = [w for w in items if w.agent_id == agent_id]
        return [w.__dict__.copy() for w in items]

    async def spawn(
        self,
        *,
        agent_id: str,
        label: str,
        coro_factory,
    ) -> WorkerInfo:
        wid = str(uuid.uuid4())
        info = WorkerInfo(id=wid, agent_id=agent_id, label=label, status="queued")

        async with self._lock:
            self._workers[wid] = info

        async def _run() -> None:
            info.status = "running"
            try:
                result = await coro_factory(info)
                info.result_preview = str(result)[:240]
                info.status = "done"
            except Exception as exc:  # noqa: BLE001
                info.status = "error"
                info.result_preview = str(exc)[:240]

        task = asyncio.create_task(_run())
        async with self._lock:
            self._tasks[wid] = task
        return info


multiplexer = SessionMultiplexer()
