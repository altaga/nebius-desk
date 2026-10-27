"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { GuideTurnEvent } from "@nebius-desk/shared/index";
import { api } from "@/lib/api";
import { useDeskGuide } from "./DeskGuideContext";
import {
  captionFromActions,
  emotionFromActions,
  gateActions,
  parseGuidePayload,
  type GuideAction,
} from "./guideActions";
import type { MillieHandle } from "./MillieCanvas";
import { readGuideSession, writeGuideSession } from "./millieStorage";
import { pickSafeClip, reactionForGuide } from "./safeMotion";

export type GuideMsg = { role: "user" | "assistant"; content: string };

function displayGuideText(raw: string): string {
  const cut = raw.lastIndexOf("```guide");
  const base = cut >= 0 && !raw.slice(cut + 8).includes("```") ? raw.slice(0, cut) : raw;
  return parseGuidePayload(base).text;
}

export function useMillieGuide(deviceId: string | null, millieRef: RefObject<MillieHandle | null>) {
  const guide = useDeskGuide();
  const [messages, setMessages] = useState<GuideMsg[]>([]);
  const [pending, setPending] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    sessionRef.current = deviceId ? readGuideSession(deviceId) : null;
    setMessages([]);
    setPending("");
    setError(null);
  }, [deviceId]);

  const applyActions = useCallback(
    (actions: GuideAction[]) => {
      for (const action of actions) {
        if (action.type === "react") {
          millieRef.current?.react(action.emotion, 3);
          continue;
        }
        guide.runAction(action);
        if (action.type === "highlight") {
          window.setTimeout(() => {
            const el = guide.queryGuideTarget(action.target);
            millieRef.current?.pointAt(el);
          }, 120);
        }
      }
    },
    [guide, millieRef]
  );

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || sending) return;
      setSending(true);
      setError(null);
      setPending("");

      // Always Nano + allowlisted guide tools — no canned local replies.
      if (!deviceId) {
        setError("Select a board first so I can open the right screens.");
        millieRef.current?.react("sleepy", 2);
        setSending(false);
        return;
      }

      setMessages((m) => [...m, { role: "user", content }]);
      millieRef.current?.react("determined", 8);
      millieRef.current?.play(pickSafeClip("thinking"));

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      let raw = "";
      const queued: GuideAction[] = [];

      try {
        await api().streamGuideMessage(
          { content, session_id: sessionRef.current, device_id: deviceId },
          (event: GuideTurnEvent) => {
            if (event.type === "start") {
              sessionRef.current = event.session_id;
              writeGuideSession(deviceId, event.session_id);
            } else if (event.type === "delta" && event.kind === "text") {
              raw += event.text;
              setPending(displayGuideText(raw));
            } else if (event.type === "action") {
              queued.push(...gateActions([event.action]));
            } else if (event.type === "done") {
              // Re-parse so a fence-only reply never lands as raw JSON in the bubble.
              const parsed = parseGuidePayload(event.message?.content || raw);
              const actions = gateActions(event.actions?.length ? event.actions : queued.length ? queued : parsed.actions);
              // Nano sometimes emits only the tool fence — still show a spoken line.
              const cleaned = parsed.text || (actions.length ? captionFromActions(actions) : "");
              const emotion = emotionFromActions(actions) || reactionForGuide(cleaned);
              setPending("");
              if (cleaned) {
                setMessages((m) => [...m, { role: "assistant", content: cleaned }]);
                millieRef.current?.say(cleaned.slice(0, 280));
              } else {
                setError("Millie returned an empty reply.");
              }
              millieRef.current?.play(pickSafeClip("nod"));
              // Apply nav/highlight; react tool (or heuristic fallback) drives the face.
              applyActions(actions.some((a) => a.type === "react") ? actions : [...actions, { type: "react", emotion }]);
            } else if (event.type === "error") {
              setError(event.detail);
              millieRef.current?.react("sleepy", 2.5);
            }
          },
          ac.signal
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          const raw = err instanceof Error ? err.message : "Guide failed";
          const friendly =
            /board_timeout|board_offline|board_reconnecting/i.test(raw)
              ? "The board link dropped before Millie could answer. Pick an online board and try again."
              : raw.includes("{") && raw.includes("detail")
                ? "Millie could not reach the board. Try again in a moment."
                : raw;
          setError(friendly);
          millieRef.current?.react("relaxed", 2);
        }
        setPending("");
      } finally {
        setSending(false);
      }
    },
    [deviceId, sending, millieRef, applyActions]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setSending(false);
  }, []);

  return { messages, pending, sending, error, send, stop };
}
