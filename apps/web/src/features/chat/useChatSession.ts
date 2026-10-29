"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApprovalAction,
  ChatMessage,
  ModelChoice,
  SessionTelemetry,
  TurnEvent,
} from "@nebius-desk/shared/index";
import { applyToolEvent, type LiveStep } from "@/features/chat/liveProgress";
import { useTurnBuffer } from "@/features/chat/useTurnBuffer";
import { api } from "@/lib/api";

export type UiMessage = ChatMessage & { pending?: boolean; stopped?: boolean };

export type PendingApproval = {
  approvalId: string;
  actions: ApprovalAction[];
};

type Options = {
  deviceId: string;
  sessionId: string | null;
  /** From sessions list — "running" means board may still be finishing after a refresh. */
  sessionStatus?: string | null;
  onSession: (id: string) => void;
  onTelemetry: (t: SessionTelemetry) => void;
  model: ModelChoice;
  /** Fired when a board ```browse``` tool succeeds — open chat preview dock. */
  onBrowserTool?: () => void;
};

function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    return (JSON.parse(raw) as { detail?: string }).detail ?? raw;
  } catch {
    return raw;
  }
}

export function useChatSession({
  deviceId,
  sessionId,
  sessionStatus,
  onSession,
  onTelemetry,
  model,
  onBrowserTool,
}: Options) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [liveSteps, setLiveSteps] = useState<LiveStep[]>([]);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const adopted = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const approvalRef = useRef<PendingApproval | null>(null);
  const buffer = useTurnBuffer(setMessages);
  const toolSeq = useRef(0);
  approvalRef.current = approval;

  useEffect(() => {
    if (sessionId && sessionId === adopted.current) {
      adopted.current = null;
      return;
    }
    abort.current?.abort();
    setError(null);
    setSending(false);
    setResuming(false);
    setApproval(null);
    setApprovalBusy(false);
    setLiveSteps([]);
    setLiveStatus(null);
    setTurnStartedAt(null);
    if (!sessionId) {
      setMessages([]);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    setMessages([]);
    api()
      .listMessages(sessionId)
      .then((rows) => {
        if (cancelled) return;
        setMessages(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        setMessages([]);
        setError(errorText(err));
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, deviceId]);

  // After refresh: if the session is still running on the board, poll until the reply lands.
  useEffect(() => {
    if (!sessionId || sending || historyLoading) return;
    let cancelled = false;
    let timer: number | null = null;

    async function tick() {
      try {
        const st = await api().sessionStatus(sessionId!);
        if (cancelled) return;
        const pending = st.pending_approval;
        if (pending?.approval_id) {
          setApproval({
            approvalId: pending.approval_id,
            actions: pending.actions || [],
          });
          setLiveStatus("Waiting for your approval…");
          setTurnStartedAt((t) => t ?? Date.now());
          setResuming(true);
          timer = window.setTimeout(tick, 2000);
          return;
        }
        if (!st.turn_active && st.status !== "running") {
          const rows = await api().listMessages(sessionId!);
          if (cancelled) return;
          setMessages(rows);
          setResuming(false);
          setApproval(null);
          setLiveStatus(null);
          setTurnStartedAt(null);
          return;
        }
        setResuming(true);
        setLiveStatus("Still working. You can leave — the answer shows up here.");
        setTurnStartedAt((t) => t ?? Date.now());
        const rows = await api().listMessages(sessionId!);
        if (cancelled) return;
        setMessages(rows);
        timer = window.setTimeout(tick, 2000);
      } catch {
        if (!cancelled) timer = window.setTimeout(tick, 4000);
      }
    }

    void api()
      .sessionStatus(sessionId)
      .then((st) => {
        if (cancelled) return;
        if (st.turn_active || st.status === "running" || sessionStatus === "running") void tick();
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [sessionId, sessionStatus, sending, historyLoading]);

  // Background agents post a chat message when they finish — soft-poll while this session is open.
  useEffect(() => {
    if (!sessionId || sending || historyLoading) return;
    let cancelled = false;
    const id = window.setInterval(() => {
      void api()
        .listMessages(sessionId)
        .then((rows) => {
          if (cancelled) return;
          setMessages((prev) => {
            if (rows.length === prev.length) {
              const lastPrev = prev[prev.length - 1]?.content;
              const lastNext = rows[rows.length - 1]?.content;
              if (lastPrev === lastNext) return prev;
            }
            return rows;
          });
        })
        .catch(() => undefined);
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [sessionId, sending, historyLoading]);

  const handle = useCallback(
    (event: TurnEvent) => {
      if (event.type === "start") {
        if (event.session_id !== sessionId) adopted.current = event.session_id;
        onSession(event.session_id);
        // Board may emit a provisional "routing" start, then a real one — refresh meta, don't fork bubbles.
        buffer.start(event);
        if (event.intent !== "routing") {
          setApproval(null);
          setLiveSteps([]);
          toolSeq.current = 0;
        }
        setLiveStatus(event.note || (event.intent === "routing" ? "Choosing a model…" : null));
      } else if (event.type === "delta") {
        buffer.push(event.kind, event.text);
      } else if (event.type === "status") {
        setLiveStatus(event.text || null);
      } else if (event.type === "tool") {
        toolSeq.current += 1;
        setLiveSteps((prev) => applyToolEvent(prev, event, toolSeq.current));
        if (
          event.phase !== "start" &&
          event.kind === "browse" &&
          event.ok !== false &&
          !event.skipped
        ) {
          onBrowserTool?.();
        }
        return;
      } else if (event.type === "approval") {
        setApproval({ approvalId: event.approval_id, actions: event.actions || [] });
        setLiveStatus("Waiting for your approval…");
      } else if (event.type === "approval_resolved") {
        setApproval(null);
        setApprovalBusy(false);
        setLiveStatus(
          event.decision === "approve" ? "Applying the approved fix…" : "Approval denied — continuing…"
        );
      } else if (event.type === "done") {
        buffer.finish(event.message);
        onTelemetry(event.telemetry);
        setApproval(null);
        setLiveSteps([]);
        setLiveStatus(null);
      } else if (event.type === "error") {
        buffer.drop();
        setError(event.detail);
        setApproval(null);
        setLiveSteps([]);
        setLiveStatus(null);
      }
    },
    [buffer, onBrowserTool, onSession, onTelemetry, sessionId]
  );

  const send = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (!text || sending) return;
      const controller = new AbortController();
      abort.current = controller;
      setSending(true);
      setError(null);
      setApproval(null);
      setLiveSteps([]);
      setLiveStatus(null);
      setTurnStartedAt(Date.now());
      setMessages((m) => [...m, { role: "user", content: text, created_at: new Date().toISOString() }]);
      try {
        await api().streamMessage(
          { content: text, session_id: sessionId, device_id: deviceId, model },
          handle,
          controller.signal
        );
      } catch (err) {
        if (controller.signal.aborted) buffer.stop();
        else {
          buffer.drop();
          setError(errorText(err));
        }
      } finally {
        abort.current = null;
        setSending(false);
        setApprovalBusy(false);
        // SSE ends on purpose after `approval` (Vercel maxDuration). Keep the card + poll.
        if (approvalRef.current) {
          setLiveStatus("Waiting for your approval…");
          setTurnStartedAt((t) => t ?? Date.now());
        } else {
          setLiveSteps([]);
          setLiveStatus(null);
          setTurnStartedAt(null);
        }
      }
    },
    [buffer, deviceId, handle, model, sending, sessionId]
  );

  const decideApproval = useCallback(async (decision: "approve" | "deny") => {
    if (!approval || approvalBusy) return;
    setApprovalBusy(true);
    try {
      await api().resolveApproval(approval.approvalId, decision);
      // SSE already closed at approval — no approval_resolved event on this socket.
      setApproval(null);
      setApprovalBusy(false);
      setLiveStatus(
        decision === "approve"
          ? "Applying the approved fix…"
          : "Denied — finishing on the board…"
      );
      setResuming(true);
    } catch (err) {
      setError(errorText(err));
      setApprovalBusy(false);
    }
  }, [approval, approvalBusy]);

  const stop = useCallback(() => abort.current?.abort(), []);

  const retry = useCallback(
    (assistantIndex: number) => {
      const prev = messages
        .slice(0, assistantIndex)
        .reverse()
        .find((m) => m.role === "user");
      if (prev) void send(prev.content);
    },
    [messages, send]
  );

  return {
    messages,
    historyLoading,
    sending: sending || resuming,
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
    resuming,
  };
}
