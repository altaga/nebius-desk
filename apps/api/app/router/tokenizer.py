"""Cheap token estimate — avoid tiktoken dependency (keeps Jetson lean)."""


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    # ~4 chars/token for English/code mix; good enough for budget telemetry
    return max(1, len(text) // 4)


def estimate_messages_tokens(messages: list[dict]) -> int:
    total = 0
    for m in messages:
        total += estimate_tokens(str(m.get("content", "")))
        total += 4  # role/framing overhead
    return total
