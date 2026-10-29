"use client";

import login from "@/features/auth/LoginScreen.module.css";
import { boardHost, boardLabel } from "./localBoard";
import { PairingActions } from "./PairingActions";
import styles from "./PairingWizard.module.css";
import type { usePairingWizard } from "./usePairingWizard";

type Wizard = ReturnType<typeof usePairingWizard>;

export function FindStep({ w }: { w: Wizard }) {
  return (
    <>
      <h1>Discover a board.</h1>
      <p className={login.sub}>Desk looks on this machine for a connected board that is not paired yet.</p>
      {w.scanning ? (
        <p className={styles.scanLine}>
          <span className={login.spinner} aria-hidden />
          Looking on the local network…
        </p>
      ) : null}
      {!w.scanning && w.candidates.length > 0 ? (
        <form
          className={login.form}
          onSubmit={(e) => {
            e.preventDefault();
            w.confirmPick();
          }}
        >
          <fieldset className={styles.picker}>
            <legend className={styles.srOnly}>Available boards</legend>
            {w.candidates.map((row) => {
              const id = `board-${boardHost(row.base).replace(/[^\w.-]+/g, "-")}`;
              return (
                <label key={row.base} className={styles.choice} htmlFor={id} data-on={w.picked === row.base}>
                  <input
                    id={id}
                    type="radio"
                    name="local-board"
                    value={row.base}
                    checked={w.picked === row.base}
                    onChange={() => w.setPicked(row.base)}
                  />
                  <span>
                    <strong>{boardLabel(row)}</strong>
                    <small>{boardHost(row.base)}</small>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <PairingActions
            primary="Next"
            primaryDisabled={!w.picked}
            secondary="Scan again"
            onSecondary={() => void w.scan()}
          />
        </form>
      ) : null}
      {!w.scanning && w.error ? (
        <p className={login.error} role="alert">
          {w.error}
        </p>
      ) : null}
      {!w.scanning && w.candidates.length === 0 ? (
        <button type="button" className={styles.primary} onClick={() => void w.scan()} style={{ marginTop: 24 }}>
          Scan again
        </button>
      ) : null}
    </>
  );
}
