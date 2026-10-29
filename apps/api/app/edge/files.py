"""File tools for the enrolled board. Paths stay inside DESK_FS_ROOT."""

from __future__ import annotations

import base64
import re
from pathlib import Path

from fastapi import HTTPException, status

from app.config import get_settings

MAX_BYTES = 200_000
# Desk upload (drag/drop + picker). Larger than the text editor cap; still relay-friendly.
MAX_UPLOAD_BYTES = 1_500_000

# Image preview via /files/read (base64). Keep under upload/relay caps.
_IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


def fs_root() -> Path:
    raw = get_settings().desk_fs_root.strip()
    return Path(raw).expanduser().resolve() if raw else Path.home().resolve()


def normalize_rel(rel: str) -> str:
    """Map model-supplied paths onto the desk root.

    Models often emit absolute paths (`/home/altaga/Projects/...`) or `~/...`.
    Those must become relative to DESK_FS_ROOT / home — otherwise
    `lstrip('/')` turns them into `home/altaga/...` under home and 404s.
    """
    root = fs_root()
    raw = (rel or "").replace("\\", "/").strip()
    if not raw or raw in (".", "./"):
        return ""
    if raw.startswith("~/"):
        cand = (Path.home() / raw[2:]).expanduser()
        try:
            return cand.resolve().relative_to(root).as_posix()
        except ValueError:
            return raw[2:].lstrip("/")
    cand = Path(raw)
    # Absolute POSIX (/home/...) or Windows (C:/...).
    if cand.is_absolute() or raw.startswith("/"):
        try:
            return cand.resolve().relative_to(root).as_posix()
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Path escapes the desk root",
            ) from exc
    # Strip a leading "./" only — never lstrip("./") (that eats ".desk/...").
    if raw.startswith("./"):
        raw = raw[2:]
    return raw.lstrip("/")


def resolve_path(rel: str) -> Path:
    root = fs_root()
    rel = normalize_rel(rel)
    if rel in (".",):
        rel = ""
    target = (root / rel).resolve() if rel else root
    if target != root and root not in target.parents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Path escapes the desk root")
    return target


def _shown_path(path: Path, root: Path) -> str:
    if path == root:
        return ""
    return path.relative_to(root).as_posix()


def _parent_rel(path: Path, root: Path) -> str | None:
    if path == root:
        return None
    return _shown_path(path.parent, root)


def list_dir(rel: str) -> dict:
    path = resolve_path(rel)
    if not path.is_dir():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Directory not found")
    entries = []
    try:
        children = list(path.iterdir())
    except OSError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Cannot read directory: {exc}") from exc

    children.sort(key=lambda p: (not _is_dir(p), p.name.lower()))
    for child in children:
        kind = "dir" if _is_dir(child) else "file"
        size = None
        if kind == "file":
            try:
                size = child.stat().st_size
            except OSError:
                size = None
        entries.append({"name": child.name, "kind": kind, "size": size})

    root = fs_root()
    shown = _shown_path(path, root)
    is_home = root == Path.home().resolve()
    return {
        "root": str(root),
        "root_label": "~" if is_home else root.name or "root",
        "is_home": is_home,
        "path": shown,
        "parent": _parent_rel(path, root),
        "entries": entries[:500],
    }


def _is_dir(path: Path) -> bool:
    try:
        return path.is_dir()
    except OSError:
        return False


def _image_media_type(path: Path) -> str | None:
    return _IMAGE_TYPES.get(path.suffix.lower())


# Streamed over the board relay in 16 KB chunks; keep demo-sized.
MAX_RAW_BYTES = 100_000_000
_RAW_TYPES = {
    **_IMAGE_TYPES,
    ".webm": "video/webm",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".pdf": "application/pdf",
}


def raw_file(rel: str) -> tuple[Path, str]:
    """Resolve a media file for streaming (video/image/pdf). Text goes through read_file."""
    path = resolve_path(rel)
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    media = _RAW_TYPES.get(path.suffix.lower())
    if not media:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only images, videos, and PDFs stream from here",
        )
    if path.stat().st_size > MAX_RAW_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File is too large to stream (max {MAX_RAW_BYTES // 1_000_000} MB)",
        )
    return path, media


_DIR_READ_CANDIDATES = (
    "src/App.jsx",
    "src/App.tsx",
    "src/main.jsx",
    "src/main.tsx",
    "App.jsx",
    "App.tsx",
    "index.js",
    "index.ts",
    "README.md",
)


def read_file(rel: str) -> dict:
    path = resolve_path(rel)
    if path.is_dir():
        # Models often ```read``` a project folder — pick the obvious entry file.
        for cand in _DIR_READ_CANDIDATES:
            hit = path / cand
            if hit.is_file():
                path = hit
                break
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Path is a directory — read a file inside it (e.g. src/App.jsx)",
            )
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    size = path.stat().st_size
    media = _image_media_type(path)
    if media:
        if size > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Image is too large to preview (max {MAX_UPLOAD_BYTES // 1_000_000} MB)",
            )
        data = path.read_bytes()
        return {
            "path": _shown_path(path, fs_root()),
            "encoding": "base64",
            "media_type": media,
            "bytes": len(data),
            "content": base64.b64encode(data).decode("ascii"),
        }
    if size > MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File is too large")
    data = path.read_bytes()
    # Refuse dumping opaque binaries into the text editor.
    if b"\x00" in data[:8192]:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="This is a binary file — the desk editor only opens text and images",
        )
    return {
        "path": _shown_path(path, fs_root()),
        "encoding": "utf-8",
        "content": data.decode("utf-8"),
    }


