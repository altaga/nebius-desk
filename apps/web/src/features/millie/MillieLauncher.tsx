"use client";

import { IconSparkle } from "@/ui/icons";
import styles from "./MillieOverlay.module.css";

export function MillieLauncher({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className={styles.launcher} onClick={onOpen} aria-label="Open Millie guide">
      <IconSparkle size={16} />
      <span>Millie</span>
    </button>
  );
}
