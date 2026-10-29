"use client";

import { useState } from "react";
import type { ToolMediaRef } from "@/features/chat/liveProgress";
import { api } from "@/lib/api";
import styles from "./ActivityFeed.module.css";

/** Inline result of a ```record``` / ```render``` tool, streamed from the board. */
export function ToolMedia({ media }: { media: ToolMediaRef }) {
  const [failed, setFailed] = useState(false);
  const src = api().rawFileUrl(media.path);
  const name = media.path.split("/").pop() || media.path;

  if (failed) {
    return (
      <p className={styles.mediaNote} role="alert">
        Could not load {name}. It is saved on the board at {media.path}.
      </p>
    );
  }
  return (
    <figure className={styles.media}>
      {media.type === "video" ? (
        <video src={src} controls playsInline preload="metadata" aria-label={name} onError={() => setFailed(true)} />
      ) : (
        <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} />
      )}
      <figcaption>
        <a href={src} download={name}>
          {media.path}
        </a>
      </figcaption>
    </figure>
  );
}
