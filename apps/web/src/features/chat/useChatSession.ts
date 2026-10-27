"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ModelChoice, SessionTelemetry, TurnEvent } from "@nebius-desk/shared/index";
import { useTurnBuffer } from "@/features/chat/useTurnBuffer";
import { api } from "@/lib/api";

export type UiMessage = ChatMessage & { pending?: boolean; stopped?: boolean };

type Options = {
  deviceId: string;
  sessionId: string | null;
  onSession: (id: string) => void;
  onTelemetry: (t: SessionTelemetry) => void;
  model: ModelChoice;
};

function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    return (JSON.parse(raw) as { detail?: string }).detail ?? raw;
  } catch {
    return raw;
  }
}

export function useChatSession({ deviceId, sessionId, onSession, onTelemetry, model }: Options) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const adopted = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const buffer = useTurnBuffer(setMessages);

  useEffect(() => {
    if (sessionId && sessionId === adopted.current) {
      adopted.current = null;
      return;
    }
    abort.current?.abort();
    setError(null);
    setSending(false);
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
    // deviceId: drop in-flight history when the board changes mid-fetch
  }, [sessionId, deviceId]);

  const handle = useCallback(
    (event: TurnEvent) => {
      if (event.type === "start") {
        if (event.session_id !== sessionId) adopted.current = event.session_id;
        onSession(event.session_id);
        buffer.start(event);
      } else if (event.type === "delta") {
        buffer.push(event.kind, event.text);
      } else if (event.type === "done") {
        buffer.finish(event.message);
        onTelemetry(event.telemetry);
      } else {
        buffer.drop();
        setError(event.detail);
      }
    },
    [buffer, onSession, onTelemetry, sessionId]
  );

  const send = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (!text || sending) return;
      const controller = new AbortController();
      abort.current = controller;
      setSending(true);
      setError(null);
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
      }
    },
    [buffer, deviceId, handle, model, sending, sessionId]
  );

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

  return { messages, historyLoading, sending, error, send, stop, retry };
}
