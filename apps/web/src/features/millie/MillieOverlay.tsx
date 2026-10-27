"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { IconX } from "@/ui/icons";
import { useDeskGuide } from "./DeskGuideContext";
import { MillieCanvas, type MillieHandle } from "./MillieCanvas";
import { MillieLauncher } from "./MillieLauncher";
import {
  clampMilliePos,
  homeMilliePos,
  readMilliePos,
  writeMillieOpen,
  writeMilliePos,
  type MilliePos,
} from "./millieStorage";
import { useMillieGuide } from "./useMillieGuide";
import { MILLIE_INTRO } from "./safeMotion";
import styles from "./MillieOverlay.module.css";

const W = 260;
/** Anchor only (canvas + ask) — bubble grows above and must not affect this. */
const H_ANCHOR = 280;
const EDGE = 8;

type Props = { deviceId: string | null };

export function MillieOverlay({ deviceId }: Props) {
  const millieRef = useRef<MillieHandle | null>(null);
  const overlayRef = useRef<HTMLElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);
  const [pos, setPos] = useState<MilliePos>(() => readMilliePos() ?? homeMilliePos(W, H_ANCHOR, EDGE));
  const [size, setSize] = useState({ w: W, h: H_ANCHOR });
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);
  const drag = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);
  const guide = useMillieGuide(deviceId, millieRef);
  const desk = useDeskGuide();
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [intro, setIntro] = useState(MILLIE_INTRO);
  const greeted = useRef(false);

  useEffect(() => {
    writeMillieOpen(true);
    setOpen(true);
    setReady(true);
  }, []);

  // Mini intro once the avatar is ready — who she is + what she does here.
  useEffect(() => {
    if (!open || loadError || greeted.current) return;
    const t = window.setTimeout(() => {
      if (greeted.current || !millieRef.current) return;
      greeted.current = true;
      setIntro(MILLIE_INTRO);
      millieRef.current.react("excited", 3.2, 1);
      millieRef.current.play("wave");
      millieRef.current.say(MILLIE_INTRO.slice(0, 180));
    }, 700);
    return () => window.clearTimeout(t);
  }, [open, loadError]);

  // Size + clamp from the Millie+ask anchor only — reply bubble must not move her.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const el = anchorRef.current;
    const syncSize = () => {
      const box = el.getBoundingClientRect();
      const next = { w: Math.ceil(box.width) || W, h: Math.ceil(box.height) || H_ANCHOR };
      setSize(next);
      setPos((p) => {
        const clamped = clampMilliePos(p, next.w, next.h, EDGE);
        if (clamped.x !== p.x || clamped.y !== p.y) writeMilliePos(clamped);
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
  }, [open]);

  useEffect(() => {
    if (!desk.highlightTarget) {
      millieRef.current?.stopPointing();
      return;
    }
    const el = desk.queryGuideTarget(desk.highlightTarget);
    millieRef.current?.pointAt(el);
  }, [desk.highlightTarget, desk]);

  const setOpenPersist = useCallback((next: boolean) => {
    setOpen(next);
    writeMillieOpen(next);
    if (next) {
      setIntro(MILLIE_INTRO);
      greeted.current = false;
      window.setTimeout(() => {
        if (!millieRef.current) return;
        greeted.current = true;
        millieRef.current.react("excited", 3.2, 1);
        millieRef.current.play("wave");
        millieRef.current.say(MILLIE_INTRO.slice(0, 180));
      }, 500);
    }
  }, []);

  const onPointerDown = (e: ReactPointerEvent) => {
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

  const lastAssistant = [...guide.messages].reverse().find((m) => m.role === "assistant")?.content || null;
  useEffect(() => {
    if (lastAssistant) setIntro("");
  }, [lastAssistant]);

  if (!ready) return null;

  if (!open) {
    return <MillieLauncher onOpen={() => setOpenPersist(true)} />;
  }

  const last =
    guide.pending ||
    (guide.sending ? "…" : null) ||
    lastAssistant ||
    intro ||
    null;
  const line = loadError ? `Avatar failed (${loadError}).` : guide.error || last;

  return (
    <aside
      ref={overlayRef}
      className={styles.overlay}
      data-dragging={dragging || undefined}
      style={{ left: pos.x, top: pos.y, right: "auto", bottom: "auto" }}
      aria-label="Millie guide"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {line ? (
        <p className={styles.bubble} data-err={guide.error || loadError ? "" : undefined} aria-live="polite">
          {line}
        </p>
      ) : null}
      <div ref={anchorRef} className={styles.anchor}>
        <div className={styles.stage}>
          <div className={styles.drag} data-drag aria-hidden />
          <div className={styles.head}>
            <button type="button" className={styles.icon} onClick={() => setOpenPersist(false)} aria-label="Close Millie">
              <IconX size={14} />
            </button>
          </div>
          <MillieCanvas ref={millieRef} active={open} onLoadError={setLoadError} />
        </div>
        <form
          className={styles.ask}
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft;
            setDraft("");
            void guide.send(text);
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={deviceId ? "Ask Millie…" : "Select a board first"}
            disabled={!deviceId || guide.sending}
            aria-label="Message Millie"
          />
          {guide.sending ? (
            <button type="button" onClick={guide.stop}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!deviceId || !draft.trim()}>
              Ask
            </button>
          )}
        </form>
      </div>
    </aside>
  );
}
