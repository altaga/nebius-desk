"use client";

import { useEffect } from "react";

type Handlers = {
  onSearch: () => void;
  onNewChat: () => void;
  onTogglePanel: () => void;
  onToggleNav: () => void;
};

/** Ctrl/⌘+K search · Ctrl/⌘+Shift+O new chat · Ctrl/⌘+. panel · Ctrl/⌘+B sidebar */
export function useShortcuts({ onSearch, onNewChat, onTogglePanel, onToggleNav }: Handlers) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      const action =
        key === "k"
          ? onSearch
          : key === "o" && e.shiftKey
            ? onNewChat
            : key === "."
              ? onTogglePanel
              : key === "b"
                ? onToggleNav
                : null;
      if (!action) return;
      e.preventDefault();
      action();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSearch, onNewChat, onTogglePanel, onToggleNav]);
}
