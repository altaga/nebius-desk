"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import styles from "./DevicesPanel.module.css";

export type DeviceRow = {
  id: string;
  name: string;
  hostname: string;
  kind: string;
  status: string;
  agent_count: number;
};

type Props = {
  onOpen: (device: DeviceRow) => void;
};

export function DevicesPanel({ onOpen }: Props) {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api()
      .listDevices()
      .then(setDevices)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load devices"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className={styles.muted}>Loading devices…</p>;
  if (error) return <p className={styles.error}>{error}</p>;

  return (
    <div className={styles.grid}>
      {devices.map((d) => (
        <button
          key={d.id}
          type="button"
          className={styles.card}
          onClick={() => onOpen(d)}
        >
          <span className={styles.status} data-status={d.status}>
            {d.status}
          </span>
          <strong>{d.name}</strong>
          <span className={styles.meta}>
            {d.kind} · {d.hostname || "—"}
          </span>
          <span className={styles.meta}>{d.agent_count} chats</span>
        </button>
      ))}
    </div>
  );
}
