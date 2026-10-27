"use client";

import { BrandMark } from "@/ui/BrandMark";
import styles from "./BootSplash.module.css";

/** Shown while the session cookie is being checked. */
export function BootSplash() {
  return (
    <main className={styles.wrap} aria-busy="true" aria-live="polite">
      <BrandMark size={36} />
      <span className={styles.bar} aria-hidden />
      <p>Connecting to your desk…</p>
    </main>
  );
}
