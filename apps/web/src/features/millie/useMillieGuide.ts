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
import { labelForTarget, type TourLang } from "./millieTour";
import { clipForReaction, pickSafeClip, pickSafeReaction, reactionForGuide } from "./safeMotion";

/** Only Millie's spoken lines — never the user's question. */
export type GuideMsg = { role: "assistant"; content: string };

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
    (actions: GuideAction[], traceId?: string | null) => {
      const switched = actions.some((a) => a.type === "select_board");
      const applied: Array<GuideAction & { status: string; reason?: string }> = [];
      for (const action of actions) {
        if (action.type === "react") {
          const emotion = pickSafeReaction(action.emotion);
          millieRef.current?.react(emotion, 3.4, 1);
          millieRef.current?.play(clipForReaction(emotion));
          applied.push({ ...action, emotion, status: "applied" });
          continue;
        }
        try {
          guide.runAction(action);
          applied.push({ ...action, status: "applied" });
        } catch (err) {
          applied.push({
            ...action,
            status: "rejected",
            reason: err instanceof Error ? err.message.slice(0, 80) : "apply_failed",
          });
        }
        if (action.type === "highlight") {
          const lang: TourLang =
            typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
          guide.setHighlightLabel(labelForTarget(action.target, lang));
          // Overlay also aims on highlightTarget — only re-aim here after a board remount.
          if (switched) {
            window.setTimeout(() => {
              const el = guide.queryGuideTarget(action.target);
              millieRef.current?.pointAt(el);
            }, 400);
          }
        }
      }
      void api()
        .reportGuideApply({
          trace_id: traceId,
          session_id: sessionRef.current,
          device_id: deviceId,
          actions: applied.map((a) => {
            const row: {
              type: string;
              target?: string;
              board?: string;
              emotion?: string;
              status?: string;
              reason?: string;
            } = { type: a.type, status: a.status, reason: a.reason };
            if ("target" in a && typeof a.target === "string") row.target = a.target;
            if ("board" in a && typeof a.board === "string") row.board = a.board;
            if ("emotion" in a && typeof a.emotion === "string") row.emotion = a.emotion;
            return row;
          }),
        })
        .catch(() => undefined);
    },
    [guide, millieRef, deviceId]
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
        millieRef.current?.react("apologetic", 2.5, 1);
        millieRef.current?.play(pickSafeClip("bow"));
        setSending(false);
        return;
      }

      // Bubble shows only Millie — keep "…" until her spoken line arrives.
      setPending("…");
      millieRef.current?.react("thinking", 8, 0.95);
      millieRef.current?.play(pickSafeClip("thinking"));

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      let raw = "";
      const queued: GuideAction[] = [];
      const norm = (s: string) =>
        s
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, " ")
          .replace(/\s+/g, " ")
          .trim();
      const userNorm = norm(content);
      const notEcho = (spoken: string) => {
        const a = norm(spoken);
        if (!a || a === "…" || a === "...") return false;
        if (!userNorm) return true;
        if (a === userNorm) return false;
        if (a.length <= userNorm.length + 8 && (userNorm.includes(a) || a.includes(userNorm))) return false;
        return true;
      };

      // Best-effort board hints (names only) — Millie answers without opening panels blindly.
      let desk: { secret_names?: string[]; expert_names?: string[] } | undefined;
      try {
        const [secrets, brains] = await Promise.all([
          api().listSecrets().catch(() => [] as Array<{ name: string }>),
          api().listBrains().catch(() => [] as Array<{ name: string; device_id?: string | null }>),
        ]);
        desk = {
          secret_names: secrets.map((s) => s.name).filter(Boolean).slice(0, 16),
          expert_names: brains
            .filter((b) => !b.device_id || b.device_id === deviceId)
            .map((b) => b.name)
            .filter(Boolean)
            .slice(0, 16),
        };
      } catch {
        desk = undefined;
      }

      try {
        await api().streamGuideMessage(
          { content, session_id: sessionRef.current, device_id: deviceId, desk },
          (event: GuideTurnEvent) => {
            if (event.type === "start") {
              sessionRef.current = event.session_id;
              writeGuideSession(deviceId, event.session_id);
            } else if (event.type === "delta" && event.kind === "text") {
              raw += event.text;
              const spoken = displayGuideText(raw);
              if (spoken && notEcho(spoken)) setPending(spoken);
              else if (spoken) setPending("…");
            } else if (event.type === "action") {
              queued.push(...gateActions([event.action]));
            } else if (event.type === "done") {
              // Prefer server polished content; never fall back to showing the user prompt.
              const parsed = parseGuidePayload(event.message?.content || raw);
              const actions = gateActions(event.actions?.length ? event.actions : queued.length ? queued : parsed.actions);
              let cleaned = parsed.text || (actions.length ? captionFromActions(actions) : "");
              if (cleaned && !notEcho(cleaned)) {
                cleaned = actions.length ? captionFromActions(actions) : "Hey! I'm Millie — what do you need?";
              }
              const emotion = emotionFromActions(actions) || reactionForGuide(cleaned);
              setPending("");
              if (cleaned) {
                setMessages([{ role: "assistant", content: cleaned }]);
                millieRef.current?.say(cleaned.slice(0, 280));
              } else {
                setError("Millie returned an empty reply.");
                millieRef.current?.react("flustered", 2.5, 1);
              }
              const traceId =
                typeof (event as { trace_id?: string }).trace_id === "string"
                  ? (event as { trace_id?: string }).trace_id
                  : null;
              applyActions(
                actions.some((a) => a.type === "react") ? actions : [...actions, { type: "react", emotion }],
                traceId
              );
            } else if (event.type === "error") {
              setError(event.detail);
              millieRef.current?.react("apologetic", 2.8, 1);
              millieRef.current?.play(pickSafeClip("bow"));
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
          millieRef.current?.react("sad", 2.6, 0.9);
          millieRef.current?.play(pickSafeClip("bow"));
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
