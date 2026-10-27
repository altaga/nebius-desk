"use client";

import { useCallback, useEffect, useState } from "react";
import { BrainCard } from "@/features/library/BrainCard";
import { VaultCard } from "@/features/library/VaultCard";
import { DeviceCard } from "@/features/panel/DeviceCard";
import { MemoryCard } from "@/features/panel/MemoryCard";
import { api } from "@/lib/api";
import styles from "./Panel.module.css";

type BoardSection = "status" | "memory" | "experts" | "secrets";

const SECTIONS: Array<{ id: BoardSection; label: string; detail: string }> = [
  { id: "status", label: "Status", detail: "Who the board is and whether it is reporting." },
  { id: "memory", label: "Memory", detail: "Markdown files every chat on this board can read." },
  { id: "experts", label: "Experts", detail: "Profiles called with @Name." },
  { id: "secrets", label: "Secrets", detail: "Names injected into the CLI and the terminal." },
];

type Counts = { memory: number | null; experts: number | null; secrets: number | null };

type Props = {
  deviceId: string;
  deviceName: string;
  memoryVersion: number;
  onUse: (prompt: string) => void;
  section?: BoardSection;
  onSection?: (section: BoardSection) => void;
};

export function BoardSections({ deviceId, deviceName, memoryVersion, onUse, section: sectionProp, onSection }: Props) {
  const [sectionLocal, setSectionLocal] = useState<BoardSection>("status");
  const section = sectionProp ?? sectionLocal;
  const setSection = onSection ?? setSectionLocal;
  const [counts, setCounts] = useState<Counts>({ memory: null, experts: null, secrets: null });

  useEffect(() => {
    let cancel = false;
    Promise.all([
      api().listDeviceMemory(deviceId).then((rows) => rows.length),
      api().listBrains().then((rows) => rows.length),
      api().listSecrets().then((rows) => rows.length),
    ])
      .then(([memory, experts, secrets]) => {
        if (cancel) return;
        setCounts((prev) => ({
          memory,
          experts: prev.experts ?? experts,
          secrets: prev.secrets ?? secrets,
        }));
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [deviceId, memoryVersion]);

  const setCount = useCallback((key: keyof Counts, value: number) => {
    setCounts((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);

  const active = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];

  return (
    <>
      <nav className={styles.boardSections} aria-label="Board sections">
        {SECTIONS.map((item) => {
          const count = item.id === "status" ? null : counts[item.id];
          return (
            <button
              key={item.id}
              type="button"
              data-guide={`board.${item.id}`}
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => setSection(item.id)}
            >
              <span>{item.label}</span>
              {count != null ? <span className={styles.num}>{count}</span> : null}
            </button>
          );
        })}
      </nav>
      <p className={styles.intro}>{active.detail}</p>
      {section === "status" ? <DeviceCard deviceName={deviceName} /> : null}
      {section === "memory" ? (
        <MemoryCard
          deviceId={deviceId}
          version={memoryVersion}
          onUse={onUse}
          onCount={(count) => setCount("memory", count)}
        />
      ) : null}
      {section === "experts" ? (
        <BrainCard deviceId={deviceId} onUse={onUse} onCount={(count) => setCount("experts", count)} />
      ) : null}
      {section === "secrets" ? <VaultCard onCount={(count) => setCount("secrets", count)} /> : null}
    </>
  );
}
