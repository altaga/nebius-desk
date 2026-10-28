"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MAX_GUIDE_INPUT_CHARS } from "@nebius-desk/shared/index";
import { IconX } from "@/ui/icons";
import { useDeskGuide } from "./DeskGuideContext";
import { MillieCanvas, type MillieHandle } from "./MillieCanvas";
import { MillieLauncher } from "./MillieLauncher";
import { MillieTourBar } from "./MillieTourBar";
import {
  clampMilliePos,
  homeMilliePos,
  readMillieOpen,
  readMilliePos,
  writeMillieOpen,
  writeMilliePos,
  type MilliePos,
} from "./millieStorage";
import { isTourCommand, labelForTarget, TOUR_STEPS, tourCenterPos, tourClearPos, type TourLang } from "./millieTour";
import { useMillieGuide } from "./useMillieGuide";
import { useMilliePresence } from "./useMilliePresence";
import { MILLIE_INTRO, MILLIE_PLACEHOLDER } from "./safeMotion";
import styles from "./MillieOverlay.module.css";

const W = 260;
const W_TOUR = 320;
/** Anchor only (canvas + ask) — bubble grows above and must not affect this. */
const H_ANCHOR = 270;
/** Canvas (~320) + tour bar (~48) + gap — keep clamp/dock math in sync. */
const H_TOUR = 390;
const EDGE = 8;
/** Guide replies + greeting auto-hide; tour steps and errors stay. */
const REPLY_LINE_MS = 15_000;

type Props = { deviceId: string | null };

