"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JetsonHealth } from "@/shared/api";
import type { DeviceRow } from "@/features/desk/types";
import { api } from "@/lib/api";
import { BoardName } from "./BoardName";
import { FilesPane } from "./FilesPane";
import { JobsPane } from "./JobsPane";
import { ServicesPane } from "./ServicesPane";
import { TerminalPane } from "./TerminalPane";
import styles from "./Machine.module.css";

export type MachineTab = "health" | "terminal" | "files" | "services" | "agents";

const HEALTH_POLL_MS = 15_000;

function num(value: number | null | undefined, suffix = "") {
  return value == null ? "—" : `${value}${suffix}`;
}

function oneLine(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ") || "—";
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
  const healthSeen = useRef(false);
  const healthSeq = useRef(0);

  const loadHealth = useCallback((quiet: boolean) => {
    const id = ++healthSeq.current;
    if (!quiet) setHealthLoading(true);
    api()
      .edgeStats()
      .then((data) => {
        if (id !== healthSeq.current) return;
        healthSeen.current = true;
        setHealth(data);
        setHealthError(null);
      })
      .catch((err: unknown) => {
        if (id !== healthSeq.current || healthSeen.current) return;
        setHealthError(err instanceof Error ? err.message : "Health unavailable");
      })
      .finally(() => {
        if (id === healthSeq.current && !quiet) setHealthLoading(false);
      });
  }, []);

  useEffect(() => {
    healthSeen.current = false;
    healthSeq.current += 1;
    setHealth(null);
    setHealthError(null);
  }, [device.id]);

  useEffect(() => {
    if (tab !== "health") return;
    loadHealth(false);
    const id = window.setInterval(() => loadHealth(true), HEALTH_POLL_MS);
    return () => window.clearInterval(id);
  }, [tab, device.id, loadHealth]);

  const fill =
    tab === "terminal" || tab === "files" || tab === "services" || tab === "agents";

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
            ["services", "Services", "machine.services"],
            ["agents", "Agents", "machine.agents"],
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
          <HealthPane health={health} fleetName={device.name} error={healthError} loading={healthLoading} />
        ) : null}
        {tab === "terminal" ? <TerminalPane deviceId={device.id} /> : null}
        {/* Keep mounted so cwd / open file survive tab switches. */}
        <div hidden={tab !== "files"} className={styles.keepPane}>
          <FilesPane key={device.id} deviceId={device.id} />
        </div>
        {tab === "services" ? <ServicesPane key={device.id} /> : null}
        {tab === "agents" ? <JobsPane key={device.id} deviceId={device.id} /> : null}
      </div>
    </section>
  );
}

function HealthPane({
  health,
  fleetName,
  error,
  loading,
}: {
  health: JetsonHealth | null;
  fleetName: string;
  error: string | null;
  loading: boolean;
}) {
  const ram =
    health?.ram_used_mb != null && health.ram_total_mb != null
      ? `${health.ram_used_mb} / ${health.ram_total_mb} MB`
      : "—";
  const disk =
    health?.disk_used_gb != null && health.disk_total_gb != null
      ? `${health.disk_used_gb} / ${health.disk_total_gb} GB`
      : "—";
  const host = health?.hostname || health?.host || "—";
  const home = health?.home || health?.desk_root || "—";
  const runtime = oneLine([health?.runtime, health?.cloud_provider, health?.instance_type]);
  const machine = oneLine([health?.product_name, health?.product_version, health?.sys_vendor]);
  const cpu = oneLine([health?.cpu_model, health?.cpu_cores != null ? `${health.cpu_cores} vCPU` : null]);
  return (
    <>
      {error ? <p className={styles.error}>{error}</p> : null}
      {!health && loading ? <p className={styles.note}>Reading sensors…</p> : null}
      {health && !health.jetson_online ? (
        <p className={styles.note}>
          No Jetson is reporting. Showing the local machine running this desk on {host} as{" "}
          {health.os_user || "unknown"} instead.
        </p>
      ) : null}
      <dl className={styles.grid}>
        <div><dt>Fleet</dt><dd>{fleetName}</dd></div>
        <div><dt>Hostname</dt><dd>{host}</dd></div>
        <div><dt>OS user</dt><dd>{health?.os_user || "—"}</dd></div>
        <div><dt>Home</dt><dd title={home}>{home}</dd></div>
        <div><dt>Model</dt><dd>{health?.model || "—"}</dd></div>
        <div><dt>Runtime</dt><dd>{runtime}</dd></div>
        <div><dt>Machine</dt><dd title={machine}>{machine}</dd></div>
        <div><dt>CPU model</dt><dd title={cpu}>{cpu}</dd></div>
        <div><dt>Arch</dt><dd>{oneLine([health?.arch, health?.kernel])}</dd></div>
        <div><dt>Local IP</dt><dd>{health?.local_ipv4 || "—"}</dd></div>
        <div><dt>Zone</dt><dd>{health?.availability_zone || "—"}</dd></div>
        <div><dt>Instance</dt><dd title={health?.instance_id || undefined}>{oneLine([health?.instance_type, health?.instance_id])}</dd></div>
        <div><dt>Temperature</dt><dd>{num(health?.temp_c, " °C")}</dd></div>
        <div><dt>CPU</dt><dd>{num(health?.cpu_pct, "%")}</dd></div>
        <div><dt>GPU</dt><dd>{num(health?.gpu_util_pct, "%")}</dd></div>
        <div><dt>RAM</dt><dd>{ram}</dd></div>
        <div><dt>Disk</dt><dd>{disk}</dd></div>
      </dl>
      <p className={styles.note}>
        Fleet is the Desk label; hostname is the OS network name; OS user owns ~.
      </p>
    </>
  );
}
