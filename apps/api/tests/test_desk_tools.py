from app.chat.approval import shell_needs_approval
from app.chat.desk_tools import extract_tools, format_tool_observations, parse_patch
from app.chat.work_state import WORK_REL, write_work_state
from app.config import get_settings
from app.edge.files import fs_root


def test_extract_tools_mixed_fences():
    text = (
        "Looking.\n"
        "```list\nsrc\n```\n"
        "```read\nsrc/a.py\n```\n"
        "```run\necho hi\n```\n"
    )
    display, calls = extract_tools(text)
    assert display == "Looking."
    assert [c.kind for c in calls] == ["list", "read", "run"]
    assert calls[2].body == "echo hi"


def test_extract_tools_caps():
    chunks = "".join(f"```list\n{i}\n```\n" for i in range(6))
    _, calls = extract_tools(chunks)
    assert len(calls) == 4


def test_parse_patch():
    body = "apps/api/app/x.py\n<<<<<<<\nold\n=======\nnew\n>>>>>>>"
    parsed = parse_patch(body)
    assert parsed == {"path": "apps/api/app/x.py", "old": "old", "new": "new"}


def test_shell_approval_policy():
    assert not shell_needs_approval("git status")
    assert not shell_needs_approval("pytest -q")
    assert not shell_needs_approval("ls -la")
    assert shell_needs_approval("rm -rf /tmp/x")
    assert shell_needs_approval("git push origin main")
    assert shell_needs_approval("sudo apt install foo")
    assert not shell_needs_approval("npm install lodash")
    assert shell_needs_approval(
        "npm create vite@latest Projects/desk-react-demo -- --template react"
    )
    # Bare python -c is gated — models were wiping Projects/ via shutil.rmtree.
    assert shell_needs_approval(
        "python3 -c \"import shutil; from pathlib import Path; shutil.rmtree(Path('Projects/todo-app'))\""
    )
    assert not shell_needs_approval("python3 --version")


def test_repair_intent_does_not_auto_wipe():
    from app.chat.desk_tools import extract_tools, infer_board_tools, tools_match_intent

    ask = (
        "Something is wrong with my application at Projects/todo-app. "
        "Diagnose the problem, fix it. The Vite app is at http://127.0.0.1:5174."
    )
    planned = infer_board_tools(ask)
    assert planned and planned[0].kind == "read"
    assert "todo-app" in planned[0].body
    assert all("rmtree" not in (c.body or "") for c in planned)
    assert tools_match_intent(ask, planned)

    fence = (
        "```patch\nProjects/todo-app/src/App.jsx\n<<<<<<<\n"
        "saveItemz(next)\n=======\nsaveItems(next)\n>>>>>>>\n```"
    )
    _display, calls = extract_tools(fence)
    assert calls and calls[0].kind == "patch"
    assert calls[0].needs_approval is True


def test_scaffold_intent_still_plans_create_without_wipe():
    from app.chat.desk_tools import infer_board_tools

    planned = infer_board_tools("crea un proyecto vite en Projects/demo-app")
    assert planned
    assert all(c.kind == "run" for c in planned)
    assert any("npm create vite" in c.body for c in planned)
    assert all("rmtree" not in c.body for c in planned)


def test_suggest_typo_patch_from_reads():
    from app.chat.desk_tools import suggest_typo_patch_from_reads

    content = (
        "function saveItems(items) {\n  localStorage.setItem('x', items)\n}\n"
        "function persist(next) {\n    saveItemz(next)\n}\n"
    )
    call = suggest_typo_patch_from_reads(
        [{"kind": "read", "ok": True, "path": "Projects/todo-app/src/App.jsx", "content": content}]
    )
    assert call is not None
    assert call.kind == "patch"
    assert call.needs_approval is True
    assert "saveItemz(next)" in call.body
    assert "saveItems(next)" in call.body


def test_format_observations_read_and_skip():
    text = format_tool_observations(
        [
            {"kind": "read", "ok": True, "path": "a.txt", "content": "hello"},
            {"kind": "run", "skipped": True, "reason": "denied", "command": "rm -rf x"},
        ]
    )
    assert "read a.txt" in text
    assert "hello" in text
    assert "skipped" in text


def test_work_state_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("DESK_FS_ROOT", str(tmp_path))
    get_settings.cache_clear()
    try:
        write_work_state("## Now\nShip P0\n\n## Done\n(none)\n")
        path = fs_root() / WORK_REL
        assert path.is_file()
        body = path.read_text(encoding="utf-8")
        assert "kind: work" in body
        assert "Ship P0" in body
    finally:
        get_settings.cache_clear()
