"use client";

import type { JetsonHealth } from "@/shared/api";
import { fmtUptime, pct } from "@/features/panel/format";
import { Meter } from "@/features/panel/Meter";
import { usePolled } from "@/features/panel/usePolled";
import { api } from "@/lib/api";
import styles from "./Panel.module.css";

type Props = { deviceName: string };

function reading(value: number | null | undefined, suffix: string) {
  return value == null ? "—" : `${Math.round(value)}${suffix}`;
}

function oneLine(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ") || "—";
}

export function DeviceCard({ deviceName }: Props) {
  const { data, error, loading } = usePolled(() => api().edgeStats(), 5000);
  const connected = !!data?.jetson_online;

  return (
    <>
      <Identity
        deviceName={deviceName}
        data={data}
        error={error}
        loading={loading}
        connected={connected}
      />
      {data && connected ? (
        <>
          <Compute data={data} />
          <Storage data={data} />
        </>
      ) : null}
    </>
  );
}

function Identity({
  deviceName,
  data,
  error,
  loading,
  connected,
}: {
  deviceName: string;
  data: JetsonHealth | null;
  error: string | null;
  loading: boolean;
  connected: boolean;
}) {
  return (
    <section className={styles.card} aria-label="Identity">
      <header className={styles.cardHead}>
        <h3>Identity</h3>
        <span className={styles.status} data-ok={connected}>
          {loading && !data ? "checking" : connected ? "reporting" : "not connected"}
        </span>
      </header>
      <p className={styles.title}>{deviceName}</p>
      {error ? <p className={styles.muted}>Health unavailable.</p> : null}
      {data && connected ? (
        <p className={styles.sub}>{data.model ?? "Jetson"} · up {fmtUptime(data.uptime_sec)}</p>
      ) : null}
      {data && !connected ? (
        <>
          <p className={styles.sub}>
            {oneLine([data.runtime, data.cloud_provider, data.instance_type])} · up {fmtUptime(data.uptime_sec)}
          </p>
          <p className={styles.footnote}>
            No Jetson is reporting to this desk. Showing the local machine on {data.host}
            {data.local_ipv4 ? ` (${data.local_ipv4})` : ""} instead.
          </p>
        </>
      ) : null}
    </section>
  );
}

function Compute({ data }: { data: JetsonHealth }) {
  return (
    <section className={styles.card} aria-label="Compute">
      <header className={styles.cardHead}>
        <h3>Compute</h3>
      </header>
      <dl className={styles.stats}>
        <div>
          <dt>Temp</dt>
          <dd>{reading(data.temp_c, "°C")}</dd>
        </div>
        <div>
          <dt>CPU</dt>
          <dd>{reading(data.cpu_pct, "%")}</dd>
        </div>
        <div>
          <dt>GPU</dt>
          <dd>{reading(data.gpu_util_pct, "%")}</dd>
        </div>
      </dl>
    </section>
  );
}

function Storage({ data }: { data: JetsonHealth }) {
  const ramPct = data.ram_total_mb ? pct(data.ram_used_mb ?? 0, data.ram_total_mb) : 0;
  const hasReadings = !!data.ram_total_mb || !!data.disk_total_gb;
  return (
    <section className={styles.card} aria-label="Storage">
      <header className={styles.cardHead}>
        <h3>Storage</h3>
      </header>
      {data.ram_total_mb ? (
        <div className={styles.row}>
          <span>Memory</span>
          <span className={styles.num}>
            {((data.ram_used_mb ?? 0) / 1024).toFixed(1)} of {(data.ram_total_mb / 1024).toFixed(1)} GB
          </span>
          <Meter
            label={`Memory ${Math.round(ramPct)}% used`}
            total={100}
            segments={[{ label: "Used", value: ramPct, color: ramPct > 85 ? "var(--warn)" : "var(--edge)" }]}
          />
        </div>
      ) : null}
      {data.disk_total_gb ? (
        <div className={styles.row}>
          <span>Disk</span>
          <span className={styles.num}>
            {data.disk_used_gb} of {data.disk_total_gb} GB
          </span>
          <Meter
            label={`Disk ${Math.round(data.disk_used_pct ?? 0)}% used`}
            total={100}
            segments={[
              {
                label: "Used",
                value: data.disk_used_pct ?? 0,
                color: (data.disk_used_pct ?? 0) > 90 ? "var(--warn)" : "var(--edge)",
              },
            ]}
          />
        </div>
      ) : null}
      {!hasReadings ? <p className={styles.muted}>No storage readings.</p> : null}
    </section>
  );
}
