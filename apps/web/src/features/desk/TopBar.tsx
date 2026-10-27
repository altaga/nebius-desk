"use client";

import { useEffect, useRef, useState } from "react";
import { TitleRename } from "@/features/desk/TitleRename";
import { BrandMark } from "@/ui/BrandMark";
import { IconChevronDown, IconPanelRight, IconPencil, IconPin, IconPlus, IconSidebar, IconTrash } from "@/ui/icons";
import styles from "./TopBar.module.css";

type Props = {
  deviceName: string | null;
  title: string | null;
  navOpen: boolean;
  panelOpen: boolean;
  onToggleNav: () => void;
  onTogglePanel: () => void;
  onNewChat: () => void;
  onRename: ((title: string) => Promise<void>) | null;
  onPin: (() => void) | null;
  pinned: boolean;
  onDelete: (() => void) | null;
  machine?: boolean;
};

export function TopBar(p: Props) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const machine = Boolean(p.machine);

  useEffect(() => {
    if (machine) setMenu(false);
  }, [machine]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const run = (fn: (() => void) | null) => () => {
    setMenu(false);
    fn?.();
  };

  return (
    <header className={styles.bar}>
      <h1 className={styles.srOnly}>{p.title ?? p.deviceName ?? "Nebius Desk"}</h1>
      <div className={styles.leading}>
        {!p.navOpen ? (
          <button type="button" className={styles.icon} onClick={p.onToggleNav} aria-label="Show sidebar">
            <IconSidebar size={16} />
          </button>
        ) : null}
        {!p.navOpen ? <BrandMark size={22} /> : null}
        {p.deviceName ? <span className={styles.device}>{p.deviceName}</span> : null}
        {p.deviceName ? <span className={styles.sep}>/</span> : null}
      </div>

      <div className={styles.center} ref={ref}>
        {machine ? (
          <span className={styles.pageTitle}>{p.title ?? "Machine"}</span>
        ) : editing && p.onRename ? (
          <TitleRename
            initial={p.title ?? ""}
            label="Chat title"
            className={styles.rename}
            onSave={p.onRename}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <button
            type="button"
            className={styles.title}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            <span>{p.title ?? "New chat"}</span>
            <IconChevronDown size={13} />
          </button>
        )}
        {menu ? (
          <div className={styles.menu} role="menu">
            <button type="button" role="menuitem" onClick={run(p.onNewChat)}>
              <IconPlus size={13} /> New chat
            </button>
            <button type="button" role="menuitem" disabled={!p.onPin} onClick={run(p.onPin)}>
              <IconPin size={13} /> {p.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!p.onRename}
              onClick={run(() => setEditing(true))}
            >
              <IconPencil size={13} /> Rename
            </button>
            <button type="button" role="menuitem" data-danger disabled={!p.onDelete} onClick={run(p.onDelete)}>
              <IconTrash size={13} /> Delete chat
            </button>
          </div>
        ) : null}
      </div>

      <div className={styles.trailing}>
        <div className={styles.legend} aria-label="Route colors">
          <span data-route="edge">Jetson</span>
          <span data-route="cloud">Nebius</span>
        </div>
        <button
          type="button"
          className={styles.icon}
          aria-pressed={p.panelOpen}
          aria-label={p.panelOpen ? "Hide telemetry" : "Show telemetry"}
          title="Telemetry (Ctrl .)"
          onClick={p.onTogglePanel}
        >
          <IconPanelRight size={16} />
        </button>
      </div>
    </header>
  );
}
