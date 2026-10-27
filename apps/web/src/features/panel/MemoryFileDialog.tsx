"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { memoryFact, memoryFileName } from "@/shared/memoryFile";
import { api } from "@/lib/api";
import styles from "./MemoryFileDialog.module.css";

type Entry = { id: number; title: string; content: string };

type Props = {
  deviceId: string;
  entry: Entry;
  onClose: () => void;
  onSaved: () => void;
  onUse: (prompt: string) => void;
};

export function MemoryFileDialog({ deviceId, entry, onClose, onSaved, onUse }: Props) {
  const titleId = useId();
  const [name, setName] = useState(entry.title);
  const [fact, setFact] = useState(memoryFact(entry.content));
  const [file, setFile] = useState(entry.content);
  const [savedName, setSavedName] = useState(entry.title);
  const [savedFact, setSavedFact] = useState(memoryFact(entry.content));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = name.trim() !== savedName || fact.trim() !== savedFact;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    const title = name.trim();
    const content = fact.trim();
    if (!title || !content || saving) return Promise.resolve(null);
    const baselineName = savedName;
    const baselineFact = savedFact;
    const baselineFile = file;
    setSaving(true);
    setError(null);
    setFile(`# ${title}\n\n${content}\n`);
    setSavedName(title);
    setSavedFact(content);
    return api()
      .updateDeviceMemory(deviceId, entry.id, content, title)
      .then((saved) => {
        const factText = memoryFact(saved.content);
        setFile(saved.content);
        setName(saved.title);
        setFact(factText);
        setSavedName(saved.title);
        setSavedFact(factText);
        onSaved();
        return saved;
      })
      .catch((err) => {
        setFile(baselineFile);
        setSavedName(baselineName);
        setSavedFact(baselineFact);
        setError(err instanceof Error ? err.message : "Could not save this memory");
        return null;
      })
      .finally(() => setSaving(false));
  }

  async function useMemory() {
    const title = name.trim();
    if (!title) return;
    if (dirty) {
      const saved = await save();
      if (!saved) return;
    }
    onUse(`Using memory "${title}": `);
    onClose();
  }

  return createPortal(
    <div className={styles.scrim} onMouseDown={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <h2 id={titleId}>{memoryFileName(name || entry.title)}</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <pre className={styles.file}>{file}</pre>
        <label>
          Name
          <input value={name} aria-label="Memory name" onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Fact
          <textarea
            value={fact}
            rows={4}
            aria-label="Memory fact"
            onChange={(event) => setFact(event.target.value)}
          />
        </label>
        {error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.actions}>
          <button type="button" onClick={() => void useMemory()} disabled={saving || !name.trim()}>
            Use in chat
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !dirty || !name.trim() || !fact.trim()}
          >
            {saving ? "Saved" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
