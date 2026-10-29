"""One chat turn: persist the user message, route it, stream the answer, record real usage."""

from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator
from datetime import datetime

from fastapi import HTTPException

from app.auth.models import User
from app.brains.service import profiles_for_prompt
from app.chat.models import ChatMessage, ChatSession
from app.chat.approval import create_pending, drop as drop_approval, wait_decision
from app.chat.desk_tools import (
    ToolCall,
    execute_tools,
    explain_approval,
    extract_tools,
    format_tool_observations,
    infer_board_tools,
    suggest_typo_patch_from_reads,
    tools_match_intent,
    tools_prompt,
    wants_repair,
    wants_web_search,
)
from app.chat.guardrails import (
    factual_reply_from_tools,
    is_fabricated_board_report,
    mkdir_target,
    needs_board_tools,
    strip_fabricated_board_report,
)
from app.chat.history import build_history, is_zombie_reply, wants_file_list
from app.chat.run_tools import format_equality_reply, resolve_equality
from app.chat.service import create_session, get_session, list_messages
from app.chat.work_state import work_prompt_blob
from app.config import get_settings
from app.db import SessionLocal
from app.devices.models import Device
from app.devices.service import ensure_default_device, get_device, memory_blob_for_prompt
from app.ops.emit import chat_features, emit_ops, emit_tool_results, new_trace_id
from app.router.hybrid import RoutingError, plan_route, run_plan
from app.router.local_llm import LocalModelError
from app.router.nebius import NebiusError
from app.router.types import RoutePlan, RouteResult, TextDelta, result_to_dict
from app.telemetry.service import record_turn, session_stats
from app.vault.service import list_names as secret_names

log = logging.getLogger(__name__)


def clip_title(content: str, limit: int = 80) -> str:
    text = " ".join(content.split())
    if len(text) <= limit:
        return text or "New chat"
    head = text[:limit]
    if " " in head:
        head = head.rsplit(" ", 1)[0]
    return head.strip() or "New chat"


def _open_session(db, user_id: int, content: str, session_id: str | None, device_id: str | None) -> ChatSession:
    if session_id:
        session = get_session(db, user_id, session_id)
    else:
        if device_id:
            try:
                device_id = get_device(db, user_id, device_id).id
            except HTTPException:
                device_id = None
        device_id = device_id or ensure_default_device(db, user_id).id
        session = create_session(db, user_id, title=clip_title(content), device_id=device_id)
    if not session.title or session.title == "New chat":
        session.title = clip_title(content)
    session.status = "running"
    session.updated_at = datetime.utcnow()
    db.add(session)
    db.commit()
    return session


