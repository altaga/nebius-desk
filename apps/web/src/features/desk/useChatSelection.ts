"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Multi-select over the visible chat order; shift-click selects a range. `active` is owned by the caller. */
export function useChatSelection(visibleIds: string[], active: boolean, onExit: () => void) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);

  useEffect(() => {
    if (active) return;
    setSelected(new Set());
    anchor.current = null;
  }, [active]);

  // Drop ids that vanished (deleted, filtered out by search).
  const visibleKey = visibleIds.join("|");
  useEffect(() => {
    const visible = new Set(visibleIds);
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleKey]); // visibleIds is a fresh array each render; the key is the stable signal

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role='alertdialog']")) onExit();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, onExit]);

  const toggle = useCallback(
    (id: string, range: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const from = anchor.current ? visibleIds.indexOf(anchor.current) : -1;
        const to = visibleIds.indexOf(id);
        if (range && from >= 0 && to >= 0) {
          const on = !prev.has(id);
          visibleIds.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((x) => (on ? next.add(x) : next.delete(x)));
        } else if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      anchor.current = id;
    },
    [visibleIds]
  );

  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleAll = useCallback(
    () => setSelected(allSelected ? new Set() : new Set(visibleIds)),
    [allSelected, visibleIds]
  );

  return useMemo(
    () => ({ selected, toggle, allSelected, toggleAll }),
    [selected, toggle, allSelected, toggleAll]
  );
}
