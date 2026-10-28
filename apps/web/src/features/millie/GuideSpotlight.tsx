"use client";

import { useEffect, useState } from "react";
import { useDeskGuide } from "./DeskGuideContext";
import styles from "./GuideSpotlight.module.css";

type Box = { top: number; left: number; width: number; height: number };

export function GuideSpotlight() {
  const { highlightTarget, highlightLabel, clearHighlight, tourActive } = useDeskGuide();
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    if (!highlightTarget) {
      setBox(null);
      return;
    }
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-guide="${highlightTarget}"]`);
      if (!el) {
        setBox(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setBox({ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 });
    };
    measure();
    const id = window.setInterval(measure, 160);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [highlightTarget]);

  if (!box || !highlightTarget) return null;

  const labelTop = Math.max(8, box.top - 28);

  return (
    <>
      {highlightLabel ? (
        <div className={styles.spotLabel} style={{ top: labelTop, left: box.left }} aria-hidden>
          {highlightLabel}
        </div>
      ) : null}
      <button
        type="button"
        className={styles.spot}
        style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
        aria-label={tourActive ? `Tour: ${highlightLabel || highlightTarget}` : "Dismiss highlight"}
        onClick={() => {
          if (!tourActive) clearHighlight();
        }}
      />
    </>
  );
}
