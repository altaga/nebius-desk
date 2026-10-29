"use client";

import { useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import type { ChatMessage, TurnEvent } from "@nebius-desk/shared/index";
import type { UiMessage } from "@/features/chat/useChatSession";

type Start = Extract<TurnEvent, { type: "start" }>;

/** Accumulates streamed deltas and flushes them into the pending message once per frame. */
export function useTurnBuffer(setMessages: Dispatch<SetStateAction<UiMessage[]>>) {
  const text = useRef("");
  const thinking = useRef("");
  const frame = useRef<number | null>(null);

  return useMemo(() => {
    const patchPending = (fn: (m: UiMessage) => UiMessage) =>
      setMessages((list) => {
        const i = list.length - 1;
        if (i < 0 || !list[i].pending) return list;
        const next = list.slice();
        next[i] = fn(list[i]);
        return next;
      });

    const flush = () => {
      frame.current = null;
      const content = text.current;
      const thought = thinking.current;
      patchPending((m) => ({ ...m, content, meta: { ...m.meta, thinking: thought } }));
    };

    const cancelFrame = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };

    return {
      start(event: Start) {
        const meta = {
          route: event.route,
          model: event.model,
          intent: event.intent,
          budget_note: event.note,
          selector: event.selector,
          selector_reason: event.selector_reason,
          selector_ms: event.selector_ms,
        };
        setMessages((list) => {
          const last = list[list.length - 1];
          // Second start in the same turn (routing → real route): patch the pending bubble.
          if (last?.pending && last.role === "assistant") {
            const next = list.slice();
            next[next.length - 1] = { ...last, meta: { ...last.meta, ...meta } };
            return next;
          }
          text.current = "";
          thinking.current = "";
          return [
            ...list,
            {
              role: "assistant",
              content: "",
              pending: true,
              meta,
            },
          ];
        });
      },
      push(kind: "text" | "thinking", chunk: string) {
        if (kind === "thinking") thinking.current += chunk;
        else text.current += chunk;
        if (frame.current === null) frame.current = requestAnimationFrame(flush);
      },
      finish(message: ChatMessage) {
        cancelFrame();
        patchPending(() => ({ ...message, pending: false }));
      },
      stop() {
        cancelFrame();
        const content = text.current;
        patchPending((m) => ({ ...m, content: content || "_Stopped._", pending: false, stopped: true }));
      },
      drop() {
        cancelFrame();
        setMessages((list) => (list.length && list[list.length - 1].pending ? list.slice(0, -1) : list));
      },
    };
  }, [setMessages]);
}
