"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import styles from "@/features/panel/Panel.module.css";

function message(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

export function VaultCard({ onCount }: { onCount?: (count: number) => void }) {
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
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

  function applyNames(next: string[]) {
    setNames(next);
    report.current?.(next.length);
  }

  const reload = useCallback(() => {
    setError(null);
    api()
      .listSecrets()
      .then((rows) => {
        const next = rows.map((row) => row.name);
        applyNames(next);
      })
      .catch((err) => setError(message(err, "Secrets unavailable")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  function save() {
    const clean = name.trim();
    const secret = value;
    if (!clean || !secret) return;
    setError(null);
    const prev = names;
    applyNames(prev.includes(clean) ? prev : [...prev, clean]);
    setName("");
    setValue("");
    flashSaved();
    void api()
      .putSecret(clean, secret)
      .catch((err) => {
        applyNames(prev);
        setSaved(false);
        setError(message(err, "Could not save the secret"));
      });
  }

  function remove(item: string) {
    const prev = names;
    applyNames(prev.filter((row) => row !== item));
    setError(null);
    void api()
      .deleteSecret(item)
      .catch((err) => {
        applyNames(prev);
        setError(message(err, "Could not remove the secret"));
      });
  }

  return (
    <section className={styles.card} aria-label="Execution secrets">
      <header className={styles.cardHead}>
        <h3>Execution secrets</h3>
        <span className={styles.num}>{names.length}</span>
      </header>
      <p className={styles.footnote}>Chats can use the names. The desk never shows the values again.</p>
      {loading ? <p className={styles.muted}>Loading…</p> : null}
      {!loading && names.length === 0 ? <p className={styles.muted}>No secrets yet.</p> : null}
      <ul className={styles.notes}>
        {names.map((item) => (
          <li key={item}>
            <span className={styles.num}>{item}</span>
            <button type="button" className={styles.ghost} onClick={() => remove(item)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className={styles.secretForm}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <input
          value={name}
          placeholder="NAME"
          aria-label="Secret name"
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
        <input
          value={value}
          type="password"
          placeholder="Value"
          aria-label="Secret value"
          autoComplete="new-password"
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" disabled={(!name.trim() || !value) && !saved}>
          {saved ? "Saved" : "Save"}
        </button>
      </form>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
