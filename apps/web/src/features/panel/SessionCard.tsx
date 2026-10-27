"use client";

import type { SessionTelemetry } from "@nebius-desk/shared/index";
import { fmtCost, shortModel } from "@/features/chat/format";
import { fmtTokens, pct } from "@/features/panel/format";
import { Meter } from "@/features/panel/Meter";
import type { ModelsState } from "@/features/panel/useModels";
import styles from "./Panel.module.css";

type Props = {
  telemetry: SessionTelemetry | null;
  models: ModelsState["data"];
  onNewChat: () => void;
};

function windowFor(models: Props["models"], telemetry: SessionTelemetry | null): number {
  if (!models || !telemetry?.last_model) return 0;
  if (telemetry.last_route === "local") return models.local.context_window;
  return models.cloud.find((m) => m.model === telemetry.last_model)?.context_window ?? 0;
}

export function SessionCard({ telemetry, models, onNewChat }: Props) {
  const used = telemetry?.last_prompt_tokens ?? 0;
  const window = windowFor(models, telemetry);
  const local = telemetry?.local_tokens ?? 0;
  const cloud = telemetry?.nebius_tokens ?? 0;

  if (!telemetry?.turns) {
    return (
      <section className={styles.card} aria-label="Session">
        <header className={styles.cardHead}>
          <h3>Usage</h3>
        </header>
        <p className={styles.muted}>Nothing yet. Send a message and its cost shows here.</p>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-label="Session">
      <header className={styles.cardHead}>
        <h3>Usage</h3>
        <span className={styles.num}>
          {telemetry.turns} {telemetry.turns === 1 ? "answer" : "answers"} · {fmtCost(telemetry.cost_usd)}
        </span>
      </header>

      <p className={styles.label}>Where the answers ran</p>
      <Meter
        label="Tokens processed on the Jetson versus Nebius"
        total={local + cloud}
        segments={[
          { label: "Jetson", value: local, color: "var(--edge)" },
          { label: "Nebius", value: cloud, color: "var(--cloud)" },
        ]}
      />
      <ul className={styles.legend}>
        <li>
          <i style={{ background: "var(--edge)" }} />
          <span className={styles.lane}>On the board</span>
          <span className={styles.num}>{fmtTokens(local)} tokens · free</span>
        </li>
        <li>
          <i style={{ background: "var(--cloud)" }} />
          <span className={styles.lane}>On Nebius</span>
          <span className={styles.num}>
            {fmtTokens(cloud)} tokens · {fmtCost(telemetry.cost_usd)}
          </span>
        </li>
      </ul>
      {telemetry.saved_tokens ? (
        <p className={styles.footnote}>
          Compression kept {fmtTokens(telemetry.saved_tokens)} tokens ({Math.round(telemetry.saved_pct)}%) from being
          sent to Nebius.
        </p>
      ) : null}

      <div className={`${styles.row} ${styles.split}`}>
        <span title={telemetry.last_model ?? undefined}>
          Memory of the last message · {shortModel(telemetry.last_model ?? "")}
        </span>
        <span className={styles.num}>
          {fmtTokens(used)}
          {window ? ` of ${fmtTokens(window)}` : ""}
        </span>
        <Meter
          label="Last prompt size versus model context window"
          total={100}
          segments={[{ label: "Last prompt", value: Math.max(pct(used, window), used ? 0.6 : 0), color: "var(--ink-2)" }]}
        />
      </div>
      <button type="button" className={styles.ghost} onClick={onNewChat}>
        Start fresh chat
      </button>
    </section>
  );
}
