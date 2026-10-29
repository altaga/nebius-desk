"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionTelemetry } from "@nebius-desk/shared/index";
import type { DeviceRow, SessionRow } from "@/features/desk/types";
import { api, setActiveBoard } from "@/lib/api";
import { isUnauthorized } from "@/lib/session";
import { readPlace, writePlace } from "@/features/desk/place";

function message(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function sameDevice(a: DeviceRow, b: DeviceRow) {
  // Ignore last_seen_at — it flutters on every reconnect and was thrashing the desk.
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.hostname === b.hostname &&
    a.agent_name === b.agent_name &&
    a.kind === b.kind &&
    a.status === b.status &&
    a.agent_count === b.agent_count &&
    a.remote_enabled === b.remote_enabled &&
    Boolean(a.board_emu) === Boolean(b.board_emu)
  );
}

export function useDesk(onUnauthorized: () => void) {
  const [username, setUsername] = useState("");
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [device, setDevice] = useState<DeviceRow | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionsReady, setSessionsReady] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<SessionTelemetry | null>(null);
  const pendingDeletes = useRef(new Set<string>());
  /** Guards against out-of-order listSessions when switching boards quickly. */
  const deviceIdRef = useRef<string | null>(null);

  useEffect(() => {
    api()
      .me()
      .then((u) => setUsername(u.username))
      .catch((err) => {
        if (isUnauthorized(err)) onUnauthorized();
      });
  }, [onUnauthorized]);

  const reloadDevices = useCallback((opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setDevicesLoading(true);
    api()
      .listDevices()
      .then((rows) => {
        setDevices((prev) => {
          if (
            prev.length === rows.length &&
            prev.every((row, i) => rows[i] && sameDevice(row, rows[i]))
          ) {
            return prev;
          }
          return rows;
        });
        const saved = readPlace().deviceId;
        setDevice((current) => {
          if (current) {
            const fresh = rows.find((row) => row.id === current.id);
            if (fresh) return sameDevice(current, fresh) ? current : fresh;
          }
          return rows.find((row) => row.id === saved) ?? rows[0] ?? null;
        });
      })
      .catch(() => {
        if (!opts?.quiet) setDevices([]);
      })
      .finally(() => {
        if (!opts?.quiet) setDevicesLoading(false);
      });
  }, []);

  useEffect(() => {
    reloadDevices();
    // Presence poll — keep light; session reload is keyed only on device id.
    const tick = window.setInterval(() => reloadDevices({ quiet: true }), 8000);
    return () => window.clearInterval(tick);
  }, [reloadDevices]);

  const reloadSessions = useCallback(async (deviceId: string, opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setSessionsLoading(true);
    setSessionsError(null);
    try {
      const rows = (await api().listSessions(deviceId)).filter((row) => !pendingDeletes.current.has(row.id));
      // Drop stale responses — sessions live per board; a late Millie reply must not paint Natasha.
      if (deviceIdRef.current !== deviceId) return;
      const saved = readPlace();
      setSessions(rows);
      setSessionId((current) => {
        if (current && rows.some((row) => row.id === current)) return current;
        if (saved.deviceId === deviceId && saved.sessionId && rows.some((row) => row.id === saved.sessionId)) {
          return saved.sessionId;
        }
        return rows[0]?.id ?? null;
      });
      setSessionsReady(deviceId);
    } catch (err) {
      if (deviceIdRef.current !== deviceId) return;
      setSessionsError(message(err, "Failed to load chats"));
    } finally {
      if (deviceIdRef.current === deviceId && !opts?.quiet) setSessionsLoading(false);
    }
  }, []);

  const deviceId = device?.id ?? null;
  /** True until the first sessions fetch for this board finishes — avoids empty-chat flash on refresh. */
  const deskHydrating = Boolean(deviceId) && sessionsReady !== deviceId;

  useEffect(() => {
    deviceIdRef.current = deviceId;
    setActiveBoard(deviceId);
    setTelemetry(null);
    setSessions([]);
    setSessionsReady(null);
    if (!deviceId) {
      setSessionId(null);
      setSessionsLoading(false);
      return;
    }
    // Keep the remembered chat while sessions load — do not flash "New chat".
    const saved = readPlace();
    setSessionId(
      saved.deviceId === deviceId && saved.sessionId ? saved.sessionId : null
    );
    void reloadSessions(deviceId);
  }, [deviceId, reloadSessions]);

  useEffect(() => {
    if (!device || sessionsReady !== device.id) return;
    // Never persist a null session over a remembered chat during boot races.
    writePlace({ deviceId: device.id, sessionId });
  }, [device, sessionId, sessionsReady]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    api()
      .sessionTelemetry(sessionId)
      .then((t) => !cancelled && setTelemetry(t))
      .catch(() => !cancelled && setTelemetry(null));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const selectSession = useCallback((id: string | null) => {
    setTelemetry(null);
    setSessionId(id);
  }, []);

  const newChat = useCallback(() => selectSession(null), [selectSession]);

  const onSessionCreated = useCallback(
    (id: string) => {
      setSessionId(id);
      if (deviceId) void reloadSessions(deviceId, { quiet: true });
    },
    [deviceId, reloadSessions]
  );

  const renameSession = useCallback(async (id: string, title: string) => {
    const clean = title.trim();
    if (!clean) return;
    const res = await api().renameSession(id, clean);
    setSessions((rows) => rows.map((s) => (s.id === id ? { ...s, title: res.title } : s)));
  }, []);

  const pinSession = useCallback(async (id: string, pinned: boolean) => {
    const res = await api().pinSession(id, pinned);
    setSessions((rows) =>
      rows.map((s) => (s.id === id ? { ...s, pinned: res.pinned, pinned_at: res.pinned_at ?? null } : s))
    );
  }, []);

  const deleteSession = useCallback(
    async (id: string) => {
      const removedAt = sessions.findIndex((row) => row.id === id);
      const removed = removedAt >= 0 ? sessions[removedAt] : undefined;
      const wasOpen = sessionId === id;
      pendingDeletes.current.add(id);
      setSessions((rows) => rows.filter((row) => row.id !== id));
      if (wasOpen) selectSession(null);
      try {
        await api().deleteSession(id);
      } catch (err) {
        pendingDeletes.current.delete(id);
        if (removed) {
          setSessions((rows) => {
            if (rows.some((row) => row.id === id)) return rows;
            const next = rows.slice();
            next.splice(Math.min(removedAt, next.length), 0, removed);
            return next;
          });
        }
        if (wasOpen) selectSession(id);
        setSessionsError(message(err, "Could not delete this chat"));
        throw err;
      }
    },
    [sessions, sessionId, selectSession]
  );

  /** Optimistic bulk delete; rows the board kept (running turns, failures) come back in place. */
  const deleteSessions = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const doomed = new Set(ids);
      const snapshot = sessions;
      const openRemoved = sessionId !== null && doomed.has(sessionId);
      ids.forEach((id) => pendingDeletes.current.add(id));
      setSessions((rows) => rows.filter((row) => !doomed.has(row.id)));
      if (openRemoved) selectSession(null);
      const restore = (keep: Set<string>) => {
        keep.forEach((id) => pendingDeletes.current.delete(id));
        setSessions((rows) => {
          const present = new Set(rows.map((r) => r.id));
          return snapshot.filter((r) => present.has(r.id) || keep.has(r.id));
        });
        if (openRemoved && sessionId && keep.has(sessionId)) selectSession(sessionId);
      };
      try {
        // Ids the board didn't delete and didn't skip were already gone — leave them out.
        const { skipped_running } = await api().deleteSessions(ids);
        if (skipped_running.length) {
          restore(new Set(skipped_running));
          const n = skipped_running.length;
          setSessionsError(n === 1 ? "1 chat is still running and was kept." : `${n} chats are still running and were kept.`);
        }
      } catch (err) {
        restore(doomed);
        setSessionsError(message(err, "Could not delete these chats"));
        throw err;
      }
    },
    [sessions, sessionId, selectSession]
  );

  const [memoryVersion, setMemoryVersion] = useState(0);

  const renameBoard = useCallback(async (id: string, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    // Paint immediately — cloud rename is fast; don't leave the row on "Saving".
    setDevices((rows) =>
      rows.map((row) => (row.id === id ? { ...row, name: clean, agent_name: clean } : row))
    );
    setDevice((current) =>
      current && current.id === id ? { ...current, name: clean, agent_name: clean } : current
    );
    try {
      const res = await api().renameBoard(id, clean);
      setDevices((rows) =>
        rows.map((row) => (row.id === id ? { ...row, name: res.name, agent_name: res.agent_name } : row))
      );
      setDevice((current) =>
        current && current.id === id ? { ...current, name: res.name, agent_name: res.agent_name } : current
      );
    } catch (err) {
      void reloadDevices({ quiet: true });
      throw err;
    }
  }, [reloadDevices]);

  const removeBoard = useCallback(async (id: string) => {
    await api().removeBoard(id);
    setDevices((rows) => {
      const next = rows.filter((row) => row.id !== id);
      setDevice((current) => {
        if (!current || current.id !== id) return current;
        return next[0] ?? null;
      });
      return next;
    });
  }, []);

  /** Switch board in one shot so ChatPane never sees device A + session from B. */
  const selectDevice = useCallback((next: DeviceRow | null) => {
    deviceIdRef.current = next?.id ?? null;
    setActiveBoard(next?.id ?? null);
    setTelemetry(null);
    setSessions([]);
    setSessionsReady(null);
    setSessionsError(null);
    if (!next) {
      setSessionId(null);
    } else {
      const saved = readPlace();
      setSessionId(saved.deviceId === next.id && saved.sessionId ? saved.sessionId : null);
    }
    setDevice(next);
  }, []);

  const saveMemory = useCallback(
    async (text: string) => {
      if (!device) return;
      await api().addDeviceMemory(device.id, text);
      setMemoryVersion((v) => v + 1);
    },
    [device]
  );

  return {
    username,
    devices,
    devicesLoading,
    device,
    setDevice: selectDevice,
    sessions,
    sessionsLoading,
    sessionsError,
    sessionId,
    deskHydrating,
    telemetry,
    setTelemetry,
    selectSession,
    newChat,
    onSessionCreated,
    renameSession,
    pinSession,
    deleteSession,
    deleteSessions,
    renameBoard,
    removeBoard,
    saveMemory,
    memoryVersion,
    reloadDevices,
  };
}
