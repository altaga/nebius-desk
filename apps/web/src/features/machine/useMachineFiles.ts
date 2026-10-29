"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FileListing } from "@/shared/api";
import { api } from "@/lib/api";
import { fileToBase64, validateUploadSize, type UploadItem } from "./collectUploads";

export type Crumb = { label: string; path: string; title: string };

type Pending = { kind: "dir"; path: string } | { kind: "file"; path: string } | { kind: "close" };

const DOTS_KEY = "nebiusdesk.files.showDots";
const POLL_MS = 15_000;
const VIDEO_EXT = /\.(webm|mp4|mov)$/i;

function message(err: unknown, fallback: string) {
  const raw = err instanceof Error ? err.message : fallback;
  try {
    const parsed = JSON.parse(raw) as { detail?: unknown; error?: { message?: string } };
    const detail = parsed.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      const nested = detail as { error?: string; message?: string };
      if (typeof nested.message === "string" && nested.message.trim()) return nested.message;
      if (typeof nested.error === "string" && nested.error.trim()) return nested.error;
    }
    if (Array.isArray(detail) && detail[0] && typeof detail[0] === "object") {
      const first = detail[0] as { msg?: string };
      if (typeof first.msg === "string" && first.msg.trim()) return first.msg;
    }
    if (typeof parsed.error?.message === "string" && parsed.error.message.trim()) {
      return parsed.error.message;
    }
  } catch {
    /* response was plain text */
  }
  return raw || fallback;
}

/** Relative path under desk root — never ".", never leading slash. */
export function normalizeRel(path: string | null | undefined): string {
  const raw = (path || "").replace(/\\/g, "/").trim();
  if (!raw || raw === ".") return "";
  return raw.replace(/^\/+/, "").replace(/\/+$/, "");
}

function joinRel(dir: string, name: string) {
  const base = normalizeRel(dir);
  const leaf = name.replace(/^\/+|\/+$/g, "");
  return base ? `${base}/${leaf}` : leaf;
}

function parentRel(dir: string) {
  const parts = normalizeRel(dir).split("/").filter(Boolean);
  if (parts.length === 0) return null;
  parts.pop();
  return parts.join("/");
}

function homeishRoot(rootParts: string[]): boolean {
  return rootParts.length === 2 && (rootParts[0] === "home" || rootParts[0] === "Users");
}

function storageKey(deviceId: string) {
  return `nebiusdesk.files.dir.${deviceId}`;
}

function readStoredDir(deviceId: string) {
  if (typeof window === "undefined") return "";
  try {
    return normalizeRel(sessionStorage.getItem(storageKey(deviceId)));
  } catch {
    return "";
  }
}

function writeStoredDir(deviceId: string, dir: string) {
  try {
    sessionStorage.setItem(storageKey(deviceId), normalizeRel(dir));
  } catch {
    /* private mode */
  }
}

