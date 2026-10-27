"""Hybrid router: decide Jetson vs Token Factory per message, then stream the answer."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator

from sqlalchemy.orm import Session

from app.config import Settings
from app.router import local_llm, nebius
from app.router.budget import check_budget
from app.router.context import cloud_context, local_context, named_system, system_prompt
from app.router.pricing import canonical_model, cost_usd, model_info
from app.router.selector import Selection, select_tier
from app.router.tokenizer import estimate_messages_tokens
from app.router.types import RoutePlan, RouteResult, TextDelta, Usage
from app.subscription.catalog import CLOUD_CREDIT_USD
from app.subscription.service import cloud_spent_usd
from app.subscription.service import is_active as subscription_active

EXPECTED_OUTPUT_TOKENS = {False: 1200, True: 4000}


class RoutingError(RuntimeError):
    pass


def _mode_override(settings: Settings, tier: str) -> str:
    if settings.board_emu:
        return "nano" if tier == "local" else tier
    if settings.llm_mode == "local_only":
        return "local"
    if settings.llm_mode == "cloud_only" and tier == "local":
        return "fast"
    return tier


def _local_plan(settings: Settings, system: dict, history: list[dict], user_text: str, sel: Selection,
                note: str, model: str) -> RoutePlan:
    ctx = local_context(settings, system, history, user_text)
    return RoutePlan("local", model, "local", _pin_identity(ctx.messages), False, ctx.original_tokens,
                     False, 0, note, sel.selector, sel.reason, sel.latency_ms)


def _pin_identity(messages: list[dict]) -> list[dict]:
    """Repeat who is answering immediately before the question. Small models follow the latest line."""
    lead = next((m["content"].split("\n", 1)[0] for m in messages if m.get("role") == "system"), "")
    if not lead or not messages or messages[-1].get("role") != "user":
        return messages
    return [*messages[:-1], {"role": "system", "content": lead}, messages[-1]]


async def plan_route(
    db: Session,
    settings: Settings,
    *,
    user_text: str,
    history: list[dict],
    shared_memory: str,
    device_name: str,
    desk_context: str = "",
    choice: str = "auto",
    user_id: int | None = None,
    system_override: dict | None = None,
    pin_identity: bool = True,
) -> RoutePlan:
    system = system_override or system_prompt(device_name, shared_memory, desk_context)
    if settings.board_emu:
        local_model, local_ok = None, False
    else:
        local_model = await local_llm.resolve_model(settings)
        local_ok = local_model is not None
    sel = await select_tier(settings, choice=choice, user_text=user_text, history_turns=len(history),
                            local_ok=local_ok)
    tier = _mode_override(settings, sel.tier)
    note = ""

    def _speak(sys: dict, *, model: str, on_device: bool) -> dict:
        if not pin_identity:
            return sys
        return named_system(sys, model=model, device_name=device_name, on_device=on_device, user_text=user_text)

    if tier == "local":
        if local_model:
            spoken = _speak(system, model=local_model, on_device=True)
            return _local_plan(settings, spoken, history, user_text, sel, "", local_model)
        if settings.llm_mode == "local_only":
            raise RoutingError("The Jetson model is offline and the desk is in local-only mode.")
        note, tier = "Jetson model offline — sent to Nebius instead", "fast"

    if user_id is not None and not subscription_active(db, user_id):
        if local_model:
            spoken = _speak(system, model=local_model, on_device=True)
            return _local_plan(
                settings, spoken, history, user_text, sel,
                "Desk subscription is inactive. Answered on the Jetson.",
                local_model,
            )
        raise RoutingError("Desk subscription is inactive. Nebius stays closed.")

    thinking = tier in {"heavy", "ultra"}
    configured = {
        "nano": settings.nebius_model_balanced,
        "fast": settings.nebius_model_fast,
        "heavy": settings.nebius_model_heavy,
        "ultra": settings.nebius_model_ultra,
    }.get(tier, settings.nebius_model_fast)
    model = canonical_model(configured)
    spoken = _speak(system, model=model, on_device=False)
    ctx = await cloud_context(settings, spoken, history, user_text, local_ok)
    info = await model_info(model)
    upcoming = (ctx.sent_tokens * info.input_per_m + EXPECTED_OUTPUT_TOKENS[thinking] * info.output_per_m) / 1e6
    if user_id is not None:
        spent = cloud_spent_usd(db, user_id)
        blocked = spent + upcoming > CLOUD_CREDIT_USD
        reason = f"Cloud credits used (${spent:.4f} of ${CLOUD_CREDIT_USD:.2f})."
    else:
        budget = check_budget(db, settings, upcoming)
        blocked, reason = not budget.allowed, budget.reason
    if blocked:
        if local_model:
            spoken = _speak(system, model=local_model, on_device=True)
            return _local_plan(settings, spoken, history, user_text, sel, f"{reason} Answered on the Jetson.", local_model)
        raise RoutingError(reason)

    return RoutePlan("nebius", model, tier, _pin_identity(ctx.messages), thinking, ctx.original_tokens, ctx.compressed,
                     ctx.compression_tokens, note, sel.selector, sel.reason, sel.latency_ms)


async def run_plan(settings: Settings, plan: RoutePlan) -> AsyncIterator[TextDelta | RouteResult]:
    started = time.perf_counter()
    if plan.route == "local":
        stream = local_llm.stream_chat(settings, plan.messages, plan.model)
    else:
        stream = nebius.stream_chat(settings, model=plan.model, messages=plan.messages, thinking=plan.thinking)

    reply: list[str] = []
    thinking: list[str] = []
    usage = Usage(0, 0)
    async for event in stream:
        if isinstance(event, Usage):
            usage = event
            continue
        (thinking if event.kind == "thinking" else reply).append(event.text)
        yield event

    yield await _result(settings, plan, "".join(reply).strip(), "".join(thinking).strip(), usage, started)


async def _result(
    settings: Settings, plan: RoutePlan, reply: str, thinking: str, usage: Usage, started: float
) -> RouteResult:
    sent_est = estimate_messages_tokens(plan.messages)
    is_cloud = plan.route == "nebius"
    saved = plan.original_tokens if not is_cloud else max(0, plan.original_tokens - sent_est)
    info = await model_info(plan.model) if is_cloud else None
    return RouteResult(
        reply=reply,
        route=plan.route,
        model=plan.model,
        intent=plan.intent,
        original_tokens=plan.original_tokens,
        sent_tokens=usage.prompt_tokens if is_cloud else 0,
        saved_tokens=saved,
        saved_pct=round(saved / plan.original_tokens * 100, 1) if plan.original_tokens else 0.0,
        nebius_tokens=usage.prompt_tokens + usage.completion_tokens if is_cloud else 0,
        local_tokens=plan.compression_tokens + (0 if is_cloud else usage.prompt_tokens + usage.completion_tokens),
        prompt_tokens=usage.prompt_tokens,
        completion_tokens=usage.completion_tokens,
        reasoning_tokens=usage.reasoning_tokens,
        cost_usd=await cost_usd(plan.model, usage.prompt_tokens, usage.completion_tokens) if is_cloud else 0.0,
        latency_ms=int((time.perf_counter() - started) * 1000),
        context_window=info.context_window if info else settings.ollama_context_tokens,
        compressed=plan.compressed,
        thinking=thinking,
        budget_note=plan.note,
        selector=plan.selector,
        selector_reason=plan.selector_reason,
        selector_ms=plan.selector_ms,
    )
