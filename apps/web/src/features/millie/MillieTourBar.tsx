"use client";

import styles from "./MillieOverlay.module.css";

type Props = {
  index: number;
  total: number;
  lang: "es" | "en";
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
};

export function MillieTourBar({ index, total, lang, onPrev, onNext, onClose }: Props) {
  const last = index >= total - 1;
  const es = lang === "es";
  return (
    <div className={styles.tourBar} role="group" aria-label={es ? "Controles del tour" : "Tour controls"}>
      <button type="button" className={styles.tourGhost} onClick={onPrev} disabled={index <= 0}>
        {es ? "Anterior" : "Previous"}
      </button>
      <span className={styles.tourCount} aria-live="polite">
        {index + 1} / {total}
      </span>
      <button type="button" className={styles.tourPrimary} onClick={onNext}>
        {last ? (es ? "Listo" : "Done") : es ? "Siguiente" : "Next"}
      </button>
      <button type="button" className={styles.tourGhost} onClick={onClose} aria-label={es ? "Cerrar tour" : "Close tour"}>
        {es ? "Cerrar" : "Close"}
      </button>
    </div>
  );
}
