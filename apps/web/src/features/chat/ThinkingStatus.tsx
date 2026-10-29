"use client";

import { useEffect, useState } from "react";
import { ActivityFeed } from "@/features/chat/ActivityFeed";
import { formatElapsed, type LiveStep } from "@/features/chat/liveProgress";
import { useThinkingPhrase } from "@/features/chat/useThinkingPhrase";
import styles from "./ChatPane.module.css";

const QUIET_STATUS = new Set(["Running board tools…"]);

type Props = {
  mode: "routing" | "thinking";
  deviceName?: string;
  /** Epoch ms when the current send started — drives the live timer. */
  startedAt?: number | null;
  statusText?: string | null;
  steps?: LiveStep[];
};

function useElapsed(startedAt: number | null | undefined, active: boolean): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!active || !startedAt) {
      setMs(0);
      return;
    }
    const tick = () => setMs(Date.now() - startedAt);
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [active, startedAt]);
  return ms;
}

export function ThinkingStatus({
  mode,
  deviceName = "Board",
  startedAt,
  statusText,
  steps = [],
}: Props) {
  const phrase = useThinkingPhrase(mode === "thinking" && !statusText && steps.length === 0);
  const elapsed = useElapsed(startedAt, true);
  const board = deviceName.trim() || "Board";
  const spoken = statusText && !QUIET_STATUS.has(statusText) ? statusText : null;
  const headline =
    mode === "routing" ? "Routing" : spoken || (steps.length ? null : phrase);

  return (
    <div
      className={styles.working}
      role="status"
      aria-label={`${board} is working — ${formatElapsed(elapsed)}`}
    >
      <div className={styles.workingHead}>
        <span className={styles.scan} aria-hidden />
        {headline ? (
          <span key={headline} className={styles.phrase}>
            {headline}
          </span>
        ) : (
          <span className={styles.phrase}>Working</span>
        )}
        <span className={styles.elapsed} aria-live="polite">
          {formatElapsed(elapsed)}
        </span>
      </div>
      <ActivityFeed steps={steps} live />
    </div>
  );
}
