"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import styles from "./ArtifactsPanel.module.css";

type Tab = "monitor" | "notes";

export function ArtifactsPanel() {
  const [tab, setTab] = useState<Tab>("monitor");
  const [edge, setEdge] = useState<Record<string, unknown> | null>(null);
  const [budget, setBudget] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const [e, b] = await Promise.all([api().edgeStats(), api().budget()]);
        if (!alive) return;
        setEdge(e);
        setBudget(b);
      } catch {
        /* not authed yet */
      }
    }
    void tick();
    const id = setInterval(() => void tick(), 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <aside className={styles.panel}>
      <div className={styles.tabs}>
        <button
          type="button"
          className={tab === "monitor" ? styles.active : undefined}
          onClick={() => setTab("monitor")}
        >
          Jetson Edge Monitor
        </button>
        <button
          type="button"
          className={tab === "notes" ? styles.active : undefined}
          onClick={() => setTab("notes")}
        >
          Notes
        </button>
      </div>

      {tab === "monitor" ? (
        <div className={styles.body}>
          <h3>Edge telemetry</h3>
          {edge ? (
            <dl className={styles.stats}>
              <div>
                <dt>GPU</dt>
                <dd>{String(edge.gpu_util_pct)}%</dd>
              </div>
              <div>
                <dt>RAM</dt>
                <dd>
                  {String(edge.ram_used_mb)} / {String(edge.ram_total_mb)} MB
                </dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{String(edge.source)}</dd>
              </div>
            </dl>
          ) : (
            <p className={styles.muted}>Waiting for edge stats…</p>
          )}

          <h3>Nebius budget</h3>
          {budget ? (
            <dl className={styles.stats}>
              <div>
                <dt>Mode</dt>
                <dd>{String(budget.llm_mode)}</dd>
              </div>
              <div>
                <dt>Spent today</dt>
                <dd>${Number(budget.daily_spent_usd).toFixed(4)}</dd>
              </div>
              <div>
                <dt>Remaining</dt>
                <dd>${Number(budget.remaining_usd).toFixed(4)}</dd>
              </div>
            </dl>
          ) : (
            <p className={styles.muted}>Budget guard ready in dummy mode.</p>
          )}
        </div>
      ) : (
        <div className={styles.body}>
          <h3>Artifact scratchpad</h3>
          <p className={styles.muted}>
            Live Mermaid / code artifacts land here next. For now this panel hosts the
            Jetson monitor judges will see in the demo video.
          </p>
        </div>
      )}
    </aside>
  );
}
