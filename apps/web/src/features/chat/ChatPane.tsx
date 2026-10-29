"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { SessionTelemetry } from "@nebius-desk/shared/index";
import { ApprovalCard } from "@/features/chat/ApprovalCard";
import { AssistantTurn } from "@/features/chat/AssistantTurn";
import { ThinkingStatus } from "@/features/chat/ThinkingStatus";
import { Composer } from "@/features/chat/Composer";
import { EmptyState } from "@/features/chat/EmptyState";
import { pinnedModelLabel, shortModel } from "@/features/chat/format";
import { MessageBody } from "@/features/chat/MessageBody";
import { useChatSession } from "@/features/chat/useChatSession";
import { useModelChoice } from "@/features/chat/useModelChoice";
import { BrowserPane } from "@/features/machine/BrowserPane";
import { useBoardServices } from "@/features/machine/useBoardServices";
import { useDeskGuideOptional } from "@/features/millie/DeskGuideContext";
import { api, setActiveBoard } from "@/lib/api";
import { IconMonitor, IconX } from "@/ui/icons";
import styles from "./ChatPane.module.css";

type Props = {
  deviceId: string;
  deviceName: string;
  /** From cloud device.board_emu — primary signal for Docker boards. */
  cloudOnly?: boolean;
  sessionId: string | null;
  /** idle | running — used to resume a turn after refresh. */
  sessionStatus?: string | null;
  /** Sessions list still loading / restoring place — hide empty "New chat" flash. */
  hydrating?: boolean;
  onSession: (id: string) => void;
  onTelemetry: (t: SessionTelemetry) => void;
  onNewChat: () => void;
  onSaveMemory: (text: string) => Promise<void>;
  draft?: { text: string; nonce: number } | null;
};

const STICK_PX = 120;
const PREVIEW_W_KEY = "nebiusdesk.chat.previewW";
const PREVIEW_H_KEY = "nebiusdesk.chat.previewH";

