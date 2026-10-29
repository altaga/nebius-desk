"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export type BoardServicesSnapshot = {
  services: unknown[];
  containers: unknown[];
  previewable: Array<{ url?: string | null }>;
  has_preview: boolean;
};

/** Poll board for live localhost web services — gates chat Preview. */
export function useBoardServices(enabled = true) {
  const [hasPreview, setHasPreview] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!enabled) return;
    api()
      .edgeServices()
      .then((data: BoardServicesSnapshot) => {
        setHasPreview(Boolean(data.has_preview));
        setUrls(
          (data.previewable || [])
            .map((s) => s.url)
            .filter((u): u is string => Boolean(u))
        );
        setError(null);
      })
      .catch((err: unknown) => {
        setHasPreview(false);
        setUrls([]);
        setError(err instanceof Error ? err.message : "services unavailable");
      });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setHasPreview(false);
      setUrls([]);
      return;
    }
    refresh();
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [enabled, refresh]);

  return { hasPreview, urls, error, refresh };
}
