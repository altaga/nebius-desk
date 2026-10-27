"""A brain is one expert profile, stored as markdown the model can read."""

from __future__ import annotations

import re

from app.markdown import slugify, yaml_scalar

_ANGLE = re.compile(r"## Angle\s+([\s\S]*?)(?:\n## |\Z)")
_METHOD = re.compile(r"## Method\s+([\s\S]*?)(?:\n## |\Z)")


def is_expert_file(text: str) -> bool:
    head = text.lstrip()[:500]
    return head.startswith("---") and "kind: expert" in head


def structure_profile(name: str, angle: str, method: str) -> str:
    clean = name.strip() or "Expert"
    angle_text = angle.strip() or "Apply this expert's judgment to the current conversation."
    method_text = method.strip() or "Say what you would do, in order, and stop where this profile is silent."
    return (
        "---\n"
        "kind: expert\n"
        f"name: {yaml_scalar(clean)}\n"
        "---\n\n"
        f"# {clean}\n\n"
        "## Role\n"
        f"{clean} is an expert profile called into a conversation. It is not a note store.\n\n"
        "## Angle\n"
        f"{angle_text}\n\n"
        "## Method\n"
        f"{method_text}\n\n"
        "## Use\n"
        f"When the operator writes @{clean}, answer as Millie from this angle and follow this method. "
        "Name the profile. Do not invent a different specialty.\n"
    ).strip() + "\n"


def profile_markdown(name: str, angle: str, method: str, profile: str = "") -> str:
    pasted = profile.strip()
    if is_expert_file(pasted):
        return pasted + "\n" if not pasted.endswith("\n") else pasted
    extra = pasted if pasted and not method.strip() else method
    return structure_profile(name, angle, extra)


def profile_filename(name: str) -> str:
    return f"experts/{slugify(name)}.md"


def section(markdown: str, heading: str) -> str:
    pattern = _ANGLE if heading == "Angle" else _METHOD
    found = pattern.search(markdown)
    return (found.group(1) if found else "").strip()


def called_names(text: str, names: list[str]) -> list[str]:
    """Names the operator called with @Name. Longer names win over prefixes."""
    remaining = text.lower()
    found: list[str] = []
    by_lower = {name.lower(): name for name in names}
    for name in sorted(by_lower, key=len, reverse=True):
        needle = f"@{name}"
        if needle in remaining:
            found.append(by_lower[name])
            remaining = remaining.replace(needle, " ")
    return found


def profiles_prompt(names: list[str], called: list[tuple[str, str]]) -> str:
    """called is (filename, markdown) for profiles named in this message."""
    if not names:
        return ""
    catalog = ", ".join(f"@{name}" for name in names)
    lines = [
        "Expert profiles. Each one is an agent you can consult for an angle or a way of doing the work.",
        f"Available: {catalog}.",
        "The operator calls one by writing @Name in the message. Until a profile is called, answer as Millie and do not adopt an expert.",
    ]
    if not called:
        return "\n".join(lines)
    lines.append(
        "The operator called these profiles for this turn. Answer from each profile's Angle and Method, and name the profile."
    )
    for filename, markdown in called:
        lines.append(f"\n### {filename}\n```markdown\n{markdown}\n```")
    return "\n".join(lines)