async def stream_turn(
    user_id: int,
    *,
    content: str,
    session_id: str | None,
    device_id: str | None,
    choice: str = "auto",
    wait_approvals: bool = True,
) -> AsyncIterator[dict]:
    settings = get_settings()
    db = SessionLocal()
    user_msg: ChatMessage | None = None
    t0 = time.monotonic()
    username = None
    try:
        user_row = db.get(User, user_id)
        username = user_row.username if user_row else None
        session = _open_session(db, user_id, content, session_id, device_id)
        raw_history = [
            {"role": m.role, "content": m.content}
            for m in list_messages(db, session.id)
            if m.role in ("user", "assistant")
        ]
        hist = build_history(raw_history, content)
        history = hist.messages
        user_msg = ChatMessage(session_id=session.id, role="user", content=content)
        db.add(user_msg)
        db.commit()

        device = db.get(Device, session.device_id) if session.device_id else None
        # Secret compare: board answers true/false — never let Nano print (and redact) values.
        names = secret_names(db, user_id)
        eq_reply = format_equality_reply(db, user_id, content, names) if names else None
        if eq_reply:
            async for event in _finish_board_reply(
                db,
                session=session,
                user_id=user_id,
                username=username,
                content=content,
                final_text=eq_reply,
                choice=choice,
                t0=t0,
                intent="secret_compare",
                model="keychain",
            ):
                yield event
            return

        desk = _desk_context(db, user_id, content, device.id if device else None)
        if hist.note:
            desk = f"{desk}\n\n{hist.note}" if desk else hist.note
        # Buffer the first model reply until tools/scrub run — Nano otherwise streams
        # invented Alice/Bob “board ops” tables before ```run``` executes.
        hold_reply = True
        trace_id = new_trace_id()
        # First byte immediately so Vercel/BFF SSE does not sit idle during routing.
        yield {
            "type": "start",
            "session_id": session.id,
            "trace_id": trace_id,
            "route": "routing",
            "model": "",
            "intent": "routing",
            "thinking": True,
            "compressed": False,
            "note": "Choosing a model…",
        }
        yield {"type": "status", "phase": "route", "text": "Choosing a model…"}
        plan = await plan_route(
            db,
            settings,
            user_text=content,
            history=history,
            shared_memory=memory_blob_for_prompt(db, user_id, device.id) if device else "",
            device_name=device.name if device else "edge device",
            desk_context=desk,
            choice=choice,
            user_id=user_id,
        )
        yield {
            "type": "start",
            "session_id": session.id,
            "trace_id": trace_id,
            "route": plan.route,
            "model": plan.model,
            "intent": plan.intent,
            "thinking": plan.thinking,
            "compressed": plan.compressed,
            "note": plan.note,
            "selector": plan.selector,
            "selector_reason": plan.selector_reason,
            "selector_ms": plan.selector_ms,
        }

        result, reply_text = None, ""
        async for item in _drive_plan(settings, plan, hold_reply=hold_reply):
            if item[0] == "delta":
                yield {"type": "delta", "kind": item[1], "text": item[2]}
            else:
                result, reply_text = item[1], item[2]

        if result is None or not reply_text:
            raise RoutingError("The model returned an empty answer.")

        display, tool_calls = extract_tools(reply_text)
        # Create-folder before list — "carpeta" would otherwise match wants_file_list.
        folder = mkdir_target(content)
        if not tool_calls and folder:
            # Cross-platform (Jetson + Windows tests): pathlib via the API interpreter.
            import sys

            py = sys.executable.replace("\\", "/")
            cmd = (
                f'"{py}" -c "from pathlib import Path; '
                f"p=Path('{folder}'); p.mkdir(parents=True, exist_ok=True); "
                f"print('created', p.as_posix())\""
            )
            tool_calls = [ToolCall(kind="run", body=cmd)]
            display = ""
            reply_text = f"```run\n{cmd}\n```"
        elif (not tool_calls or not tools_match_intent(content, tool_calls)) and (
            needs_board_tools(content) or wants_web_search(content)
        ):
            # Agentic path: LLM missed or under-shot the board task.
            if tool_calls and not tools_match_intent(content, tool_calls):
                tool_calls = []
            if not tool_calls:
                yield {
                    "type": "status",
                    "phase": "tools",
                    "text": "Retrying — model must emit a board tool fence…",
                }
                nudge_desk = (
                    f"{desk}\n\n"
                    "TOOL RETRY (mandatory): Your previous reply had ZERO usable board tool fences. "
                    "Reply with ONLY the fence(s) needed for the latest user message "
                    "(```read``` / ```patch``` / ```run``` / ```install``` / ```browse``` / "
                    "```list``` / ```search```). "
                    "If the user asked to diagnose or fix an existing app, emit ```read``` "
                    "(then ```patch```) — never wipe or recreate. "
                    "No narration before or instead of the fence."
                )
                retry_plan = await plan_route(
                    db,
                    settings,
                    user_text=content,
                    history=history
                    + [
                        {"role": "assistant", "content": reply_text[:800]},
                        {
                            "role": "user",
                            "content": (
                                "That reply had no usable board fence. Emit the fence now for my "
                                "previous request — fence body only, no prose."
                            ),
                        },
                    ],
                    shared_memory=memory_blob_for_prompt(db, user_id, device.id) if device else "",
                    device_name=device.name if device else "edge device",
                    desk_context=nudge_desk,
                    choice=choice,
                    user_id=user_id,
                )
                result2, reply2 = None, ""
                async for item in _drive_plan(settings, retry_plan, hold_reply=True):
                    if item[0] == "done":
                        result2, reply2 = item[1], item[2]
                if result2 is not None and reply2:
                    result = result2
                    reply_text = reply2
                    display, tool_calls = extract_tools(reply_text)
            if not tool_calls or not tools_match_intent(content, tool_calls):
                planned = infer_board_tools(content)
                if planned:
                    yield {
                        "type": "status",
                        "phase": "tools",
                        "text": "Planning board tools from your request…",
                    }
                    tool_calls = planned
                    display = ""
                    reply_text = "\n\n".join(f"```{c.kind}\n{c.body}\n```" for c in planned)
        elif not tool_calls and wants_file_list(content):
            tool_calls = [ToolCall(kind="list", body=".")]
            display = "" if is_zombie_reply(reply_text) or is_fabricated_board_report(reply_text) else display
            reply_text = "```list\n.\n```"
        tool_runs: list[dict] = []
        final_text = reply_text

        if tool_calls:
            if wants_repair(content):
                yield {
                    "type": "status",
                    "phase": "tools",
                    "text": "Inspecting board services and the crashed app…",
                }
                yield {
                    "type": "status",
                    "phase": "tools",
                    "text": "Reading application source…",
                }
            async for event in _run_tool_phase(
                db,
                user_id=user_id,
                session_id=session.id,
                calls=tool_calls,
                wait_approvals=wait_approvals,
            ):
                if event.get("type") == "tools_done":
                    tool_runs = event["results"]
                else:
                    yield event

            # Repair asks often stop after ```read```. Prefer an exact typo patch from
            # the file bytes (approval-gated); fall back to one model continue turn.
            if (
                wants_repair(content)
                and tool_runs
                and any(r.get("kind") == "read" and r.get("ok") for r in tool_runs)
                and not any(r.get("kind") == "patch" and r.get("ok") for r in tool_runs)
            ):
                yield {
                    "type": "status",
                    "phase": "tools",
                    "text": "Identifying the failure from the source…",
                }
                yield {
                    "type": "status",
                    "phase": "tools",
                    "text": "Proposing a correction…",
                }
                fix_calls: list[ToolCall] = []
                suggested = suggest_typo_patch_from_reads(tool_runs)
                if suggested is not None:
                    fix_calls = [suggested]
                else:
                    observations = format_tool_observations(tool_runs)[:10_000]
                    fix_desk = (
                        f"{desk}\n\n"
                        "REPAIR CONTINUE (mandatory): You already read the file(s) below. "
                        "Emit ONE ```patch``` fence that fixes the bug in place. "
                        "Copy the old line BYTE-FOR-BYTE from the read output. "
                        "Do not wipe, recreate, scaffold, or ```run```. No prose — fence only.\n\n"
                        f"{observations}"
                    )
                    try:
                        fix_plan = await plan_route(
                            db,
                            settings,
                            user_text=(
                                f"{content}\n\n"
                                "Emit the ```patch``` fence now using the file contents above."
                            ),
                            history=history,
                            shared_memory=memory_blob_for_prompt(db, user_id, device.id) if device else "",
                            device_name=device.name if device else "edge device",
                            desk_context=fix_desk,
                            choice=choice,
                            user_id=user_id,
                        )
                        fix_result, fix_reply = None, ""
                        async for item in _drive_plan(settings, fix_plan, hold_reply=True):
                            if item[0] == "done":
                                fix_result, fix_reply = item[1], item[2]
                            elif item[0] == "delta" and item[1] == "thinking":
                                yield {"type": "delta", "kind": "thinking", "text": item[2]}
                        if fix_result is not None:
                            _add_usage(result, fix_result)
                        if fix_reply:
                            _display, parsed = extract_tools(fix_reply)
                            fix_calls = [c for c in parsed if c.kind == "patch"]
                    except (RoutingError, LocalModelError, NebiusError) as exc:
                        log.warning("repair continue failed: %s", exc)
                if fix_calls:
                    async for event in _run_tool_phase(
                        db,
                        user_id=user_id,
                        session_id=session.id,
                        calls=fix_calls,
                        wait_approvals=wait_approvals,
                    ):
                        if event.get("type") == "tools_done":
                            tool_runs = tool_runs + event["results"]
                        else:
                            yield event

            follow_text = ""
            if _needs_synthesis(tool_runs):
                yield {"type": "status", "phase": "answer", "text": "Reading the results…"}
                follow_text = await _synthesize_from_tools(
                    db,
                    settings,
                    result,
                    content=content,
                    history=history,
                    tool_runs=tool_runs,
                    device=device,
                    user_id=user_id,
                    choice=choice,
                )
            # Nano follow-ups keep inventing Alice/Bob dashboards — prefer real tool output.
            follow_text = follow_text or factual_reply_from_tools(tool_runs)
            if follow_text:
                yield {"type": "delta", "kind": "text", "text": follow_text}
            final_text = follow_text
            result.reply = final_text
        else:
            yield {"type": "status", "phase": "answer", "text": "Writing the answer…"}
            final_text = strip_fabricated_board_report(reply_text) or (
                "I could not complete that without a board tool. "
                "Try asking to list home or create a folder by name."
            )
            result.reply = final_text
            if final_text:
                yield {"type": "delta", "kind": "text", "text": final_text}

        meta = result_to_dict(result)
        if tool_runs:
            meta["tool_runs"] = [
                {
                    "kind": item.get("kind"),
                    "command": item.get("command"),
                    "path": item.get("path"),
                    "ok": item.get("ok"),
                    "exit_code": item.get("exit_code"),
                    "timed_out": bool(item.get("timed_out")),
                    "skipped": bool(item.get("skipped")),
                    "url": item.get("url"),
                    "error": (str(item["error"])[:240] if item.get("error") else None),
                    "media": item.get("media"),
                }
                for item in tool_runs
            ]
        assistant = ChatMessage(
            session_id=session.id,
            role="assistant",
            content=final_text,
            meta_json=json.dumps(meta),
        )
        session.status = "idle"
        session.updated_at = datetime.utcnow()
        db.add_all([assistant, session])
        db.commit()
        record_turn(db, user_id=user_id, session_id=session.id, result=result)
        if tool_runs:
            emit_tool_results(trace_id=trace_id, session_id=session.id, results=tool_runs)
        tool_fail = sum(
            1
            for c in tool_runs
            if c.get("skipped") or c.get("ok") is False or (c.get("kind") == "run" and c.get("exit_code") not in (None, 0))
        )
        emit_ops(
            {
                "kind": "chat",
                "status": "partial" if tool_fail else "ok",
                "phase": "done",
                "trace_id": trace_id,
                "session_id": session.id,
                "route": result.route,
                "model": result.model,
                "intent": result.intent,
                "latency_ms": int((time.monotonic() - t0) * 1000),
                "prompt_tokens": result.prompt_tokens,
                "completion_tokens": result.completion_tokens,
                "cost_usd": result.cost_usd,
                "features": chat_features(
                    content,
                    final_text,
                    {
                        "tool_count": len(tool_runs),
                        "tool_fail": tool_fail,
                        "tool_kinds": [c.get("kind") for c in tool_runs][:8],
                        "selector": result.selector,
                        "thinking": bool(result.thinking),
                        "compressed": bool(result.compressed),
                        "choice": choice,
                    },
                ),
                "input_text": content,
                "output_text": final_text,
                "note": f"user={username or '?'}",
            }
        )
        yield {
            "type": "done",
            "session_id": session.id,
            "trace_id": trace_id,
            "message": {
                "role": "assistant",
                "content": final_text,
                "meta": meta,
                "created_at": assistant.created_at.isoformat() if assistant.created_at else None,
            },
            "telemetry": session_stats(db, session.id),
        }
    except (RoutingError, NebiusError, LocalModelError) as exc:
        detail = str(exc)
        emit_ops(
            {
                "kind": "chat",
                "status": "error",
                "phase": "done",
                "trace_id": locals().get("trace_id"),
                "error_code": type(exc).__name__,
                "session_id": session_id,
                "latency_ms": int((time.monotonic() - t0) * 1000),
                "features": chat_features(content, "", {"choice": choice}),
                "input_text": content,
                "note": detail[:280],
            }
        )
        yield _failure(db, user_msg, detail)
    except Exception as exc:  # noqa: BLE001 — never leave the client hanging
        log.exception("Chat turn failed")
        emit_ops(
            {
                "kind": "chat",
                "status": "error",
                "phase": "done",
                "trace_id": locals().get("trace_id"),
                "error_code": "unexpected",
                "session_id": session_id,
                "latency_ms": int((time.monotonic() - t0) * 1000),
                "features": chat_features(content, "", {"choice": choice}),
                "input_text": content,
                "note": f"{type(exc).__name__}: {exc}"[:280],
            }
        )
        yield _failure(db, user_msg, f"Unexpected error: {exc}")
    finally:
        db.close()


