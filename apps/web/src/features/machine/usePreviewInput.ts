"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { api } from "@/lib/api";

export type PreviewInput =
  | { input: "click"; x: number; y: number }
  | { input: "scroll"; dy: number }
  | { input: "key"; key: string }
  | { input: "text"; text: string };

export type Viewport = { width: number; height: number };

type Options = {
  enabled: boolean;
  viewport: Viewport;
  onFrame: (src: string, url: string | null) => void;
  onError: (message: string) => void;
};

/** Must match the board allowlist in app/browser/runtime.py. */
const KEYS = new Set([
  "Enter", "Backspace", "Tab", "Escape", "Delete", "Home", "End", "PageUp", "PageDown",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]);

const LINE_PX = 40;

function enqueue(queue: PreviewInput[], next: PreviewInput) {
  const last = queue.at(-1);
  if (last?.input === "scroll" && next.input === "scroll") {
    last.dy += next.dy;
    return;
  }
  if (last?.input === "text" && next.input === "text") {
    last.text += next.text;
    return;
  }
  queue.push(next);
}

/**
 * Forwards clicks, wheel, and keys on the Live preview frame to the board's Chromium tab.
 * One input in flight at a time; bursts collapse so the relay never backs up.
 */
export function usePreviewInput({ enabled, viewport, onFrame, onError }: Options) {
  const queue = useRef<PreviewInput[]>([]);
  const running = useRef(false);
  const callbacks = useRef({ onFrame, onError, viewport });
  const target = useRef<HTMLDivElement | null>(null);
  const [sending, setSending] = useState(false);
  callbacks.current = { onFrame, onError, viewport };

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setSending(true);
    try {
      while (queue.current.length) {
        const next = queue.current.shift()!;
        const { viewport: size } = callbacks.current;
        try {
          const result = await api().browserAction({ action: "interact", ...next, ...size });
          if (result.ok === false) {
            callbacks.current.onError(String(result.error || "Input failed"));
            continue;
          }
          const b64 = typeof result.image_b64 === "string" ? result.image_b64 : null;
          const mime = typeof result.image_mime === "string" ? result.image_mime : "image/jpeg";
          const url = typeof result.url === "string" ? result.url : null;
          if (b64) callbacks.current.onFrame(`data:${mime};base64,${b64}`, url);
        } catch (err: unknown) {
          queue.current = [];
          callbacks.current.onError(err instanceof Error ? err.message : "Input failed");
        }
      }
    } finally {
      running.current = false;
      setSending(false);
    }
  }, []);

  const push = useCallback(
    (input: PreviewInput) => {
      if (!enabled) return;
      enqueue(queue.current, input);
      void drain();
    },
    [drain, enabled]
  );

  // React wheel listeners are passive; attach natively so the dock does not scroll instead.
  useEffect(() => {
    const node = target.current;
    if (!node || !enabled) return;
    function onWheel(event: globalThis.WheelEvent) {
      event.preventDefault();
      const dy = event.deltaMode === 1 ? event.deltaY * LINE_PX : event.deltaY;
      if (dy) push({ input: "scroll", dy });
    }
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [enabled, push]);

  function onClick(event: MouseEvent<HTMLImageElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    target.current?.focus({ preventScroll: true });
    push({
      input: "click",
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length === 1) {
      event.preventDefault();
      push({ input: "text", text: event.key });
      return;
    }
    if (KEYS.has(event.key)) {
      event.preventDefault();
      push({ input: "key", key: event.key });
    }
  }

  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    const text = event.clipboardData.getData("text");
    if (!text) return;
    event.preventDefault();
    push({ input: "text", text });
  }

  return { target, sending, onClick, onKeyDown, onPaste };
}
