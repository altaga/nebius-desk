from app.guide.actions import gate_actions, parse_guide_reply


def test_parse_strips_fence_and_keeps_text():
    text, actions = parse_guide_reply(
        'Open Terminal.\n\n```guide\n{"actions":[{"type":"react","emotion":"determined"},{"type":"open_terminal"},{"type":"highlight","target":"machine.terminal"}]}\n```\n'
    )
    assert "Open Terminal" in text
    assert "```" not in text
    assert actions == [
        {"type": "react", "emotion": "determined"},
        {"type": "open_terminal"},
        {"type": "highlight", "target": "machine.terminal"},
    ]


def test_react_alone_and_name_alias():
    text, actions = parse_guide_reply(
        'Hi!\n```guide\n{"actions":[{"type":"react","name":"happy"}]}\n```'
    )
    assert text == "Hi!"
    assert actions == [{"type": "react", "emotion": "happy"}]


def test_rejects_forbidden_actions():
    assert gate_actions([{"type": "run_shell", "cmd": "ls"}, {"type": "open_chat"}]) == [{"type": "open_chat"}]
    assert gate_actions([{"type": "highlight", "target": "evil"}]) == []
    assert gate_actions([{"type": "react", "emotion": "rage"}]) == []


def test_fence_only_reply_does_not_leak_json():
    text, actions = parse_guide_reply(
        '```guide\n{"actions":[{"type":"react","emotion":"determined"},{"type":"open_panel","target":"panel.board"}]}\n```'
    )
    assert text == ""
    assert "```" not in text
    assert actions == [
        {"type": "react", "emotion": "determined"},
        {"type": "open_panel"},
    ]


def test_bare_actions_json_is_stripped():
    text, actions = parse_guide_reply(
        '{"actions":[{"type":"react","emotion":"happy"},{"type":"open_board"}]}'
    )
    assert text == ""
    assert actions == [
        {"type": "react", "emotion": "happy"},
        {"type": "open_board"},
    ]
