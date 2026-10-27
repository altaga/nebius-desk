"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import panel from "@/features/panel/Panel.module.css";
import { profileAngle, profileMethod } from "@/features/library/profileFile";
import styles from "./BrainCard.module.css";

type Brain = {
  id: string;
  name: string;
  description: string;
  device_id?: string | null;
  profile?: string;
};

function message(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function draftProfile(angle: string, method: string) {
  const body = [`## Angle`, angle];
  if (method) body.push("", "## Method", method);
  return body.join("\n");
}

export function BrainCard({
  deviceId,
  onUse,
  onCount,
}: {
  deviceId: string;
  onUse: (prompt: string) => void;
  onCount?: (count: number) => void;
}) {
  const [brains, setBrains] = useState<Brain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [angle, setAngle] = useState("");
  const [method, setMethod] = useState("");
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

  function applyBrains(next: Brain[]) {
    setBrains(next);
    report.current?.(next.length);
  }

  const reload = useCallback(() => {
    setError(null);
    api()
      .listBrains()
      .then((rows) => applyBrains(rows))
      .catch((err) => setError(message(err, "Experts unavailable")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload, deviceId]);

  function create() {
    const clean = name.trim();
    const nextAngle = angle.trim();
    const nextMethod = method.trim();
    if (!clean || !nextAngle) return;
    setError(null);
    const tempId = `pending-${Date.now()}`;
    const prev = brains;
    const optimistic: Brain = {
      id: tempId,
      name: clean,
      description: nextAngle,
      device_id: deviceId,
      profile: draftProfile(nextAngle, nextMethod),
    };
    applyBrains([...prev, optimistic]);
    setName("");
    setAngle("");
    setMethod("");
    flashSaved();
    void api()
      .createBrain(clean, nextAngle, deviceId, nextMethod)
      .then((row) => {
        setBrains((current) =>
          current.map((brain) =>
            brain.id === tempId
              ? {
                  ...brain,
                  id: row.id,
                  name: row.name,
                  profile: row.profile,
                  description: nextAngle,
                }
              : brain,
          ),
        );
      })
      .catch((err) => {
        applyBrains(prev);
        setSaved(false);
        setError(message(err, "Could not save the expert"));
      });
  }

  function remove(brainId: string) {
    const prev = brains;
    applyBrains(prev.filter((brain) => brain.id !== brainId));
    setError(null);
    void api()
      .deleteBrain(brainId)
      .catch((err) => {
        applyBrains(prev);
        setError(message(err, "Could not delete the expert"));
      });
  }

  return (
    <section className={panel.card} aria-label="Expert profiles">
      <header className={panel.cardHead}>
        <h3>Experts</h3>
        <span className={panel.num}>{brains.length}</span>
      </header>
      {loading ? <p className={panel.muted}>Loading…</p> : null}
      {!loading && brains.length === 0 ? <p className={panel.muted}>No experts yet.</p> : null}
      {brains.map((brain) => (
        <ExpertRow
          key={brain.id}
          brain={brain}
          onDelete={() => remove(brain.id)}
          onUse={() => onUse(`@${brain.name} `)}
        />
      ))}
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <input
          value={name}
          placeholder="Expert name"
          aria-label="Expert name"
          onChange={(event) => setName(event.target.value)}
        />
        <input
          value={angle}
          placeholder="Angle on the work"
          aria-label="Expert angle"
          onChange={(event) => setAngle(event.target.value)}
        />
        <textarea
          value={method}
          placeholder="How they would do it"
          aria-label="Expert method"
          rows={2}
          onChange={(event) => setMethod(event.target.value)}
        />
        <button type="submit" disabled={(!name.trim() || !angle.trim()) && !saved}>
          {saved ? "Saved" : "Add expert"}
        </button>
      </form>
      {error ? (
        <p className={panel.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function ExpertRow({ brain, onDelete, onUse }: { brain: Brain; onDelete: () => void; onUse: () => void }) {
  const angle = profileAngle(brain.profile, brain.description);
  const method = profileMethod(brain.profile);
  return (
    <article className={styles.brain}>
      <header className={styles.head}>
        <h4 className={styles.name}>{brain.name}</h4>
        <code className={styles.call}>@{brain.name}</code>
        <button type="button" className={styles.remove} onClick={onUse}>
          Use
        </button>
        <button
          type="button"
          className={styles.remove}
          disabled={brain.id.startsWith("pending-")}
          onClick={onDelete}
        >
          Delete
        </button>
      </header>
      <p className={styles.angle}>{angle || "No angle yet."}</p>
      {method ? <p className={styles.method}>{method}</p> : null}
    </article>
  );
}
