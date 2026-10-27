"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { IconX } from "@/ui/icons";
import { useDeskGuide } from "./DeskGuideContext";
import { MillieCanvas, type MillieHandle } from "./MillieCanvas";
import { MillieLauncher } from "./MillieLauncher";
import { clampMilliePos, homeMilliePos, writeMillieOpen, type MilliePos } from "./millieStorage";
import { useMillieGuide } from "./useMillieGuide";
import styles from "./MillieOverlay.module.css";

const W = 260;
const H_GUESS = 320;
const EDGE = 8;

type Props = { deviceId: string | null };

export function MillieOverlay({ deviceId }: Props) {
  const millieRef = useRef<MillieHandle | null>(null);
  const overlayRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(true);
  const [pos, setPos] = useState<MilliePos>(() => homeMilliePos(W, H_GUESS, EDGE));
  const [size, setSize] = useState({ w: W, h: H_GUESS });
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);
  const drag = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);
  const guide = useMillieGuide(deviceId, millieRef);
  const desk = useDeskGuide();
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const goHome = useCallback((w = size.w, h = size.h) => {
    setPos(homeMilliePos(w, h, EDGE));
  }, [size.h, size.w]);

  useEffect(() => {
    writeMillieOpen(true);
    setOpen(true);
    goHome(W, H_GUESS);
    setReady(true);
  }, [goHome]);

  useLayoutEffect(() => {
    if (!open || !overlayRef.current) return;
    const el = overlayRef.current;
    const sync = () => {
      const box = el.getBoundingClientRect();
      const next = { w: Math.ceil(box.width) || W, h: Math.ceil(box.height) || H_GUESS };
      setSize(next);
      if (!drag.current) setPos(homeMilliePos(next.w, next.h, EDGE));
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
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
      millieRef.current?.play("nod");
      millieRef.current?.react("happy", 2);
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
    goHome();
  };

  if (!ready) return null;

  if (!open) {
    return <MillieLauncher onOpen={() => setOpenPersist(true)} />;
  }

  const last =
    guide.pending ||
    [...guide.messages].reverse().find((m) => m.role === "assistant")?.content ||
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
      <div className={styles.stack}>
        {line ? (
          <p className={styles.bubble} data-err={guide.error || loadError ? "" : undefined} aria-live="polite">
            {line}
          </p>
        ) : null}
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
