"""Per-model Token Factory prices and context windows from Nebius' public catalog (cached)."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import httpx

log = logging.getLogger(__name__)

CATALOG_URL = "https://tokenfactory.nebius.com/api/public/models_info"
CACHE_SECONDS = 6 * 3600


@dataclass(frozen=True)
class ModelInfo:
    input_per_m: float
    output_per_m: float
    context_window: int
    source: str


# Used only until the catalog is reachable (Oct 2026 catalog values).
FALLBACK: dict[str, ModelInfo] = {
    "nvidia/Nemotron-3_5-Lightning": ModelInfo(0.06, 0.24, 1_048_576, "fallback"),
    "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B": ModelInfo(0.06, 0.24, 262_144, "fallback"),
    "nvidia/nemotron-3-super-120b-a12b": ModelInfo(0.30, 0.90, 262_144, "fallback"),
    "nvidia/Nemotron-3-Ultra-550b-a55b": ModelInfo(1.00, 3.00, 1_048_576, "fallback"),
}

_cache: dict[str, ModelInfo] = {}
_loaded_at = 0.0


def _parse_catalog(models: object) -> dict[str, ModelInfo]:
    out: dict[str, ModelInfo] = {}
    for m in models if isinstance(models, list) else []:
        for f in m.get("flavors") or []:
            model_id = f.get("model_id")
            inp = f.get("input_price_per_million_tokens")
            if not model_id or inp is None:
                continue
            window = f.get("max_model_len") or int(f.get("context_window_k") or 128) * 1024
            out[model_id] = ModelInfo(
                float(inp), float(f.get("output_price_per_million_tokens") or 0), int(window), "catalog"
            )
    return out


async def refresh_catalog() -> None:
    global _loaded_at
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(CATALOG_URL)
            resp.raise_for_status()
            parsed = _parse_catalog(resp.json())
        if parsed:
            _cache.update(parsed)
            _loaded_at = time.time()
    except Exception as exc:  # noqa: BLE001 — pricing must never break chat
        log.warning("Token Factory catalog unavailable: %s", exc)


_ALIASES = {
    "nvidia/Nemotron-3.5-Lightning": "nvidia/Nemotron-3_5-Lightning",
    "nvidia/Nemotron-3-Super": "nvidia/nemotron-3-super-120b-a12b",
    "nvidia/Nemotron-3-Nano": "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
}


def canonical_model(model: str) -> str:
    name = model.strip()
    return _ALIASES.get(name, name)


async def model_info(model: str) -> ModelInfo:
    if time.time() - _loaded_at > CACHE_SECONDS:
        await refresh_catalog()
    name = canonical_model(model)
    return _cache.get(name) or FALLBACK.get(name) or ModelInfo(0.30, 0.90, 131_072, "fallback")


async def cost_usd(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    info = await model_info(model)
    return (prompt_tokens * info.input_per_m + completion_tokens * info.output_per_m) / 1_000_000