def write_file(rel: str, content: str) -> dict:
    path = resolve_path(rel)
    if path.is_dir():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Path is a directory")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return {"path": rel, "bytes": len(content.encode("utf-8"))}


def upload_file(rel: str, content_b64: str, *, overwrite: bool = True) -> dict:
    """Write raw bytes from base64 into a path under the desk root."""
    try:
        data = base64.b64decode(content_b64 or "", validate=False)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid base64 payload") from exc
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File is too large (max {MAX_UPLOAD_BYTES // 1_000_000} MB)",
        )
    path = resolve_path("/".join(_parts(rel)))
    if path.is_dir():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Path is a directory")
    if _present(path) and not overwrite:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That name already exists")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    except OSError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Could not upload file: {exc}") from exc
    return {"path": _shown_path(path, fs_root()), "bytes": len(data)}


def _unique_replace(content: str, old: str, new: str) -> str | None:
    if not old:
        return None
    count = content.count(old)
    if count == 1:
        return content.replace(old, new, 1)
    return None


def _identifier_typo_replace(content: str, old: str, new: str) -> str | None:
    """If the patch is a one-identifier typo (saveItemz → saveItems), apply it."""
    old_ids = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", old or ""))
    new_ids = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", new or ""))
    removed = old_ids - new_ids
    added = new_ids - old_ids
    if len(removed) != 1 or len(added) != 1:
        return None
    bad, good = removed.pop(), added.pop()
    if len(bad) < 4 or content.count(bad) != 1:
        return None
    return content.replace(bad, good, 1)


def edit_file(rel: str, old: str, new: str) -> dict:
    """Scoped single-match edit. Tolerates newline / trailing-space / typo drift from models."""
    path = resolve_path(rel)
    if path.is_dir():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Path is a directory")
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    content = path.read_text(encoding="utf-8", errors="replace")
    old_s = (old or "").replace("\r\n", "\n")
    new_s = (new or "").replace("\r\n", "\n")
    text = content.replace("\r\n", "\n")

    replaced = _unique_replace(text, old_s, new_s)
    if replaced is None:
        replaced = _unique_replace(text, old_s.strip("\n"), new_s.strip("\n"))
    if replaced is None:
        # Last resort: if each side is a single distinctive line, swap that line once.
        old_lines = [ln for ln in old_s.splitlines() if ln.strip()]
        new_lines = [ln for ln in new_s.splitlines() if ln.strip()]
        if len(old_lines) == 1 and len(new_lines) == 1:
            replaced = _unique_replace(text, old_lines[0], new_lines[0])
            if replaced is None:
                replaced = _unique_replace(text, old_lines[0].strip(), new_lines[0].strip())
    if replaced is None:
        replaced = _identifier_typo_replace(text, old_s, new_s)

    if replaced is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Expected one match, found {text.count(old_s)}",
        )
    path.write_text(replaced, encoding="utf-8")
    return {"path": _shown_path(path, fs_root()), "replaced": True}


def mkdir(rel: str) -> dict:
    path = resolve_path(rel)
    if path.exists() and not path.is_dir():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Path is a file")
    path.mkdir(parents=True, exist_ok=True)
    root = fs_root()
    return {"path": _shown_path(path, root), "ok": True}


def _parts(rel: str) -> list[str]:
    raw = (rel or "").replace("\\", "/").strip()
    if not raw or raw in {".", "/"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid path")
    bits = raw.split("/")
    if any(bit in {"", ".."} or "\x00" in bit for bit in bits):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid path")
    parts = [bit for bit in bits if bit != "."]
    if not parts:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid path")
    return parts


def _leaf(name: str) -> str:
    leaf = (name or "").strip()
    if not leaf or leaf in {".", ".."} or "/" in leaf or "\\" in leaf or "\x00" in leaf:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid name")
    return leaf


def _present(path: Path) -> bool:
    try:
        path.lstat()
    except OSError:
        return False
    return True


def create_file(rel: str) -> dict:
    path = resolve_path("/".join(_parts(rel)))
    if _present(path):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That name already exists")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("", encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Could not create file: {exc}") from exc
    return {"path": _shown_path(path, fs_root()), "ok": True}


def rename_entry(rel: str, name: str) -> dict:
    leaf = _leaf(name)
    path = resolve_path("/".join(_parts(rel)))
    root = fs_root()
    if path == root:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot rename the desk root")
    if not _present(path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    dest = path.with_name(leaf)
    if dest != path and _present(dest):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That name already exists")
    path.rename(dest)
    return {"path": _shown_path(dest, root), "ok": True}


def delete_entry(rel: str) -> dict:
    path = resolve_path("/".join(_parts(rel)))
    root = fs_root()
    if path == root:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete the desk root")
    if not _present(path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    shown = _shown_path(path, root)
    try:
        _remove(path, root)
    except OSError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Could not delete: {exc}") from exc
    return {"path": shown, "ok": True}


def _remove(path: Path, root: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
        return
    if not path.is_dir():
        path.unlink()
        return
    for child in list(path.iterdir()):
        if not child.is_symlink():
            resolved = child.resolve()
            if resolved != root and root not in resolved.parents:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Refusing to delete a path outside the desk",
                )
        _remove(child, root)
    path.rmdir()
