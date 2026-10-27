"use client";

import { useState } from "react";
import type { SessionTelemetry } from "@nebius-desk/shared/index";
import type { DeviceRow } from "@/features/desk/types";
import { BoardSections } from "@/features/panel/BoardSections";
import { PanelTabs, type PanelTab } from "@/features/panel/PanelTabs";
import { RouterCard } from "@/features/panel/RouterCard";
import { SessionCard } from "@/features/panel/SessionCard";
import { SubscriptionCard } from "@/features/panel/SubscriptionCard";
import { useModels } from "@/features/panel/useModels";
import { IconX } from "@/ui/icons";
import styles from "./Panel.module.css";

type Props = {
  device: DeviceRow | null;
  telemetry: SessionTelemetry | null;
  memoryVersion: number;
  onNewChat: () => void;
  onClose: () => void;
  onUse: (prompt: string) => void;
  tab?: PanelTab;
  onTab?: (tab: PanelTab) => void;
  boardSection?: "status" | "memory" | "experts" | "secrets";
  onBoardSection?: (section: "status" | "memory" | "experts" | "secrets") => void;
};

const INTRO: Record<Exclude<PanelTab, "board">, string> = {
  chat: "What the open chat used and where each answer ran.",
  plan: "What your subscription includes and how much is left.",
};

export function TelemetryPanel({
  device,
  telemetry,
  memoryVersion,
  onNewChat,
  onClose,
  onUse,
  tab: tabProp,
  onTab,
  boardSection,
  onBoardSection,
}: Props) {
  const [tabLocal, setTabLocal] = useState<PanelTab>("chat");
  const tab = tabProp ?? tabLocal;
  const setTab = onTab ?? setTabLocal;
  const models = useModels();

  return (
    <aside className={styles.panel} aria-label="Telemetry">
      <header className={styles.panelHead}>
        <PanelTabs active={tab} onChange={setTab} />
        <button type="button" className={styles.close} onClick={onClose} aria-label="Hide telemetry panel">
          <IconX size={14} />
        </button>
      </header>
      <div className={styles.cards} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {device ? (
          <>
            {tab !== "board" ? <p className={styles.intro}>{INTRO[tab]}</p> : null}
            {tab === "chat" ? (
              <>
                <SessionCard telemetry={telemetry} models={models.data} onNewChat={onNewChat} />
                <RouterCard state={models} />
              </>
            ) : null}
            {tab === "board" ? (
              <BoardSections
                key={device.id}
                deviceId={device.id}
                deviceName={device.name}
                memoryVersion={memoryVersion}
                onUse={onUse}
                section={boardSection}
                onSection={onBoardSection}
              />
            ) : null}
            {tab === "plan" ? <SubscriptionCard refreshKey={telemetry?.turns ?? 0} /> : null}
          </>
        ) : (
          <p className={styles.muted}>Select a board to see its telemetry.</p>
        )}
      </div>
    </aside>
  );
}
