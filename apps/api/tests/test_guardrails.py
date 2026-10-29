from app.chat.guardrails import (
    factual_reply_from_tools,
    is_fabricated_board_report,
    mkdir_target,
    needs_board_tools,
    strip_fabricated_board_report,
    wants_mkdir,
)


def test_detects_alice_board_summary():
    text = (
        "```bash\nmkdir -p /home/millie/Projects\n```\n\n"
        "**Board Summary**\n\n| Board | Operator |\n| Kratos | Alice |"
    )
    assert is_fabricated_board_report(text)
    cleaned = strip_fabricated_board_report(text)
    assert cleaned == "" or "Alice" not in cleaned
    assert "Board Summary" not in cleaned


def test_mkdir_target_strips_fake_home():
    assert wants_mkdir("Crea una carpeta llamada /Projects")
    assert mkdir_target("Crea una carpeta llamada /Projects") == "Projects"
    assert mkdir_target("mkdir -p Projects") == "Projects"
    assert mkdir_target("mkdir -p Projects/desk-react-demo") == "Projects/desk-react-demo"
    assert mkdir_target("crea la carpeta Projects/desk-react-demo") == "Projects/desk-react-demo"
    assert mkdir_target("crea la carpeta Projects/../etc") is None


def test_needs_board_tools():
    assert needs_board_tools("instala node y crea un proyecto vite")
    assert needs_board_tools("abre http://127.0.0.1:5173 con playwright")
    assert not needs_board_tools("qué hora es en Tokio")


def test_factual_reply_from_list_tool():
    text = factual_reply_from_tools(
        [
            {
                "kind": "list",
                "ok": True,
                "path": ".",
                "entries": [
                    {"name": "Desktop", "kind": "dir"},
                    {"name": ".bashrc", "kind": "file"},
                ],
            }
        ]
    )
    assert "Folders:" in text and "Desktop/" in text
    assert "Files:" in text and ".bashrc" in text
    assert "Alice" not in text
    assert "/home/altaga/nebius-desk" not in text


def test_factual_reply_mkdir_is_friendly():
    text = factual_reply_from_tools(
        [
            {
                "kind": "run",
                "exit_code": 0,
                "command": '/home/altaga/nebius-desk/apps/api/.venv/bin/python3 -c "from pathlib import Path; p=Path(\'Projects\'); p.mkdir(parents=True, exist_ok=True); print(\'created\', p.as_posix())"',
                "stdout": "created Projects\n",
                "stderr": "",
            }
        ]
    )
    assert "Projects" in text
    assert "created" in text.lower() or "Done" in text
    assert ".venv" not in text
    assert "pathlib" not in text