async def _finish_board_reply(
    db,
    *,
    session: ChatSession,
    user_id: int,
    username: str | None,
    content: str,
    final_text: str,
    choice: str,
    t0: float,
    intent: str,
    model: str,
) -> AsyncIterator[dict]:
    """Persist + stream a deterministic board answer (no LLM)."""
    trace_id = new_trace_id()
    latency_ms = int((time.monotonic() - t0) * 1000)
    result = RouteResult(
        reply=final_text,
        route="board",
        model=model,
        intent=intent,
        original_tokens=0,
        sent_tokens=0,
        saved_tokens=0,
        saved_pct=0.0,
        nebius_tokens=0,
        local_tokens=0,
        latency_ms=latency_ms,
        selector="board",
        selector_reason=intent,
    )
    yield {
        "type": "start",
        "session_id": session.id,
        "trace_id": trace_id,
        "route": result.route,
        "model": result.model,
        "intent": result.intent,
        "thinking": False,
        "compressed": False,
        "note": "",
        "selector": result.selector,
        "selector_reason": result.selector_reason,
        "selector_ms": 0,
    }
    yield {"type": "delta", "kind": "text", "text": final_text}
    meta = result_to_dict(result)
    assistant = ChatMessage(
        session_id=session.id,
        role="assistant",
        content=final_text,
        meta_json=json.dumps(meta),
    )
    session.status = "idle"
    session.updated_at = datetime.utcnow()
    db.add_all([assistant, session])
    db.commit()
    record_turn(db, user_id=user_id, session_id=session.id, result=result)
    emit_ops(
        {
            "kind": "chat",
            "status": "ok",
            "phase": "done",
            "trace_id": trace_id,
            "session_id": session.id,
            "route": result.route,
            "model": result.model,
            "intent": result.intent,
            "latency_ms": latency_ms,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "cost_usd": 0.0,
            "features": chat_features(
                content,
                final_text,
                {"tool_count": 0, "tool_fail": 0, "choice": choice, "board": intent},
            ),
            "input_text": content,
            "output_text": final_text,
            "note": f"user={username or '?'}",
        }
    )
    yield {
        "type": "done",
        "session_id": session.id,
        "trace_id": trace_id,
        "message": {
            "role": "assistant",
            "content": final_text,
            "meta": meta,
            "created_at": assistant.created_at.isoformat() if assistant.created_at else None,
        },
        "telemetry": session_stats(db, session.id),
    }


