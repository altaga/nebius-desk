"use client";

import { useCallback, useEffect, useState } from "react";
import { memoryFact, memoryFileName } from "@/shared/memoryFile";
import { api } from "@/lib/api";
import styles from "./DeviceMemoryPanel.module.css";

type Entry = {
  id: number;
  title: string;
  content: string;
};

type Props = {
  deviceId: string;
};

export function DeviceMemoryPanel({ deviceId }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api()
      .listDeviceMemory(deviceId)
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : "Memory load failed"));
  }, [deviceId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function addNote() {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    try {
      await api().addDeviceMemory(deviceId, content);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <aside className={styles.panel}>
      <h3>Shared memory</h3>
      <p className={styles.hint}>Markdown files every chat on this device can read.</p>
      <ul>
        {entries.length === 0 ? (
          <li className={styles.muted}>No memory files yet</li>
        ) : (
          entries.map((e) => (
            <li key={e.id}>
              <strong>{memoryFileName(e.title || "memory")}</strong>
              <span>{memoryFact(e.content)}</span>
            </li>
          ))
        )}
      </ul>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="A fact this board should remember"
        rows={3}
      />
      <button type="button" onClick={() => void addNote()}>
        Save to memory
      </button>
      {error ? <p className={styles.error}>{error}</p> : null}
    </aside>
  );
}
