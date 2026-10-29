"""Chat can USE execution secrets via shell — never READ them.

The model emits a ```run fence; we inject the vault as env, run on the board,
and return redacted stdout/stderr plus the exit code.

Simple equality questions ("is TEST equal to 'x'?") are resolved on the board
before the model answers, so small models can USE the keychain without guessing.
"""

from __future__ import annotations

import hashlib
import hmac
import re

from sqlalchemy.orm import Session

from app.edge.cli import run_command
from app.subscription.service import is_active as subscription_active
from app.vault.service import secret_map

_FENCE = re.compile(r"```run\s*([\s\S]*?)```", re.I)
_MAX_RUNS = 2
_MAX_CMD = 4000
# Tight: only deliberate secret comparisons — not "check the files" / "verify deploy".
_COMPARE_VERB = re.compile(
    r"(?i)\b(?:"
    r"compare|equals?|igual(?:es)?|igual\s+a|"
    r"(?:is|es)\s+(?:the\s+)?(?:secret\s+)?[A-Za-z_][\w]*\s+(?:equal|igual)"
    r")\b|=="
)
_QUOTED = re.compile(r"['\"]([^'\"]+)['\"]")
_WORD = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]{0,63})\b")
_SECRET_ASK = re.compile(
    r"(?i)\b(?:secret|secrets|keychain|llavero|env(?:ironment)?\s*var|"
    r"variable(?:s)?\s+de\s+entorno)\b"
)


def extract_runs(text: str) -> tuple[str, list[str]]:
    """Strip ```run fences and return (display_text, commands)."""
    commands: list[str] = []

    def _take(match: re.Match[str]) -> str:
        body = (match.group(1) or "").strip()
        if body and len(body) <= _MAX_CMD:
            commands.append(body)
        return ""

    cleaned = _FENCE.sub(_take, text or "")
    cleaned = re.sub(r"```run\s*[\s\S]*$", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned, commands[:_MAX_RUNS]


def run_board_commands(db: Session, user_id: int, commands: list[str]) -> list[dict]:
    if not commands:
        return []
    if not subscription_active(db, user_id):
        return [
            {
                "command": cmd,
                "cwd": "",
                "exit_code": None,
                "stdout": "",
                "stderr": "Desk subscription is inactive — shell use is closed.",
                "timed_out": False,
            }
            for cmd in commands
        ]
    secrets = secret_map(db, user_id)
    return [run_command(cmd, secrets=secrets) for cmd in commands]


def format_observations(results: list[dict]) -> str:
    blocks: list[str] = []
    for item in results:
        code = item.get("exit_code")
        status = "timeout" if item.get("timed_out") else f"exit {code}"
        stdout = (item.get("stdout") or "").strip()
        stderr = (item.get("stderr") or "").strip()
        lines = [f"$ {item.get('command')}", f"({status})"]
        if stdout:
            lines.append(stdout)
        if stderr:
            lines.append(stderr)
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def equality_checks(user_text: str, names: list[str]) -> list[tuple[str, str]]:
    """Parse (secret_name, candidate) pairs the user asked to compare.

    Requires an explicit compare verb AND a quoted/candidate value AND a known secret name.
    Does not fire on ordinary 'check/verify' task language.
    """
    text = user_text or ""
    if not names or not _COMPARE_VERB.search(text):
        return []
    known = {name.upper(): name for name in names}
    # Prefer quoted candidates; unquoted only with clear "to/con/with/=" anchor.
    candidates = _QUOTED.findall(text)
    if not candidates:
        tail = re.search(r"(?i)(?:to|con|with|=)\s+([^\s'\"`,.!?]+)", text)
        if tail:
            candidates = [tail.group(1)]
    if not candidates:
        return []
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    for raw_name in _WORD.findall(text):
        real = known.get(raw_name.upper())
        if not real:
            continue
        for candidate in candidates:
            # Ignore candidate that is just another secret name with no compare intent noise.
            if candidate.upper() in known and candidate.upper() == real.upper():
                continue
            key = f"{real}={candidate}"
            if key in seen:
                continue
            seen.add(key)
            found.append((real, candidate))
            if len(found) >= _MAX_RUNS:
                return found
    return found


def _values_equal(actual: str, candidate: str) -> bool:
    left = hashlib.sha256(actual.encode()).digest()
    right = hashlib.sha256(candidate.encode()).digest()
    return hmac.compare_digest(left, right)


def resolve_equality(db: Session, user_id: int, user_text: str, names: list[str]) -> str | None:
    """USE the keychain in-process: boolean match only, never expose values to the model."""
    checks = equality_checks(user_text, names)
    if not checks:
        return None
    secrets = secret_map(db, user_id)
    lines = [
        "Board keychain USE already ran for this turn (values never leave the vault). "
        "Report equal/different from these results; do not invent values; "
        "do not emit another ```run fence for the same check."
    ]
    for name, candidate in checks:
        actual = secrets.get(name)
        if actual is None:
            lines.append(f"{name}=missing")
        elif _values_equal(actual, candidate):
            lines.append(f"{name}=equal")
        else:
            lines.append(f"{name}=different")
    return "\n".join(lines)


def format_equality_reply(db: Session, user_id: int, user_text: str, names: list[str]) -> str | None:
    """Operator-facing true/false for a secret compare — never echo vault values.

    Small models often try to print the secret (then redaction turns it into ••••).
    When the user asked a deliberate compare, answer on the board instead.
    """
    checks = equality_checks(user_text, names)
    if not checks:
        return None
    secrets = secret_map(db, user_id)
    parts: list[str] = []
    for name, candidate in checks:
        # Never echo a matching candidate — that would print the vault value.
        # On mismatch, the candidate is safe to quote (user typed it; it is wrong).
        shown = candidate.replace("`", "'")
        actual = secrets.get(name)
        if actual is None:
            parts.append(
                f"false — There is no secret named `{name}` on the board keychain, "
                f"so it cannot equal the candidate you gave."
            )
        elif _values_equal(actual, candidate):
            parts.append(
                f"true — `{name}` matches the candidate you gave. "
                "The vault value itself is never shown."
            )
        else:
            parts.append(
                f"false — `{name}` does not match `{shown}`. "
                "The vault value itself is never shown."
            )
    return "\n\n".join(parts)
