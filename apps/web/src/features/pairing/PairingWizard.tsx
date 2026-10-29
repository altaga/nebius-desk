"use client";

import { BrandMark } from "@/ui/BrandMark";
import login from "@/features/auth/LoginScreen.module.css";
import { FindStep } from "./BoardPicker";
import { PairIdStep, SetupForm } from "./PairingSteps";
import { usePairingWizard } from "./usePairingWizard";
import styles from "./PairingWizard.module.css";

export function PairingWizard({ onDone }: { onDone: () => void }) {
  const w = usePairingWizard(onDone);

  return (
    <main className={login.wrap}>
      <section className={login.side} aria-busy={w.busy || w.scanning}>
        <header className={login.top}>
          <a className={login.brand} href="/dashboard" aria-label="Back to desk">
            <BrandMark size={26} />
            <span>
              Nebius<b>Desk</b>
            </span>
          </a>
          <a className={login.back} href="/dashboard">
            ← Desk
          </a>
        </header>

        <div className={login.formArea}>
          <ol className={styles.steps} aria-label="Pairing steps">
            <li data-on={w.step === "scan"}>1 · Discover</li>
            <li data-on={w.step === "form"}>2 · Setup</li>
            <li data-on={w.step === "code"}>3 · Pair ID</li>
          </ol>
          <p className={login.kicker}>
            <span className={login.dot} aria-hidden />
            Local board setup
          </p>
          {w.step === "scan" ? <FindStep w={w} /> : null}
          {w.step === "form" ? <SetupForm w={w} /> : null}
          {w.step === "code" ? <PairIdStep w={w} /> : null}
        </div>
        <footer className={login.foot}>Discover, set credentials, then confirm the Pair ID.</footer>
      </section>
      <aside className={login.explain} aria-hidden>
        <div className={login.explainInner}>
          <p className={login.eyebrow}>Onboarding</p>
          <h2>
            Discover the board.
            <span> Then set it up.</span>
          </h2>
          <p className={login.explainText}>
            Desk finds an unpaired board on this machine. You set the name, password, and Wi-Fi, then confirm the Pair
            ID to enroll it.
          </p>
        </div>
      </aside>
    </main>
  );
}
