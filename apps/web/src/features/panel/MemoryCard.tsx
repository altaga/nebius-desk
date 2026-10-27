"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MemoryFileDialog } from "@/features/panel/MemoryFileDialog";
import { memoryFact, memoryFileName } from "@/shared/memoryFile";
import { api } from "@/lib/api";
import styles from "./Panel.module.css";

type Entry = { id: number; title: string; content: string };

type Props = {
  deviceId: string;
  version: number;
  onUse: (prompt: string) => void;
  onCount?: (count: number) => void;
};

export function MemoryCard({ deviceId, version, onUse, onCount }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const report = useRef(onCount);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  report.current = onCount;

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  function flashSaved() {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1200);
  }

  function applyEntries(next: Entry[]) {
    setEntries(next);
    report.current?.(next.length);
  }

  const reload = useCallback(() => {
    setError(null);
    api()
      .listDeviceMemory(deviceId)
      .then((rows) => applyEntries(rows))
      .catch((err) => setError(err instanceof Error ? err.message : "Memory unavailable"))
      .finally(() => setLoading(false));
  }, [deviceId]);

  useEffect(() => {
    reload();
  }, [reload, version]);

  function save() {
    const content = draft.trim();
    const title = name.trim();
    if (!content || !title) return;
    setError(null);
    const tempId = -Date.now();
    const prev = entries;
    applyEntries([...prev, { id: tempId, title, content }]);
    setName("");
    setDraft("");
    flashSaved();
    void api()
      .addDeviceMemory(deviceId, content, title)
      .then((row) => {
        setEntries((current) => current.map((entry) => (entry.id === tempId ? row : entry)));
      })
      .catch((err) => {
        applyEntries(prev);
        setSaved(false);
        setError(err instanceof Error ? err.message : "Save failed");
      });
  }

  return (
    <section className={styles.card} aria-label="Shared memory">
      <header className={styles.cardHead}>
        <h3>Shared memory</h3>
        <span className={styles.num}>{entries.length}</span>
      </header>
      {loading ? <p className={styles.muted}>Loading…</p> : null}
      {!loading && entries.length === 0 ? <p className={styles.muted}>No memory files yet.</p> : null}
      <ul className={styles.files}>
        {entries.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              className={styles.openFile}
              disabled={e.id < 0}
              onClick={() => {
                if (e.id < 0) return;
                setOpen(e);
              }}
            >
              <span className={styles.fileName}>{memoryFileName(e.title || "memory")}</span>
              <span className={styles.fact}>{memoryFact(e.content)}</span>
            </button>
          </li>
        ))}
      </ul>
      <form
        className={styles.memoryForm}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          value={name}
          placeholder="Name"
          aria-label="New memory name"
          onChange={(e) => setName(e.target.value)}
        />
        <input
          value={draft}
          placeholder="A fact this board should remember"
          aria-label="New shared memory fact"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={(!name.trim() || !draft.trim()) && !saved}>
          {saved ? "Saved" : "Save"}
        </button>
      </form>
      {open ? (
        <MemoryFileDialog
          deviceId={deviceId}
          entry={open}
          onClose={() => setOpen(null)}
          onSaved={reload}
          onUse={onUse}
        />
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