function readPct(key: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  try {
    const n = Number(sessionStorage.getItem(key));
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export function ChatPane(p: Props) {
  const guide = useDeskGuideOptional();
  const browserOpen = guide?.browserDockOpen ?? false;
  const setBrowserOpen = guide?.setBrowserDockOpen;
  const openBrowserPreview = guide?.openBrowserPreview;
  const { hasPreview, urls: previewUrls } = useBoardServices(true);
  const showPreview = hasPreview || browserOpen;
  const paneRef = useRef<HTMLElement | null>(null);
  const [previewW, setPreviewW] = useState(() => readPct(PREVIEW_W_KEY, 40));
  const [previewH, setPreviewH] = useState(() => readPct(PREVIEW_H_KEY, 38));
  const [resizing, setResizing] = useState(false);
  const [probedEmu, setProbedEmu] = useState(false);
  const cloudOnly = Boolean(p.cloudOnly) || probedEmu;
  const { choice, pick } = useModelChoice(cloudOnly);
  const {
    messages,
    historyLoading,
    sending,
    error,
    send,
    stop,
    retry,
    approval,
    approvalBusy,
    decideApproval,
    liveSteps,
    liveStatus,
    turnStartedAt,
  } = useChatSession({
    deviceId: p.deviceId,
    sessionId: p.sessionId,
    sessionStatus: p.sessionStatus,
    onSession: p.onSession,
    onTelemetry: p.onTelemetry,
    model: choice,
    // Only auto-open dock when a localhost web service is actually up.
    onBrowserTool: () => {
      void api()
        .edgeServices()
        .then((s) => {
          const first = (s.previewable || []).map((p) => p.url).find(Boolean);
          if (first) openBrowserPreview?.(String(first));
          else if (s.has_preview) setBrowserOpen?.(true);
        })
        .catch(() => undefined);
    },
  });
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(p.draft ?? null);

  useEffect(() => {
    if (p.draft) setSeed(p.draft);
  }, [p.draft]);

  // Pre-start Chromium on the board while Preview is available (cold launch is the slow part).
  useEffect(() => {
    if (!hasPreview || p.cloudOnly) return;
    void api()
      .browserWarm()
      .catch(() => undefined);
  }, [hasPreview, p.cloudOnly, p.deviceId]);

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
  }, [messages, sending, liveSteps, liveStatus]);

  const last = messages[messages.length - 1];
  const live = last?.role === "assistant" && last.pending ? last : null;
  const selecting = sending && choice === "auto" && !live;
  const thinking = sending && !selecting && !live?.content && !live?.meta?.thinking;
  const lastModel = [...messages].reverse().find((m) => m.meta?.model)?.meta?.model;
  const pinned = pinnedModelLabel(choice);
  const lastAssistant = messages.map((m) => m.role).lastIndexOf("assistant");
  const restoring = historyLoading || (Boolean(p.hydrating) && messages.length === 0 && !sending);
  const showEmpty = !restoring && messages.length === 0 && !sending;
  // Welcome: composer centered with empty state. Thread: composer pinned to bottom.
  const mode = showEmpty ? "welcome" : "thread";

  const composer = (
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
  );

  const onSplitterPointerDown = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const pane = paneRef.current;
    if (!pane) return;
    e.preventDefault();
    const stacked = window.matchMedia("(max-width: 900px)").matches;
    const start = stacked ? e.clientY : e.clientX;
    const rect = pane.getBoundingClientRect();
    const size0 = stacked ? previewH : previewW;
    const handle = e.currentTarget;
    setResizing(true);
    handle.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const delta = stacked ? ev.clientY - start : ev.clientX - start;
      const span = stacked ? rect.height : rect.width;
      if (span <= 0) return;
      // Pull splitter toward chat → preview grows.
      const next = Math.min(65, Math.max(22, size0 - (delta / span) * 100));
      if (stacked) {
        setPreviewH(next);
        try {
          sessionStorage.setItem(PREVIEW_H_KEY, String(next));
        } catch {
          /* private mode */
        }
      } else {
        setPreviewW(next);
        try {
          sessionStorage.setItem(PREVIEW_W_KEY, String(next));
        } catch {
          /* private mode */
        }
      }
    };
    const onUp = (ev: PointerEvent) => {
      setResizing(false);
      try {
        handle.releasePointerCapture(ev.pointerId);
      } catch {
        /* already released */
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [previewH, previewW]);

  return (
    <section
      ref={paneRef}
      className={styles.pane}
      data-preview={browserOpen ? "true" : "false"}
      data-resizing={resizing ? "true" : undefined}
      style={
        {
          ["--preview-w" as string]: `${previewW}%`,
          ["--preview-h" as string]: `${previewH}%`,
        } as CSSProperties
      }
    >
      <div className={styles.chatCol} data-mode={mode}>
        <div className={styles.toolbar}>
          {showPreview ? (
            <button
              type="button"
              className={styles.previewBtn}
              data-on={browserOpen}
              data-guide="chat.browser_preview"
              aria-pressed={browserOpen}
              title={browserOpen ? "Hide live preview" : "Show localhost preview beside chat"}
              onClick={() => {
                if (browserOpen) {
                  setBrowserOpen?.(false);
                  return;
                }
                void api()
                  .browserWarm()
                  .catch(() => undefined);
                const first = previewUrls[0];
                if (first && openBrowserPreview) openBrowserPreview(first);
                else setBrowserOpen?.(true);
              }}
            >
              <IconMonitor size={14} />
              Preview
            </button>
          ) : null}
        </div>

        {mode === "welcome" ? (
          <div className={styles.welcome}>
            <EmptyState
              deviceName={p.deviceName}
              cloudOnly={cloudOnly}
              onPick={(text) => setSeed({ text, nonce: Date.now() })}
            />
            <div className={styles.dock}>{composer}</div>
          </div>
        ) : (
          <>
            <div
              className={styles.scroll}
              ref={scroller}
              onScroll={(e) => {
                const el = e.currentTarget;
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
              }}
            >
              <div className={styles.thread}>
                {restoring ? (
                  <div className={styles.skeleton} aria-label="Loading conversation">
                    <span />
                    <span />
                    <span />
                  </div>
                ) : null}
                {!restoring
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
                          liveSteps={
                            i === lastAssistant && (sending || Boolean(approval))
                              ? liveSteps
                              : undefined
                          }
                          liveStatus={
                            i === lastAssistant && (sending || Boolean(approval))
                              ? liveStatus
                              : undefined
                          }
                        />
                      )
                    )
                  : null}

            {selecting ? (
              <ThinkingStatus mode="routing" deviceName={p.deviceName} startedAt={turnStartedAt} />
            ) : null}
            {(thinking || liveStatus) && !live && !approval ? (
              <ThinkingStatus
                mode="thinking"
                deviceName={p.deviceName}
                startedAt={turnStartedAt}
                statusText={liveStatus}
                steps={liveSteps}
              />
            ) : null}
                {approval ? (
                  <ApprovalCard
                    actions={approval.actions}
                    busy={approvalBusy}
                    onDecide={(d) => void decideApproval(d)}
                  />
                ) : null}
                {error ? (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
            </div>
            <div className={styles.dock}>{composer}</div>
          </>
        )}
      </div>

      {browserOpen ? (
        <>
          <button
            type="button"
            className={styles.splitter}
            aria-label="Resize preview"
            title="Drag to resize"
            onPointerDown={onSplitterPointerDown}
          />
          <aside className={styles.previewCol} aria-label="Board browser preview">
            <div className={styles.previewBar}>
              <span>Live board browser</span>
              <button
                type="button"
                className={styles.iconBtn}
                aria-label="Close preview"
                onClick={() => setBrowserOpen?.(false)}
              >
                <IconX size={14} />
              </button>
            </div>
            <div className={styles.previewBody}>
              <BrowserPane variant="dock" deviceId={p.deviceId} />
            </div>
          </aside>
        </>
      ) : null}
    </section>
  );
}
