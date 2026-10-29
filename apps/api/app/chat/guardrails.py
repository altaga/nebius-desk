"""Strip Nano fabrications that look like a “board ops dashboard”."""

from __future__ import annotations

import re

# Invented multi-operator / pending-action reports (seen in the wild with Nano).
# Keep tight — "Next Steps" alone is too common in honest replies.
_FABRICATED = re.compile(
    r"(?is)"
    r"(?:\*{0,2}|#{1,3}\s*)Board\s+(?:Summary|Operations|Status)\b"
    r"|(?:\*{0,2}|#{1,3}\s*)(?:Pending\s+Actions|Current\s+Board\s+Status)\b"
    r"|\b(?:Alice|Bob|Carol)\b.{0,40}\b(?:status|deploy|idle)\b"
    r"|\bAction\s+ID:\s*PA-\d+"
    r"|\bActive\s+Users:\s*\d{2,}"
    r"|\bPending\s+Actions:\s*\d+"
    r"|\bTeam\s+Alpha\b|\bTeam\s+Beta\b|\bInfrastructure\s+Team\b"
)

_MKDIR_ASK = re.compile(
    r"(?i)\b(?:"
    r"crea(?:r)?|create|mkdir|hac[eé]\s+(?:una\s+)?carpeta|make\s+(?:a\s+)?(?:dir(?:ectory)?|folder)"
    r")\b"
)
_FOLDER_NAME = re.compile(
    r"(?i)"
    r"(?:carpeta|folder|dir(?:ectory)?)\s+(?:llamad[ao]|called|named)\s+[\"'`]?(/?[\w./-]+)[\"'`]?"
    r"|(?:carpeta|folder)\s+[\"'`]?(/?[\w./-]+)[\"'`]?"
    r"|(?:llamad[ao]|called|named)\s+[\"'`]?(/?[\w./-]+)[\"'`]?"
    r"|mkdir\s+(?:-p\s+)?[\"'`]?(/?[\w./-]+)[\"'`]?"
)


def is_fabricated_board_report(text: str) -> bool:
    return bool(_FABRICATED.search(text or ""))


def strip_fabricated_board_report(text: str) -> str:
    """Drop hallucinated ops tables; keep a short leading factual bit if any.

    Returns empty string when nothing usable remains — caller should fall back
    to real tool observations instead of a dead 'Ignored…' stub.
    """
    raw = text or ""
    if not is_fabricated_board_report(raw):
        return raw
    cut = re.split(
        r"(?im)^(?:\*{0,2}|#{1,3}\s*)?(?:Board\s+(?:Summary|Operations|Status)|Pending\s+Actions|"
        r"Current\s+Board\s+Status)\b",
        raw,
        maxsplit=1,
    )[0].strip()
    if cut and not is_fabricated_board_report(cut) and len(cut) > 8:
        return cut
    return ""


_CREATED = re.compile(r"(?im)^\s*created\s+(\S+)\s*$")
_MKDIR_PATHLIB = re.compile(r"""Path\(\s*['"]([\w./-]+)['"]\s*\)\.mkdir""")


def _friendly_run(item: dict) -> str:
    code = item.get("exit_code")
    out = (item.get("stdout") or "").strip()
    err = (item.get("stderr") or "").strip()
    cmd = (item.get("command") or "").strip()

    created = _CREATED.search(out)
    if created and code == 0:
        return f"Done — created folder `{created.group(1)}` under home."
    mkdir_name = _MKDIR_PATHLIB.search(cmd)
    if mkdir_name and code == 0:
        return f"Done — created folder `{mkdir_name.group(1)}` under home."

    if code == 0:
        if out and len(out) < 240 and "\n" not in out and "python" not in out.lower():
            return out
        if out:
            return f"Done.\n```\n{out[:1200]}\n```"
        return "Done."
    detail = (err or out or f"exit {code}")[:600]
    return f"Command failed.\n```\n{detail}\n```"


def _friendly_list(item: dict) -> str:
    if not item.get("ok"):
        return f"Could not list: {item.get('error') or 'error'}."
    entries = item.get("entries") or []
    dirs = [e["name"] for e in entries if e.get("kind") == "dir"]
    files = [e["name"] for e in entries if e.get("kind") != "dir"]
    where = item.get("path") or "."
    place = "home" if where in (".", "") else f"`{where}`"
    lines = [f"{place} has {len(entries)} entries:"]
    if dirs:
        lines.append("Folders: " + ", ".join(f"`{n}/`" for n in dirs[:30]))
    if files:
        shown = files[:25]
        extra = f" (+{len(files) - 25} more)" if len(files) > 25 else ""
        lines.append("Files: " + ", ".join(f"`{n}`" for n in shown) + extra)
    if not dirs and not files:
        lines.append("(empty)")
    return "\n".join(lines)


