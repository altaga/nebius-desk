"""File tools for the enrolled board. Paths stay inside DESK_FS_ROOT."""

from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException, status

from app.config import get_settings

MAX_BYTES = 200_000


def fs_root() -> Path:
    raw = get_settings().desk_fs_root.strip()
    return Path(raw).expanduser().resolve() if raw else Path.home().resolve()


def resolve_path(rel: str) -> Path:
    root = fs_root()
    rel = (rel or "").replace("\\", "/").lstrip("/")
    target = (root / rel).resolve() if rel else root
    if target != root and root not in target.parents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Path escapes the desk root")
    return target


def list_dir(rel: str) -> dict:
    path = resolve_path(rel)
    if not path.is_dir():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Directory not found")
    entries = []
    for child in sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        kind = "dir" if child.is_dir() else "file"
        size = child.stat().st_size if kind == "file" else None
        entries.append({"name": child.name, "kind": kind, "size": size})
    root = fs_root()
    shown = "." if path == root else path.relative_to(root).as_posix()
    return {"root": str(root), "path": shown, "entries": entries[:200]}


def read_file(rel: str) -> dict:
    path = resolve_path(rel)
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    if path.stat().st_size > MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File is too large")
    return {"path": rel, "content": path.read_text(encoding="utf-8", errors="replace")}


def write_file(rel: str, content: str) -> dict:
    path = resolve_path(rel)
    if path.is_dir():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Path is a directory")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return {"path": rel, "bytes": len(content.encode("utf-8"))}


def edit_file(rel: str, old: str, new: str) -> dict:
    path = resolve_path(rel)
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    content = path.read_text(encoding="utf-8", errors="replace")
    count = content.count(old)
    if count != 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Expected one match, found {count}",
        )
    path.write_text(content.replace(old, new, 1), encoding="utf-8")
    return {"path": rel, "replaced": True}