export function MillieOverlay({ deviceId }: Props) {
  const millieRef = useRef<MillieHandle | null>(null);
  const overlayRef = useRef<HTMLElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);
  const [pos, setPos] = useState<MilliePos>(() => homeMilliePos(W, H_ANCHOR, EDGE));
  const [size, setSize] = useState({ w: W, h: H_ANCHOR });
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);
  const drag = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);
  const savedPos = useRef<MilliePos | null>(null);
  const tourTimers = useRef<number[]>([]);
  const guide = useMillieGuide(deviceId, millieRef);
  const desk = useDeskGuide();
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const presenceLang: TourLang =
    typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
  const introLine = MILLIE_INTRO[presenceLang];
  const [intro, setIntro] = useState(introLine);
  const [presenceLine, setPresenceLine] = useState<string | null>(null);
  const [introDone, setIntroDone] = useState(false);
  const [tourIndex, setTourIndex] = useState<number | null>(null);
  const greeted = useRef(false);
  const replyKey = guide.messages.length;
  const [expiredReplyKey, setExpiredReplyKey] = useState<number | null>(null);
  const latestReply = guide.messages[guide.messages.length - 1]?.content || null;
  const lastAssistant = expiredReplyKey === replyKey ? null : latestReply;
  const touring = tourIndex != null;
  const presenceBusy =
    touring ||
    !introDone ||
    guide.sending ||
    dragging ||
    !!draft.trim() ||
    !!desk.highlightTarget ||
    !!guide.pending;

  useMilliePresence({
    millieRef,
    enabled: open && !loadError && ready && !touring,
    busy: presenceBusy,
    lang: presenceLang,
    onLine: setPresenceLine,
  });

  useEffect(() => {
    if (guide.sending || guide.pending || lastAssistant) setPresenceLine(null);
  }, [guide.sending, guide.pending, lastAssistant]);

  // Restore open/closed + dock position from the last visit (client-only).
  useEffect(() => {
    const savedOpen = readMillieOpen();
    const stored = readMilliePos();
    setOpen(savedOpen);
    if (stored) {
      setPos(clampMilliePos(stored, W, H_ANCHOR, EDGE));
    } else {
      setPos(homeMilliePos(W, H_ANCHOR, EDGE));
    }
    setReady(true);
  }, []);

  // Mini intro once the avatar is ready — who she is + what she does here.
  useEffect(() => {
    if (!open || loadError || greeted.current || touring) return;
    const t = window.setTimeout(() => {
      if (greeted.current || !millieRef.current || touring) return;
      greeted.current = true;
      setIntro(introLine);
      millieRef.current.react("excited", 3.2, 1);
      millieRef.current.play("wave");
      millieRef.current.say(introLine.slice(0, 180));
      window.setTimeout(() => setIntroDone(true), 4200);
    }, 700);
    return () => window.clearTimeout(t);
  }, [open, loadError, touring, introLine]);

  // Size + clamp from the Millie+ask/tour anchor only.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const el = anchorRef.current;
    const syncSize = () => {
      const box = el.getBoundingClientRect();
      const fallbackW = touring ? W_TOUR : W;
      const fallbackH = touring ? H_TOUR : H_ANCHOR;
      const next = { w: Math.ceil(box.width) || fallbackW, h: Math.ceil(box.height) || fallbackH };
      setSize(next);
      setPos((p) => {
        const clamped = clampMilliePos(p, next.w, next.h, EDGE);
        if (!touring && (clamped.x !== p.x || clamped.y !== p.y)) writeMilliePos(clamped);
        return clamped;
      });
    };
    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(el);
    window.addEventListener("resize", syncSize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncSize);
    };
  }, [open, touring]);

  useEffect(() => {
    if (!desk.highlightTarget) {
      millieRef.current?.stopPointing();
      return;
    }
    // Tour aims after dock move in applyTourStep — don't freeze a bad hold from center first.
    if (desk.tourActive) return;
    const target = desk.highlightTarget;
    const aim = () => {
      const el = desk.queryGuideTarget(target);
      if (el) millieRef.current?.pointAt(el);
    };
    aim();
    const t = window.setTimeout(aim, 320);
    return () => window.clearTimeout(t);
  }, [desk.highlightTarget, desk.queryGuideTarget, desk.tourActive]);

  const applyTourStep = useCallback(
    (index: number) => {
      const step = TOUR_STEPS[index];
      if (!step) return;
      desk.forceClearHighlight();
      millieRef.current?.stopPointing();

      const opens = step.actions.filter((a) => a.type !== "highlight" && a.type !== "react");
      const highlights = step.actions.filter((a) => a.type === "highlight");
      for (const action of opens) desk.runAction(action);

      const settle = step.settleMs ?? (highlights.length ? 260 : 80);
      window.setTimeout(() => {
        for (const action of highlights) desk.runAction(action);
        const target = highlights[0] && "target" in highlights[0] ? highlights[0].target : null;
        desk.setHighlightLabel(step.label[presenceLang] || labelForTarget(target, presenceLang));
        // Dock clear of the spotlight, then aim from the new spot (CSS transition ~180ms).
        window.setTimeout(() => {
          const el = target ? desk.queryGuideTarget(target) : null;
          const rect = el?.getBoundingClientRect() ?? null;
          if (highlights.length) setPos(tourClearPos(W_TOUR, H_TOUR, rect, EDGE));
          else setPos(tourCenterPos(W_TOUR, H_TOUR, EDGE));
          window.setTimeout(() => {
            const m = millieRef.current;
            if (!m) return;
            if (el) m.pointAt(el);
            m.react(step.emotion, 2.6, highlights.length ? 0.65 : 1);
            if (!highlights.length) m.play(step.clip);
            m.say(`${step.title[presenceLang]}. ${step.body[presenceLang]}`.slice(0, 260));
          }, 440);
        }, 120);
      }, settle);
    },
    [desk, presenceLang]
  );

  const clearTourTimers = useCallback(() => {
    for (const id of tourTimers.current) window.clearTimeout(id);
    tourTimers.current = [];
  }, []);

  useEffect(() => () => clearTourTimers(), [clearTourTimers]);

  const endTour = useCallback(() => {
    clearTourTimers();
    setTourIndex(null);
    desk.setTourActive(false);
    millieRef.current?.setTourLook(false);
    millieRef.current?.stopPointing();
    const restore = savedPos.current ?? readMilliePos() ?? homeMilliePos(W, H_ANCHOR, EDGE);
    savedPos.current = null;
    setPos(clampMilliePos(restore, W, H_ANCHOR, EDGE));
    writeMilliePos(restore);
    millieRef.current?.react("happy", 2.4, 1);
    millieRef.current?.play("bow");
  }, [desk, clearTourTimers]);

  const startTour = useCallback(() => {
    clearTourTimers();
    savedPos.current = pos;
    desk.setTourActive(true);
    setPresenceLine(null);
    setIntro("");
    setTourIndex(0);
    // Dock to center first — outfit waits 1s after she's fixed there.
    setPos(tourCenterPos(W_TOUR, H_TOUR, EDGE));
    const lookId = window.setTimeout(() => {
      millieRef.current?.setTourLook(true);
      millieRef.current?.react("excited", 2.6, 1);
      millieRef.current?.play("celebrate");
      const stepId = window.setTimeout(() => applyTourStep(0), 800);
      tourTimers.current.push(stepId);
    }, 1000);
    tourTimers.current.push(lookId);
  }, [pos, desk, applyTourStep, clearTourTimers]);

  const goTour = useCallback(
    (next: number) => {
      if (next < 0) return;
      if (next >= TOUR_STEPS.length) {
        endTour();
        return;
      }
      setTourIndex(next);
      applyTourStep(next);
    },
    [applyTourStep, endTour]
  );

  const setOpenPersist = useCallback(
    (next: boolean) => {
      if (!next && touring) endTour();
      setOpen(next);
      writeMillieOpen(next);
      if (next) {
        setIntro(introLine);
        setIntroDone(false);
        setPresenceLine(null);
        greeted.current = false;
        window.setTimeout(() => {
          if (!millieRef.current || touring) return;
          greeted.current = true;
          millieRef.current.react("excited", 3.2, 1);
          millieRef.current.play("wave");
          millieRef.current.say(introLine.slice(0, 180));
          window.setTimeout(() => setIntroDone(true), 4200);
        }, 500);
      }
    },
    [touring, endTour, introLine]
  );

  const onPointerDown = (e: ReactPointerEvent) => {
    if (touring) return;
    if (!(e.target as HTMLElement).closest("[data-drag]")) return;
    if ((e.target as HTMLElement).closest("button, input, textarea, a")) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { ox: e.clientX, oy: e.clientY, px: pos.x, py: pos.y };
    setDragging(true);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    setPos(
      clampMilliePos(
        {
          x: drag.current.px + (e.clientX - drag.current.ox),
          y: drag.current.py + (e.clientY - drag.current.oy),
        },
        size.w,
        size.h,
        EDGE
      )
    );
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    setPos((p) => {
      writeMilliePos(p);
      return p;
    });
  };

  useEffect(() => {
    if (latestReply && !touring) setIntro("");
  }, [latestReply, touring]);

  useEffect(() => {
    if (!latestReply || touring || guide.sending) return;
    const t = window.setTimeout(() => setExpiredReplyKey(replyKey), REPLY_LINE_MS);
    return () => window.clearTimeout(t);
  }, [latestReply, replyKey, touring, guide.sending]);

  useEffect(() => {
    if (!open || !intro || touring) return;
    const t = window.setTimeout(() => setIntro(""), REPLY_LINE_MS);
    return () => window.clearTimeout(t);
  }, [open, intro, touring]);

  // Escape ends the tour.
  useEffect(() => {
    if (!touring) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endTour();
      if (e.key === "ArrowRight") goTour((tourIndex ?? 0) + 1);
      if (e.key === "ArrowLeft") goTour((tourIndex ?? 0) - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [touring, tourIndex, endTour, goTour]);

  if (!ready) return null;

  if (!open) {
    return <MillieLauncher onOpen={() => setOpenPersist(true)} />;
  }

  const step = touring ? TOUR_STEPS[tourIndex!] : null;
  const tourLine = step ? `${step.title[presenceLang]}\n${step.body[presenceLang]}` : null;
  const last = tourLine || guide.pending || presenceLine || lastAssistant || intro || null;
  const line = loadError ? `Avatar failed (${loadError}).` : guide.error || last;

  return (
    <>
      {touring ? <div className={styles.tourScrim} aria-hidden /> : null}
      <aside
        ref={overlayRef}
        className={styles.overlay}
        data-dragging={dragging || undefined}
        data-tour={touring || undefined}
        style={{ left: pos.x, top: pos.y, right: "auto", bottom: "auto", width: touring ? W_TOUR : undefined }}
        aria-label={touring ? "Millie product tour" : "Millie guide"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div ref={anchorRef} className={styles.anchor}>
          <div className={styles.stage}>
            {line ? (
              <p className={styles.bubble} data-err={guide.error || loadError ? "" : undefined} data-tour={touring || undefined} aria-live="polite">
                {line}
              </p>
            ) : null}
            {!touring ? <div className={styles.drag} data-drag aria-hidden /> : null}
            <div className={styles.head}>
              <button
                type="button"
                className={styles.icon}
                onClick={() => (touring ? endTour() : setOpenPersist(false))}
                aria-label={touring ? "Close tour" : "Close Millie"}
              >
                <IconX size={14} />
              </button>
            </div>
            <MillieCanvas ref={millieRef} active={open} onLoadError={setLoadError} />
          </div>
          {touring && tourIndex != null ? (
            <MillieTourBar
              index={tourIndex}
              total={TOUR_STEPS.length}
              lang={presenceLang}
              onPrev={() => goTour(tourIndex - 1)}
              onNext={() => goTour(tourIndex + 1)}
              onClose={endTour}
            />
          ) : (
            <form
              className={styles.ask}
              onSubmit={(e) => {
                e.preventDefault();
                const text = draft;
                setDraft("");
                if (isTourCommand(text)) {
                  startTour();
                  return;
                }
                void guide.send(text);
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={MILLIE_PLACEHOLDER[presenceLang][deviceId ? "ready" : "noBoard"]}
                disabled={guide.sending}
                maxLength={MAX_GUIDE_INPUT_CHARS}
                aria-label="Message Millie"
              />
              {guide.sending ? (
                <button type="button" onClick={guide.stop}>
                  Stop
                </button>
              ) : (
                <button type="submit" disabled={!draft.trim() || (!deviceId && !isTourCommand(draft))}>
                  Ask
                </button>
              )}
            </form>
          )}
        </div>
      </aside>
    </>
  );
}
