"use client";

import { useEffect, useState } from "react";
import { useDeskGuide } from "./DeskGuideContext";
import styles from "./GuideSpotlight.module.css";

type Box = { top: number; left: number; width: number; height: number };

export function GuideSpotlight() {
  const { highlightTarget, clearHighlight } = useDeskGuide();
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
      setBox({ top: r.top - 4, left: r.left - 4, width: r.width + 8, height: r.height + 8 });
    };
    measure();
    const id = window.setInterval(measure, 200);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [highlightTarget]);

  if (!box || !highlightTarget) return null;

  return (
    <button
      type="button"
      className={styles.spot}
      style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
      aria-label="Dismiss highlight"
      onClick={clearHighlight}
    />
  );
}
