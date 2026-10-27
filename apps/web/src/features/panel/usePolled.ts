"use client";

import { useEffect, useState } from "react";

type State<T> = { data: T | null; error: string | null; loading: boolean };

/** Fetches immediately, then every `intervalMs` while the tab is visible. */
export function usePolled<T>(load: (() => Promise<T>) | null, intervalMs: number, deps: unknown[] = []) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: !!load });

  useEffect(() => {
    if (!load) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      load()
        .then((data) => !cancelled && setState({ data, error: null, loading: false }))
        .catch(
          (err) =>
            !cancelled &&
            setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : "Unavailable" }))
        );
    };
    setState((s) => ({ ...s, loading: true }));
    tick();
    const id = window.setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);

  return state;
}
