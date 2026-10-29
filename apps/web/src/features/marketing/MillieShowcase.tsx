"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import type { MillieHandle } from "@/features/millie/MillieCanvas";
import { useInView } from "./useInView";
import styles from "./MillieShowcase.module.css";

const MillieCanvas = dynamic(() => import("@/features/millie/MillieCanvas").then((m) => m.MillieCanvas), {
  ssr: false,
});

type Status = "waiting" | "loading" | "ready" | "error";

const MOVES = [
  { label: "Wave", run: (m: MillieHandle) => m.play("wave") },
  { label: "Celebrate", run: (m: MillieHandle) => (m.react("excited", 2.4), m.play("celebrate")) },
  { label: "Think", run: (m: MillieHandle) => m.play("thinking") },
] as const;

export function MillieShowcase() {
  const { ref, seen } = useInView<HTMLDivElement>();
  const millie = useRef<MillieHandle>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [huang, setHuang] = useState(false);
  const status: Status = failed ? "error" : loaded ? "ready" : seen ? "loading" : "waiting";

  const toggleHuang = () => {
    const next = !huang;
    millie.current?.setTourLook(next);
    if (next) millie.current?.react("excited", 2, 1);
    setHuang(next);
  };

  return (
    <section className={styles.section} id="millie" aria-labelledby="millie-title">
      <div className={styles.copy}>
        <p className={styles.eyebrow}>Meet Millie</p>
        <h2 id="millie-title">A guide who knows the desk.</h2>
        <p className={styles.lead}>
          Millie lives in the corner of your desk. Ask her where anything is, or type{" "}
          <code>/tour</code> for a one-minute walkthrough. She points at each part of the screen as
          she explains it.
        </p>
        <div className={styles.moves} role="group" aria-label="Try Millie">
          {MOVES.map((move) => (
            <button
              key={move.label}
              type="button"
              disabled={status !== "ready"}
              onClick={() => millie.current && move.run(millie.current)}
            >
              {move.label}
            </button>
          ))}
          <button
            type="button"
            className={styles.huang}
            aria-pressed={huang}
            disabled={status !== "ready"}
            onClick={toggleHuang}
          >
            {huang ? "Back to Nebius look" : "Huang mode"}
          </button>
        </div>
      </div>

      <div ref={ref} className={styles.stage} data-status={status} data-millie-frame="0.95">
        <div className={styles.halo} aria-hidden />
        {seen && !failed ? (
          <MillieCanvas
            ref={millie}
            active
            className={styles.canvas}
            onReady={() => setLoaded(true)}
            onLoadError={() => setFailed(true)}
          />
        ) : null}
        {status === "loading" || status === "waiting" ? <p className={styles.state}>Millie is on her way…</p> : null}
        {status === "error" ? <p className={styles.state}>Millie couldn&apos;t load here. She&apos;s waiting inside the desk.</p> : null}
      </div>
    </section>
  );
}
