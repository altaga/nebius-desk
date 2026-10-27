"""One remote command on the Jetson, in the desk file root."""

from __future__ import annotations

import os
import subprocess

from app.edge.files import fs_root
from app.vault.redact import redact

MAX_OUT = 20_000


def run_command(command: str, timeout_s: float = 20, secrets: dict[str, str] | None = None) -> dict:
    root = fs_root()
    hidden = list((secrets or {}).values())
    env = os.environ.copy()
    env.update(secrets or {})
    try:
        proc = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            cwd=str(root),
            env=env,
        )
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout if isinstance(exc.stdout, str) else ""
        return _pack(command, root, None, stdout, "Timed out", True, hidden)
    return _pack(command, root, proc.returncode, proc.stdout or "", proc.stderr or "", False, hidden)


def _pack(command: str, root, code: int | None, stdout: str, stderr: str, timed_out: bool, hidden: list[str]) -> dict:
    return {
        "command": redact(command, hidden),
        "cwd": str(root),
        "exit_code": code,
        "stdout": redact(stdout, hidden)[-MAX_OUT:],
        "stderr": redact(stderr, hidden)[-MAX_OUT:],
        "timed_out": timed_out,
    }
