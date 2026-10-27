"""On-device model on the Jetson, served by Ollama."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx

from app.config import Settings
from app.router.types import TextDelta, Usage


KEEP_ALIVE = "24h"


class LocalModelError(RuntimeError):
    pass


async def warm_up(settings: Settings) -> None:
    """Load the model into GPU memory so the first chat doesn't pay the cold start."""
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            await client.post(
                f"{settings.ollama_base_url.rstrip('/')}/api/generate",
                json={"model": settings.ollama_model, "prompt": "", "keep_alive": KEEP_ALIVE},
            )
    except httpx.HTTPError:
        pass


def _match_installed(names: set[str], wanted: str) -> str | None:
    if wanted in names:
        return wanted
    family = wanted.split(":", 1)[0]
    tagged = sorted(name for name in names if name == family or name.startswith(family + ":"))
    return tagged[0] if tagged else None


async def resolve_model(settings: Settings) -> str | None:
    """Installed Ollama name for the configured model, including a matching tag."""
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{settings.ollama_base_url.rstrip('/')}/api/tags")
            resp.raise_for_status()
            names = {str(m.get("name")) for m in resp.json().get("models", []) if m.get("name")}
    except Exception:  # noqa: BLE001 — availability probe
        return None
    return _match_installed(names, settings.ollama_model)


async def is_available(settings: Settings) -> bool:
    return await resolve_model(settings) is not None


async def stream_chat(settings: Settings, messages: list[dict], model: str | None = None) -> AsyncIterator[TextDelta | Usage]:
    url = f"{settings.ollama_base_url.rstrip('/')}/api/chat"
    payload = {
        "model": model or settings.ollama_model,
        "messages": messages,
        "stream": True,
        "keep_alive": KEEP_ALIVE,
        "options": {"temperature": 0.3},
    }
    timeout = httpx.Timeout(connect=5.0, read=120.0, write=30.0, pool=5.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", url, json=payload) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode(errors="replace")[:200]
                    raise LocalModelError(f"Ollama HTTP {resp.status_code}: {body}")
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    chunk = json.loads(line)
                    text = (chunk.get("message") or {}).get("content")
                    if text:
                        yield TextDelta(text)
                    if chunk.get("done"):
                        yield Usage(
                            prompt_tokens=int(chunk.get("prompt_eval_count") or 0),
                            completion_tokens=int(chunk.get("eval_count") or 0),
                        )
    except httpx.HTTPError as exc:
        raise LocalModelError(f"Jetson model unreachable: {exc}") from exc


async def generate(settings: Settings, prompt: str) -> tuple[str, Usage]:
    """Non-streamed completion, used for on-device context compression."""
    text: list[str] = []
    usage = Usage(0, 0)
    async for event in stream_chat(settings, [{"role": "user", "content": prompt}]):
        if isinstance(event, TextDelta):
            text.append(event.text)
        else:
            usage = event
    return "".join(text).strip(), usage