# Tools whose output is the answer's raw material; others get the factual summary only.
_SYNTH_KINDS = ("search",)
_USAGE_FIELDS = (
    "original_tokens", "sent_tokens", "saved_tokens", "nebius_tokens", "local_tokens",
    "prompt_tokens", "completion_tokens", "reasoning_tokens", "cost_usd", "latency_ms",
)


def _needs_synthesis(tool_runs: list[dict]) -> bool:
    return any(r.get("kind") in _SYNTH_KINDS and r.get("ok") and r.get("results") for r in tool_runs)


def _add_usage(into: RouteResult, extra: RouteResult) -> None:
    """Both model calls in a turn are billed — keep the ledger row honest."""
    for name in _USAGE_FIELDS:
        setattr(into, name, getattr(into, name) + getattr(extra, name))


async def _synthesize_from_tools(
    db, settings, result: RouteResult, *, content: str, history: list[dict], tool_runs: list[dict],
    device, user_id: int, choice: str,
) -> str:
    """Second pass: answer the user from tool observations. Returns "" to fall back to facts."""
    observations = format_tool_observations(tool_runs)[:12_000]
    prompt = (
        f"{content}\n\n"
        "--- Results from the tools you just ran ---\n"
        f"{observations}\n"
        "--- end ---\n\n"
        "Answer my request above using only these results, in English. "
        "Cite sources inline as markdown links whose text is the site or page name, e.g. "
        "[Nebius blog](https://…) — never the bare word 'source'. If the results don't cover it, say so. "
        "Do not emit tool fences."
    )
    try:
        plan = await plan_route(
            db,
            settings,
            user_text=prompt,
            history=history,
            shared_memory="",
            device_name=device.name if device else "edge device",
            desk_context="",
            choice=choice,
            user_id=user_id,
        )
        extra, text = None, ""
        async for item in _drive_plan(settings, plan, hold_reply=True):
            if item[0] == "done":
                extra, text = item[1], item[2]
    except (RoutingError, LocalModelError, NebiusError) as exc:
        log.warning("tool synthesis failed, using factual reply: %s", exc)
        return ""
    if extra is not None:
        _add_usage(result, extra)
    display, _calls = extract_tools(text)
    return strip_fabricated_board_report(display).strip()


