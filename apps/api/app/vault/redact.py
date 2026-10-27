"""Strip secret values out of text the desk is about to show."""

from __future__ import annotations


def redact(text: str, secrets: list[str]) -> str:
    if not text or not secrets:
        return text
    cleaned = text
    for secret in sorted({item for item in secrets if item}, key=len, reverse=True):
        cleaned = cleaned.replace(secret, "••••")
    return cleaned


class StreamRedactor:
    """Hide a secret even when it arrives split across terminal chunks."""

    def __init__(self, secrets: list[str]) -> None:
        self._secrets = sorted({item for item in secrets if len(item) >= 4}, key=len, reverse=True)
        self._hold = ""

    def feed(self, text: str) -> str:
        combined = redact(self._hold + text, self._secrets)
        hold = _prefix_hold(combined, self._secrets)
        self._hold = combined[-hold:] if hold else ""
        return combined[:-hold] if hold else combined

    def flush(self) -> str:
        out = redact(self._hold, self._secrets)
        self._hold = ""
        return out


def _prefix_hold(text: str, secrets: list[str]) -> int:
    hold = 0
    for secret in secrets:
        limit = min(len(secret) - 1, len(text))
        for size in range(limit, 0, -1):
            if text.endswith(secret[:size]):
                hold = max(hold, size)
                break
    return hold
