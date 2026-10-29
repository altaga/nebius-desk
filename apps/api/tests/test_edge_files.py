"""Desk file browser path helpers."""

from pathlib import Path

import pytest
from fastapi import HTTPException

from app.edge import files as edge_files


def test_list_dir_root_and_child(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    home = tmp_path / "home"
    home.mkdir()
    (home / "Projects").mkdir()
    (home / "readme.txt").write_text("hi", encoding="utf-8")
    monkeypatch.setattr(edge_files, "fs_root", lambda: home.resolve())
    monkeypatch.setattr(edge_files.Path, "home", staticmethod(lambda: home.resolve()))

    root = edge_files.list_dir("")
    assert root["path"] == ""
    assert root["parent"] is None
    assert root["is_home"] is True
    assert root["root_label"] == "~"
    names = {e["name"]: e["kind"] for e in root["entries"]}
    assert names["Projects"] == "dir"
    assert names["readme.txt"] == "file"

    child = edge_files.list_dir("Projects")
    assert child["path"] == "Projects"
    assert child["parent"] == ""
    assert child["entries"] == []


def test_list_dir_dot_normalizes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "desk"
    root.mkdir()
    monkeypatch.setattr(edge_files, "fs_root", lambda: root.resolve())
    monkeypatch.setattr(edge_files.Path, "home", staticmethod(lambda: tmp_path.resolve()))

    listed = edge_files.list_dir(".")
    assert listed["path"] == ""
    assert listed["is_home"] is False


def test_read_rejects_empty_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "desk"
    (root / "Projects").mkdir(parents=True)
    monkeypatch.setattr(edge_files, "fs_root", lambda: root.resolve())
    with pytest.raises(HTTPException) as caught:
        edge_files.read_file("Projects")
    assert caught.value.status_code == 400
    assert "directory" in str(caught.value.detail).lower()


def test_read_directory_picks_app_jsx(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "desk"
    app = root / "Projects" / "todo-app" / "src" / "App.jsx"
    app.parent.mkdir(parents=True)
    app.write_text("export default function App() {}", encoding="utf-8")
    monkeypatch.setattr(edge_files, "fs_root", lambda: root.resolve())
    out = edge_files.read_file("Projects/todo-app")
    assert out["path"] == "Projects/todo-app/src/App.jsx"
    assert "export default" in out["content"]


def test_normalize_absolute_home_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "home"
    target = root / "Projects" / "todo-app" / "src" / "App.jsx"
    target.parent.mkdir(parents=True)
    target.write_text("ok", encoding="utf-8")
    monkeypatch.setattr(edge_files, "fs_root", lambda: root.resolve())
    monkeypatch.setattr(edge_files.Path, "home", staticmethod(lambda: root.resolve()))
    abs_path = str(target.resolve())
    assert edge_files.normalize_rel(abs_path) == "Projects/todo-app/src/App.jsx"
    out = edge_files.read_file(abs_path)
    assert out["content"] == "ok"


def test_edit_file_tolerates_snippet_whitespace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "desk"
    target = root / "Projects" / "todo-app" / "src" / "App.jsx"
    target.parent.mkdir(parents=True)
    target.write_text(
        "  function persist(next) {\n    setItems(next)\n    saveItemz(next)\n  }\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(edge_files, "fs_root", lambda: root.resolve())
    # Model often patches only the typo line.
    out = edge_files.edit_file(
        "Projects/todo-app/src/App.jsx",
        "    saveItemz(next)\n",
        "    saveItems(next)\n",
    )
    assert out["replaced"] is True
    body = target.read_text(encoding="utf-8")
    assert "saveItems(next)" in body
    assert "saveItemz" not in body


def test_edit_file_identifier_typo_fallback(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "desk"
    target = root / "src" / "App.jsx"
    target.parent.mkdir(parents=True)
    target.write_text("persist(saveItemz(next))\n", encoding="utf-8")
    monkeypatch.setattr(edge_files, "fs_root", lambda: root.resolve())
    # Model invents a non-matching multi-line old snippet but clear typo intent.
    edge_files.edit_file(
        "src/App.jsx",
        "function persist(next) {\n  saveItemz(next)\n}\n",
        "function persist(next) {\n  saveItems(next)\n}\n",
    )
    assert "saveItems" in target.read_text(encoding="utf-8")
    assert "saveItemz" not in target.read_text(encoding="utf-8")


def test_mkdir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "desk"
    root.mkdir()
    monkeypatch.setattr(edge_files, "fs_root", lambda: root.resolve())
    out = edge_files.mkdir("Projects/demo")
    assert out["ok"] is True
    assert out["path"] == "Projects/demo"
    assert (root / "Projects" / "demo").is_dir()


def _root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "desk"
    root.mkdir()
    monkeypatch.setattr(edge_files, "fs_root", lambda: root.resolve())
    return root


def test_create_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = _root(tmp_path, monkeypatch)
    out = edge_files.create_file("notes/todo.txt")
    assert out == {"path": "notes/todo.txt", "ok": True}
    assert (root / "notes" / "todo.txt").read_text(encoding="utf-8") == ""


def test_create_file_rejects_existing_and_dotdot(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = _root(tmp_path, monkeypatch)
    (root / "todo.txt").write_text("keep", encoding="utf-8")
    with pytest.raises(HTTPException) as exists:
        edge_files.create_file("todo.txt")
    assert exists.value.status_code == 409
    with pytest.raises(HTTPException) as escaped:
        edge_files.create_file("../outside.txt")
    assert escaped.value.status_code == 400
    assert (root / "todo.txt").read_text(encoding="utf-8") == "keep"


def test_rename_file_and_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = _root(tmp_path, monkeypatch)
    (root / "a.txt").write_text("a", encoding="utf-8")
    (root / "dir").mkdir()
    (root / "dir" / "inner.txt").write_text("in", encoding="utf-8")
    renamed = edge_files.rename_entry("a.txt", "b.txt")
    assert renamed["path"] == "b.txt"
    assert (root / "b.txt").read_text(encoding="utf-8") == "a"
    folder = edge_files.rename_entry("dir", "work")
    assert folder["path"] == "work"
    assert (root / "work" / "inner.txt").is_file()


def test_rename_rejects_conflict_and_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = _root(tmp_path, monkeypatch)
    (root / "a.txt").write_text("a", encoding="utf-8")
    (root / "b.txt").write_text("b", encoding="utf-8")
    with pytest.raises(HTTPException) as conflict:
        edge_files.rename_entry("a.txt", "b.txt")
    assert conflict.value.status_code == 409
    with pytest.raises(HTTPException) as bad:
        edge_files.rename_entry("a.txt", "../c.txt")
    assert bad.value.status_code == 400


def test_upload_file_bytes_and_nested(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    import base64

    root = _root(tmp_path, monkeypatch)
    payload = b"\x00PNG\r\nbinary"
    out = edge_files.upload_file(
        "assets/logo.png",
        base64.b64encode(payload).decode("ascii"),
        overwrite=True,
    )
    assert out["path"] == "assets/logo.png"
    assert out["bytes"] == len(payload)
    assert (root / "assets" / "logo.png").read_bytes() == payload


def test_read_image_as_base64_and_rejects_opaque_binary(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    import base64

    root = _root(tmp_path, monkeypatch)
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
    (root / "logo.png").write_bytes(png)
    (root / "blob.bin").write_bytes(b"\x00\x01\x02\x03binary")
    (root / "note.txt").write_text("hello", encoding="utf-8")

    image = edge_files.read_file("logo.png")
    assert image["encoding"] == "base64"
    assert image["media_type"] == "image/png"
    assert base64.b64decode(image["content"]) == png

    text = edge_files.read_file("note.txt")
    assert text["encoding"] == "utf-8"
    assert text["content"] == "hello"

    with pytest.raises(HTTPException) as binary:
        edge_files.read_file("blob.bin")
    assert binary.value.status_code == 415


def test_upload_rejects_too_large_and_conflict(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    import base64

    root = _root(tmp_path, monkeypatch)
    (root / "keep.bin").write_bytes(b"old")
    with pytest.raises(HTTPException) as conflict:
        edge_files.upload_file("keep.bin", base64.b64encode(b"new").decode("ascii"), overwrite=False)
    assert conflict.value.status_code == 409
    assert (root / "keep.bin").read_bytes() == b"old"
    huge = base64.b64encode(b"x" * (edge_files.MAX_UPLOAD_BYTES + 1)).decode("ascii")
    with pytest.raises(HTTPException) as too_big:
        edge_files.upload_file("big.bin", huge, overwrite=True)
    assert too_big.value.status_code == 413


def test_delete_file_folder_and_symlink(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = _root(tmp_path, monkeypatch)
    outside = tmp_path / "outside.txt"
    outside.write_text("safe", encoding="utf-8")
    (root / "gone.txt").write_text("x", encoding="utf-8")
    (root / "box").mkdir()
    (root / "box" / "n.txt").write_text("n", encoding="utf-8")
    assert edge_files.delete_entry("gone.txt")["ok"] is True
    assert not (root / "gone.txt").exists()
    assert edge_files.delete_entry("box")["ok"] is True
    assert not (root / "box").exists()
    with pytest.raises(HTTPException) as missing:
        edge_files.delete_entry("gone.txt")
    assert missing.value.status_code == 404
    with pytest.raises(HTTPException) as root_delete:
        edge_files.delete_entry(".")
    assert root_delete.value.status_code == 400
    try:
        (root / "link").symlink_to(outside)
    except OSError:
        return
    assert edge_files.delete_entry("link")["ok"] is True
    assert outside.read_text(encoding="utf-8") == "safe"
