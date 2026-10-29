"""Context engineering for chat turns — what history still serves the active prompt.

Patterns borrowed from Cursor / Claude Code / Anthropic context engineering:
  - Attention is finite: keep the smallest high-signal set for *this* ask.
  - Task-boundary cut: off-topic digressions (vault ↔ files) do not ride along.
  - Tool-result clearing: old ```run/list/…``` dumps become stubs once consumed.
  - Sticky identifiers: paths / secret *names* mentioned stay as a short note.
  - Continuity: "también / show more / eso" reuses the last useful turn.
  - Compaction note: older on-topic turns collapse to one extractive line.

This runs before every route so Nano cannot parrot an unrelated prior reply.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.router.context import wants_identity

_SECRET = re.compile(
    r"(?i)\b(?:secret|secrets|keychain|llavero|env(?:ironment)?\s*var|"
    r"variable(?:s)?\s+de\s+entorno|vault)\b"
)
_FILES = re.compile(
    r"(?i)\b(?:"
    r"list(?:ar)?|enumer\w*|archivos?|files?|carpeta|folder|directorio|"
    r"home|ls\b|dir\b|path|ruta|read(?:ear)?|cat\b|abrir archivo"
    r")\b"
)
_SHELL = re.compile(
    r"(?i)\b(?:"
    r"shell|terminal|comando|command|bash|run\b|ejecut\w*|curl\b|ssh\b|pip\b|npm\b"
    r")\b"
)
_DEPLOY = re.compile(
    r"(?i)\b(?:deploy|rollback|verify|bakeoff|checks?|probe|receta|recipe)\b"
)
_SEARCH = re.compile(r"(?i)\b(?:search|busca(?:r)?|web\b|tavily|google)\b")
_HEALTH = re.compile(
    r"(?i)\b(?:health|temp(?:eratura)?|gpu|ram|disco|disk|df\b|uptime|jetson status)\b"
)
_CODE = re.compile(
    r"(?i)\b(?:code|código|patch|bug|error|stack|function|función|refactor|"
    r"python|typescript|javascript|\.py\b|\.ts\b|\.tsx\b)\b"
)
_CONTINUITY = re.compile(
    r"(?i)^\s*(?:"
    r"y\b|also\b|también|ahora\b|now\b|ok\b|vale\b|eso\b|eso mismo|"
    r"más\b|more\b|sigue|continue|otra vez|again|lo mismo|"
    r"muéstra(?:me)?\s+más|show\s+more|y\s+los?\b"
    r")"
)
_ZOMBIE = re.compile(
    r"(?is)^\s*I am (?:Millie|Kratos|Atreus|Natasha)\b.*\b(?:TEST secret|keychain USE|Nemotron Nano)\b"
    r"|^\s*The TEST secret is (?:not )?equal to\b"
)
_TOOL_FENCE = re.compile(
    r"```(?:run|list|read|patch|search|work|probe|health|verify|deploy|checks|bakeoff|browse|job|install)\b[\s\S]*?```",
    re.I,
)
_PATH_TOKEN = re.compile(r"(?m)(?:^|\s)((?:\./|~/|/home/|\.desk/)[^\s`\"']+|[A-Za-z0-9_.-]+\.(?:py|ts|tsx|js|json|md|sh|toml|yml|yaml))")
_WORD = re.compile(r"[a-záéíóúñü0-9_]{3,}", re.I)
_STOP = frozenset(
    {
        "the", "and", "for", "with", "that", "this", "from", "have", "are", "was",
        "los", "las", "del", "una", "unos", "que", "por", "para", "con", "como",
        "este", "esta", "estos", "estas", "de", "en", "el", "la", "un", "al",
    }
)

Topic = str


@dataclass(frozen=True)
class HistoryBundle:
    messages: list[dict]
    note: str = ""  # optional system addendum (sticky paths / compact)


def is_zombie_reply(text: str) -> bool:
    return bool(_ZOMBIE.search(text or ""))


def classify(text: str) -> frozenset[Topic]:
    raw = text or ""
    found: set[Topic] = set()
    if wants_identity(raw):
        found.add("identity")
    if _SECRET.search(raw):
        found.add("secret")
    if _FILES.search(raw):
        found.add("files")
    if _SHELL.search(raw):
        found.add("shell")
    if _DEPLOY.search(raw):
        found.add("deploy")
    if _SEARCH.search(raw):
        found.add("search")
    if _HEALTH.search(raw):
        found.add("health")
    if _CODE.search(raw):
        found.add("code")
    return frozenset(found) if found else frozenset({"general"})


def wants_file_list(user_text: str) -> bool:
    text = user_text or ""
    if wants_identity(text) or "secret" in classify(text):
        return False
    return "files" in classify(text)


def _overlap(a: frozenset[Topic], b: frozenset[Topic]) -> bool:
    left = a - {"general"}
    right = b - {"general"}
    if left and right:
        return bool(left & right)
    return a == b == frozenset({"general"})


def _tokens(text: str) -> set[str]:
    return {w.lower() for w in _WORD.findall(text or "") if w.lower() not in _STOP}


def _prune_tools(text: str, *, keep_recent: bool) -> str:
    """Clear old tool fences (Claude-style tool-result clearing). Keep recent verbatim."""
    if keep_recent or not text:
        return text
    if not _TOOL_FENCE.search(text):
        return text
    cleaned = _TOOL_FENCE.sub("[prior board tool result cleared — re-run the tool if needed]", text)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned[:1200]


def _sticky_paths(*texts: str, limit: int = 8) -> list[str]:
    seen: list[str] = []
    for text in texts:
        for match in _PATH_TOKEN.findall(text or ""):
            path = match.strip().rstrip(".,;:")
            if path and path not in seen:
                seen.append(path)
            if len(seen) >= limit:
                return seen
    return seen


def _pairs(history: list[dict]) -> list[tuple[dict | None, dict | None, frozenset[Topic]]]:
    out: list[tuple[dict | None, dict | None, frozenset[Topic]]] = []
    pending_user: dict | None = None
    pending_topics = frozenset({"general"})
    for row in history:
        role = row.get("role")
        if role == "user":
            if pending_user is not None:
                out.append((pending_user, None, pending_topics))
            pending_user = row
            pending_topics = classify(row.get("content") or "")
        elif role == "assistant":
            if pending_user is not None:
                topics = pending_topics | classify(row.get("content") or "")
                out.append((pending_user, row, topics))
                pending_user = None
                pending_topics = frozenset({"general"})
            else:
                out.append((None, row, classify(row.get("content") or "")))
    if pending_user is not None:
        out.append((pending_user, None, pending_topics))
    return out


def _score(
    *,
    topics: frozenset[Topic],
    active: frozenset[Topic],
    user_text: str,
    assist_text: str,
    ask_tokens: set[str],
    index: int,
    total: int,
) -> float:
    if not _overlap(topics, active) and active != frozenset({"general"}):
        # Hard task-boundary: off-topic digressions score out.
        return -1.0
    if is_zombie_reply(assist_text) and "identity" not in active and "secret" not in active:
        return -1.0

    score = 0.0
    if _overlap(topics, active):
        score += 3.0
    blob = f"{user_text}\n{assist_text}"
    shared = len(ask_tokens & _tokens(blob))
    score += min(shared, 8) * 0.35
    # Recency (Cursor/Claude keep the tail verbatim).
    if total > 1:
        score += (index / (total - 1)) * 2.0
    else:
        score += 2.0
    # Prefer short, concrete assistant answers over essays.
    if 0 < len(assist_text) < 900:
        score += 0.4
    elif len(assist_text) > 4000:
        score -= 0.6
    return score


def select_relevant_history(
    history: list[dict],
    user_text: str,
    *,
    max_messages: int = 12,
) -> list[dict]:
    return build_history(history, user_text, max_messages=max_messages).messages


def build_history(
    history: list[dict],
    user_text: str,
    *,
    max_messages: int = 12,
) -> HistoryBundle:
    """Score, prune, and optionally compact history for the active ask."""
    active = classify(user_text)
    continuity = bool(_CONTINUITY.search(user_text or ""))
    ask_tokens = _tokens(user_text)
    pairs = _pairs(history)
    total = len(pairs)
    ranked: list[tuple[float, int, dict | None, dict | None, frozenset[Topic]]] = []

    for idx, (user_row, assistant_row, topics) in enumerate(pairs):
        user_text_prev = (user_row or {}).get("content") or ""
        assist_text = (assistant_row or {}).get("content") or ""
        score = _score(
            topics=topics,
            active=active,
            user_text=user_text_prev,
            assist_text=assist_text,
            ask_tokens=ask_tokens,
            index=idx,
            total=max(total, 1),
        )
        if score < 0:
            continue
        ranked.append((score, idx, user_row, assistant_row, topics))

    if continuity and not ranked and pairs:
        user_row, assistant_row, topics = pairs[-1]
        assist_text = (assistant_row or {}).get("content") or ""
        if not (assistant_row and is_zombie_reply(assist_text) and "secret" not in active and "identity" not in active):
            ranked = [(1.0, total - 1, user_row, assistant_row, topics)]

    ranked.sort(key=lambda row: (-row[0], -row[1]))
    # Keep chronological order among the winners.
    winners = sorted(ranked[: max(1, max_messages // 2 + 1)], key=lambda row: row[1])

    # Older on-topic losers → one extractive compact line (Claude-style focus note).
    kept_idx = {row[1] for row in winners}
    dropped_on_topic = [
        row for row in ranked if row[1] not in kept_idx and _overlap(row[4], active)
    ]
    compact_bits: list[str] = []
    for _score_v, _idx, user_row, assistant_row, _topics in dropped_on_topic[-3:]:
        snippet = ((user_row or {}).get("content") or "")[:80]
        if snippet:
            compact_bits.append(snippet.strip())

    flat: list[dict] = []
    sticky_src: list[str] = [user_text]
    for i, (_score_v, idx, user_row, assistant_row, _topics) in enumerate(winners):
        keep_tools = i >= len(winners) - 1  # only the freshest kept pair keeps tool dumps
        if user_row:
            flat.append(user_row)
            sticky_src.append(user_row.get("content") or "")
        if assistant_row:
            text = _prune_tools(assistant_row.get("content") or "", keep_recent=keep_tools)
            if (
                is_zombie_reply(text)
                and "identity" not in active
                and "secret" not in active
            ):
                continue
            flat.append({**assistant_row, "content": text})
            sticky_src.append(text)

    if max_messages > 0 and len(flat) > max_messages:
        flat = flat[-max_messages:]

    notes: list[str] = []
    if compact_bits:
        notes.append(
            "Earlier on-topic turns (compacted): " + " | ".join(compact_bits) + "."
        )
    paths = _sticky_paths(*sticky_src)
    if paths:
        notes.append("Sticky paths from this thread: " + ", ".join(paths) + ".")
    note = " ".join(notes)
    return HistoryBundle(messages=flat, note=note)


def scrub_history(history: list[dict], user_text: str) -> list[dict]:
    """Public entry used by chat turns."""
    return select_relevant_history(history, user_text)
