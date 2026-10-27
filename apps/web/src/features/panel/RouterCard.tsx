"use client";

import { fmtWindow } from "@/features/panel/format";
import type { ModelsState } from "@/features/panel/useModels";
import styles from "./Panel.module.css";

const ROLE_LABEL: Record<string, string> = {
  nano: "Short cloud",
  fast: "Everyday",
  heavy: "Deep reasoning",
  ultra: "Largest",
};

function capability(context: number, input: number | null, output: number | null, note: string) {
  const parts: string[] = [];
  const window = fmtWindow(context);
  if (window) parts.push(`${window} context`);
  if (input == null || output == null) parts.push(note);
  else parts.push(`$${input} in`, `$${output} out`);
  return parts.join(" · ");
}

export function RouterCard({ state }: { state: ModelsState }) {
  const { data, error, loading } = state;
  return (
    <section className={styles.card} aria-label="Router models">
      <header className={styles.cardHead}>
        <h3>Models</h3>
        {data ? <span className={styles.badge}>{data.llm_mode}</span> : null}
      </header>
      <p className={styles.footnote}>Each message goes to the cheapest model that can answer it.</p>
      {loading && !data ? <p className={styles.muted}>Loading models…</p> : null}
      {error && !data ? <p className={styles.muted}>Model list unavailable.</p> : null}
      {data ? (
        <ul className={styles.models}>
          <li data-route="edge">
            <span className={styles.modelRole}>Simple · on the board</span>
            <span className={styles.modelName}>{data.local.model}</span>
            <span className={styles.num}>
              {capability(data.local.context_window, null, null, data.local.available ? "free" : "not running")}
            </span>
          </li>
          {data.cloud.filter((m) => m.role !== "ultra").map((m) => (
            <li key={m.role} data-route="cloud">
              <span className={styles.modelRole}>{ROLE_LABEL[m.role] ?? m.role} · Nebius</span>
              <span className={styles.modelName}>{m.model}</span>
              <span className={styles.num}>
                {capability(m.context_window, m.input_per_m, m.output_per_m, "")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
