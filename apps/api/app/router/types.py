from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class TextDelta:
    """A streamed piece of the answer (kind="text") or of the model's reasoning (kind="thinking")."""

    text: str
    kind: str = "text"


@dataclass
class Usage:
    prompt_tokens: int
    completion_tokens: int
    reasoning_tokens: int = 0


@dataclass
class RoutePlan:
    route: str  # "local" | "nebius"
    model: str
    intent: str
    messages: list[dict]
    thinking: bool
    original_tokens: int
    compressed: bool
    compression_tokens: int
    note: str = ""
    selector: str = "rules"
    selector_reason: str = ""
    selector_ms: int = 0


@dataclass
class RouteResult:
    reply: str
    route: str
    model: str
    intent: str
    original_tokens: int
    sent_tokens: int
    saved_tokens: int
    saved_pct: float
    nebius_tokens: int
    local_tokens: int
    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0
    context_window: int = 0
    compressed: bool = False
    thinking: str = ""
    budget_note: str = ""
    selector: str = "rules"
    selector_reason: str = ""
    selector_ms: int = 0
    extra: dict = field(default_factory=dict)


def result_to_dict(result: RouteResult) -> dict:
    data = asdict(result)
    data.pop("extra", None)
    return data
