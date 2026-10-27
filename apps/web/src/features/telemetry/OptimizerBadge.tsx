"use client";

import styles from "./OptimizerBadge.module.css";

type Props = {
  badge?: string | null;
  savedPct?: number;
  dummy?: boolean;
};

export function OptimizerBadge({ badge, savedPct, dummy }: Props) {
  if (!badge) {
    return <div className={styles.idle}>Jetson Optimizer standby</div>;
  }
  return (
    <div className={styles.badge} title={badge}>
      <span className={styles.dot} />
      <span>
        Jetson Optimizer Active
        {typeof savedPct === "number" ? ` · ${savedPct}%` : ""}
        {dummy ? " · dummy" : ""}
      </span>
    </div>
  );
}