async def _drive_plan(
    settings, plan: RoutePlan, *, hold_reply: bool
) -> AsyncIterator[tuple]:
    """Yield ("delta", kind, text) while running, then ("done", result, reply_text)."""
    result: RouteResult | None = None
    reply: list[str] = []
    async for event in run_plan(settings, plan):
        if isinstance(event, TextDelta):
            if event.kind == "thinking":
                yield ("delta", "thinking", event.text)
            else:
                reply.append(event.text)
                if not hold_reply:
                    yield ("delta", event.kind, event.text)
            continue
        result = event
    text = (result.reply if result and result.reply else "".join(reply)).strip()
    yield ("done", result, text)


async def complete_turn(
    user_id: int,
    *,
    content: str,
    session_id: str | None = None,
    device_id: str | None = None,
    choice: str = "auto",
) -> dict:
    """Run a turn to completion; returns the `done` event or raises RoutingError.

    Missions and non-interactive clients skip the approval wait — sensitive shell is denied.
    """
    async for event in stream_turn(
        user_id,
        content=content,
        session_id=session_id,
        device_id=device_id,
        choice=choice,
        wait_approvals=False,
    ):
        if event["type"] == "error":
            raise RoutingError(event["detail"])
        if event["type"] == "done":
            return event
    raise RoutingError("Turn ended without an answer.")


