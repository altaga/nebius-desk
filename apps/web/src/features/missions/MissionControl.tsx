"use client";

import { useEffect, useState } from "react";
import type { MissionThread } from "@nebius-desk/shared/index";
import { api } from "@/lib/api";
import styles from "./MissionControl.module.css";

export function MissionControl() {
  const [threads, setThreads] = useState<MissionThread[]>([]);
  const [forking, setForking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await api().listThreads("main");
      setThreads(res.threads);
    } catch {
      /* ignore until authed */
    }
  }

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 2500);
    return () => clearInterval(id);
  }, []);

  async function launchDemo() {
    setForking(true);
    setError(null);
    try {
      await api().forkMissions([
        "resume este log: ERROR timeout redis 500ms",
        "traduce este párrafo al inglés: El enrutador híbrido ahorra tokens",
        "diseña la arquitectura de un API FastAPI multi-sesión",
      ]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fork failed");
    } finally {
      setForking(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h3>Active Agent Threads</h3>
        <button type="button" onClick={() => void launchDemo()} disabled={forking}>
          {forking ? "Forking…" : "Fork ×3"}
        </button>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      <ul className={styles.list}>
        {threads.length === 0 ? (
          <li className={styles.empty}>No parallel workers yet</li>
        ) : (
          threads.map((t) => (
            <li key={t.id}>
              <strong>{t.status}</strong>
              <span>{t.label}</span>
              <em>{t.route || "—"}</em>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