export function crumbs(
  root: string | undefined,
  dir: string,
  opts?: { rootLabel?: string | null; isHome?: boolean }
): Crumb[] {
  const rootParts = (root ?? "").replace(/\\/g, "/").split("/").filter(Boolean);
  const rootTitle = rootParts.length ? `/${rootParts.join("/")}` : "/";
  const rootLabel =
    (opts?.rootLabel && opts.rootLabel.trim()) ||
    (opts?.isHome || homeishRoot(rootParts) ? "~" : rootParts.at(-1) || "root");
  const items: Crumb[] = [{ label: rootLabel, path: "", title: rootTitle }];
  let acc = "";
  for (const part of normalizeRel(dir).split("/").filter(Boolean)) {
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

export function useMachineFiles(deviceId: string) {
  const [dir, setDir] = useState(() => readStoredDir(deviceId));
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
  const [showDots, setShowDots] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(DOTS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  /** Object URL for image preview; revoked on close/navigate. */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<"image" | "video" | null>(null);
  const seq = useRef(0);
  const quietGen = useRef(0);
  const prevDir = useRef(dir);
  const dirRef = useRef(dir);
  const listingRef = useRef(listing);
  const filePathRef = useRef(filePath);
  const previewUrlRef = useRef<string | null>(null);
  const held = useRef(false);
  const working = useRef(false);
  dirRef.current = dir;
  listingRef.current = listing;
  filePathRef.current = filePath;

  const load = useCallback((path: string, opts?: { clear?: boolean; quiet?: boolean }) => {
    const target = normalizeRel(path);
    if (opts?.quiet) {
      const ticket = seq.current;
      const qid = ++quietGen.current;
      api()
        .listFiles(target)
        .then((data) => {
          if (qid !== quietGen.current || ticket !== seq.current) return;
          setListing({ ...data, path: normalizeRel(data.path) });
        })
        .catch(() => undefined);
      return;
    }
    const id = ++seq.current;
    quietGen.current += 1;
    setLoading(true);
    setError(null);
    if (opts?.clear) setListing(null);
    api()
      .listFiles(target)
      .then((data) => {
        if (id !== seq.current) return;
        setListing({ ...data, path: normalizeRel(data.path) });
        setError(null);
        prevDir.current = target;
      })
      .catch((err: unknown) => {
        if (id !== seq.current) return;
        setError(message(err, "Files unavailable"));
        if (prevDir.current !== target) setDir(prevDir.current);
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (held.current || document.hidden) return;
      load(dirRef.current, { quiet: true });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    writeStoredDir(deviceId, dir);
    load(dir, { clear: true });
  }, [deviceId, dir, load]);

  const dirty = filePath !== null && !previewKind && draft !== baseline;

  function revokePreview() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setPreviewKind(null);
  }

  function clearFile() {
    revokePreview();
    setFilePath(null);
    setDraft("");
    setBaseline("");
    setSaved(false);
    setFileError(null);
    setPending(null);
  }

  function openDir(path: string) {
    const next = normalizeRel(path);
    if (next === normalizeRel(dir)) {
      load(next, { clear: false });
      return;
    }
    guard({ kind: "dir", path: next }, () => {
      clearFile();
      setDir(next);
    });
  }

  async function openFile(path: string) {
    const target = normalizeRel(path);
    setOpening(true);
    setFileError(null);
    setSaved(false);
    setPending(null);
    revokePreview();
    if (VIDEO_EXT.test(target)) {
      // Streamed by the board; the <video> element fetches it directly.
      setFilePath(target);
      setPreviewUrl(api().rawFileUrl(target));
      setPreviewKind("video");
      setDraft("");
      setBaseline("");
      setOpening(false);
      return;
    }
    try {
      const file = await api().readFile(target);
      setFilePath(target);
      if (file.encoding === "base64" && file.media_type?.startsWith("image/")) {
        const bin = atob(file.content);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: file.media_type }));
        previewUrlRef.current = url;
        setPreviewUrl(url);
        setPreviewKind("image");
        setDraft("");
        setBaseline("");
        return;
      }
      setDraft(file.content);
      setBaseline(file.content);
    } catch (err) {
      const text = message(err, "Could not open that file");
      if (/directory/i.test(text)) {
        openDir(target);
        return;
      }
      setFilePath(target);
      setDraft("");
      setBaseline("");
      setFileError(text);
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

  function openEntry(name: string, kind: string) {
    const path = joinRel(dir, name);
    if (kind === "dir" || kind === "directory" || kind === "folder") {
      openDir(path);
      return;
    }
    if (path === filePath) return;
    guard({ kind: "file", path }, () => void openFile(path));
  }

  function goUp() {
    const parent = listing?.parent != null ? normalizeRel(listing.parent) : parentRel(dir);
    if (parent === null && !normalizeRel(dir)) return;
    openDir(parent ?? "");
  }

  function goHome() {
    openDir("");
  }

  function closeFile() {
    guard({ kind: "close" }, clearFile);
  }

  function discard() {
    const next = pending;
    clearFile();
    if (!next || next.kind === "close") return;
    if (next.kind === "dir") setDir(normalizeRel(next.path));
    else void openFile(next.path);
  }

  async function save() {
    if (!filePath || saving || !dirty || previewKind) return;
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

  function toggleDots() {
    setShowDots((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(DOTS_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function leafName(name: string) {
    const leaf = name.trim();
    if (!leaf || leaf === "." || leaf === ".." || /[\\/\u0000]/.test(leaf)) {
      setError("Use a name without slashes.");
      return null;
    }
    return leaf;
  }

  function nameTaken(leaf: string, except?: string) {
    return (listingRef.current?.entries ?? []).some((entry) => entry.name === leaf && entry.name !== except);
  }

  function retarget(path: string | null, from: string, to: string | null) {
    if (!path) return path;
    if (path === from) return to;
    if (path.startsWith(`${from}/`)) return to ? `${to}${path.slice(from.length)}` : null;
    return path;
  }

  async function refreshListing(path: string) {
    const target = normalizeRel(path);
    const ticket = seq.current;
    const qid = ++quietGen.current;
    try {
      const data = await api().listFiles(target);
      if (qid !== quietGen.current || ticket !== seq.current) return;
      setListing({ ...data, path: normalizeRel(data.path) });
    } catch {
      /* keep prior listing; next poll retries */
    }
  }

  async function runChange(work: () => Promise<void>, fallback: string) {
    if (working.current) {
      setError("Another file change is still running — try again in a moment.");
      return false;
    }
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
      await refreshListing(dirRef.current);
      return true;
    } catch (err) {
      setError(message(err, fallback));
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  async function createFolder(name: string) {
    const leaf = leafName(name);
    if (!leaf) return false;
    if (nameTaken(leaf)) {
      setError("That name already exists.");
      return false;
    }
    return runChange(() => api().mkdir(joinRel(dirRef.current, leaf)).then(() => undefined), "Could not create folder");
  }

  async function createFile(name: string) {
    const leaf = leafName(name);
    if (!leaf) return false;
    if (nameTaken(leaf)) {
      setError("That name already exists.");
      return false;
    }
    const path = joinRel(dirRef.current, leaf);
    const ok = await runChange(() => api().createFile(path).then(() => undefined), "Could not create file");
    if (ok) guard({ kind: "file", path }, () => void openFile(path));
    return ok;
  }

  async function renameEntry(fromName: string, toName: string) {
    const leaf = leafName(toName);
    if (!leaf) return false;
    if (leaf === fromName) return true;
    if (nameTaken(leaf, fromName)) {
      setError("That name already exists.");
      return false;
    }
    const from = joinRel(dirRef.current, fromName);
    return runChange(async () => {
      const renamed = await api().renameFile(from, leaf);
      const next = retarget(filePathRef.current, from, renamed.path || joinRel(dirRef.current, leaf));
      if (next !== filePathRef.current) setFilePath(next);
    }, "Could not rename that item");
  }

  async function deleteEntry(name: string) {
    const leaf = leafName(name);
    if (!leaf) return false;
    const path = joinRel(dirRef.current, leaf);
    return runChange(async () => {
      await api().deleteFile(path);
      const next = retarget(filePathRef.current, path, null);
      if (next !== filePathRef.current) {
        if (next) setFilePath(next);
        else clearFile();
      }
    }, "Could not delete that item");
  }

  /** Upload into the folder currently open in the browser (dirRef). */
  async function uploadItems(items: UploadItem[]) {
    if (!items.length) return false;
    for (const item of items) {
      const bad = validateUploadSize(item);
      if (bad) {
        setError(bad);
        return false;
      }
      const rel = normalizeRel(item.relativePath);
      if (!rel || rel.split("/").some((part) => part === ".." || part === "")) {
        setError("Invalid upload path.");
        return false;
      }
    }
    return runChange(async () => {
      const targetDir = dirRef.current;
      const dirs = new Set<string>();
      for (const item of items) {
        const parts = normalizeRel(item.relativePath).split("/").filter(Boolean);
        const isDir = "kind" in item && item.kind === "dir";
        const folderParts = isDir ? parts : parts.slice(0, -1);
        let acc = "";
        for (const part of folderParts) {
          acc = acc ? `${acc}/${part}` : part;
          dirs.add(joinRel(targetDir, acc));
        }
      }
      for (const folder of [...dirs].sort((a, b) => a.length - b.length)) {
        await api().mkdir(folder);
      }
      for (const item of items) {
        if ("kind" in item && item.kind === "dir") continue;
        if (!("file" in item)) continue;
        const path = joinRel(targetDir, item.relativePath);
        const contentB64 = await fileToBase64(item.file);
        await api().uploadFile(path, contentB64, true);
      }
    }, "Could not upload into this folder");
  }

  const hold = useCallback((on: boolean) => {
    held.current = on;
  }, []);

  const entries = (listing?.entries ?? []).filter((entry) => showDots || !entry.name.startsWith("."));
  const folderLabel = normalizeRel(dir).split("/").filter(Boolean).at(-1) || listing?.root_label || "~";

  return {
    dir: normalizeRel(dir),
    listing,
    entries,
    folderLabel,
    loading,
    error,
    filePath,
    draft,
    previewUrl,
    previewKind,
    mediaFailed: setFileError,
    opening,
    saving,
    saved,
    dirty,
    fileError,
    pending,
    showDots,
    busy,
    canGoUp: Boolean(normalizeRel(dir)),
    hold,
    reload: () => load(dir, { clear: false }),
    openDir,
    openEntry,
    goUp,
    goHome,
    closeFile,
    discard,
    keepEditing: () => setPending(null),
    save,
    edit,
    toggleDots,
    createFolder,
    createFile,
    renameEntry,
    deleteEntry,
    uploadItems,
  };
}
