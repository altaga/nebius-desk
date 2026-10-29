"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDeskGuideOptional } from "@/features/millie/DeskGuideContext";
import { api } from "@/lib/api";
import { usePreviewInput, type Viewport } from "./usePreviewInput";
import styles from "./BrowserPane.module.css";

type Artifact = {
  path: string;
  name: string;
  run: string;
  bytes: number;
  mtime: number;
  kind: string;
};

type Status = {
  playwright: boolean;
  detail: string;
  session_id: string | null;
  url: string | null;
  last_shot: string | null;
  headed: boolean;
  artifacts: Artifact[];
};

type Orientation = "landscape" | "portrait";

const VIEWPORTS: Record<Orientation, Viewport> = {
  landscape: { width: 960, height: 540 },
  portrait: { width: 390, height: 844 },
};

type Props = {
  /** Compact dock beside chat (live app preview while iterating). */
  variant?: "page" | "dock";
  deviceId?: string;
};

/**
 * Dock mode streams board-side Playwright frames (one relay round-trip per frame).
 * Clicks, wheel, and keys on the frame drive that same Chromium tab — an iframe
 * through the tunnel is too slow for Vite (hundreds of modules).
 */
export function BrowserPane({ variant = "page", deviceId: _deviceId }: Props) {
  const guide = useDeskGuideOptional();
  const boardUrl = guide?.browserPreviewUrl ?? null;
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const dock = variant === "dock";
  const captureGen = useRef(0);
  const liveRef = useRef<string | null>(null);
  const viewport = VIEWPORTS[orientation];

  const showFrame = useCallback((src: string, url: string | null) => {
    setShotUrl((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return src;
    });
    if (url) {
      liveRef.current = url;
      setLiveUrl(url);
    }
    setError(null);
  }, []);

  const input = usePreviewInput({
    enabled: dock && Boolean(boardUrl) && Boolean(shotUrl) && !busy,
    viewport,
    onFrame: showFrame,
    onError: setError,
  });

  const refresh = useCallback(() => {
    api()
      .browserStatus()
      .then((s) => {
        setStatus(s);
        setError(null);
        if (s.last_shot) setSelected(s.last_shot);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Browser unavailable"));
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, dock ? 15_000 : 5_000);
    return () => window.clearInterval(id);
  }, [refresh, dock]);

  useEffect(() => {
    // Dock preview prefers inline JPEG from the action response.
    if (dock) return;
    if (!selected) {
      setShotUrl(null);
      return;
    }
    let revoked: string | null = null;
    let cancelled = false;
    api()
      .browserArtifactBlob(selected)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        revoked = url;
        setShotUrl(url);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Shot unavailable");
      });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [selected, dock]);

  const capture = useCallback(async (url: string, size: Viewport) => {
    const gen = ++captureGen.current;
    setBusy(true);
    setError(null);
    try {
      // Warm in parallel so Chromium is up before / with the capture.
      void api()
        .browserWarm()
        .catch(() => undefined);
      // Board always hard-reloads on preview (see runtime.py) so repairs show up.
      const result = await api().browserAction({ action: "preview", url, ...size });
      if (gen !== captureGen.current) return;
      const b64 = typeof result.image_b64 === "string" ? result.image_b64 : null;
      const mime = typeof result.image_mime === "string" ? result.image_mime : "image/jpeg";
      if (b64) {
        // One relay trip: show JPEG immediately (skip artifact re-download).
        showFrame(`data:${mime};base64,${b64}`, typeof result.url === "string" ? result.url : null);
        if (result.shot) setSelected(String(result.shot));
      } else if (result.shot) {
        setSelected(String(result.shot));
      }
      if (result.ok === false) {
        setError(String(result.error || "Preview capture failed"));
      }
    } catch (err: unknown) {
      if (gen !== captureGen.current) return;
      const msg = err instanceof Error ? err.message : "Preview capture failed";
      setError(/timeout|504|board_timeout/i.test(msg) ? "Preview timed out. Retry Refresh — Chromium may still be warming." : msg);
    } finally {
      if (gen === captureGen.current) setBusy(false);
    }
  }, [showFrame]);

  // A new target app starts from its own URL, not wherever the last one was clicked to.
  useEffect(() => {
    liveRef.current = null;
    setLiveUrl(null);
  }, [boardUrl]);

  // Dock: capture whenever the target URL or orientation changes (board resizes its viewport).
  useEffect(() => {
    if (!dock || !boardUrl) return;
    void capture(liveRef.current ?? boardUrl, viewport);
  }, [dock, boardUrl, capture, viewport]);

  async function run(action: string, extra: Record<string, string> = {}) {
    setBusy(true);
    try {
      const result = await api().browserAction({ action, ...extra });
      if (result.shot) setSelected(String(result.shot));
      refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  function onRefresh() {
    if (dock && boardUrl) {
      void capture(liveUrl ?? boardUrl, viewport);
      return;
    }
    void run("screenshot");
  }

  const frameLabel = orientation === "portrait" ? "Mobile" : "Desktop";

  return (
    <div className={styles.pane} data-variant={variant} data-orientation={orientation}>
      <header className={styles.head}>
        <div>
          <p className={styles.title}>{dock ? "Live preview" : "Board browser"}</p>
          <p className={styles.meta}>
            {boardUrl
              ? liveUrl ?? boardUrl
              : status?.playwright
                ? status.url || (status.session_id ? `Session ${status.session_id}` : "Ready (headless)")
                : status?.detail || "Checking Playwright…"}
          </p>
        </div>
        <div className={styles.actions}>
          <div className={styles.orient} role="group" aria-label="Preview orientation">
            <button
              type="button"
              data-on={orientation === "landscape"}
              aria-pressed={orientation === "landscape"}
              title="Desktop (horizontal)"
              onClick={() => setOrientation("landscape")}
            >
              Horizontal
            </button>
            <button
              type="button"
              data-on={orientation === "portrait"}
              aria-pressed={orientation === "portrait"}
              title="Mobile (vertical)"
              onClick={() => setOrientation("portrait")}
            >
              Vertical
            </button>
          </div>
          <button type="button" disabled={busy || (dock && !boardUrl)} onClick={onRefresh}>
            {busy ? "Capturing…" : dock ? "Refresh" : "Screenshot"}
          </button>
          {!dock ? (
            <button
              type="button"
              disabled={busy || !status?.playwright}
              onClick={() => void run("navigate", { url: "https://example.com" })}
            >
              Open example.com
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (dock) {
                guide?.setBrowserDockOpen(false);
                return;
              }
              void api().browserClose().then(refresh);
            }}
          >
            Close
          </button>
        </div>
      </header>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.stage} data-orientation={orientation}>
        <div
          ref={input.target}
          className={styles.frame}
          data-orientation={orientation}
          data-interactive={dock && Boolean(shotUrl)}
          data-sending={input.sending}
          title={dock && shotUrl ? `${frameLabel} — click, scroll, and type to use the app` : frameLabel}
          tabIndex={dock && shotUrl ? 0 : undefined}
          aria-label={dock && shotUrl ? "Live preview of the board app. Click to focus, then type." : undefined}
          onKeyDown={dock ? input.onKeyDown : undefined}
          onPaste={dock ? input.onPaste : undefined}
        >
          {busy && !shotUrl ? (
            <p className={styles.empty} aria-live="polite">
              Capturing on the board…
            </p>
          ) : shotUrl ? (
            <img
              src={shotUrl}
              alt="Board browser screenshot"
              className={styles.shot}
              draggable={false}
              onClick={dock ? input.onClick : undefined}
            />
          ) : (
            <p className={styles.empty}>
              {dock
                ? "Open Preview from Services, or ask chat to start a localhost app."
                : "No screenshots yet. Ask in chat to browse, or open a service Preview."}
            </p>
          )}
        </div>
      </div>

      {!dock ? (
        <ul className={styles.list}>
          {(status?.artifacts || [])
            .filter((a) => a.kind === "png")
            .map((a) => (
              <li key={a.path}>
                <button type="button" data-on={selected === a.path} onClick={() => setSelected(a.path)}>
                  {a.run}/{a.name}
                </button>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}
