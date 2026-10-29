from app.chat.history import (
    build_history,
    is_zombie_reply,
    scrub_history,
    wants_file_list,
)


def test_zombie_detects_identity_plus_test():
    text = "I am Millie, running Nemotron Nano on Nebius.\nThe TEST secret is not equal to 'testo'."
    assert is_zombie_reply(text)


def test_scrub_drops_secret_thread_for_file_ask():
    """Task-boundary cut: vault digression must not pollute a file listing ask."""
    history = [
        {"role": "user", "content": "is TEST equal to testo?"},
        {
            "role": "assistant",
            "content": "I am Millie, running Nemotron Nano on Nebius.\nThe TEST secret is not equal to 'testo'.",
        },
        {"role": "user", "content": "ok thanks"},
        {"role": "assistant", "content": "Here are the files:\n- a\n- b"},
    ]
    ask = "Enumerame los primeros 10 archivos de la carpeta que este en home"
    cleaned = scrub_history(history, ask)
    blob = "\n".join(m["content"] for m in cleaned)
    assert "TEST secret" not in blob
    assert "I am Millie" not in blob
    assert "files" in blob.lower() or "a" in blob


def test_wants_file_list_spanish():
    assert wants_file_list("Enumerame los primeros 10 archivos de la carpeta que este en home")
    assert not wants_file_list("is the TEST secret equal to 'testo'?")


def test_prunes_old_tool_fences_keeps_recent():
    history = [
        {
            "role": "user",
            "content": "list files in home",
        },
        {
            "role": "assistant",
            "content": "Listing now.\n```list\n.\n```\na\nb\nc",
        },
        {
            "role": "user",
            "content": "list files again please",
        },
        {
            "role": "assistant",
            "content": "Again:\n```list\n.\n```\nx\ny",
        },
    ]
    bundle = build_history(history, "muéstrame más archivos del home", max_messages=8)
    texts = [m["content"] for m in bundle.messages if m["role"] == "assistant"]
    assert texts, "expected at least one assistant turn kept"
    # Oldest tool dump cleared; freshest may remain.
    if len(texts) >= 2:
        assert "prior board tool result cleared" in texts[0] or "```list" not in texts[0]


def test_continuity_keeps_last_useful_turn():
    history = [
        {"role": "user", "content": "explain photosynthesis briefly"},
        {"role": "assistant", "content": "Plants turn light into sugar."},
    ]
    cleaned = scrub_history(history, "también en una frase")
    assert any("photosynthesis" in (m.get("content") or "") or "Plants" in (m.get("content") or "") for m in cleaned)
