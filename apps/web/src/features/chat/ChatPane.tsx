"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionTelemetry } from "@nebius-desk/shared/index";
import { AssistantTurn } from "@/features/chat/AssistantTurn";
import { ThinkingStatus } from "@/features/chat/ThinkingStatus";
import { Composer } from "@/features/chat/Composer";
import { EmptyState } from "@/features/chat/EmptyState";
import { pinnedModelLabel, shortModel } from "@/features/chat/format";
import { MessageBody } from "@/features/chat/MessageBody";
import { useChatSession } from "@/features/chat/useChatSession";
import { useModelChoice } from "@/features/chat/useModelChoice";
import { api, setActiveBoard } from "@/lib/api";
import styles from "./ChatPane.module.css";

type Props = {
  deviceId: string;
  deviceName: string;
  /** From cloud device.board_emu — primary signal for Docker boards. */
  cloudOnly?: boolean;
  sessionId: string | null;
  onSession: (id: string) => void;
  onTelemetry: (t: SessionTelemetry) => void;
  onNewChat: () => void;
  onSaveMemory: (text: string) => Promise<void>;
  draft?: { text: string; nonce: number } | null;
};

const STICK_PX = 120;

export function ChatPane(p: Props) {
  const [probedEmu, setProbedEmu] = useState(false);
  const cloudOnly = Boolean(p.cloudOnly) || probedEmu;
  const { choice, pick } = useModelChoice(cloudOnly);
  const { messages, historyLoading, sending, error, send, stop, retry } = useChatSession({
    deviceId: p.deviceId,
    sessionId: p.sessionId,
    onSession: p.onSession,
    onTelemetry: p.onTelemetry,
    model: choice,
  });
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(p.draft ?? null);

  useEffect(() => {
    if (p.draft) setSeed(p.draft);
  }, [p.draft]);

  useEffect(() => {
    let cancelled = false;
    setProbedEmu(false);
    setActiveBoard(p.deviceId);
    if (p.cloudOnly) return;
    api()
      .edgeCapabilities()
      .then((caps) => {
        if (!cancelled) setProbedEmu(Boolean(caps.board_emu));
      })
      .catch(() => {
        if (!cancelled) setProbedEmu(false);
      });
    return () => {
      cancelled = true;
    };
  }, [p.deviceId, p.cloudOnly]);

  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const last = messages[messages.length - 1];
  const live = last?.role === "assistant" && last.pending ? last : null;
  const selecting = sending && choice === "auto" && !live;
  const thinking = sending && !selecting && !live?.content && !live?.meta?.thinking;
  const lastModel = [...messages].reverse().find((m) => m.meta?.model)?.meta?.model;
  const pinned = pinnedModelLabel(choice);
  const lastAssistant = messages.map((m) => m.role).lastIndexOf("assistant");
  const showEmpty = !historyLoading && messages.length === 0 && !sending;

  return (
    <section className={styles.pane}>
      <div
        className={styles.scroll}
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
        }}
      >
        <div className={styles.thread}>
          {historyLoading ? (
            <div className={styles.skeleton} aria-label="Loading conversation">
              <span />
              <span />
              <span />
            </div>
          ) : null}
          {showEmpty ? (
            <EmptyState
              deviceName={p.deviceName}
              cloudOnly={cloudOnly}
              onPick={(text) => setSeed({ text, nonce: Date.now() })}
            />
          ) : null}
          {!historyLoading
            ? messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className={styles.userRow}>
                    <div className={styles.userBubble}>
                      <MessageBody content={m.content} />
                    </div>
                  </div>
                ) : (
                  <AssistantTurn
                    key={i}
                    message={m}
                    isLast={i === lastAssistant && !sending}
                    onRetry={() => retry(i)}
                    deviceName={p.deviceName}
                  />
                )
              )
            : null}

          {selecting ? <ThinkingStatus mode="routing" deviceName={p.deviceName} /> : null}
          {thinking ? <ThinkingStatus mode="thinking" deviceName={p.deviceName} /> : null}
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className={styles.dock}>
        <Composer
          sending={sending}
          seed={seed}
          modelLabel={pinned || shortModel(lastModel) || (cloudOnly ? "Nano" : "Auto")}
          modelId={pinned ? undefined : lastModel}
          choice={choice}
          onChoice={pick}
          deviceName={p.deviceName}
          cloudOnly={cloudOnly}
          onSend={(t) => {
            stick.current = true;
            void send(t);
          }}
          onStop={stop}
          onNewChat={p.onNewChat}
          onSaveMemory={p.onSaveMemory}
        />
      </div>
    </section>
  );
}
