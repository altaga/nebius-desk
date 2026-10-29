"""Human approval for sensitive board actions — never auto-run destructive shell."""

from __future__ import annotations

import asyncio
import re
import time
import uuid
from dataclasses import dataclass, field

# Soft allowlist: run without prompting when the whole command matches.
_SAFE = re.compile(
    r"(?x)^\s*("
    r"ls\b|pwd\b|whoami\b|uname\b|date\b|echo\b|cat\b|head\b|tail\b|wc\b|"
    r"rg\b|grep\b|find\b|file\b|stat\b|du\b|df\b|"
    r"git\s+(status|diff|log|show|branch|remote|rev-parse)\b|"
    r"pytest\b|python\s+-m\s+pytest\b|"
    # Node/Vite project scaffold + local preview (no sudo / no publish).
    # Optional: cd <rel> && … / npm --prefix <rel> … / nvm.sh prelude.
    r"(?:export\s+NVM_DIR=\S+\s*;\s*(?:\.\s+\"?\$NVM_DIR/nvm\.sh\"?\s*;\s*)?)?"
    r"(?:cd\s+[\w./-]+\s+&&\s+)?"
    r"npm\s+(?:--prefix\s+[\w./-]+\s+)?"
    r"(test|run\s+(test|dev|build|start|preview)|install|i|ci|ls|outdated)\b|"
    # `npm create` / create-vite need approval — hero-repair models were
    # scaffolding over an existing broken app instead of patching it.
    r"npx\s+(--yes\s+)?serve\b|"
    r"nohup\s+npm\s+(?:--prefix\s+[\w./-]+\s+)?run\s+(dev|start|preview)\b|"
    r"node\s+(-v|-e|--version)\b|npm\s+(-v|--version)\b|"
    # Intentionally NOT allowing bare `python3 -c` — it can shutil.rmtree /
    # open-write arbitrary paths without an approval gate.
    r"python3?\s+(-V|--version)\b|"
    r"which\b|type\b|command\s+-v\b|"
    r"pkill\s+-f\s+vite\b|"
    r"mkdir\s+-p\b|"
    r"test\s+-[efd]\b|"
    r"curl\s+-sS?\s+(-o\s+/dev/null\s+)?(-w\s+'[^']*'\s+)?http://127\.0\.0\.1\b"
    r")",
    re.I,
)

_DANGER = re.compile(
    r"(?ix)"
    r"\b(sudo|rm\s+(-[a-zA-Z]*f|-[a-zA-Z]*r)|rm\s+-rf|git\s+push|git\s+reset\s+--hard|"
    r"git\s+clean\s+-f|mkfs|dd\s+if=|chmod\s+777|chown\b|"
    r"drop\s+table|migrate\b|wrangler\s+deploy|vercel\s+deploy|"
    r"kubectl\s+delete|docker\s+system\s+prune|"
    r"shutdown\b|reboot\b|mkfs\b|"
    r"shutil\.rmtree|pathlib\.Path\(.*\)\.unlink|os\.remove|os\.rmdir)\b"
    r"|(?:curl|wget)\b.*\|\s*(?:ba)?sh\b"
)


@dataclass
class PendingApproval:
    id: str
    user_id: int
    session_id: str
    actions: list[dict]
    created_at: float = field(default_factory=time.monotonic)
    decision: str | None = None  # "approve" | "deny"
    event: asyncio.Event = field(default_factory=asyncio.Event)


_PENDING: dict[str, PendingApproval] = {}
# Hero demos need time to notice the Approve card; keep pending longer than the wait.
_TTL_SEC = 600.0


def pending_for_session(session_id: str, user_id: int) -> PendingApproval | None:
    """Newest unresolved approval for this chat (for status poll / UI restore)."""
    _prune()
    matches = [
        item
        for item in _PENDING.values()
        if item.session_id == session_id and item.user_id == user_id and item.decision is None
    ]
    if not matches:
        return None
    return max(matches, key=lambda item: item.created_at)


def shell_needs_approval(command: str) -> bool:
    cmd = (command or "").strip()
    if not cmd:
        return False
    if _DANGER.search(cmd):
        return True
    if _SAFE.match(cmd):
        return False
    # Unknown shell: ask. Safer default on a real board.
    return True


def create_pending(*, user_id: int, session_id: str, actions: list[dict]) -> PendingApproval:
    _prune()
    item = PendingApproval(
        id=str(uuid.uuid4()),
        user_id=user_id,
        session_id=session_id,
        actions=actions,
    )
    _PENDING[item.id] = item
    return item


def get_pending(approval_id: str) -> PendingApproval | None:
    _prune()
    return _PENDING.get(approval_id)


def resolve(approval_id: str, user_id: int, decision: str) -> PendingApproval:
    item = get_pending(approval_id)
    if item is None:
        raise KeyError("approval not found or expired")
    if item.user_id != user_id:
        raise PermissionError("approval belongs to another user")
    if decision not in ("approve", "deny"):
        raise ValueError("decision must be approve or deny")
    item.decision = decision
    item.event.set()
    return item


async def wait_decision(item: PendingApproval, *, timeout: float = 300.0) -> str:
    try:
        await asyncio.wait_for(item.event.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        item.decision = item.decision or "deny"
        item.event.set()
    return item.decision or "deny"


def drop(approval_id: str) -> None:
    _PENDING.pop(approval_id, None)


def _prune() -> None:
    now = time.monotonic()
    dead = [k for k, v in _PENDING.items() if now - v.created_at > _TTL_SEC and v.event.is_set()]
    for key in dead:
        _PENDING.pop(key, None)
