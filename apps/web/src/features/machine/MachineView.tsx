"use client";

import { useCallback, useEffect, useState } from "react";
import type { JetsonHealth } from "@/shared/api";
import type { DeviceRow } from "@/features/desk/types";
import { api } from "@/lib/api";
import { BoardName } from "./BoardName";
import { FilesPane } from "./FilesPane";
import { TerminalPane } from "./TerminalPane";
import styles from "./Machine.module.css";

export type MachineTab = "health" | "terminal" | "files";

function num(value: number | null | undefined, suffix = "") {
  return value == null ? "—" : `${value}${suffix}`;
}

type Props = {
  device: DeviceRow;
  onRename: (name: string) => Promise<void>;
  tab?: MachineTab;
  onTab?: (tab: MachineTab) => void;
};

export function MachineView({ device, onRename, tab: tabProp, onTab }: Props) {
  const [tabLocal, setTabLocal] = useState<MachineTab>("health");
  const tab = tabProp ?? tabLocal;
  const setTab = onTab ?? setTabLocal;
  const [remote, setRemote] = useState(device.remote_enabled !== false);
  useEffect(() => {
    setRemote(device.remote_enabled !== false);
  }, [device.id, device.remote_enabled]);
  const [health, setHealth] = useState<JetsonHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const loadHealth = useCallback(() => {
    setHealthLoading(true);
    api()
      .edgeStats()
      .then((data) => {
        setHealth(data);
        setHealthError(null);
      })
      .catch((err: unknown) => setHealthError(err instanceof Error ? err.message : "Health unavailable"))
      .finally(() => setHealthLoading(false));
  }, []);

  // Prefetch as soon as Machine opens — don't wait for the Health tab click.
  useEffect(() => {
    loadHealth();
  }, [device.id, loadHealth]);

  useEffect(() => {
    if (tab !== "health") return;
    const id = window.setInterval(loadHealth, 4000);
    return () => window.clearInterval(id);
  }, [tab, loadHealth]);

  const fill = tab === "terminal" || tab === "files";

  return (
    <section className={styles.view} aria-label="Machine">
      <BoardName name={device.name} onRename={onRename} />
      <label className={styles.remote}>
        <input
          type="checkbox"
          checked={remote}
          onChange={(e) => {
            const next = e.target.checked;
            setRemote(next);
            void api().setRemote(device.id, next).catch(() => setRemote(!next));
          }}
        />
        Remote access
      </label>
      <div className={styles.tabs} role="tablist">
        {(
          [
            ["health", "Health", "machine.health"],
            ["terminal", "Terminal", "machine.terminal"],
            ["files", "Files", "machine.files"],
          ] as const
        ).map(([id, label, guide]) => (
          <button
            key={id}
            type="button"
            role="tab"
            data-on={tab === id}
            data-guide={guide}
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={styles.body} data-fill={fill}>
        {tab === "health" ? (
          <HealthPane health={health} error={healthError} loading={healthLoading} onRefresh={loadHealth} />
        ) : null}
        {tab === "terminal" ? <TerminalPane deviceId={device.id} /> : null}
        {tab === "files" ? <FilesPane /> : null}
      </div>
    </section>
  );
}

function HealthPane({
  health,
  error,
  loading,
  onRefresh,
}: {
  health: JetsonHealth | null;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const ram =
    health?.ram_used_mb != null && health.ram_total_mb != null
      ? `${health.ram_used_mb} / ${health.ram_total_mb} MB`
      : "—";
  const disk =
    health?.disk_used_gb != null && health.disk_total_gb != null
      ? `${health.disk_used_gb} / ${health.disk_total_gb} GB`
      : "—";
  if (health && !health.jetson_online) {
    return (
      <>
        <p className={styles.note}>
          No Jetson is reporting. The API is running on {health.host}, which has no board sensors.
        </p>
        <button type="button" className={styles.action} onClick={onRefresh}>Check again</button>
      </>
    );
  }
  return (
    <>
      {error ? <p className={styles.error}>{error}</p> : null}
      {!health && loading ? <p className={styles.note}>Reading sensors…</p> : null}
      <dl className={styles.grid}>
        <div><dt>Temperature</dt><dd>{num(health?.temp_c, " °C")}</dd></div>
        <div><dt>CPU</dt><dd>{num(health?.cpu_pct, "%")}</dd></div>
        <div><dt>GPU</dt><dd>{num(health?.gpu_util_pct, "%")}</dd></div>
        <div><dt>RAM</dt><dd>{ram}</dd></div>
        <div><dt>Disk</dt><dd>{disk}</dd></div>
      </dl>
      <p className={styles.note}>
        {health?.jetson_online ? health.host : "Readings come from the host. Missing sensors stay blank."}
        {loading && health ? " · updating…" : ""}
      </p>
      <button type="button" className={styles.action} onClick={onRefresh} disabled={loading}>
        Refresh
      </button>
    </>
  );
}
