"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { GuideAction, GuideTarget } from "./guideActions";

export type MachineTab = "health" | "terminal" | "files" | "services" | "agents";
export type PanelTab = "chat" | "board" | "plan";
export type BoardSection = "status" | "memory" | "experts" | "secrets";
export type DeskView = "chat" | "machine";

/** Local Millie beats from the chat composer (not Nano). */
export type ComposerCue = { kind: "fast_type" | "long_paste"; chars?: number };

export type DeskGuideApi = {
  view: DeskView;
  machineTab: MachineTab;
  panelTab: PanelTab;
  boardSection: BoardSection;
  navOpen: boolean;
  panelOpen: boolean;
  /** Live board app preview docked beside chat (interactive iframe). */
  browserDockOpen: boolean;
  setBrowserDockOpen: (open: boolean) => void;
  /** Board localhost URL currently shown in the preview dock (e.g. http://127.0.0.1:5173/). */
  browserPreviewUrl: string | null;
  /** Open the chat preview dock at a board localhost URL (does not open the right panel). */
  openBrowserPreview: (url: string) => void;
  highlightTarget: GuideTarget | null;
  /** Optional noun chip drawn on the spotlight (tour / guide). */
  highlightLabel: string | null;
  setHighlightLabel: (label: string | null) => void;
  /** Millie /tour walkthrough — locks spotlight dismiss + presence. */
  tourActive: boolean;
  setTourActive: (active: boolean) => void;
  setView: (v: DeskView) => void;
  setMachineTab: (t: MachineTab) => void;
  setPanelTab: (t: PanelTab) => void;
  setBoardSection: (s: BoardSection) => void;
  setNavOpen: (open: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  /** Switch the selected fleet board by display name (case-insensitive). */
  selectBoardByName: (name: string) => boolean;
  /** Start a fresh chat session (Millie new_chat). */
  startNewChat: () => void;
  runAction: (action: GuideAction) => void;
  clearHighlight: () => void;
  /** Clears spotlight even during /tour (step changes / end). */
  forceClearHighlight: () => void;
  queryGuideTarget: (target: GuideTarget) => HTMLElement | null;
  /** Chat composer → Millie presence (cheer / interested). */
  notifyComposerCue: (cue: ComposerCue) => void;
  subscribeComposerCue: (fn: (cue: ComposerCue) => void) => () => void;
};

const DeskGuideContext = createContext<DeskGuideApi | null>(null);

type ProviderProps = {
  children: ReactNode;
  view: DeskView;
  machineTab: MachineTab;
  panelTab: PanelTab;
  boardSection: BoardSection;
  navOpen: boolean;
  panelOpen: boolean;
  setView: (v: DeskView) => void;
  setMachineTab: (t: MachineTab) => void;
  setPanelTab: (t: PanelTab) => void;
  setBoardSection: (s: BoardSection) => void;
  setNavOpen: (open: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  selectBoardByName: (name: string) => boolean;
  startNewChat: () => void;
};

export function DeskGuideProvider({
  children,
  view,
  machineTab,
  panelTab,
  boardSection,
  navOpen,
  panelOpen,
  setView,
  setMachineTab,
  setPanelTab,
  setBoardSection,
  setNavOpen,
  setPanelOpen,
  selectBoardByName,
  startNewChat,
}: ProviderProps) {
  const [highlightTarget, setHighlightTarget] = useState<GuideTarget | null>(null);
  const [highlightLabel, setHighlightLabel] = useState<string | null>(null);
  const [tourActive, setTourActive] = useState(false);
  // Live preview always starts closed on refresh — no cookie / sessionStorage.
  const [browserDockOpen, setBrowserDockOpen] = useState(false);
  const [browserPreviewUrl, setBrowserPreviewUrl] = useState<string | null>(null);
  const clearTimer = useRef<number | null>(null);
  const tourActiveRef = useRef(false);
  tourActiveRef.current = tourActive;

  const setBrowserDock = useCallback((open: boolean) => {
    setBrowserDockOpen(open);
    if (!open) setBrowserPreviewUrl(null);
  }, []);

  const openBrowserPreview = useCallback(
    (url: string) => {
      const clean = (url || "").trim();
      if (!clean) return;
      setBrowserPreviewUrl(clean);
      setBrowserDockOpen(true);
      // Preview docks beside chat in main — do not open the right telemetry panel.
      setView("chat");
    },
    [setView]
  );
  const cueListeners = useRef(new Set<(cue: ComposerCue) => void>());

  const clearHighlight = useCallback(() => {
    // During /tour, only the tour chrome may clear the spot.
    if (tourActiveRef.current) return;
    if (clearTimer.current != null) window.clearTimeout(clearTimer.current);
    clearTimer.current = null;
    setHighlightTarget(null);
    setHighlightLabel(null);
  }, []);

  const forceClearHighlight = useCallback(() => {
    if (clearTimer.current != null) window.clearTimeout(clearTimer.current);
    clearTimer.current = null;
    setHighlightTarget(null);
    setHighlightLabel(null);
  }, []);

  const notifyComposerCue = useCallback((cue: ComposerCue) => {
    for (const fn of cueListeners.current) fn(cue);
  }, []);

  const subscribeComposerCue = useCallback((fn: (cue: ComposerCue) => void) => {
    cueListeners.current.add(fn);
    return () => {
      cueListeners.current.delete(fn);
    };
  }, []);

  const queryGuideTarget = useCallback((target: GuideTarget) => {
    return document.querySelector<HTMLElement>(`[data-guide="${target}"]`);
  }, []);

  const runAction = useCallback(
    (action: GuideAction) => {
      switch (action.type) {
        case "open_chat":
          setView("chat");
          break;
        case "new_chat":
          startNewChat();
          setView("chat");
          break;
        case "open_machine":
          setView("machine");
          break;
        case "open_health":
          setView("machine");
          setMachineTab("health");
          break;
        case "open_terminal":
          setView("machine");
          setMachineTab("terminal");
          break;
        case "open_files":
          setView("machine");
          setMachineTab("files");
          break;
        case "open_browser":
        case "open_services":
          // Services tab lists live localhost apps; preview dock only if one is up.
          setView("machine");
          setMachineTab("services");
          break;
        case "open_panel":
          setPanelOpen(true);
          break;
        case "open_board":
          setPanelOpen(true);
          setPanelTab("board");
          break;
        case "open_plan":
          setPanelOpen(true);
          setPanelTab("plan");
          break;
        case "open_nav":
          setNavOpen(true);
          break;
        case "select_board": {
          selectBoardByName(action.board);
          break;
        }
        case "react":
          // Avatar emotion is applied by useMillieGuide — desk UI ignores it.
          break;
        case "highlight": {
          if (action.target.startsWith("machine.")) {
            setView("machine");
            const tab = action.target.split(".")[1];
            if (
              tab === "health" ||
              tab === "terminal" ||
              tab === "files" ||
              tab === "services" ||
              tab === "agents"
            ) {
              setMachineTab(tab);
            } else if (tab === "browser") {
              setMachineTab("services");
            }
          } else if (action.target.startsWith("chat.")) {
            setView("chat");
          } else if (action.target.startsWith("panel.") || action.target.startsWith("board.")) {
            setPanelOpen(true);
            if (action.target.startsWith("panel.")) {
              const tab = action.target.split(".")[1] as PanelTab;
              if (tab === "chat" || tab === "board" || tab === "plan") setPanelTab(tab);
            } else {
              setPanelTab("board");
              const section = action.target.split(".")[1] as BoardSection;
              if (section === "status" || section === "memory" || section === "experts" || section === "secrets") {
                setBoardSection(section);
              }
            }
          } else if (action.target.startsWith("nav.")) {
            setNavOpen(true);
          }
          if (clearTimer.current != null) window.clearTimeout(clearTimer.current);
          // Wait a tick so newly opened tabs mount before spotlight.
          window.setTimeout(() => setHighlightTarget(action.target), 80);
          // Tour keeps the spot until the next step; free highlights auto-fade.
          if (!tourActiveRef.current) {
            clearTimer.current = window.setTimeout(() => {
              setHighlightTarget(null);
              setHighlightLabel(null);
            }, 8000);
          }
          break;
        }
      }
    },
    [setView, setMachineTab, setPanelTab, setBoardSection, setNavOpen, setPanelOpen, selectBoardByName, startNewChat, setBrowserDock]
  );

  const setTourActiveSafe = useCallback(
    (active: boolean) => {
      setTourActive(active);
      tourActiveRef.current = active;
      if (!active) forceClearHighlight();
    },
    [forceClearHighlight]
  );

  const value = useMemo<DeskGuideApi>(
    () => ({
      view,
      machineTab,
      panelTab,
      boardSection,
      navOpen,
      panelOpen,
      browserDockOpen,
      setBrowserDockOpen: setBrowserDock,
      browserPreviewUrl,
      openBrowserPreview,
      highlightTarget,
      highlightLabel,
      setHighlightLabel,
      tourActive,
      setTourActive: setTourActiveSafe,
      setView,
      setMachineTab,
      setPanelTab,
      setBoardSection,
      setNavOpen,
      setPanelOpen,
      selectBoardByName,
      startNewChat,
      runAction,
      clearHighlight,
      forceClearHighlight,
      queryGuideTarget,
      notifyComposerCue,
      subscribeComposerCue,
    }),
    [
      view,
      machineTab,
      panelTab,
      boardSection,
      navOpen,
      panelOpen,
      browserDockOpen,
      setBrowserDock,
      browserPreviewUrl,
      openBrowserPreview,
      highlightTarget,
      highlightLabel,
      setHighlightLabel,
      tourActive,
      setTourActiveSafe,
      setView,
      setMachineTab,
      setPanelTab,
      setBoardSection,
      setNavOpen,
      setPanelOpen,
      selectBoardByName,
      startNewChat,
      runAction,
      clearHighlight,
      forceClearHighlight,
      queryGuideTarget,
      notifyComposerCue,
      subscribeComposerCue,
    ]
  );

  return <DeskGuideContext.Provider value={value}>{children}</DeskGuideContext.Provider>;
}

export function useDeskGuide(): DeskGuideApi {
  const ctx = useContext(DeskGuideContext);
  if (!ctx) throw new Error("useDeskGuide must be used inside DeskGuideProvider");
  return ctx;
}

export function useDeskGuideOptional(): DeskGuideApi | null {
  return useContext(DeskGuideContext);
}
