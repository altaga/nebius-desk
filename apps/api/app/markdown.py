"""Small helpers for markdown files the model can parse."""

from __future__ import annotations

import re

_SLUG = re.compile(r"[^a-z0-9]+")
_QUOTED = re.compile(r"""^(['"])(.*)\1$""")
_NEEDS_QUOTE = re.compile(r"[:#{}[\]&*!|>%@`\"'\\]|^\s|\s$")
_RESERVED = {"true", "false", "null", "yes", "no", "~"}


def yaml_scalar(value: str) -> str:
    text = " ".join(value.split())
    if not text:
        return '""'
    if text.lower() in _RESERVED or _NEEDS_QUOTE.search(text):
        escaped = text.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return text


def yaml_unquote(value: str) -> str:
    text = value.strip()
    quoted = _QUOTED.match(text)
    if quoted:
        return quoted.group(2).replace('\\"', '"').replace("\\\\", "\\")
    return text


def slugify(value: str) -> str:
    slug = _SLUG.sub("-", value.strip().lower()).strip("-")
    return slug[:60] or "file"
