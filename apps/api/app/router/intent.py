"""Rule router. Runs on the board, before any paid model is called."""

from __future__ import annotations

import re

_GREETING = re.compile(
    r"^(?:hi|hello|hey|yo|hola|buenas(?:\s+(?:tardes|noches|d[ií]as))?|"
    r"gracias|thanks|thank you|ok|okay|vale|perfecto|buen[oa]s?)\b",
    re.I,
)
_SMALLTALK = re.compile(
    r"\b(?:how are you|how'?s it going|what'?s up|who are you|what can you do|"
    r"c[oó]mo est[aá]s|qu[eé] tal|qui[eé]n eres|qu[eé] puedes hacer)\b",
    re.I,
)
_LIGHT = [
    r"\btraduc(e|ir|ci[oó]n|eme)\b",
    r"\btranslate\b",
    r"\b(corrige|fix)\b.{0,40}\b(ortograf[ií]a|typos?|grammar|gram[aá]tica)\b",
    r"\bformat(ea|ear|o)?\b.{0,40}\b(json|yaml|xml|csv|markdown|tabla|table)\b",
    r"\b(resume|summari[sz]e)\b.{0,40}\b(brevemente|briefly|en una l[ií]nea|in one line)\b",
]
_HEAVY = [
    r"\barquitect(ura|ure)\b",
    r"\brefactori?[sz]?\w*\b",
    r"\bmulti[- ]?agent\w*\b",
    r"\bstep[- ]by[- ]step\b",
    r"\bpaso a paso\b",
    r"\brazon(a|amiento)\b",
    r"\b(plan|planea|planifica)\b.{0,80}\b(task|tarea|project|proyecto|migration|migraci[oó]n|system|sistema)\b",
    r"\bdesign\b.{0,40}\b(system|api|schema|architecture)\b",
    r"\bdiseñ(a|ar|o)\b.{0,40}\b(sistema|api|esquema|arquitectura)\b",
    r"\b(prove|demuestra|debug|depura)\b",
    r"\b(stack\s*trace|traceback|segmentation fault)\b",
]


def route_tier(user_text: str) -> tuple[str, str]:
    """Return local, fast, or heavy, plus a short reason the desk can show."""
    text = user_text.strip()
    lowered = text.lower()
    words = re.findall(r"\S+", lowered)
    heavy = any(re.search(pattern, lowered, re.I) for pattern in _HEAVY) or len(text) > 2500
    if heavy:
        return "heavy", "hard request — Nemotron Super"
    light = any(re.search(pattern, lowered, re.I) for pattern in _LIGHT)
    greeting = bool(_GREETING.search(lowered))
    smalltalk = bool(_SMALLTALK.search(lowered))
    if (light or greeting or smalltalk) and len(words) <= 40 and "```" not in text:
        return "local", "short request — kept on the Jetson"
    return "fast", "everyday request — Nemotron Lightning"
