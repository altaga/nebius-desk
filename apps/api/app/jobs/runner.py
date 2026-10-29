"""Background runner for durable board jobs (asyncio on the Jetson process)."""

from __future__ import annotations

import asyncio
import json
import logging

from app.db import SessionLocal
from app.edge.monitor import snapshot
from app.jobs.models import BoardJob
from app.edge.cli import run_command
from app.browser import demo as browser_demo
from app.jobs.bakeoff import run_bakeoff
from app.jobs.checks import run_checks
from app.jobs.probe import probe_target
from app.jobs.recipes import run_deploy
from app.jobs.research import run_research
from app.jobs.service import is_cancelled, mark_finished, mark_running
from app.jobs.verify import run_verify
from app.vault.service import secret_map

log = logging.getLogger(__name__)

_queue: asyncio.Queue[str] | None = None
_worker: asyncio.Task | None = None
_loop_id: int | None = None


def _ensure_queue() -> asyncio.Queue[str]:
    """Create a queue on the *current* event loop (TestClient recreates loops)."""
    global _queue, _loop_id
    try:
        loop = asyncio.get_running_loop()
        loop_id = id(loop)
    except RuntimeError:
        loop_id = None
    if _queue is None or _loop_id != loop_id:
        _queue = asyncio.Queue()
        _loop_id = loop_id
    return _queue


async def start_worker() -> None:
    global _worker
    # Always bind a fresh queue to this lifespan's loop.
    global _queue, _loop_id
    _queue = asyncio.Queue()
    _loop_id = id(asyncio.get_running_loop())
    q = _queue
    if _worker and not _worker.done():
        _worker.cancel()
        try:
            await _worker
        except asyncio.CancelledError:
            pass
    _worker = asyncio.create_task(_loop(q), name="desk-job-worker")
    # Re-queue anything left running/queued after a restart.
    db = SessionLocal()
    try:
        pending = (
            db.query(BoardJob)
            .filter(BoardJob.status.in_(("queued", "running")))
            .order_by(BoardJob.created_at.asc())
            .all()
        )
        for job in pending:
            if job.status == "running":
                job.status = "queued"
                db.add(job)
            await q.put(job.id)
        db.commit()
    finally:
        db.close()


async def stop_worker() -> None:
    global _worker, _queue, _loop_id
    if _worker:
        _worker.cancel()
        try:
            await _worker
        except asyncio.CancelledError:
            pass
        _worker = None
    _queue = None
    _loop_id = None


async def submit(job_id: str) -> None:
    await _ensure_queue().put(job_id)


async def _loop(q: asyncio.Queue[str]) -> None:
    while True:
        job_id = await q.get()
        try:
            await asyncio.to_thread(_run_job_sync, job_id)
        except Exception:  # noqa: BLE001
            log.exception("job worker failed for %s", job_id)
        finally:
            q.task_done()


def _run_job_sync(job_id: str) -> None:
    db = SessionLocal()
    try:
        job = db.get(BoardJob, job_id)
        if not job or job.status not in ("queued", "running"):
            return
        mark_running(db, job)
        db.refresh(job)
        if job.status not in ("running",):
            return
        try:
            payload = json.loads(job.payload_json or "{}")
        except json.JSONDecodeError:
            payload = {}
        secrets = secret_map(db, job.user_id)

        def _finish(ok: bool, result: dict, error: str | None = None) -> None:
            if is_cancelled(db, job_id):
                mark_finished(db, job, ok=False, result=result or {}, error=error or "Cancelled by operator")
                return
            mark_finished(db, job, ok=ok, result=result, error=error)

        try:
            if job.kind == "shell":
                cmd = str(payload.get("command") or "").strip()
                if not cmd:
                    raise ValueError("shell job missing command")
                row = run_command(cmd, secrets=secrets)
                ok = row.get("exit_code") == 0 and not row.get("timed_out")
                _finish(ok, row, None if ok else (row.get("stderr") or "exit non-zero"))
            elif job.kind == "verify":
                result = run_verify(
                    commands=payload.get("commands"),
                    repeats=payload.get("repeats"),
                    secrets=secrets,
                )
                _finish(
                    bool(result.get("ok")),
                    result,
                    None if result.get("ok") else result.get("error") or "verify failed",
                )
            elif job.kind == "probe":
                target = str(payload.get("target") or "").strip()
                if not target:
                    raise ValueError("probe job missing target")
                result = probe_target(target)
                ok = result.get("verdict") in ("ok", "auth")
                _finish(ok, result, None if ok else result.get("detail"))
            elif job.kind == "health":
                _finish(True, snapshot())
            elif job.kind == "deploy":
                result = run_deploy(
                    secrets=secrets,
                    skip_verify=bool(payload.get("skip_verify")),
                )
                _finish(
                    bool(result.get("ok")),
                    result,
                    None if result.get("ok") else result.get("error") or "deploy failed",
                )
            elif job.kind == "checks":
                result = run_checks(secrets=secrets)
                _finish(
                    bool(result.get("ok")),
                    result,
                    None if result.get("ok") else result.get("error") or "checks failed",
                )
            elif job.kind == "bakeoff":
                result = run_bakeoff(repeats=int(payload.get("repeats") or 3))
                _finish(
                    bool(result.get("ok")),
                    result,
                    None if result.get("ok") else result.get("error"),
                )
            elif job.kind == "record":
                body = str(payload.get("body") or "").strip()
                if not body:
                    raise ValueError("record job missing body (url + steps)")
                result = browser_demo.record_demo(job.user_id, body)
                _finish(
                    bool(result.get("ok")),
                    result,
                    None if result.get("ok") else result.get("error") or "record failed",
                )
            elif job.kind == "research":
                topic = str(payload.get("topic") or "").strip()
                min_s = payload.get("min_seconds")
                result = run_research(
                    topic=topic,
                    min_seconds=float(min_s) if min_s is not None else None,
                    job_id=job_id,
                )
                if result.get("cancelled"):
                    _finish(False, result, "Cancelled by operator")
                else:
                    _finish(
                        bool(result.get("ok")),
                        result,
                        None if result.get("ok") else result.get("error") or "research failed",
                    )
            else:
                raise ValueError(f"unknown job kind {job.kind}")
        except Exception as exc:  # noqa: BLE001
            _finish(False, {}, f"{type(exc).__name__}: {exc}")
    finally:
        db.close()