async def _run_tool_phase(
    db,
    *,
    user_id: int,
    session_id: str,
    calls: list[ToolCall],
    wait_approvals: bool,
) -> AsyncIterator[dict]:
    """Yield SSE tool/approval events; final yield is tools_done with results.

    Each tool emits phase=start before work and phase=done after, so the UI can
    show live progress instead of a blank spinner until everything finishes.
    """
    immediate = [c for c in calls if not c.needs_approval]
    gated = [c for c in calls if c.needs_approval]
    results: list[dict] = []

    if immediate or gated:
        yield {"type": "status", "phase": "tools", "text": "Running board tools…"}

    async for event in _run_calls_live(db, user_id, immediate, session_id=session_id):
        if event.get("type") == "tool" and event.get("phase") == "done":
            results.append(event["_result"])
            yield {k: v for k, v in event.items() if k != "_result"}
        else:
            yield event

    if gated:
        actions = [c.summary() for c in gated]
        proposal = explain_approval(actions)
        yield {
            "type": "status",
            "phase": "approval",
            "text": "Proposed a fix — review it, then Approve or Deny…",
        }
        # Stream the explanation into the assistant bubble before the Approve card.
        yield {"type": "delta", "kind": "text", "text": proposal + "\n\n"}
        pending = create_pending(
            user_id=user_id,
            session_id=session_id,
            actions=actions,
        )
        yield {
            "type": "approval",
            "approval_id": pending.id,
            "session_id": session_id,
            "actions": pending.actions,
            "timeout_sec": 300,
            "explain": proposal,
        }
        if wait_approvals:
            decision = await wait_decision(pending, timeout=300.0)
        else:
            decision = "deny"
            pending.decision = "deny"
            pending.event.set()
        drop_approval(pending.id)
        yield {
            "type": "approval_resolved",
            "approval_id": pending.id,
            "decision": decision,
        }
        if decision == "approve":
            yield {
                "type": "status",
                "phase": "tools",
                "text": "Applying the approved fix…",
            }
            async for event in _run_calls_live(db, user_id, gated, session_id=session_id):
                if event.get("type") == "tool" and event.get("phase") == "done":
                    results.append(event["_result"])
                    yield {k: v for k, v in event.items() if k != "_result"}
                else:
                    yield event
        else:
            for call in gated:
                skipped = {
                    **call.summary(),
                    "kind": call.kind,
                    "ok": False,
                    "skipped": True,
                    "reason": "operator denied or timed out" if wait_approvals else "non-interactive deny",
                }
                results.append(skipped)
                yield _tool_event(skipped, phase="done")

    if immediate or gated:
        yield {"type": "status", "phase": "answer", "text": "Writing the answer…"}
    yield {"type": "tools_done", "results": results}


