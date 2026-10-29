"use client";

import styles from "./PairingWizard.module.css";

type Props = {
  primary: string;
  onPrimary?: () => void;
  primaryType?: "button" | "submit";
  primaryDisabled?: boolean;
  secondary: string;
  onSecondary: () => void;
  secondaryDisabled?: boolean;
};

export function PairingActions(p: Props) {
  return (
    <div className={styles.actions}>
      <button type={p.primaryType ?? "submit"} className={styles.primary} onClick={p.onPrimary} disabled={p.primaryDisabled}>
        {p.primary}
      </button>
      <button type="button" className={styles.ghost} onClick={p.onSecondary} disabled={p.secondaryDisabled}>
        {p.secondary}
      </button>
    </div>
  );
}
