"use client";

import type { RefObject } from "react";
import { ChatList } from "@/features/desk/ChatList";
import { FleetList } from "@/features/desk/FleetList";
import { PairBoard } from "@/features/desk/PairBoard";
import type { DeviceRow, SessionRow } from "@/features/desk/types";
import { BrandMark } from "@/ui/BrandMark";
import { IconLogout, IconMonitor, IconPlus, IconSearch, IconSidebar } from "@/ui/icons";
import styles from "./DeskNav.module.css";

type Props = {
  username: string;
  devices: DeviceRow[];
  devicesLoading: boolean;
  device: DeviceRow | null;
  sessions: SessionRow[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  sessionId: string | null;
  query: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onQuery: (q: string) => void;
  onSelectDevice: (d: DeviceRow) => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => Promise<void>;
  onRenameBoard: (id: string, name: string) => Promise<void>;
  onRemoveBoard: (id: string) => Promise<void>;
  onPinSession: (id: string, pinned: boolean) => Promise<void>;
  onDeleteSession: (id: string) => Promise<void>;
  onNewChat: () => void;
  onOpenMachine: () => void;
  machineOpen: boolean;
  onLogout: () => void;
  onHide: () => void;
  onPaired: () => void;
};

export function DeskNav(p: Props) {
  return (
    <nav className={styles.nav} aria-label="Workspace">
      <header className={styles.brand}>
        <BrandMark size={26} />
        <span className={styles.wordmark}>
          Nebius<b>Desk</b>
        </span>
        <button type="button" className={styles.iconBtn} onClick={p.onHide} aria-label="Hide sidebar">
          <IconSidebar size={16} />
        </button>
      </header>

      <section className={styles.fleetPane} aria-labelledby="fleet-label">
        <h2 id="fleet-label" className={styles.label}>
          Fleet
        </h2>
        <div className={styles.fleetScroll}>
          <FleetList
            devices={p.devices}
            loading={p.devicesLoading}
            activeId={p.device?.id ?? null}
            onSelect={p.onSelectDevice}
            onRename={p.onRenameBoard}
            onRemove={p.onRemoveBoard}
          />
        </div>
        <PairBoard onPaired={p.onPaired} />
      </section>

      <section className={styles.boardPane} aria-labelledby="board-label">
        <h2 id="board-label" className={styles.label} title={p.device?.name}>
          {p.device?.name ?? "Machine"}
        </h2>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.newChat}
            data-on={Boolean(p.device) && p.machineOpen}
            data-guide="nav.open_machine"
            onClick={p.onOpenMachine}
            disabled={!p.device}
          >
            <IconMonitor size={15} />
            {p.machineOpen ? "Back to chat" : "Open machine"}
          </button>
          <button
            type="button"
            className={styles.newChat}
            data-guide="nav.new_chat"
            onClick={p.onNewChat}
            disabled={!p.device}
          >
            <IconPlus size={15} />
            New chat
            <kbd>Ctrl ⇧ O</kbd>
          </button>
        </div>
      </section>

      <section className={styles.chatsPane} aria-labelledby="chats-label">
        <h2 id="chats-label" className={styles.label}>
          Chats
        </h2>
        <label className={styles.search}>
          <IconSearch size={15} />
          <input
            ref={p.searchRef}
            type="search"
            value={p.query}
            placeholder="Search chats"
            aria-label="Search chats"
            onChange={(e) => p.onQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && p.onQuery("")}
            disabled={!p.device}
          />
          <kbd>Ctrl K</kbd>
        </label>
        <div className={styles.scroll}>
          {p.device ? (
            <ChatList
              sessions={p.sessions}
              loading={p.sessionsLoading}
              error={p.sessionsError}
              query={p.query}
              activeId={p.sessionId}
              onSelect={p.onSelectSession}
              onRename={p.onRenameSession}
              onPin={p.onPinSession}
              onDelete={p.onDeleteSession}
            />
          ) : (
            <p className={styles.hint}>Select a machine in the fleet.</p>
          )}
        </div>
      </section>

      <footer className={styles.account}>
        <span className={styles.avatar} aria-hidden>
          {(p.username || "?").slice(0, 2).toUpperCase()}
        </span>
        <span className={styles.who}>
          <strong>{p.username || "…"}</strong>
          <small>Operator</small>
        </span>
        <button type="button" className={styles.iconBtn} onClick={p.onLogout} aria-label="Sign out" title="Sign out">
          <IconLogout size={15} />
        </button>
      </footer>
    </nav>
  );
}
