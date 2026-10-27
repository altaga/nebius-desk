"""Nebius Token Factory client (OpenAI-compatible, streamed)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx

from app.cloudlink import cloud_config
from app.config import Settings
from app.router.types import TextDelta, Usage


class NebiusError(RuntimeError):
    pass


def _payload(model: str, messages: list[dict], thinking: bool, max_tokens: int) -> dict:
    return {
        "model": model,
        "messages": messages,
        "stream": True,
        "stream_options": {"include_usage": True},
        "temperature": 0.6 if thinking else 0.4,
        "max_tokens": max_tokens,
        "chat_template_kwargs": {"enable_thinking": thinking},
    }


def _events_from_chunk(chunk: dict) -> list[TextDelta | Usage]:
    events: list[TextDelta | Usage] = []
    for choice in chunk.get("choices") or []:
        delta = choice.get("delta") or {}
        if delta.get("reasoning_content"):
            events.append(TextDelta(delta["reasoning_content"], "thinking"))
        if delta.get("content"):
            events.append(TextDelta(delta["content"], "text"))
    usage = chunk.get("usage")
    if usage:
        details = usage.get("completion_tokens_details") or {}
        events.append(
            Usage(
                prompt_tokens=int(usage.get("prompt_tokens") or 0),
                completion_tokens=int(usage.get("completion_tokens") or 0),
                reasoning_tokens=int(details.get("reasoning_tokens") or 0),
            )
        )
    return events


async def stream_chat(
    settings: Settings,
    *,
    model: str,
    messages: list[dict],
    thinking: bool,
    max_tokens: int = 4096,
) -> AsyncIterator[TextDelta | Usage]:
    cloud = cloud_config()
    if cloud:
        url = f"{cloud[0]}/v1/gateway/nebius/chat/completions"
        headers = {"Authorization": f"Bearer {cloud[1]}"}
    else:
        url = f"{settings.nebius_base_url.rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {settings.nebius_api_key}"}
    timeout = httpx.Timeout(connect=15.0, read=180.0, write=30.0, pool=15.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream(
            "POST", url, headers=headers, json=_payload(model, messages, thinking, max_tokens)
        ) as resp:
            if resp.status_code >= 400:
                body = (await resp.aread()).decode(errors="replace")[:300]
                raise NebiusError(f"Token Factory HTTP {resp.status_code}: {body}")
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                for event in _events_from_chunk(chunk):
                    yield event
