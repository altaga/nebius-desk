"""Structured desk tools emitted as fenced blocks in the model reply.

Supported fences (in document order):
  ```run …```      board shell (vault env + redact)
  ```read path```   read file under desk root
  ```list path```   list directory
  ```patch …```     scoped single-match edit
  ```search …```    Tavily web search
  ```work …```      rewrite .desk/WORK.md
  ```probe …```     me-vs-service network probe
  ```health```      board GPU/RAM/temp snapshot
  ```verify …```    run .desk/verify.json (optional repeats:)
  ```deploy```      recipe deploy → verify → rollback on fail
  ```checks```      lint/type/vuln gate from .desk/checks.json
  ```bakeoff```     latency bakeoff → .desk/bakeoff-report.md
  ```browse …```    Playwright on the board (screenshots under .desk/browser/)
  ```record …```    scripted demo video of a page → Demos/ (webm|mp4|gif)
  ```render …```    HTML/SVG → PNG/JPEG under the desk root (default Images/)
  ```job …```       enqueue durable background job
  ```install …```   search official sources → trust-check → vetted install recipe
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.browser import demo as browser_demo
from app.browser import runtime as browser_runtime
from app.chat.approval import shell_needs_approval
from app.chat.run_tools import run_board_commands
from app.chat.safe_install import command_looks_malicious, plan_install, search_query_for
from app.chat.work_state import write_work_state
from app.edge import files as edge_files
from app.edge.monitor import snapshot
from app.jobs import runner as job_runner
from app.jobs.bakeoff import run_bakeoff
from app.jobs.checks import run_checks
from app.jobs.probe import probe_target
from app.jobs.recipes import run_deploy
from app.jobs.service import enqueue, job_out
from app.jobs.verify import run_verify
from app.subscription.service import is_active as subscription_active
from app.subscription.service import tavily_allowance
from app.config import get_settings
from app.tools.credits import TavilyCapReached
from app.tools.tavily import web_search
from app.vault.service import secret_map

log = logging.getLogger(__name__)

_KINDS = (
    "run|read|list|patch|search|work|probe|health|verify|deploy|checks|bakeoff|browse|record|render|job|install"
)
_FENCE = re.compile(rf"```({_KINDS})\s*([\s\S]*?)```", re.I)
_MAX_TOOLS = 4
_PATCH_BODY = re.compile(
    r"(?s)^\s*(?P<path>[^\n]+)\n+<<<<<<<\s*\n(?P<old>.*?)\n=======\s*\n(?P<new>.*?)\n>>>>>>>\s*$"
)
_KV = re.compile(r"(?m)^([A-Za-z_][\w-]*)\s*:\s*(.+)$")


@dataclass
class ToolCall:
    kind: str
    body: str
    needs_approval: bool = False

    def summary(self) -> dict:
        out: dict = {"kind": self.kind, "needs_approval": self.needs_approval}
        if self.kind == "run":
            cmd = self.body.strip()[:200]
            out["command"] = cmd
            out["explain"] = f"Run this shell command on the board:\n`$ {cmd}`"
        elif self.kind in ("read", "list"):
            out["path"] = self.body.strip().splitlines()[0][:200] if self.body.strip() else "."
        elif self.kind == "patch":
            parsed = parse_patch(self.body)
            out["path"] = (parsed or {}).get("path", "")[:200]
            if parsed:
                out["old"] = (parsed.get("old") or "")[:800]
                out["new"] = (parsed.get("new") or "")[:800]
                out["explain"] = explain_patch(parsed)
        elif self.kind == "search":
            out["query"] = self.body.strip()[:200]
        elif self.kind == "work":
            out["bytes"] = len(self.body.encode("utf-8"))
        elif self.kind == "probe":
            out["target"] = self.body.strip().splitlines()[0][:200] if self.body.strip() else ""
        elif self.kind == "verify":
            out["repeats"] = parse_kv(self.body).get("repeats")
        elif self.kind == "job":
            out["job_kind"] = parse_kv(self.body).get("kind", "")
        elif self.kind == "browse":
            kv = parse_kv(self.body)
            out["action"] = kv.get("action", "")
            out["url"] = (kv.get("url") or "")[:200]
        elif self.kind == "record":
            out["url"] = (parse_kv(self.body).get("url") or "")[:200]
        elif self.kind == "render":
            out["path"] = (parse_kv(self.body).get("out") or "Images/")[:200]
        elif self.kind == "install":
            kv = parse_kv(self.body)
            out["tool"] = (kv.get("tool") or kv.get("package") or self.body.strip().splitlines()[0][:80])
        return out


def parse_kv(body: str) -> dict[str, str]:
    return {m.group(1).lower(): m.group(2).strip() for m in _KV.finditer(body or "")}


_PROJECT_PATH = re.compile(r"(?i)\b(Projects/[\w.-]+)\b")
_LOCAL_URL = re.compile(r"https?://127\.0\.0\.1:\d{2,5}\S*")
_ANY_URL = re.compile(r"https?://[^\s)>\]]+")
# "grabar" also means "save" and "render" is everyday React talk — require video/image context.
_WANTS_RECORD = re.compile(
    r"(?i)\b(screen ?cast|demo en video|video demo|"
    r"(?:gr[aá]ba\w*|record(?:ing)?)\b[^\n]{0,60}?(?:video|demo|pantalla|screen|https?://|localhost|127\.0\.0\.1))"
)
_WANTS_RENDER = re.compile(
    r"(?i)\b(thumbnail|miniatura|social card|og image|"
    r"render\w*\s+(?:an?\s+|una?\s+)?(?:image|imagen|png|jpg|svg|banner|diagram\w*))"
)


_WANTS_WEB = re.compile(
    r"(?i)\btavily\b|\bweb\s+search\b|\bsearch\s+(?:the\s+)?(?:web|internet|online)\b|"
    r"\b(?:busca\w*|investiga\w*|googlea\w*)\b[^\n]{0,30}?\b(?:en\s+)?(?:la\s+)?(?:web|internet|google|l[ií]nea)\b"
)
_WEB_LEAD = re.compile(
    r"(?i)^\s*(?:por\s+favor[, ]+)?(?:busca\w*|investiga\w*|googlea\w*|search)\s+(?:en\s+)?(?:la\s+|the\s+)?"
    r"(?:web|internet|google)?\s*(?:con\s+tavily|with\s+tavily)?\s*(?:y\s+|and\s+)?"
)


def wants_web_search(user_text: str) -> bool:
    return bool(_WANTS_WEB.search(user_text or ""))


def web_query_from(user_text: str) -> str:
    """Strip the 'search the web for' lead so Tavily gets the topic, not the instruction."""
    text = " ".join((user_text or "").split())
    query = _WEB_LEAD.sub("", text).strip(" .?¿!¡") or text
    return query[:300]


def _project_path(text: str, default: str = "Projects/desk-react-demo") -> str:
    m = _PROJECT_PATH.search(text or "")
    return m.group(1) if m else default


_WANTS_SCAFFOLD = re.compile(
    r"(?i)\b(?:"
    r"(?:crea(?:r)?|create|scaffold|nuevo)\s+(?:un\s+|una\s+|a\s+|an\s+)?"
    r"(?:proyecto\s+)?(?:vite|react(?:\s+app)?|app(?:lication)?)"
    r"|npm\s+create\s+vite|create-vite|create\s+vite"
    r")\b"
)
_WANTS_REPAIR = re.compile(
    r"(?i)\b(?:"
    r"diagnos\w*|fix(?:es|ed|ing)?|bug|broken|arregla\w*|repara\w*|"
    r"something is wrong|no funciona|est[aá] roto|typo|ReferenceError"
    r")\b"
)


def wants_repair(user_text: str) -> bool:
    return bool(_WANTS_REPAIR.search(user_text or ""))


def suggest_typo_patch_from_reads(tool_runs: list[dict]) -> ToolCall | None:
    """Build an exact ```patch``` when a read shows a 1-char identifier typo vs a defined name.

    Lightning often invents a non-matching old snippet; constructing the patch from the
    file bytes keeps diagnose→approve→fix reliable for the hero demo.
    """
    for item in tool_runs:
        if item.get("kind") != "read" or not item.get("ok"):
            continue
        content = item.get("content") or ""
        path = (item.get("path") or "").strip()
        if not path or not content:
            continue
        defined = set(re.findall(r"\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)", content))
        defined |= set(re.findall(r"\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=", content))
        used = set(re.findall(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\(", content))
        # Skip the definition occurrence: keep calls that aren't defined.
        for name in sorted(used - defined, key=len, reverse=True):
            if len(name) < 5:
                continue
            # Find a defined name at edit distance 1 (typo).
            for good in defined:
                if len(good) != len(name):
                    continue
                diffs = sum(a != b for a, b in zip(name, good))
                if diffs != 1:
                    continue
                if content.count(name) < 1:
                    continue
                # Patch the first call line that uses the typo (not a comment-only line if possible).
                old_line = next(
                    (
                        ln
                        for ln in content.splitlines()
                        if name in ln and f"function {name}" not in ln and f"const {name}" not in ln
                    ),
                    None,
                )
                if not old_line:
                    continue
                new_line = old_line.replace(name, good)
                body = f"{path}\n<<<<<<<\n{old_line}\n=======\n{new_line}\n>>>>>>>"
                call = ToolCall(kind="patch", body=body)
                call.needs_approval = True
                return call
    return None


def tools_match_intent(user_text: str, calls: list[ToolCall]) -> bool:
    """False when the model emitted something weak (e.g. only ```list```) for a real board task."""
    text = user_text or ""
    kinds = {c.kind for c in calls}
    bodies = " ".join(c.body for c in calls).lower()
    if _WANTS_RECORD.search(text):
        return "record" in kinds
    if _WANTS_RENDER.search(text):
        return bool(kinds & {"render", "run"})
    if wants_web_search(text):
        return "search" in kinds
    # Repair/diagnose must actually inspect or edit code — ```list``` alone is too weak.
    if _WANTS_REPAIR.search(text):
        return bool(kinds & {"read", "patch"})
    if _WANTS_SCAFFOLD.search(text) or re.search(
        r"(?i)\b(npm install|npm create)\b", text
    ):
        return any(c.kind == "run" for c in calls) and (
            "vite" in bodies or "npm" in bodies or "install" in bodies
        )
    if re.search(r"(?i)(npm run dev|nohup|segundo plano|arranca|inicia).{0,40}(dev|vite|5173|servidor)", text) or (
        "5173" in text and re.search(r"(?i)\b(arranca|inicia|start|dev)\b", text)
    ):
        return any(c.kind == "run" for c in calls) and (
            "dev" in bodies or "nohup" in bodies or "5173" in bodies or "vite" in bodies
        )
    if re.search(r"(?i)\b(browse|playwright|screenshot)\b", text) or (
        re.search(r"(?i)\babre\b", text) and _LOCAL_URL.search(text)
    ):
        return "browse" in kinds
    if re.search(r"(?i)\b(node|npm)\b.{0,20}\b(-v|--version)|instala(?:r)?\s+node", text):
        return bool(kinds & {"install", "run", "search"})
    return True


def infer_board_tools(user_text: str) -> list[ToolCall]:
    """Last-resort agentic planner when the LLM narrates instead of fencing."""
    text = user_text or ""
    path = _project_path(text)

    if _WANTS_RECORD.search(text):
        found = _ANY_URL.search(text)
        url = found.group(0) if found else "http://127.0.0.1:5173"
        body = (
            f"url: {url}\nsize: 720p\nformat: mp4\nname: demo\nsteps:\n"
            "- wait 2\n- scroll 600\n- wait 1\n- scroll -600\n- wait 1"
        )
        return [ToolCall(kind="record", body=body)]

    if wants_web_search(text):
        return [ToolCall(kind="search", body=web_query_from(text))]

    if re.search(r"(?i)\b(browse|playwright|screenshot)\b", text) or (
        re.search(r"(?i)\babre\b", text) and _LOCAL_URL.search(text)
    ):
        found = _LOCAL_URL.search(text)
        url = found.group(0) if found else "http://127.0.0.1:5173"
        return [ToolCall(kind="browse", body=f"action: navigate\nurl: {url}")]

    # Diagnose/fix existing apps — never auto-wipe. Prefer read of a likely source file.
    if _WANTS_REPAIR.search(text):
        target = path if "/" in path and path != "Projects/desk-react-demo" else "Projects/todo-app"
        read_path = f"{target}/src/App.jsx"
        if re.search(r"(?i)Projects/[\w./-]+\.\w+", text):
            m = re.search(r"(?i)(Projects/[\w./-]+\.\w+)", text)
            if m:
                read_path = m.group(1)
        elif re.search(r"(?i)Projects/[\w.-]+", text):
            m = re.search(r"(?i)(Projects/[\w.-]+)", text)
            if m:
                read_path = f"{m.group(1).rstrip('/')}/src/App.jsx"
        return [ToolCall(kind="read", body=read_path)]

    # Explicit scaffold only — no silent rmtree (wipe needs operator approval if model asks).
    if _WANTS_SCAFFOLD.search(text):
        create = f"npm create vite@latest {path} -- --template react"
        install = f"npm --prefix {path} install"
        out: list[ToolCall] = []
        for body in (create, install):
            call = ToolCall(kind="run", body=body)
            call.needs_approval = shell_needs_approval(body)
            out.append(call)
        return out

    if re.search(r"(?i)(npm run dev|nohup|segundo plano).{0,60}(5173|dev|vite)", text) or (
        "5173" in text and re.search(r"(?i)\b(arranca|inicia|start)\b", text)
    ):
        body = (
            f"nohup npm --prefix {path} run dev -- --host 127.0.0.1 --port 5173 "
            f"> /tmp/vite-desk.log 2>&1 < /dev/null &"
        )
        call = ToolCall(kind="run", body=body)
        call.needs_approval = shell_needs_approval(body)
        return [call]

    if re.search(r"(?i)\b(node|npm)\b.{0,30}(-v|--version)|instala(?:r)?\s+node|node\.js", text):
        # Prefer confirm; install fence if clearly missing-install ask.
        if re.search(r"(?i)\b(instala|install|si falta|aseg[uú]rate)\b", text):
            return [
                ToolCall(kind="search", body="official Node.js LTS install nvm"),
                ToolCall(kind="install", body="tool: node"),
                ToolCall(kind="run", body="node -v"),
            ]
        call = ToolCall(kind="run", body="node -v")
        return [call]

    return []


def extract_tools(text: str) -> tuple[str, list[ToolCall]]:
    """Strip tool fences; return (display_text, calls in order, capped)."""
    calls: list[ToolCall] = []

    def _take(match: re.Match[str]) -> str:
        kind = (match.group(1) or "").lower()
        body = (match.group(2) or "").strip()
        if not body and kind not in ("list", "health", "deploy", "checks", "bakeoff"):
            return ""
        if kind == "list" and not body:
            body = "."
        call = ToolCall(kind=kind, body=body)
        if kind == "run":
            call.needs_approval = shell_needs_approval(body)
        elif kind == "patch":
            # Code edits always wait for the operator (hero demo + real boards).
            call.needs_approval = True
        elif kind == "deploy":
            call.needs_approval = True
        elif kind == "install":
            # safe_install already re-searches + trusted-host gate — no second human prompt.
            # (Approve over production relay often cannot land while the SSE turn holds the DO.)
            call.needs_approval = False
        calls.append(call)
        return ""

    cleaned = _FENCE.sub(_take, text or "")
    cleaned = re.sub(rf"```(?:{_KINDS})\s*[\s\S]*$", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned, calls[:_MAX_TOOLS]


def parse_patch(body: str) -> dict | None:
    found = _PATCH_BODY.match(body.strip())
    if not found:
        return None
    return {
        "path": found.group("path").strip(),
        "old": found.group("old"),
        "new": found.group("new"),
    }


def explain_patch(parsed: dict) -> str:
    """Human-readable reason shown before Approve — never approve blind."""
    path = (parsed.get("path") or "file").strip() or "file"
    old = (parsed.get("old") or "").strip()
    new = (parsed.get("new") or "").strip()
    # Typo / rename of a single identifier (hero demo: saveItemz → saveItems).
    old_ids = set(re.findall(r"\b([A-Za-z_][A-Za-z0-9_]*)\b", old))
    new_ids = set(re.findall(r"\b([A-Za-z_][A-Za-z0-9_]*)\b", new))
    removed = sorted(old_ids - new_ids)
    added = sorted(new_ids - old_ids)
    if len(removed) == 1 and len(added) == 1 and len(removed[0]) > 3:
        return (
            f"Repair `{path}`: rename `{removed[0]}` → `{added[0]}` "
            f"(undefined name crashes the app on load)."
        )
    if not old and new:
        return f"Repair `{path}`: insert the missing snippet so the app runs again."
    if old and not new:
        return f"Repair `{path}`: remove the broken line that crashes the app."
    return f"Repair `{path}`: replace the broken snippet with a corrected one."


def explain_approval(actions: list[dict]) -> str:
    """Operator-facing summary of gated actions (English)."""
    parts: list[str] = []
    for item in actions or []:
        kind = item.get("kind") or "action"
        if item.get("explain"):
            parts.append(str(item["explain"]))
            continue
        if kind == "patch":
            parts.append(explain_patch(item))
        elif kind == "run" and item.get("command"):
            parts.append(f"Run on the board: `$ {item['command']}`")
        elif item.get("path"):
            parts.append(f"`{kind}` on `{item['path']}`")
        else:
            parts.append(f"`{kind}` (needs your OK)")
    if not parts:
        return "A board action needs your approval before it runs."
    lead = "Here is what I will do if you Approve:"
    return lead + "\n\n" + "\n\n".join(parts)


def tools_prompt() -> str:
    return (
        "Always speak to the operator in English. "
        "Board tools — when the user asks you to act on the board, emit 1–2 fences NOW "
        "(fence body = the real command). Never claim a tool ran unless you emitted it.\n"
        "- Shell (secrets injected as env, never print values):\n"
        "```run\ncommand here\n```\n"
        "Long servers (Vite/npm run dev): background them, e.g.\n"
        "```run\n"
        "nohup npm --prefix Projects/APP run dev -- --host 127.0.0.1 --port 5173 "
        "> /tmp/vite.log 2>&1 < /dev/null &\n"
        "```\n"
        "then ```browse``` navigate to http://127.0.0.1:5173 and screenshot.\n"
        "Repair / diagnose an existing app (preferred): ```read``` the source, then ```patch``` "
        "the minimal fix. Never wipe or recreate a project that already exists.\n"
        "Scaffold a NEW React app only when the user explicitly asks to create one "
        "(empty path; do NOT shutil.rmtree / rm -rf — those need approval and erase work):\n"
        "```run\nnpm create vite@latest Projects/APP -- --template react\n```\n"
        "```run\nnpm --prefix Projects/APP install\n```\n"
        "- Install tooling (node/python/expo/playwright/…): ALWAYS search official docs first, then:\n"
        "```search\nofficial Node.js install nvm\n```\n"
        "```install\ntool: node\n```\n"
        "Never curl|bash from random blogs. ```install``` re-searches, keeps only trusted hosts "
        "(nodejs.org, python.org, docs.expo.dev, nvm-sh/nvm, npmjs.com, pypi.org, …) and refuses the rest.\n"
        "- Read / list under the desk filesystem root (operator home). "
        "Always use paths relative to home (e.g. `Projects/todo-app/src/App.jsx`), "
        "never absolute `/home/...`:\n"
        "```read\nProjects/todo-app/src/App.jsx\n```\n"
        "```list\nProjects/todo-app\n```\n"
        "- Scoped edit (exactly one match of the old text):\n"
        "```patch\nrelative/file.py\n<<<<<<<\nold snippet\n=======\nnew snippet\n>>>>>>>\n```\n"
        "- Web search:\n"
        "```search\nquery\n```\n"
        "- Update durable work state (`.desk/WORK.md`):\n"
        "```work\n## Now\n…\n## Done\n…\n## Blocked\n…\n## Next\n…\n```\n"
        "- Probe from this board (verdict: ok|local_network|remote_service|auth|unknown):\n"
        "```probe\nhttps://example.com\n```\n"
        "- Board health (GPU/RAM/temp/disk):\n"
        "```health\n```\n"
        "- Verify harness (`.desk/verify.json`; optional repeats: N):\n"
        "```verify\nrepeats: 3\n```\n"
        "- Deploy recipe (`.desk/recipes.json`; needs approval; verify+rollback on fail):\n"
        "```deploy\n```\n"
        "- Checks gate (`.desk/checks.json`):\n"
        "```checks\n```\n"
        "- Provider bakeoff (`.desk/bakeoff.json` → report markdown):\n"
        "```bakeoff\nrepeats: 3\n```\n"
        "- Browser on this board (Playwright; screenshots in `.desk/browser/`):\n"
        "```browse\naction: navigate\nurl: https://example.com\n```\n"
        "actions: navigate|screenshot|snapshot|click|type|close "
        "(click/type need selector:; type needs text:; headed: true for watch mode when display exists).\n"
        "- Demo video of a page (visible cursor; saved under `Demos/`; max 2 min, one at a time). "
        "Use real selectors from the app (read its source or ```browse``` snapshot first):\n"
        "```record\nurl: http://127.0.0.1:5173\nsize: 720p\nformat: mp4\nname: counter-demo\nsteps:\n"
        "- wait 1\n- click text=count is\n- type #email :: demo@example.com\n- press Enter\n"
        "- scroll 600\n- wait 2\n```\n"
        "size: 720p|1080p|mobile|square|WxH. format: webm|mp4|gif. "
        "steps: wait S | click SEL | hover SEL | type SEL :: TEXT | press KEY | scroll PX | goto URL.\n"
        "- Image from HTML/SVG (thumbnails, diagrams, mockups, social cards). Options, then the markup:\n"
        "```render\nsize: 1200x630\nout: Images/thumb.png\n---\n"
        "<html><body style=\"margin:0;display:grid;place-items:center;height:100vh;"
        "background:#111;color:#fff;font:600 64px system-ui\">Hello</body></html>\n```\n"
        "scale: 2x for crisp output. Inline all CSS; no external assets needed.\n"
        "- Background job (survives closing the chat; Agents tab + desk notice when done).\n"
        "Best agentic default: deep research (~30s on the board — multi-angle web search + "
        "brief written to `.desk/research/…`). Do NOT invent empty verify×N padding.\n"
        "```job\nkind: research\ntopic: edge AI agents on Jetson Orin Nano\n```\n"
        "Also: record|shell|verify|probe|health|deploy|checks|bakeoff.\n"
        "Use ```job``` when the operator wants work that outlives the chat — background, "
        "leave it running, deep research, spin up a process, close the tab, notify/ping/"
        "avisame when done, Agents tab. After enqueueing, say plainly e.g. "
        "'Research agent started — watch Machine → Agents; I'll leave a notice when the "
        "report is ready.' Never write 'Job `job` completed' or similar.\n"
        "Do not invent file contents. Prefer read before patch. "
        "```patch```, destructive shell, and deploy wait for the operator to approve. "
        "If a project already exists and something is broken, diagnose with read/list — "
        "do not scaffold over it."
    )


async def execute_tools(
    db: Session,
    user_id: int,
    calls: list[ToolCall],
    *,
    session_id: str | None = None,
) -> list[dict]:
    """Run non-approval tools. Approval-gated calls must be filtered first."""
    results: list[dict] = []
    for call in calls:
        try:
            results.append(await _execute_one(db, user_id, call, session_id=session_id))
        except Exception as exc:  # noqa: BLE001 — surface to the model as observation
            log.exception("desk tool %s failed", call.kind)
            results.append(
                {
                    "kind": call.kind,
                    "ok": False,
                    "error": f"{type(exc).__name__}: {exc}",
                    **call.summary(),
                }
            )
    return results


async def _execute_install(db: Session, user_id: int, call: ToolCall) -> dict:
    """Re-search → trust filter → run curated recipe only."""
    kv = parse_kv(call.body)
    tool = (kv.get("tool") or kv.get("package") or "").strip()
    if not tool:
        tool = call.body.strip().splitlines()[0].strip() if call.body.strip() else ""
    if not tool:
        return {"kind": "install", "ok": False, "error": "install needs tool: node|python|expo|…"}

    if not subscription_active(db, user_id):
        return {"kind": "install", "ok": False, "tool": tool, "error": "subscription inactive"}

    query = search_query_for(tool)
    try:
        cap = tavily_allowance(get_settings().tavily_credit_cap)
        data = await web_search(db, query, max_results=6, credit_cap=cap)
    except TavilyCapReached as exc:
        return {
            "kind": "install",
            "ok": False,
            "tool": tool,
            "error": f"Tavily credit cap ({exc.spent}/{exc.cap})",
        }

    hits = data.get("results") or []
    plan = plan_install(tool=tool, search_results=hits, package=kv.get("package"))
    base = {
        "kind": "install",
        "tool": plan.tool or tool,
        "query": query,
        "trusted_urls": plan.trusted_urls[:6],
        "untrusted_urls": plan.untrusted_urls[:6],
        "warnings": plan.warnings,
        "dummy_search": bool(data.get("dummy")),
    }
    if not plan.ok or not plan.recipe:
        return {**base, "ok": False, "error": plan.error or "install refused"}

    bad = command_looks_malicious(plan.recipe)
    # Allow the one curated nvm pipe from raw.githubusercontent.com/nvm-sh
    if bad and "raw.githubusercontent.com/nvm-sh/nvm/" not in plan.recipe:
        return {**base, "ok": False, "error": bad, "recipe": plan.recipe}

    rows = run_board_commands(db, user_id, [plan.recipe])
    row = rows[0] if rows else {}
    return {
        **base,
        "ok": row.get("exit_code") == 0,
        "recipe": plan.recipe,
        "command": row.get("command"),
        "exit_code": row.get("exit_code"),
        "stdout": row.get("stdout"),
        "stderr": row.get("stderr"),
        "timed_out": row.get("timed_out"),
        "note": "Ran vetted recipe after trusted-host search filter.",
    }


async def _execute_one(
    db: Session,
    user_id: int,
    call: ToolCall,
    *,
    session_id: str | None = None,
) -> dict:
    kind = call.kind
    if kind == "run":
        cmd = call.body.strip()
        bad = command_looks_malicious(cmd)
        if bad:
            return {
                "kind": "run",
                "ok": False,
                "command": cmd[:200],
                "error": bad,
                "skipped": True,
                "reason": "blocked_malicious_pattern",
            }
        rows = run_board_commands(db, user_id, [cmd])
        row = rows[0] if rows else {}
        return {
            "kind": "run",
            "ok": row.get("exit_code") == 0,
            "command": row.get("command"),
            "exit_code": row.get("exit_code"),
            "stdout": row.get("stdout"),
            "stderr": row.get("stderr"),
            "timed_out": row.get("timed_out"),
        }
    if kind == "read":
        path = call.body.strip().splitlines()[0].strip()
        data = edge_files.read_file(path)
        return {"kind": "read", "ok": True, "path": data["path"], "content": data["content"]}
    if kind == "list":
        path = call.body.strip().splitlines()[0].strip() or "."
        data = edge_files.list_dir(path)
        return {
            "kind": "list",
            "ok": True,
            "path": data["path"],
            "entries": data["entries"],
        }
    if kind == "patch":
        parsed = parse_patch(call.body)
        if not parsed:
            return {
                "kind": "patch",
                "ok": False,
                "error": "Bad patch fence. Use path, then <<<<<<< old ======= new >>>>>>>",
            }
        try:
            data = edge_files.edit_file(parsed["path"], parsed["old"], parsed["new"])
        except HTTPException as exc:
            return {"kind": "patch", "ok": False, "path": parsed["path"], "error": str(exc.detail)}
        return {"kind": "patch", "ok": True, "path": data["path"], "replaced": True}
    if kind == "search":
        if not subscription_active(db, user_id):
            return {
                "kind": "search",
                "ok": False,
                "query": call.body.strip(),
                "error": "Desk subscription is inactive — search is closed.",
            }
        query = call.body.strip()[:500]
        try:
            cap = tavily_allowance(get_settings().tavily_credit_cap)
            data = await web_search(db, query, max_results=5, credit_cap=cap)
        except TavilyCapReached as exc:
            return {
                "kind": "search",
                "ok": False,
                "query": query,
                "error": f"Tavily credit cap ({exc.spent}/{exc.cap})",
            }
        hits = [
            {
                "title": r.get("title"),
                "url": r.get("url"),
                "content": (r.get("content") or "")[:500],
            }
            for r in (data.get("results") or [])[:5]
        ]
        return {
            "kind": "search",
            "ok": True,
            "query": query,
            "dummy": bool(data.get("dummy")),
            "results": hits,
        }
    if kind == "work":
        data = write_work_state(call.body)
        return {"kind": "work", "ok": True, "path": data["path"], "bytes": data["bytes"]}
    if kind == "probe":
        target = call.body.strip().splitlines()[0].strip()
        data = probe_target(target)
        return {"kind": "probe", "ok": data.get("verdict") in ("ok", "auth"), **data}
    if kind == "health":
        data = snapshot()
        return {"kind": "health", "ok": True, **data}
    if kind == "verify":
        kv = parse_kv(call.body)
        repeats = int(kv["repeats"]) if kv.get("repeats", "").isdigit() else None
        secrets = secret_map(db, user_id)
        data = run_verify(repeats=repeats, secrets=secrets)
        return {"kind": "verify", **data}
    if kind == "deploy":
        secrets = secret_map(db, user_id)
        data = run_deploy(secrets=secrets)
        return {"kind": "deploy", **data}
    if kind == "checks":
        secrets = secret_map(db, user_id)
        data = run_checks(secrets=secrets)
        return {"kind": "checks", **data}
    if kind == "bakeoff":
        kv = parse_kv(call.body)
        repeats = int(kv["repeats"]) if kv.get("repeats", "").isdigit() else 3
        data = run_bakeoff(repeats=repeats)
        return {"kind": "bakeoff", **data}
    if kind == "browse":
        kv = parse_kv(call.body)
        action = (kv.get("action") or "screenshot").strip().lower()
        params = {
            "url": kv.get("url"),
            "selector": kv.get("selector"),
            "text": kv.get("text"),
            "headed": (kv.get("headed") or "").lower() in ("1", "true", "yes"),
        }
        try:
            # runtime.run_action hops onto a dedicated Playwright OS thread.
            return browser_runtime.run_action(user_id, action, params)
        except Exception as exc:  # noqa: BLE001
            return {"kind": "browse", "ok": False, "action": action, "error": f"{type(exc).__name__}: {exc}"}
    if kind in ("record", "render"):
        # Up to ~2 min of Playwright + ffmpeg — keep it off the event loop.
        fn = browser_demo.record_demo if kind == "record" else browser_demo.render_image
        try:
            return await asyncio.to_thread(fn, user_id, call.body)
        except HTTPException as exc:
            return {"kind": kind, "ok": False, "error": str(exc.detail)}
        except Exception as exc:  # noqa: BLE001 — surface Playwright/ffmpeg failures to the model
            return {"kind": kind, "ok": False, "error": f"{type(exc).__name__}: {str(exc)[:300]}"}
    if kind == "install":
        return await _execute_install(db, user_id, call)
    if kind == "job":
        kv = parse_kv(call.body)
        job_kind = (kv.get("kind") or "").strip().lower()
        allowed = (
            "shell",
            "verify",
            "probe",
            "health",
            "deploy",
            "checks",
            "bakeoff",
            "record",
            "research",
        )
        if job_kind not in allowed:
            return {
                "kind": "job",
                "ok": False,
                "error": f"job needs kind: {'|'.join(allowed)}",
            }
        payload: dict = {}
        if job_kind == "shell":
            payload["command"] = kv.get("command") or ""
        elif job_kind in ("verify", "bakeoff"):
            if kv.get("repeats", "").isdigit():
                payload["repeats"] = int(kv["repeats"])
        elif job_kind == "probe":
            payload["target"] = kv.get("target") or ""
        elif job_kind == "research":
            payload["topic"] = (kv.get("topic") or kv.get("query") or "").strip()
            if kv.get("min_seconds", "").replace(".", "", 1).isdigit():
                payload["min_seconds"] = float(kv["min_seconds"])
        elif job_kind == "record":
            # Full record fence body (url/steps/…) minus the kind line — same as ```record```.
            payload["body"] = "\n".join(
                ln for ln in call.body.splitlines() if not ln.strip().lower().startswith("kind:")
            ).strip()
        job = enqueue(
            db,
            user_id=user_id,
            kind=job_kind,
            payload=payload,
            notify_session_id=session_id,
        )
        await job_runner.submit(job.id)
        return {"kind": "job", "ok": True, "job": job_out(job)}
    return {"kind": kind, "ok": False, "error": f"Unknown tool {kind}"}


def format_tool_observations(results: list[dict]) -> str:
    blocks: list[str] = []
    for item in results:
        kind = item.get("kind")
        if item.get("skipped"):
            detail = item.get("command") or item.get("path") or item.get("query") or ""
            reason = item.get("reason") or "approval denied"
            blocks.append(f"{kind} {detail}: skipped ({reason})".strip())
            continue
        if kind == "run":
            code = item.get("exit_code")
            status = "timeout" if item.get("timed_out") else f"exit {code}"
            lines = [f"$ {item.get('command')}", f"({status})"]
            if item.get("stdout"):
                lines.append(str(item["stdout"]).strip())
            if item.get("stderr"):
                lines.append(str(item["stderr"]).strip())
            blocks.append("\n".join(lines))
            continue
        if kind == "read":
            if not item.get("ok"):
                blocks.append(f"read {item.get('path')}: ERROR {item.get('error')}")
            else:
                content = item.get("content") or ""
                blocks.append(f"read {item.get('path')} ({len(content)} chars)\n{content}")
            continue
        if kind == "list":
            if not item.get("ok"):
                blocks.append(f"list {item.get('path')}: ERROR {item.get('error')}")
            else:
                names = ", ".join(
                    f"{e.get('name')}{'/' if e.get('kind') == 'dir' else ''}"
                    for e in (item.get("entries") or [])[:80]
                )
                blocks.append(f"list {item.get('path')}: {names or '(empty)'}")
            continue
        if kind == "patch":
            if item.get("ok"):
                blocks.append(f"patch {item.get('path')}: replaced")
            else:
                blocks.append(f"patch {item.get('path')}: ERROR {item.get('error')}")
            continue
        if kind == "search":
            if not item.get("ok"):
                blocks.append(f"search {item.get('query')}: ERROR {item.get('error')}")
            else:
                lines = [f"search {item.get('query')}" + (" (mock)" if item.get("dummy") else "")]
                for hit in item.get("results") or []:
                    lines.append(f"- {hit.get('title')} — {hit.get('url')}\n  {hit.get('content')}")
                blocks.append("\n".join(lines))
            continue
        if kind == "install":
            if not item.get("ok"):
                blocks.append(
                    f"install {item.get('tool')}: REFUSED {item.get('error')}\n"
                    f"trusted={item.get('trusted_urls')}\nuntrusted={item.get('untrusted_urls')}"
                )
            else:
                lines = [
                    f"install {item.get('tool')}: ok exit={item.get('exit_code')}",
                    f"trusted: {item.get('trusted_urls')}",
                    f"$ {item.get('recipe')}",
                ]
                if item.get("stdout"):
                    lines.append(str(item["stdout"]).strip()[:1500])
                if item.get("stderr"):
                    lines.append(str(item["stderr"]).strip()[:800])
                blocks.append("\n".join(lines))
            continue
        if kind == "work":
            if item.get("ok"):
                blocks.append(f"work state updated ({item.get('bytes')} bytes) at {item.get('path')}")
            else:
                blocks.append(f"work state: ERROR {item.get('error')}")
            continue
        if kind == "probe":
            blocks.append(
                f"probe {item.get('target')}: verdict={item.get('verdict')} "
                f"dns={item.get('dns_ok')} tcp={item.get('tcp_ok')} "
                f"http={item.get('http_status')} latency_ms={item.get('latency_ms')} "
                f"({item.get('detail')})"
            )
            continue
        if kind == "health":
            blocks.append(
                f"health host={item.get('host')} gpu={item.get('gpu_util_pct')}% "
                f"ram={item.get('ram_used_mb')}/{item.get('ram_total_mb')}MB "
                f"temp={item.get('temp_c')}C cpu={item.get('cpu_pct')}% "
                f"disk={item.get('disk_used_pct')}% source={item.get('source')}"
            )
            continue
        if kind == "verify":
            blocks.append(
                f"verify ok={item.get('ok')} pass_rate={item.get('pass_rate')} "
                f"({item.get('pass_count')}/{item.get('repeats')}) "
                f"cmds={item.get('commands')}"
            )
            continue
        if kind == "job":
            job = item.get("job") or {}
            jkind = job.get("kind") or "agent"
            blocks.append(
                f"Background {jkind} agent enqueued id={job.get('id')} status={job.get('status')}. "
                "Tell the operator it is running under Machine → Agents and will leave a notice when done. "
                "Do not wait for it. Do not write phrases like 'Job job completed'."
            )
            continue
        if kind == "deploy":
            phases = ",".join(p.get("label", "?") for p in (item.get("phases") or []))
            blocks.append(
                f"deploy ok={item.get('ok')} rolled_back={item.get('rolled_back')} "
                f"phases=[{phases}] error={item.get('error')}"
            )
            continue
        if kind == "checks":
            blocks.append(f"checks ok={item.get('ok')} cmds={item.get('commands')} error={item.get('error')}")
            continue
        if kind == "bakeoff":
            if not item.get("ok"):
                blocks.append(f"bakeoff ERROR {item.get('error')}")
            else:
                lines = [f"bakeoff report={item.get('report')}"]
                for r in item.get("results") or []:
                    lines.append(
                        f"- {r.get('name')}: avg_ms={r.get('avg_latency_ms')} "
                        f"errors={r.get('errors')}/{r.get('repeats')}"
                    )
                blocks.append("\n".join(lines))
            continue
        if kind == "browse":
            lines = [
                f"browse action={item.get('action')} ok={item.get('ok')} url={item.get('url')}"
            ]
            if item.get("shot"):
                lines.append(f"shot={item.get('shot')}")
            if item.get("title"):
                lines.append(f"title={item.get('title')}")
            if item.get("text"):
                lines.append(str(item.get("text"))[:2000])
            if item.get("error"):
                lines.append(f"ERROR {item.get('error')}")
            blocks.append("\n".join(lines))
            continue
        if kind == "record":
            if not item.get("ok"):
                blocks.append(f"record {item.get('url')}: ERROR {item.get('error')}")
                continue
            mb = (item.get("bytes") or 0) / 1_000_000
            lines = [
                f"record saved {item.get('path')} ({item.get('format')}, {mb:.1f} MB, "
                f"{item.get('seconds')}s, steps {item.get('steps_run')}/{item.get('steps_total')}) "
                f"final_url={item.get('final_url')}"
            ]
            if item.get("note"):
                lines.append(f"note: {item.get('note')}")
            for problem in item.get("step_errors") or []:
                lines.append(f"step problem: {problem}")
            blocks.append("\n".join(lines))
            continue
        if kind == "render":
            if item.get("ok"):
                blocks.append(
                    f"render saved {item.get('path')} ({item.get('width')}x{item.get('height')} "
                    f"@{item.get('scale')}x, {item.get('bytes')} bytes)"
                )
            else:
                blocks.append(f"render: ERROR {item.get('error')}")
            continue
        blocks.append(f"{kind}: {item}")
    return "\n\n".join(blocks)
