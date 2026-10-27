"use client";

import styles from "./Panel.module.css";

export type PanelTab = "chat" | "board" | "plan";

const TABS: Array<[PanelTab, string]> = [
  ["chat", "Chat"],
  ["board", "Board"],
  ["plan", "Plan"],
];

type Props = {
  active: PanelTab;
  onChange: (tab: PanelTab) => void;
};

export function PanelTabs({ active, onChange }: Props) {
  return (
    <div className={styles.tabs} role="tablist" aria-label="Telemetry sections">
      {TABS.map(([id, label]) => (
        <button
          key={id}
          id={`tab-${id}`}
          type="button"
          role="tab"
          aria-selected={active === id}
          aria-controls={`panel-${id}`}
          data-on={active === id}
          data-guide={`panel.${id}`}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
