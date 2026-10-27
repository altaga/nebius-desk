"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { GuideAction, GuideTarget } from "./guideActions";

export type MachineTab = "health" | "terminal" | "files";
export type PanelTab = "chat" | "board" | "plan";
export type BoardSection = "status" | "memory" | "experts" | "secrets";
export type DeskView = "chat" | "machine";

export type DeskGuideApi = {
  view: DeskView;
  machineTab: MachineTab;
  panelTab: PanelTab;
  boardSection: BoardSection;
  navOpen: boolean;
  panelOpen: boolean;
  highlightTarget: GuideTarget | null;
  setView: (v: DeskView) => void;
  setMachineTab: (t: MachineTab) => void;
  setPanelTab: (t: PanelTab) => void;
  setBoardSection: (s: BoardSection) => void;
  setNavOpen: (open: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  runAction: (action: GuideAction) => void;
  clearHighlight: () => void;
  queryGuideTarget: (target: GuideTarget) => HTMLElement | null;
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
}: ProviderProps) {
  const [highlightTarget, setHighlightTarget] = useState<GuideTarget | null>(null);
  const clearTimer = useRef<number | null>(null);

  const clearHighlight = useCallback(() => {
    if (clearTimer.current != null) window.clearTimeout(clearTimer.current);
    clearTimer.current = null;
    setHighlightTarget(null);
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
        case "react":
          // Avatar emotion is applied by useMillieGuide — desk UI ignores it.
          break;
        case "highlight": {
          if (action.target.startsWith("machine.")) {
            setView("machine");
            const tab = action.target.split(".")[1] as MachineTab;
            if (tab === "health" || tab === "terminal" || tab === "files") setMachineTab(tab);
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
          clearTimer.current = window.setTimeout(() => setHighlightTarget(null), 8000);
          break;
        }
      }
    },
    [setView, setMachineTab, setPanelTab, setBoardSection, setNavOpen, setPanelOpen]
  );

  const value = useMemo<DeskGuideApi>(
    () => ({
      view,
      machineTab,
      panelTab,
      boardSection,
      navOpen,
      panelOpen,
      highlightTarget,
      setView,
      setMachineTab,
      setPanelTab,
      setBoardSection,
      setNavOpen,
      setPanelOpen,
      runAction,
      clearHighlight,
      queryGuideTarget,
    }),
    [
      view,
      machineTab,
      panelTab,
      boardSection,
      navOpen,
      panelOpen,
      highlightTarget,
      setView,
      setMachineTab,
      setPanelTab,
      setBoardSection,
      setNavOpen,
      setPanelOpen,
      runAction,
      clearHighlight,
      queryGuideTarget,
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
