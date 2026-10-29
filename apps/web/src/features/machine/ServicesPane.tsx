"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useDeskGuideOptional } from "@/features/millie/DeskGuideContext";
import styles from "./ServicesPane.module.css";

export type BoardService = {
  kind: string;
  port?: number;
  bind?: string;
  process?: string | null;
  url?: string | null;
  http?: boolean;
  likely_web?: boolean;
  /** HTTP status code (listeners) or docker Status string (containers). */
  status?: number | string;
  title?: string | null;
  server?: string | null;
  id?: string;
  name?: string;
  image?: string;
  ports?: string;
};

type Snapshot = {
  services: BoardService[];
  containers: BoardService[];
  previewable: Array<{ url?: string | null }>;
  has_preview: boolean;
};

type Props = {
  onPreviewUrl?: (url: string) => void;
};

const POLL_MS = 15_000;

export function ServicesPane({ onPreviewUrl }: Props) {
  const guide = useDeskGuideOptional();
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  const seen = useRef(false);

  const refresh = useCallback((quiet: boolean) => {
    api()
      .edgeServices()
      .then((next) => {
        seen.current = true;
        setData(next);
        setError(null);
        setReady(true);
      })
      .catch((err: unknown) => {
        if (quiet && seen.current) return;
        setError(err instanceof Error ? err.message : "Services unavailable");
        setReady(true);
      });
  }, []);

  useEffect(() => {
    refresh(false);
    const id = window.setInterval(() => refresh(true), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function openPreview(url: string) {
    setBusyUrl(url);
    try {
      // Interactive iframe via board localhost proxy — no Playwright required.
      guide?.openBrowserPreview(url);
      onPreviewUrl?.(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not open preview");
    } finally {
      setBusyUrl(null);
    }
  }

  const services = data?.services ?? [];
  const containers = data?.containers ?? [];
  const empty = ready && !error && services.length === 0 && containers.length === 0;

  return (
    <div className={styles.pane}>
      <p className={styles.meta}>Web pages on this board. APIs such as Ollama stay off this list.</p>

      {!ready ? (
        <div className={styles.skeleton} aria-label="Looking for web pages">
          <span />
          <span />
        </div>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {empty ? (
        <p className={styles.empty}>
          No web pages yet. Start a Vite or Next server that serves HTML and it will show up here.
          Preview also appears in chat.
        </p>
      ) : null}

      {services.length ? (
        <section className={styles.section} aria-label="HTTP listeners">
          <h3 className={styles.sectionTitle}>Web on localhost</h3>
          <ul className={styles.list}>
            {services.map((s) => {
              const label = s.title || s.process || `port ${s.port}`;
              return (
                <li key={`p-${s.port}`} className={styles.card}>
                  <div className={styles.cardMain}>
                    <p className={styles.cardTitle}>{label}</p>
                    <p className={styles.cardMeta}>
                      {s.url || `:${s.port}`}
                      {s.status != null ? ` · HTTP ${s.status}` : ""}
                      {s.process ? ` · ${s.process}` : ""}
                    </p>
                  </div>
                  {s.url ? (
                    <button
                      type="button"
                      className={styles.preview}
                      disabled={busyUrl === s.url}
                      onClick={() => void openPreview(s.url!)}
                    >
                      Preview
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {containers.length ? (
        <section className={styles.section} aria-label="Containers">
          <h3 className={styles.sectionTitle}>Containers</h3>
          <ul className={styles.list}>
            {containers.map((c) => (
              <li key={c.id || c.name} className={styles.card}>
                <div className={styles.cardMain}>
                  <p className={styles.cardTitle}>{c.name || c.id || "container"}</p>
                  <p className={styles.cardMeta}>
                    {c.image}
                    {c.ports ? ` · ${c.ports}` : ""}
                    {c.status ? ` · ${c.status}` : ""}
                  </p>
                </div>
                {c.url ? (
                  <button
                    type="button"
                    className={styles.preview}
                    disabled={busyUrl === c.url}
                    onClick={() => void openPreview(c.url!)}
                  >
                    Preview
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
