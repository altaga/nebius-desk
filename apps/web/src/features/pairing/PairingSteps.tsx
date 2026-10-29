"use client";

import login from "@/features/auth/LoginScreen.module.css";
import { boardLabel } from "./localBoard";
import { PairingActions } from "./PairingActions";
import styles from "./PairingWizard.module.css";
import type { usePairingWizard } from "./usePairingWizard";

type Wizard = ReturnType<typeof usePairingWizard>;

export function SetupForm({ w }: { w: Wizard }) {
  return (
    <>
      <h1>Set up this board.</h1>
      <p className={login.sub}>
        Name, a password for later sudo, and Wi-Fi for {w.selected ? boardLabel(w.selected) : "this board"}.
      </p>
      <form
        className={login.form}
        onSubmit={(e) => {
          e.preventDefault();
          void w.submitForm();
        }}
        noValidate
      >
        <Field id="board-name" label="Board name" value={w.form.name} onChange={(v) => w.patch({ name: v })} disabled={w.busy} />
        <Field
          id="board-password"
          label="Board password"
          value={w.form.password}
          onChange={(v) => w.patch({ password: v })}
          type="password"
          autoComplete="new-password"
          disabled={w.busy}
        />
        <Field id="wifi-ssid" label="Wi-Fi name" value={w.form.wifiSsid} onChange={(v) => w.patch({ wifiSsid: v })} disabled={w.busy} />
        <Field
          id="wifi-password"
          label="Wi-Fi password"
          value={w.form.wifiPassword}
          onChange={(v) => w.patch({ wifiPassword: v })}
          type="password"
          disabled={w.busy}
        />
        {w.error ? (
          <p className={login.error} role="alert">
            {w.error}
          </p>
        ) : null}
        <PairingActions
          primary={w.busy ? "Saving…" : "Next"}
          primaryDisabled={!w.canNext || w.busy}
          secondary="Back"
          onSecondary={w.back}
          secondaryDisabled={w.busy}
        />
      </form>
    </>
  );
}

export function PairIdStep({ w }: { w: Wizard }) {
  const code = w.status?.code;
  const paired = w.claimed || Boolean(w.status?.paired);
  return (
    <>
      <h1>{paired ? "Board enrolled." : "Pair ID"}</h1>
      <p className={login.sub}>
        {paired
          ? "This desk now owns the board. You can open it from the fleet."
          : "Waiting for confirmation. Confirm this Pair ID to enroll the board."}
      </p>
      <div className={styles.codeCard}>
        {code ? <p className={styles.code}>{code}</p> : <p className={styles.scanLine}>Waiting for a Pair ID…</p>}
        <p className={styles.meta}>
          {w.status?.name || "Board"}
          {w.origin ? ` · ${w.origin.replace(/^https?:\/\//, "")}` : ""}
        </p>
        {w.error ? (
          <p className={login.error} role="alert">
            {w.error}
          </p>
        ) : null}
        <PairingActions
          primary={paired ? "Open desk" : w.busy ? "Confirming…" : "Confirm"}
          primaryType="button"
          onPrimary={paired ? w.onDone : () => void w.retryClaim()}
          primaryDisabled={w.busy || (!paired && !code)}
          secondary="Back"
          onSecondary={w.back}
          secondaryDisabled={w.busy}
        />
      </div>
    </>
  );
}

function Field(p: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "password";
  autoComplete?: string;
  disabled?: boolean;
}) {
  return (
    <div className={login.field}>
      <label htmlFor={p.id}>{p.label}</label>
      <input
        id={p.id}
        type={p.type ?? "text"}
        value={p.value}
        onChange={(e) => p.onChange(e.target.value)}
        autoComplete={p.autoComplete ?? "off"}
        disabled={p.disabled}
        spellCheck={false}
      />
    </div>
  );
}