def factual_reply_from_tools(results: list[dict]) -> str:
    """Short English summary from tool results — hide raw tool plumbing."""
    parts: list[str] = []
    for item in results or []:
        kind = item.get("kind")
        if item.get("skipped"):
            parts.append(
                f"Skipped `{kind}`: {item.get('reason') or 'needs your approval'}."
            )
            continue
        if kind == "run":
            parts.append(_friendly_run(item))
            continue
        if kind == "list":
            parts.append(_friendly_list(item))
            continue
        if kind == "read":
            if not item.get("ok"):
                parts.append(f"Could not read the file: {item.get('error') or 'error'}.")
            else:
                body = (item.get("content") or "")[:1500]
                parts.append(f"Contents of `{item.get('path')}`:\n```\n{body}\n```")
            continue
        if kind == "install":
            tool = item.get("tool") or "tool"
            if item.get("ok"):
                parts.append(
                    f"Installed `{tool}` from verified sources"
                    + (
                        f" ({len(item.get('trusted_urls') or [])} trusted URLs)."
                        if item.get("trusted_urls")
                        else "."
                    )
                )
            else:
                parts.append(f"Did not install `{tool}`: {item.get('error') or 'security block'}.")
            continue
        if kind == "record":
            if item.get("ok"):
                size = item.get("bytes") or 0
                shown = f"{size / 1_000_000:.1f} MB" if size >= 1_000_000 else f"{max(1, size // 1000)} KB"
                parts.append(f"Recorded the demo: `{item.get('path')}` ({shown}, {item.get('seconds')} s).")
            else:
                parts.append(f"Could not record the demo: {item.get('error') or 'error'}.")
            continue
        if kind == "render":
            if item.get("ok"):
                parts.append(f"Rendered image `{item.get('path')}`.")
            else:
                parts.append(f"Could not render the image: {item.get('error') or 'error'}.")
            continue
        if kind == "search" and item.get("ok"):
            hits = item.get("results") or []
            if not hits:
                parts.append(f"No results for “{item.get('query')}”.")
            else:
                lines = [f"Results for “{item.get('query')}”:"]
                lines += [f"- [{h.get('title') or h.get('url')}]({h.get('url')})" for h in hits[:5]]
                parts.append("\n".join(lines))
            continue
        if kind == "job":
            job = item.get("job") or {}
            jkind = str(job.get("kind") or "agent")
            label = {
                "research": "Research",
                "record": "Record",
                "verify": "Verify",
                "shell": "Shell",
                "deploy": "Deploy",
                "checks": "Checks",
                "bakeoff": "Bakeoff",
                "probe": "Probe",
                "health": "Health",
            }.get(jkind, jkind.capitalize())
            if item.get("ok") is False:
                parts.append(f"Could not start the {label.lower()} agent: {item.get('error') or 'error'}.")
            else:
                parts.append(
                    f"{label} agent started on the board. Watch Machine → Agents — "
                    "it keeps running if you close this tab, and leaves a notice when done."
                )
            continue
        if kind in ("patch", "search", "probe", "health", "verify", "deploy", "checks", "bakeoff", "browse", "work"):
            if item.get("ok") is False:
                parts.append(f"`{kind}` failed: {item.get('error') or 'error'}.")
            else:
                parts.append(f"`{kind}` completed.")
    return "\n\n".join(p for p in parts if p).strip() or "Done."


_BOARD_ACT = re.compile(
    r"(?i)\b("
    r"install|instala|node|npm|npx|mkdir|carpeta|folder|vite|react|"
    r"servidor|server|dev\b|localhost|127\.0\.0\.1|5173|browse|playwright|"
    r"screenshot|crea(?:r)?|ejecut|arranca|abre\s+https?://|nohup|"
    r"proyecto|scaffold|dependenc|gr[aá]ba\w*|record|render|thumbnail|miniatura"
    r")\b"
)


def wants_mkdir(user_text: str) -> bool:
    return bool(_MKDIR_ASK.search(user_text or ""))


def needs_board_tools(user_text: str) -> bool:
    """True when the user is asking the board to act (not pure Q&A)."""
    return bool(_BOARD_ACT.search(user_text or ""))


def mkdir_target(user_text: str) -> str | None:
    """Relative folder under desk home, e.g. Projects — never /home/<hostname>."""
    if not wants_mkdir(user_text):
        return None
    m = _FOLDER_NAME.search(user_text or "")
    if not m:
        return None
    raw = next((g for g in m.groups() if g), "").strip().strip("/\\")
    if not raw or raw in {".", ".."}:
        return None
    # Absolute paths that look like someone else's home → take basename only.
    if raw.startswith("home/") or "/home/" in f"/{raw}":
        raw = raw.rstrip("/").split("/")[-1]
    # Nested relative paths OK (Projects/desk-react-demo); reject .. segments.
    if ".." in raw.split("/") or not re.fullmatch(r"[\w./-]+", raw):
        return None
    return raw
