"""Shared memory is a markdown file with a stable shape the model can read."""

from __future__ import annotations

import re
from datetime import datetime

from app.markdown import slugify, yaml_scalar, yaml_unquote

_FRONT_TITLE = re.compile(r"(?m)^title:\s*(.+)$")
_FACT = re.compile(r"## Fact\s+([\s\S]*?)(?:\n## |\Z)")


def is_memory_file(text: str) -> bool:
    head = text.lstrip()[:500]
    return head.startswith("---") and "kind: memory" in head


def structure_memory(title: str, content: str, *, updated: datetime | None = None) -> tuple[str, str]:
    """Return (title, markdown). An existing memory file is left intact."""
    raw = content.strip()
    if is_memory_file(raw):
        found = _FRONT_TITLE.search(raw)
        name = yaml_unquote(found.group(1)) if found else title.strip()
        return (name or "Memory")[:80], _stable(raw)

    name = (title.strip() or _first_line(raw) or "Memory")[:80]
    when = (updated or datetime.utcnow()).date().isoformat()
    markdown = (
        "---\n"
        "kind: memory\n"
        f"title: {yaml_scalar(name)}\n"
        f"updated: {when}\n"
        "scope: device\n"
        "---\n\n"
        f"# {name}\n\n"
        "## Fact\n"
        f"{raw}\n\n"
        "## Use\n"
        "This file is shared by every chat on this device. Treat Fact as the source. "
        "Do not add details that are not written there. If Fact conflicts with a guess, keep Fact.\n"
    )
    return name, _stable(markdown)


def _stable(text: str) -> str:
    return text.strip() + "\n"


def memory_filename(title: str) -> str:
    return f"memory/{slugify(title)}.md"


def fact_text(markdown: str) -> str:
    found = _FACT.search(markdown)
    return (found.group(1) if found else markdown).strip()


def memory_prompt(files: list[tuple[str, str]]) -> str:
    """files are (filename, markdown)."""
    if not files:
        return ""
    blocks = [f"### {name}\n```markdown\n{body}\n```" for name, body in files]
    lead = (
        "Shared memory files. Read each file's front matter and its Fact section. "
        "The Use section says how to apply the file. It is not an extra fact."
    )
    return lead + "\n\n" + "\n\n".join(blocks)


def _first_line(text: str) -> str:
    line = text.split("\n", 1)[0].strip().lstrip("#").strip()
    return line[:80]
