from unittest.mock import MagicMock, patch

from app.chat.run_tools import (
    _values_equal,
    equality_checks,
    extract_runs,
    format_equality_reply,
    format_observations,
)
from app.edge.cli import run_command


def test_extract_runs_strips_fence():
    display, commands = extract_runs(
        "Checking now.\n```run\nnode -e 'process.exit(process.env.TEST===\"testo\"?0:1)'\n```\n"
    )
    assert display == "Checking now."
    assert commands == ["node -e 'process.exit(process.env.TEST===\"testo\"?0:1)'"]


def test_extract_runs_caps_and_ignores_empty():
    text = "```run\n\n```\n```run\necho one\n```\n```run\necho two\n```\n```run\necho three\n```"
    display, commands = extract_runs(text)
    assert display == ""
    assert commands == ["echo one", "echo two"]


def test_equality_checks_from_natural_language():
    assert equality_checks("Compare if the TEST secret is equal to 'testo'", ["TEST"]) == [
        ("TEST", "testo")
    ]


def test_format_equality_reply_true_false():
    ask_ok = "Compare if the TEST secret is equal to 'testo'"
    ask_no = "Compare if the TEST secret is equal to 'nope'"
    db = MagicMock()
    with patch("app.chat.run_tools.secret_map", return_value={"TEST": "testo"}):
        hit = format_equality_reply(db, 1, ask_ok, ["TEST"])
        miss = format_equality_reply(db, 1, ask_no, ["TEST"])
    assert hit is not None and hit.startswith("true —")
    assert "matches" in hit
    # Matching reply must NOT echo the candidate (that would leak the vault value).
    assert "testo" not in hit
    assert miss is not None and miss.startswith("false —")
    assert "does not match" in miss and "nope" in miss
    assert "••••" not in miss and "...." not in miss
    assert format_equality_reply(db, 1, "list files in home", ["TEST"]) is None


def test_equality_checks_ignores_file_tasks():
    """Do not hijack ordinary list/check language into a vault compare."""
    assert equality_checks("check the files in home and list env", ["TEST"]) == []
    assert equality_checks("verify the deploy on Kratos", ["TEST"]) == []


def test_values_equal_is_constant_time_digest():
    assert _values_equal("testo", "testo")
    assert not _values_equal("testo", "nope")


def test_run_command_injects_secret_for_code_use():
    check = "python -c \"import os,sys; sys.exit(0 if os.environ.get('TEST')=='testo' else 1)\""
    assert run_command(check, secrets={"TEST": "testo"})["exit_code"] == 0
    assert run_command(check, secrets={"TEST": "other"})["exit_code"] == 1
    leaked = run_command(
        "python -c \"import os; print(os.environ.get('TEST',''))\"",
        secrets={"TEST": "super-secret-value"},
    )
    assert "super-secret-value" not in leaked["stdout"]
    assert "••••" in leaked["stdout"]


def test_format_observations_includes_exit():
    text = format_observations(
        [{"command": "echo hi", "exit_code": 0, "stdout": "hi", "stderr": "", "timed_out": False}]
    )
    assert "exit 0" in text
    assert "$ echo hi" in text
