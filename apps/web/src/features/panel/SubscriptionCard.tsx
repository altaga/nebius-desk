"use client";

import { pct } from "@/features/panel/format";
import { Meter } from "@/features/panel/Meter";
import { usePolled } from "@/features/panel/usePolled";
import { api } from "@/lib/api";
import styles from "./Panel.module.css";

const LANE: Record<string, string> = {
  access: "Access",
  jetson: "On the board",
  nebius: "Nebius",
  tavily: "Tavily",
};

export function SubscriptionCard({ refreshKey }: { refreshKey: unknown }) {
  const { data, error } = usePolled(() => api().subscription(), 60_000, [refreshKey]);

  if (error) return <p className={styles.muted}>Plan unavailable.</p>;
  if (!data) return <p className={styles.muted}>Loading plan…</p>;

  const cloud = data.allowances;
  const cloudSpent = cloud.cloud_credit_usd - cloud.cloud_remaining_usd;

  return (
    <>
      <section className={styles.card} aria-label="Plan balances">
        <header className={styles.cardHead}>
          <h3>Balances</h3>
          <span className={styles.status} data-ok={data.active}>
            {data.plan_name} · {data.status}
          </span>
        </header>
        <div className={styles.row}>
          <span>Nebius credits</span>
          <span className={styles.num}>
            ${cloud.cloud_remaining_usd.toFixed(2)} of ${cloud.cloud_credit_usd.toFixed(2)} left
          </span>
          <Meter
            label="Nebius credits spent"
            total={100}
            segments={[{ label: "Spent", value: pct(cloudSpent, cloud.cloud_credit_usd), color: "var(--cloud)" }]}
          />
        </div>
        <div className={styles.row}>
          <span>Tavily searches</span>
          <span className={styles.num}>
            {cloud.tavily_credits_remaining} of {cloud.tavily_credits} left
          </span>
          <Meter
            label="Tavily credits spent"
            total={100}
            segments={[
              {
                label: "Spent",
                value: pct(cloud.tavily_credits - cloud.tavily_credits_remaining, cloud.tavily_credits),
                color: "var(--cloud)",
              },
            ]}
          />
        </div>
        <p className={styles.footnote}>Remote access and work on the board are unlimited.</p>
      </section>

      <section className={styles.card} aria-label="Savings">
        <header className={styles.cardHead}>
          <h3>Saved by the board</h3>
        </header>
        <p className={styles.title}>
          <span className={styles.num}>${data.savings.avoided_usd.toFixed(2)}</span>
          <span className={styles.sub}>
            {" "}
            on {data.savings.local_turns} {data.savings.local_turns === 1 ? "answer" : "answers"} that never left it
          </span>
        </p>
        <p className={styles.footnote}>Priced as if Nebius had answered them.</p>
      </section>

      <details className={styles.card}>
        <summary className={styles.summary}>What the plan includes ({data.tools.length})</summary>
        <ul className={styles.tools}>
          {data.tools.map((tool) => (
            <li key={tool.id} data-lane={tool.lane} data-included={tool.included}>
              <span className={styles.toolLane}>{LANE[tool.lane] ?? tool.lane}</span>
              <span className={styles.toolName}>{tool.name}</span>
              <span className={styles.toolDetail}>{tool.detail}</span>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
