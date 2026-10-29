"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export type BoardJob = {
  id: string;
  kind: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  error: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
};

const POLL_MS = 4_000;

/** Poll durable board jobs — background agents that survive closing the browser. */
export function useBoardJobs(enabled = true) {
  const [jobs, setJobs] = useState<BoardJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const seen = useRef(false);

  const refresh = useCallback(
    (quiet = false) => {
      if (!enabled) return;
      api()
        .listJobs(40)
        .then((data) => {
          seen.current = true;
          setJobs(data.jobs || []);
          setError(null);
          setReady(true);
        })
        .catch((err: unknown) => {
          if (quiet && seen.current) return;
          setError(err instanceof Error ? err.message : "Jobs unavailable");
          setReady(true);
        });
    },
    [enabled]
  );

  useEffect(() => {
    if (!enabled) {
      setJobs([]);
      setReady(false);
      setError(null);
      seen.current = false;
      return;
    }
    refresh(false);
    const id = window.setInterval(() => refresh(true), POLL_MS);
    return () => window.clearInterval(id);
  }, [enabled, refresh]);

  const stopJob = useCallback(
    async (jobId: string) => {
      setBusyId(jobId);
      try {
        await api().cancelJob(jobId);
        refresh(true);
      } finally {
        setBusyId(null);
      }
    },
    [refresh]
  );

  const removeJob = useCallback(
    async (jobId: string) => {
      setBusyId(jobId);
      try {
        await api().dismissJob(jobId);
        setJobs((prev) => prev.filter((j) => j.id !== jobId));
      } finally {
        setBusyId(null);
      }
    },
    []
  );

  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const recent = jobs.filter(
    (j) => j.status === "done" || j.status === "error" || j.status === "cancelled"
  );
  return { jobs, active, recent, error, ready, busyId, refresh, stopJob, removeJob };
}
