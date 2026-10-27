"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TitleRename } from "@/features/desk/TitleRename";
import type { DeviceRow } from "@/features/desk/types";
import { IconChip, IconDots, IconPencil, IconTrash } from "@/ui/icons";
import styles from "./DeskNav.module.css";

type Props = {
  devices: DeviceRow[];
  loading: boolean;
  activeId: string | null;
  onSelect: (d: DeviceRow) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
};

export function FleetList({ devices, loading, activeId, onSelect, onRename, onRemove }: Props) {
  if (loading) return <p className={styles.hint}>Looking for devices…</p>;
  if (devices.length === 0) {
    return <p className={styles.hint}>No board paired yet.</p>;
  }
  return (
    <ul className={styles.fleet}>
      {devices.map((d) => (
        <FleetRow
          key={d.id}
          device={d}
          active={d.id === activeId}
          onSelect={() => onSelect(d)}
          onRename={(name) => onRename(d.id, name)}
          onRemove={() => onRemove(d.id)}
        />
      ))}
    </ul>
  );
}

function FleetRow({
  device,
  active,
  onSelect,
  onRename,
  onRemove,
}: {
  device: DeviceRow;
  active: boolean;
  onSelect: () => void;
  onRename: (name: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"idle" | "menu" | "rename" | "confirm">("idle");
  const [error, setError] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const online = device.status === "online";

  useEffect(() => {
    if (mode !== "menu") return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (moreRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setMode("idle");
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [mode]);

  function openMenu() {
    const box = moreRef.current?.getBoundingClientRect();
    if (box) {
      const width = 148;
      const left = Math.min(box.right - width, window.innerWidth - width - 8);
      setMenuPos({ top: box.bottom + 4, left: Math.max(8, left) });
    }
    setMode("menu");
  }

  if (mode === "rename") {
    return (
      <li className={styles.fleetRow}>
        <TitleRename
          initial={device.name}
          label="Board name"
          className={styles.fleetRename}
          onSave={onRename}
          onCancel={() => setMode("idle")}
        />
      </li>
    );
  }

  return (
    <li className={styles.fleetRow} data-open={mode !== "idle"}>
      <button
        type="button"
        className={styles.device}
        data-active={active}
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
      >
        <IconChip size={15} />
        <span className={styles.deviceName}>{device.name}</span>
        <span className={styles.deviceMeta}>{online ? "Online" : "Offline"}</span>
        <i className={styles.dot} data-online={online} aria-label={online ? "Online" : "Offline"} />
      </button>
      <button
        ref={moreRef}
        type="button"
        className={styles.fleetMore}
        aria-label={`Options for ${device.name}`}
        aria-expanded={mode === "menu"}
        onClick={(e) => {
          e.stopPropagation();
          if (mode === "menu") setMode("idle");
          else openMenu();
        }}
      >
        <IconDots size={14} />
      </button>
      {mode === "menu" && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              className={styles.fleetMenu}
              role="menu"
              style={{ top: menuPos.top, left: menuPos.left }}
            >
              <button type="button" role="menuitem" onClick={() => setMode("rename")}>
                <IconPencil size={13} /> Rename
              </button>
              <button type="button" role="menuitem" data-danger onClick={() => setMode("confirm")}>
                <IconTrash size={13} /> Remove
              </button>
            </div>,
            document.body
          )
        : null}
      {mode === "confirm" && typeof document !== "undefined" ? (
        <RemoveBoardDialog
          name={device.name}
          onCancel={() => setMode("idle")}
          onConfirm={() => {
            void onRemove().catch((err: unknown) => {
              setError(err instanceof Error ? err.message : "Could not remove this board");
              setMode("idle");
            });
          }}
        />
      ) : null}
      {error ? <p className={styles.hint}>{error}</p> : null}
    </li>
  );
}

function RemoveBoardDialog({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div className={styles.fleetScrim} onMouseDown={onCancel}>
      <div
        className={styles.fleetConfirm}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p id={titleId}>Remove {name} from this desk?</p>
        <div>
          <button type="button" autoFocus onClick={onCancel}>
            Cancel
          </button>
          <button type="button" data-danger onClick={onConfirm}>
            Remove
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
