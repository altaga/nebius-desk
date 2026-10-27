"use client";

import { useThinkingPhrase } from "@/features/chat/useThinkingPhrase";
import styles from "./ChatPane.module.css";

type Props = { mode: "routing" | "thinking"; deviceName?: string };

export function ThinkingStatus({ mode, deviceName = "Board" }: Props) {
  const phrase = useThinkingPhrase(mode === "thinking");
  const label = mode === "routing" ? "Routing" : phrase;
  const board = deviceName.trim() || "Board";

  return (
    <div className={styles.working} role="status" aria-label={mode === "routing" ? "Routing" : `${board} is thinking`}>
      <span className={styles.scan} aria-hidden />
      <span key={label} className={styles.phrase}>
        {label}
      </span>
    </div>
  );
}
