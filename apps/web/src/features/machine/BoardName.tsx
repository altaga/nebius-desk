"use client";

import { useEffect, useState } from "react";
import styles from "./Machine.module.css";

type Props = {
  name: string;
  onRename: (name: string) => Promise<void>;
};

export function BoardName({ name, onRename }: Props) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const dirty = draft.trim() !== name && draft.trim().length > 0;

  useEffect(() => setDraft(name), [name]);

  async function save() {
    if (!dirty) return;
    setError(null);
    try {
      await onRename(draft.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
    }
  }

  return (
    <form
      className={styles.board}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label>
        Board
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Board name"
          maxLength={120}
        />
      </label>
      <button type="submit" disabled={!dirty}>
        Rename
      </button>
      {error ? <p className={styles.error}>{error}</p> : null}
    </form>
  );
}
