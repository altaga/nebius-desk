"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPane } from "@/features/chat/ChatPane";
import { DeskNav } from "@/features/desk/DeskNav";
import { MachineView } from "@/features/machine/MachineView";
import { TopBar } from "@/features/desk/TopBar";
import { useDesk } from "@/features/desk/useDesk";
import { useShortcuts } from "@/features/desk/useShortcuts";
import {
  DeskGuideProvider,
  type BoardSection,
  type DeskView,
  type MachineTab,
  type PanelTab,
} from "@/features/millie/DeskGuideContext";
import { GuideSpotlight } from "@/features/millie/GuideSpotlight";
import { MillieErrorBoundary } from "@/features/millie/MillieErrorBoundary";
import { TelemetryPanel } from "@/features/panel/TelemetryPanel";
import { readPanelOpenCookie, writePanelOpenCookie } from "@/features/desk/panelCookie";
import styles from "./DeskShell.module.css";

const MillieOverlay = dynamic(
  () => import("@/features/millie/MillieOverlay").then((m) => m.MillieOverlay),
  { ssr: false, loading: () => null }
);

const COMPACT = "(max-width: 1080px)";

export function DeskShell({ onLogout }: { onLogout: () => void }) {
  const desk = useDesk(onLogout);
  // Fleet/chats nav: open by default on refresh — never persisted.
  const [navOpen, setNavOpen] = useState(true);
  // Right telemetry panel: closed by default; cookie remembers last choice.
  const [panelOpen, setPanelOpenState] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<DeskView>("chat");
  const [machineTab, setMachineTab] = useState<MachineTab>("health");
  const [panelTab, setPanelTab] = useState<PanelTab>("chat");
  const [boardSection, setBoardSection] = useState<BoardSection>("status");
  const [draft, setDraft] = useState<{ text: string; nonce: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const setPanelOpen = useCallback((open: boolean | ((prev: boolean) => boolean)) => {
    setPanelOpenState((prev) => {
      const next = typeof open === "function" ? open(prev) : open;
      writePanelOpenCookie(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const compact = window.matchMedia(COMPACT).matches;
    if (compact) {
      setNavOpen(false);
      setPanelOpenState(false);
      return;
    }
    // Desktop: nav stays open (no cookie). Restore right panel from cookie only.
    setPanelOpenState(readPanelOpenCookie());
  }, []);

  const showChat = useCallback(() => {
    setView("chat");
  }, []);

  const newChat = useCallback(() => {
    desk.newChat();
    showChat();
  }, [desk, showChat]);

  useShortcuts({
    onSearch: () => {
      setNavOpen(true);
      window.setTimeout(() => searchRef.current?.focus(), 0);
    },
    onNewChat: newChat,
    onTogglePanel: () => setPanelOpen((v) => !v),
    onToggleNav: () => setNavOpen((v) => !v),
  });

  const active = desk.sessions.find((s) => s.id === desk.sessionId) ?? null;

  return (
    <DeskGuideProvider
      view={view}
      machineTab={machineTab}
      panelTab={panelTab}
      boardSection={boardSection}
      navOpen={navOpen}
      panelOpen={panelOpen}
      setView={setView}
      setMachineTab={setMachineTab}
      setPanelTab={setPanelTab}
      setBoardSection={setBoardSection}
      setNavOpen={setNavOpen}
      setPanelOpen={setPanelOpen}
      selectBoardByName={(name) => {
        const hit = desk.devices.find((d) => d.name.toLowerCase() === name.trim().toLowerCase());
        if (!hit) return false;
        desk.setDevice(hit);
        return true;
      }}
      startNewChat={newChat}
    >
      <div className={styles.shell} data-nav={navOpen} data-panel={panelOpen}>
        {navOpen ? (
          <div className={styles.nav}>
            <DeskNav
              username={desk.username}
              devices={desk.devices}
              devicesLoading={desk.devicesLoading}
              device={desk.device}
              sessions={desk.sessions}
              sessionsLoading={desk.sessionsLoading}
              sessionsError={desk.sessionsError}
              sessionId={desk.sessionId}
              query={query}
              searchRef={searchRef}
              onQuery={setQuery}
              onSelectDevice={desk.setDevice}
              onSelectSession={(id) => {
                desk.selectSession(id);
                showChat();
              }}
              onRenameSession={desk.renameSession}
              onRenameBoard={desk.renameBoard}
              onRemoveBoard={desk.removeBoard}
              onPinSession={desk.pinSession}
              onDeleteSession={desk.deleteSession}
              onDeleteSessions={desk.deleteSessions}
              onNewChat={newChat}
              onOpenMachine={() => {
                setView((current) => (current === "machine" ? "chat" : "machine"));
              }}
              machineOpen={view === "machine"}
              onLogout={onLogout}
              onHide={() => setNavOpen(false)}
              onPaired={desk.reloadDevices}
            />
          </div>
        ) : null}

        <main className={styles.main}>
          <TopBar
            deviceName={desk.device?.name ?? null}
            title={
              view === "machine"
                ? "Machine"
                : desk.deskHydrating && !active
                  ? "…"
                  : (active?.title ?? null)
            }
            navOpen={navOpen}
            panelOpen={panelOpen}
            onToggleNav={() => setNavOpen((v) => !v)}
            onTogglePanel={() => setPanelOpen((v) => !v)}
            onNewChat={newChat}
            onRename={active ? (title) => desk.renameSession(active.id, title) : null}
            onPin={active ? () => void desk.pinSession(active.id, !active.pinned) : null}
            pinned={Boolean(active?.pinned)}
            onDelete={active ? () => void desk.deleteSession(active.id) : null}
            machine={view === "machine"}
          />
          {view === "machine" && desk.device ? (
            <MachineView
              device={desk.device}
              onRename={(name) => desk.renameBoard(desk.device!.id, name)}
              tab={machineTab}
              onTab={setMachineTab}
            />
          ) : desk.device ? (
            <ChatPane
              deviceId={desk.device.id}
              deviceName={desk.device.name}
              cloudOnly={Boolean(desk.device.board_emu)}
              sessionId={desk.sessionId}
              sessionStatus={active?.status ?? null}
              hydrating={desk.deskHydrating}
              onSession={desk.onSessionCreated}
              onTelemetry={desk.setTelemetry}
              onNewChat={newChat}
              onSaveMemory={desk.saveMemory}
              draft={draft}
            />
          ) : (
            <div className={styles.placeholder}>
              {desk.devicesLoading ? <p>Connecting to your fleet…</p> : <p>Select a device in the sidebar.</p>}
            </div>
          )}
        </main>

        {panelOpen ? (
          <div className={styles.panel}>
            <TelemetryPanel
              device={desk.device}
              telemetry={desk.telemetry}
              memoryVersion={desk.memoryVersion}
              onNewChat={newChat}
              onClose={() => setPanelOpen(false)}
              onUse={(text) => {
                setView("chat");
                setDraft({ text, nonce: Date.now() });
              }}
              tab={panelTab}
              onTab={setPanelTab}
              boardSection={boardSection}
              onBoardSection={setBoardSection}
            />
          </div>
        ) : null}

        <button
          type="button"
          className={styles.scrim}
          aria-label="Close overlay"
          tabIndex={-1}
          onClick={() => {
            setNavOpen(false);
            setPanelOpen(false);
          }}
        />

        <GuideSpotlight />
        <MillieErrorBoundary>
          <MillieOverlay deviceId={desk.device?.id ?? null} />
        </MillieErrorBoundary>
      </div>
    </DeskGuideProvider>
  );
}
