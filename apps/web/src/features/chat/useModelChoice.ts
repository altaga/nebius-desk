"use client";

import { useCallback, useEffect, useState } from "react";
import type { ModelChoice } from "@nebius-desk/shared/index";

const KEY = "nebiusdesk.model";
const ALL: ModelChoice[] = ["auto", "local", "nano", "fast", "heavy"];
const CLOUD_ONLY: ModelChoice[] = ["nano", "fast", "heavy"];

export function useModelChoice(cloudOnly = false) {
  const allowed = cloudOnly ? CLOUD_ONLY : ALL;
  const fallback: ModelChoice = cloudOnly ? "nano" : "auto";
  const [choice, setChoice] = useState<ModelChoice>(fallback);

  useEffect(() => {
    const saved = window.localStorage.getItem(KEY) as ModelChoice | null;
    if (saved && allowed.includes(saved)) {
      setChoice(saved);
      return;
    }
    setChoice(fallback);
    window.localStorage.setItem(KEY, fallback);
  }, [allowed, fallback]);

  const pick = useCallback(
    (next: ModelChoice) => {
      const safe = allowed.includes(next) ? next : fallback;
      setChoice(safe);
      window.localStorage.setItem(KEY, safe);
    },
    [allowed, fallback]
  );

  return { choice, pick };
}
