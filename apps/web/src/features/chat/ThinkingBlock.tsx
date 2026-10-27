"use client";

import { useState } from "react";
import { fmtCount } from "@/features/chat/format";
import { useThinkingPhrase } from "@/features/chat/useThinkingPhrase";
import { IconChevronRight } from "@/ui/icons";
import styles from "./AssistantTurn.module.css";

type Props = {
  text: string;
  live: boolean;
  tokens?: number;
};

export function ThinkingBlock({ text, live, tokens }: Props) {
  const [open, setOpen] = useState(false);
  const phrase = useThinkingPhrase(live);
  const expanded = open || (live && text.length > 0);
  const label = live ? phrase : `Reasoned${tokens ? ` · ${fmtCount(tokens)} tokens` : ""}`;

  return (
    <div className={styles.thinking} data-live={live}>
      <button type="button" aria-expanded={expanded} onClick={() => setOpen((v) => !v)}>
        <IconChevronRight size={12} className={styles.chev} data-open={expanded} />
        {label}
      </button>
      {expanded ? <p className={styles.thinkingText}>{live ? text.slice(-1200) : text}</p> : null}
    </div>
  );
}
