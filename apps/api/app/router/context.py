"""Builds the prompt for each route; compresses long histories on the Jetson."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from app.config import Settings
from app.router import local_llm
from app.router.tokenizer import estimate_messages_tokens

log = logging.getLogger(__name__)


@dataclass
class BuiltContext:
    messages: list[dict]
    original_tokens: int
    sent_tokens: int
    compressed: bool
    compression_tokens: int


def system_prompt(device_name: str, shared_memory: str, desk_context: str = "") -> dict:
    board = (device_name or "").strip() or "Kratos"
    text = (
        f"You are {board}, the edge agent on this desk board. "
        f"Your name is {board} — speak as {board}, never as Millie. "
        "Millie is only the separate UI guide avatar in the corner; she is not you and not this board. "
        "Always reply in English. Be direct and concrete; use Markdown "
        "for structure and fenced code blocks for code. "
        "Do not introduce yourself or name the model unless the user asks who you are or which model you are. "
        "Never invent board operators, Alice/Bob/Carol, pending-action IDs, fake dates, "
        "active-user counts, or multi-agent status tables. "
        "For shell/files/browser/install you MUST emit a real fence "
        "(```run``` / ```list``` / ```read``` / ```install``` / ```browse``` / ```search```) "
        "in the same reply — never narrate that you ran a tool, never say "
        "'run fence creado' / 'ejecutando' / 'voy a instalar' without the fence body. "
        "A reply with zero fences when the user asked to act on the board is a failure. "
        "After a tool runs, reply in 1–3 short sentences from the tool output; nothing else."
    )
    if shared_memory:
        text += f"\n\n{shared_memory}"
    if desk_context:
        text += f"\n\n{desk_context}"
    return {"role": "system", "content": text}


def _face(model: str) -> str:
    slug = model.lower()
    if "qwen" in slug:
        return "Qwen"
    if "ultra" in slug:
        return "Nemotron Ultra"
    if "super" in slug:
        return "Nemotron Super"
    if "lightning" in slug:
        return "Nemotron Lightning"
    if "nano" in slug:
        return "Nemotron Nano"
    return model.rsplit("/", 1)[-1]


_VERSION_ASK = re.compile(r"\b(version|versi[oó]n|model id|exact id|build)\b", re.I)
_IDENTITY_ASK = re.compile(
    r"(?i)\b("
    r"who are you|what are you|which model|what model|qué modelo|que modelo|"
    r"qui[eé]n eres|qu[eé] eres|c[oó]mo te llamas|your name|tu nombre"
    r")\b"
)


def wants_identity(user_text: str) -> bool:
    return bool(_IDENTITY_ASK.search(user_text or "") or _VERSION_ASK.search(user_text or ""))


def _where(device_name: str, on_device: bool) -> str:
    if not on_device:
        return " on Nebius"
    clean = device_name.strip() or "Kratos"
    return f" on {clean}"


def named_system(system: dict, *, model: str, device_name: str, on_device: bool, user_text: str) -> dict:
    """Only pin the spoken identity line when the user asked who/which model."""
    if not wants_identity(user_text):
        return system
    board = (device_name or "").strip() or "Kratos"
    face = _face(model)
    where = _where(device_name, on_device)
    who = (
        f"I am {board}, running {face} version {model}{where}."
        if _VERSION_ASK.search(user_text)
        else f"I am {board}, running {face}{where}."
    )
    lead = (
        f"You are {board} (never Millie). The user asked who you are or which model you are. "
        f"Answer exactly: {who}"
    )
    return {"role": "system", "content": f"{lead}\n\n{system['content']}"}


def _with_history_note(system: dict, note: str) -> dict:
    if not note:
        return system
    return {"role": "system", "content": f"{system['content']}\n\n{note}"}


def local_context(settings: Settings, system: dict, history: list[dict], user_text: str) -> BuiltContext:
    from app.chat.history import build_history

    bundle = build_history(history, user_text, max_messages=settings.local_history_messages)
    spoken = _with_history_note(system, bundle.note)
    messages = [spoken, *bundle.messages, {"role": "user", "content": user_text}]
    full = estimate_messages_tokens([system, *history, {"role": "user", "content": user_text}])
    return BuiltContext(messages, full, estimate_messages_tokens(messages), False, 0)


async def cloud_context(
    settings: Settings, system: dict, history: list[dict], user_text: str, local_ok: bool
) -> BuiltContext:
    from app.chat.history import build_history

    user = {"role": "user", "content": user_text}
    bundle = build_history(history, user_text, max_messages=max(settings.cloud_recent_messages * 2, 12))
    history = bundle.messages
    spoken = _with_history_note(system, bundle.note)
    full_messages = [spoken, *history, user]
    original = estimate_messages_tokens(full_messages)
    keep = settings.cloud_recent_messages
    if original <= settings.compress_after_tokens or len(history) <= keep or not local_ok:
        return BuiltContext(full_messages, original, original, False, 0)

    older, recent = history[:-keep], history[-keep:]
    transcript = "\n".join(f"{m['role']}: {m['content']}" for m in older)
    prompt = (
        "Compress this earlier part of a conversation into a dense summary for another model. "
        "Keep facts, decisions, names, numbers, file paths, code identifiers and open questions. "
        "Drop pleasantries. Write at most 250 words.\n\n" + transcript
    )
    try:
        summary, usage = await local_llm.generate(settings, prompt)
    except local_llm.LocalModelError as exc:
        log.warning("Compression skipped: %s", exc)
        return BuiltContext(full_messages, original, original, False, 0)

    summary_msg = {"role": "system", "content": f"Summary of the earlier conversation:\n{summary}"}
    messages = [spoken, summary_msg, *recent, user]
    return BuiltContext(
        messages,
        original,
        estimate_messages_tokens(messages),
        True,
        usage.prompt_tokens + usage.completion_tokens,
    )
