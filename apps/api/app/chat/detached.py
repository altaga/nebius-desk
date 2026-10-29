"""Run chat turns detached from the SSE client connection.

If the operator refreshes or closes the tab mid-command, the board keeps working
and still persists the assistant reply. The browser can poll the session later.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

from app.chat.turns import stream_turn

log = logging.getLogger(__name__)

# Long tools (demo recording) go quiet for minutes; edge proxies drop idle streams ~100s.
KEEPALIVE_SECONDS = 15.0

# session_id → in-flight producer task
_tasks: dict[str, asyncio.Task] = {}


def session_turn_active(session_id: str | None) -> bool:
    if not session_id:
        return False
    task = _tasks.get(session_id)
    return bool(task and not task.done())


async def iter_detached_turn(
    user_id: int,
    *,
    content: str,
    session_id: str | None,
    device_id: str | None,
    choice: str,
) -> AsyncIterator[dict]:
    """Yield turn events to the live client without canceling work on disconnect."""
    if session_id and session_turn_active(session_id):
        yield {
            "type": "error",
            "detail": "This chat is still running on the board. Wait a moment, then refresh — the answer will appear when it finishes.",
        }
        return

    # Unbounded: a full bounded queue previously dropped `approval` under delta pressure.
    queue: asyncio.Queue[dict | None] = asyncio.Queue()
    bound: dict[str, str | None] = {"id": session_id}

    async def _emit(event: dict) -> None:
        await queue.put(event)

    async def _produce() -> None:
        me = asyncio.current_task()
        sid = bound["id"]
        try:
            async for event in stream_turn(
                user_id,
                content=content,
                session_id=session_id,
                device_id=device_id,
                choice=choice,
            ):
                if event.get("type") == "start" and event.get("session_id"):
                    sid = str(event["session_id"])
                    bound["id"] = sid
                    if me is not None:
                        _tasks[sid] = me
                await _emit(event)
        except Exception as exc:  # noqa: BLE001
            log.exception("detached turn crashed")
            await _emit({"type": "error", "detail": f"Turn failed: {exc}"})
        finally:
            await _push_sentinel(queue)
            if sid and _tasks.get(sid) is me:
                _tasks.pop(sid, None)

    asyncio.create_task(_produce(), name=f"chat-turn-{session_id or 'new'}")
    # Vercel/BFF kills SSE at maxDuration (~300s). Approval waits are longer, so we
    # close the browser stream right after the approval event; the board task keeps
    # waiting and the UI polls + POSTs /approvals/:id.
    close_after_approval = False
    try:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), KEEPALIVE_SECONDS)
            except asyncio.TimeoutError:
                yield {"type": "ping"}
                continue
            if item is None:
                break
            yield item
            if item.get("type") == "approval":
                close_after_approval = True
                break
    except (asyncio.CancelledError, GeneratorExit):
        log.info("SSE client left; turn continues in background session=%s", bound["id"])
        raise
    finally:
        if close_after_approval:
            asyncio.create_task(_drain_queue(queue), name=f"drain-approval-{bound['id']}")


async def _drain_queue(queue: asyncio.Queue[dict | None]) -> None:
    """Keep the producer unblocked after we intentionally end the SSE at approval."""
    while True:
        item = await queue.get()
        if item is None:
            return


async def _push_sentinel(queue: asyncio.Queue[dict | None]) -> None:
    await queue.put(None)
