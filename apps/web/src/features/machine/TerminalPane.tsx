"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import styles from "./Machine.module.css";

export function TerminalPane({ deviceId }: { deviceId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let cancelled = false;
    let term: { dispose: () => void } | null = null;
    let socket: WebSocket | null = null;

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      await import("@xterm/xterm/css/xterm.css");
      if (cancelled) return;
      const next = new Terminal({ cursorBlink: true, fontSize: 13, theme: { background: "#1c1917" } });
      const fit = new FitAddon();
      next.loadAddon(fit);
      next.open(node);
      fit.fit();
      term = next;
      const ticket = await api().terminalTicket(deviceId);
      if (cancelled) return;
      const url = new URL(ticket.ws_url);
      url.searchParams.set("cols", String(next.cols));
      url.searchParams.set("rows", String(next.rows));
      socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      socket.onmessage = (ev) => {
        next.write(typeof ev.data === "string" ? ev.data : new Uint8Array(ev.data));
      };
      socket.onclose = () => next.writeln("\r\n[session closed]");
      next.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
      });
      next.onResize(({ cols, rows }) => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "resize", cols, rows }));
      });
    })().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Terminal unavailable");
    });

    return () => {
      cancelled = true;
      socket?.close();
      term?.dispose();
    };
  }, [deviceId]);

  return (
    <>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div ref={host} className={styles.term} />
    </>
  );
}