async def _run_calls_live(
    db, user_id: int, calls: list[ToolCall], *, session_id: str | None = None
) -> AsyncIterator[dict]:
    """Run tools one-by-one so the client sees start → done for each."""
    for call in calls:
        yield _tool_start_event(call)
        ran = await execute_tools(db, user_id, [call], session_id=session_id)
        item = ran[0] if ran else {"kind": call.kind, "ok": False, "error": "empty tool result"}
        event = _tool_event(item, phase="done")
        event["_result"] = item
        yield event


def _tool_start_event(call: ToolCall) -> dict:
    summary = call.summary()
    return {
        "type": "tool",
        "phase": "start",
        "kind": call.kind,
        "command": summary.get("command"),
        "path": summary.get("path"),
        "query": summary.get("query"),
        "url": summary.get("url"),
        "action": summary.get("action"),
        "tool": summary.get("tool"),
    }


def _tool_event(item: dict, *, phase: str = "done") -> dict:
    return {
        "type": "tool",
        "phase": phase,
        "kind": item.get("kind"),
        "command": item.get("command"),
        "path": item.get("path"),
        "query": item.get("query"),
        "ok": item.get("ok"),
        "exit_code": item.get("exit_code"),
        "stdout": item.get("stdout"),
        "stderr": item.get("stderr"),
        "timed_out": item.get("timed_out"),
        "skipped": item.get("skipped"),
        "error": item.get("error"),
        "reason": item.get("reason"),
        # P1 tools
        "target": item.get("target"),
        "verdict": item.get("verdict"),
        "detail": item.get("detail"),
        "host": item.get("host"),
        "gpu_util_pct": item.get("gpu_util_pct"),
        "pass_count": item.get("pass_count"),
        "fail_count": item.get("fail_count"),
        "pass_rate": item.get("pass_rate"),
        "repeats": item.get("repeats"),
        "job": item.get("job"),
        "phases": item.get("phases"),
        "rolled_back": item.get("rolled_back"),
        "results": item.get("results"),
        "report": item.get("report"),
        "circuit_open": item.get("circuit_open"),
        "action": item.get("action"),
        "shot": item.get("shot"),
        "title": item.get("title"),
        "text": item.get("text"),
        "url": item.get("url"),
        "selector": item.get("selector"),
        "tool": item.get("tool"),
        "media": item.get("media"),
    }


def _desk_context(db, user_id: int, content: str, device_id: str | None) -> str:
    from app.edge.identity import identity_prompt_blob

    fleet = None
    if device_id:
        row = db.get(Device, device_id)
        fleet = row.name if row else None
    parts: list[str] = [
        "Always reply to the operator in English. "
        "Answer the latest user message only. "
        "Never repeat prior identity lines ('I am Kratos…') or secret-check results "
        "unless the user asks who you are or about a named secret again. "
        "While working, prefer short progress status over long narration — "
        "the UI already shows live tool steps.",
        identity_prompt_blob(fleet),
        tools_prompt(),
        work_prompt_blob(),
    ]
    if wants_file_list(content):
        parts.append(
            "Latest task is a directory listing under the desk filesystem root (operator home). "
            "Emit exactly one fence:\n```list\n.\n```\n"
            "Do not mention secrets, identity, or models."
        )
    names = secret_names(db, user_id)
    if names:
        listed = ", ".join(names)
        parts.append(
            "Board keychain (llavero) — secret NAMES only: "
            f"{listed}. "
            "Values are injected automatically as environment variables into every ```run``` "
            "shell ($NAME / process.env.NAME). You never READ values (no print/echo/log). "
            "Do not mention the keychain unless the user asks about a named secret. "
            "For file tasks use ```list``` / ```read```; for shell use ```run```. "
            "Only when the user asks to compare a named secret to a candidate value, "
            "the board may pre-resolve equal/different for you — otherwise ignore secrets."
        )
        verified = resolve_equality(db, user_id, content, names)
        if verified:
            parts.append(verified)
    profiles = profiles_for_prompt(db, user_id, content, device_id=device_id)
    if profiles:
        parts.append(profiles)
    return "\n\n".join(parts)


def _failure(db, user_msg: ChatMessage | None, detail: str) -> dict:
    db.rollback()
    if user_msg is not None and user_msg.id is not None:
        db.query(ChatMessage).filter(ChatMessage.id == user_msg.id).delete()
        db.query(ChatSession).filter(ChatSession.id == user_msg.session_id).update({"status": "idle"})
        db.commit()
    return {"type": "error", "detail": detail}
