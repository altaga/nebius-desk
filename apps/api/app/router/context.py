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
    text = (
        f"You are Millie, the assistant for the operator of '{device_name}'. "
        "Answer in the user's language. Be direct and concrete; use Markdown "
        "for structure and fenced code blocks for code."
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


def _where(device_name: str, on_device: bool) -> str:
    if not on_device:
        return " on Nebius"
    if device_name.strip().lower() == "millie":
        return ""
    return f" on {device_name}"


def named_system(system: dict, *, model: str, device_name: str, on_device: bool, user_text: str) -> dict:
    face = _face(model)
    where = _where(device_name, on_device)
    who = f"I am Millie, running {face} version {model}{where}." if _VERSION_ASK.search(user_text) else f"I am Millie, running {face}{where}."
    lead = f"You are Millie. If asked who you are or which model you are, answer exactly: {who}"
    return {"role": "system", "content": f"{lead}\n\n{system['content']}"}


def local_context(settings: Settings, system: dict, history: list[dict], user_text: str) -> BuiltContext:
    recent = history[-settings.local_history_messages :]
    messages = [system, *recent, {"role": "user", "content": user_text}]
    full = estimate_messages_tokens([system, *history, {"role": "user", "content": user_text}])
    return BuiltContext(messages, full, estimate_messages_tokens(messages), False, 0)


async def cloud_context(
    settings: Settings, system: dict, history: list[dict], user_text: str, local_ok: bool
) -> BuiltContext:
    user = {"role": "user", "content": user_text}
    full_messages = [system, *history, user]
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
    messages = [system, summary_msg, *recent, user]
    return BuiltContext(
        messages,
        original,
        estimate_messages_tokens(messages),
        True,
        usage.prompt_tokens + usage.completion_tokens,
    )
