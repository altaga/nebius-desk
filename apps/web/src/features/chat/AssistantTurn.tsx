"use client";

import { useState } from "react";
import type { ChatMessage } from "@nebius-desk/shared/index";
import { fmtCost, fmtCount, fmtMs, shortModel } from "@/features/chat/format";
import { MessageBody } from "@/features/chat/MessageBody";
import { RouteDetails } from "@/features/chat/RouteDetails";
import { ThinkingBlock } from "@/features/chat/ThinkingBlock";
import type { UiMessage } from "@/features/chat/useChatSession";
import { timeAgo } from "@/lib/time";
import { IconCheck, IconChevronRight, IconCopy, IconRetry } from "@/ui/icons";
import styles from "./AssistantTurn.module.css";

type Props = {
  message: UiMessage;
  isLast: boolean;
  onRetry: () => void;
  deviceName?: string;
};

export function routeOf(meta: ChatMessage["meta"]): "edge" | "cloud" | null {
  if (!meta?.route) return null;
  return meta.route.startsWith("local") ? "edge" : "cloud";
}

function summary(meta: NonNullable<ChatMessage["meta"]>, pending: boolean): string {
  if (pending) return "";
  const tokens = (meta.prompt_tokens ?? 0) + (meta.completion_tokens ?? 0);
  return [`${fmtCount(tokens)} tok`, fmtCost(meta.cost_usd), fmtMs(meta.latency_ms)].filter(Boolean).join(" · ");
}

export function AssistantTurn({ message, isLast, onRetry, deviceName = "Board" }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const meta = message.meta;
  const route = routeOf(meta);
  const pending = !!message.pending;
  const board = deviceName.trim() || "Board";

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <article className={styles.turn} data-route={route ?? "none"} aria-busy={pending}>
      {meta && route ? (
        <button
          type="button"
          className={styles.route}
          aria-expanded={open}
          disabled={pending}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={styles.where}>{board}</span>
          <span title={meta.model}>{shortModel(meta.model)}</span>
          {pending ? <span className={styles.live}>streaming</span> : <span>{summary(meta, pending)}</span>}
          {!pending ? <IconChevronRight size={12} className={styles.chev} data-open={open} /> : null}
        </button>
      ) : null}
      {open && meta ? <RouteDetails meta={meta} deviceName={board} /> : null}
      {meta?.budget_note && route === "cloud" && !open ? <p className={styles.note}>{meta.budget_note}</p> : null}

      {meta?.thinking ? (
        <ThinkingBlock text={meta.thinking} live={pending && !message.content} tokens={meta.reasoning_tokens} />
      ) : null}

      {message.content ? (
        <MessageBody content={message.content} />
      ) : pending ? (
        <span className={styles.caret} aria-label="Waiting for the first token" />
      ) : null}

      {!pending ? (
        <footer className={styles.actions} data-last={isLast}>
          <button type="button" onClick={() => void copy()} aria-label="Copy response" title="Copy">
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          </button>
          <button type="button" onClick={onRetry} aria-label="Regenerate" title="Regenerate">
            <IconRetry size={14} />
          </button>
          {message.stopped ? <span className={styles.stopped}>stopped</span> : null}
          {message.created_at ? <time>{timeAgo(message.created_at)}</time> : null}
        </footer>
      ) : null}
    </article>
  );
}
