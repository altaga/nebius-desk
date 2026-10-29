"use client";

import { useState, type KeyboardEvent } from "react";
import styles from "./LoginScreen.module.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function PasswordField({ value, onChange, disabled }: Props) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const readCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.("CapsLock") ?? false);

  return (
    <div className={styles.field}>
      <label htmlFor="login-password">Password</label>
      <div className={styles.passwordWrap}>
        <input
          id="login-password"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={readCaps}
          onKeyUp={readCaps}
          onBlur={() => setCapsLock(false)}
          autoComplete="current-password"
          autoFocus
          disabled={disabled}
          required
          aria-describedby={capsLock ? "caps-hint" : undefined}
        />
        <button
          type="button"
          className={styles.reveal}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          disabled={disabled}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {capsLock ? (
        <p id="caps-hint" className={styles.hint}>
          Caps Lock is on.
        </p>
      ) : null}
    </div>
  );
}
