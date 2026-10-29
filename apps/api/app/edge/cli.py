"""One remote command on the Jetson, in the desk file root."""

from __future__ import annotations

import os
import subprocess

from app.edge.files import fs_root
from app.vault.redact import redact

MAX_OUT = 20_000


def _timeout_for(command: str, default: float) -> float:
    """Installers and scaffolds need more than the interactive default."""
    c = (command or "").lower()
    if any(
        tok in c
        for tok in (
            "npm install",
            "npm i ",
            "npm ci",
            "npm create",
            "npx create-",
            "pip install",
            "--prefix",  # npm --prefix <dir> install|ci
        )
    ) or (c.strip().startswith("npm") and " install" in f" {c}"):
        return max(default, 600.0)
    if "npm run" in c or c.strip().startswith("nohup"):
        return max(default, 90.0)
    return default


def _with_nvm_path(env: dict[str, str]) -> dict[str, str]:
    """Prefer nvm's current node/npm when the interactive profile is not sourced."""
    home = env.get("HOME") or os.path.expanduser("~")
    nvm_bin = os.path.join(home, ".nvm", "versions", "node")
    if not os.path.isdir(nvm_bin):
        return env
    # Pick the newest installed version directory.
    versions = sorted(
        (d for d in os.listdir(nvm_bin) if d.startswith("v")),
        reverse=True,
    )
    if not versions:
        return env
    bin_dir = os.path.join(nvm_bin, versions[0], "bin")
    if not os.path.isdir(bin_dir):
        return env
    path = env.get("PATH") or ""
    if bin_dir not in path.split(":"):
        env = {**env, "PATH": f"{bin_dir}:{path}", "NVM_DIR": os.path.join(home, ".nvm")}
    return env


def run_command(command: str, timeout_s: float = 45, secrets: dict[str, str] | None = None) -> dict:
    timeout_s = _timeout_for(command, timeout_s)
    root = fs_root()
    hidden = list((secrets or {}).values())
    env = _with_nvm_path(os.environ.copy())
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
