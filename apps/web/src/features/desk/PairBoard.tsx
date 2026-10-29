"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { IconChip } from "@/ui/icons";
import styles from "./DeskNav.module.css";

export function PairBoard({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const clean = code.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api().claimPair(clean);
      setCode("");
      onPaired();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code did not pair");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.pair}
      data-guide="nav.pair"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className={styles.pairLabel}>Pair new board?</p>
      <Link className={styles.pairSetup} href="/pair">
        <IconChip size={15} />
        Set up a board
      </Link>
      <div className={styles.pairRow}>
        <input
          id="pair-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD-EFGH"
          aria-label="Pairing code"
          autoCapitalize="characters"
        />
        <button type="submit" disabled={busy || code.trim().length < 8}>
          {busy ? "Pairing" : "Pair"}
        </button>
      </div>
      {error ? <p className={styles.hint}>{error}</p> : null}
    </form>
  );
}
