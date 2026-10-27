"use client";

import { useCallback, useEffect, useState } from "react";
import type { FileListing } from "@/shared/api";
import { api } from "@/lib/api";

export type Crumb = { label: string; path: string; title: string };

type Pending = { kind: "dir"; path: string } | { kind: "file"; path: string } | { kind: "close" };

function message(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

export function crumbs(root: string | undefined, dir: string): Crumb[] {
  const rootParts = (root ?? "").replace(/\\/g, "/").split("/").filter(Boolean);
  const rootLabel = rootParts.at(-1) || "root";
  const rootTitle = rootParts.length ? `/${rootParts.join("/")}` : "/";
  const items: Crumb[] = [{ label: rootLabel, path: "", title: rootTitle }];
  let acc = "";
  for (const part of dir.split("/").filter(Boolean)) {
    acc = acc ? `${acc}/${part}` : part;
    items.push({ label: part, path: acc, title: `${rootTitle}/${acc}` });
  }
  return items;
}

export function formatSize(bytes: number | null) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function useMachineFiles() {
  const [dir, setDir] = useState("");
  const [listing, setListing] = useState<FileListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [baseline, setBaseline] = useState("");
  const [draft, setDraft] = useState("");
  const [opening, setOpening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const load = useCallback((path: string) => {
    setLoading(true);
    api()
      .listFiles(path)
      .then((data) => {
        setListing(data);
        setError(null);
      })
      .catch((err: unknown) => setError(message(err, "Files unavailable")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(dir);
  }, [dir, load]);

  const dirty = filePath !== null && draft !== baseline;

  function clearFile() {
    setFilePath(null);
    setDraft("");
    setBaseline("");
    setSaved(false);
    setFileError(null);
    setPending(null);
  }

  async function openFile(path: string) {
    setOpening(true);
    setFileError(null);
    setSaved(false);
    setPending(null);
    try {
      const file = await api().readFile(path);
      setFilePath(path);
      setDraft(file.content);
      setBaseline(file.content);
    } catch (err) {
      setFileError(message(err, "Could not open that file"));
    } finally {
      setOpening(false);
    }
  }

  function guard(next: Pending, run: () => void) {
    if (dirty) {
      setPending(next);
      return;
    }
    run();
  }

  function openDir(path: string) {
    if (path === dir) return;
    guard({ kind: "dir", path }, () => {
      clearFile();
      setDir(path);
    });
  }

  function openEntry(name: string, kind: string) {
    const path = dir ? `${dir}/${name}` : name;
    if (kind === "dir") {
      openDir(path);
      return;
    }
    if (path === filePath) return;
    guard({ kind: "file", path }, () => void openFile(path));
  }

  function closeFile() {
    guard({ kind: "close" }, clearFile);
  }

  function discard() {
    const next = pending;
    clearFile();
    if (!next || next.kind === "close") return;
    if (next.kind === "dir") setDir(next.path);
    else void openFile(next.path);
  }

  async function save() {
    if (!filePath || saving || !dirty) return;
    setSaving(true);
    setFileError(null);
    try {
      await api().writeFile(filePath, draft);
      setBaseline(draft);
      setSaved(true);
      load(dir);
    } catch (err) {
      setFileError(message(err, "Could not save that file"));
    } finally {
      setSaving(false);
    }
  }

  function edit(value: string) {
    setDraft(value);
    setSaved(false);
  }

  return {
    dir,
    listing,
    loading,
    error,
    filePath,
    draft,
    opening,
    saving,
    saved,
    dirty,
    fileError,
    pending,
    reload: () => load(dir),
    openDir,
    openEntry,
    closeFile,
    discard,
    keepEditing: () => setPending(null),
    save,
    edit,
  };
}
