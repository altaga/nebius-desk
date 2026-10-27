"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TitleRename } from "@/features/desk/TitleRename";
import type { SessionRow } from "@/features/desk/types";
import { IconDots, IconPencil, IconPin, IconTrash } from "@/ui/icons";
import styles from "./ChatList.module.css";

type Props = {
  row: SessionRow;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => Promise<void>;
  onPin: (pinned: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
};

type Mode = "idle" | "menu" | "rename" | "confirm";

export function ChatRow({ row, active, onSelect, onRename, onPin, onDelete }: Props) {
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (mode !== "menu") return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMode("idle");
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [mode]);

  if (mode === "rename") {
    return (
      <li className={styles.row} data-active={active}>
        <TitleRename
          initial={row.title}
          label="Chat title"
          className={styles.rename}
          onSave={onRename}
          onCancel={() => setMode("idle")}
        />
      </li>
    );
  }

  return (
    <li ref={ref} className={styles.row} data-active={active} data-open={mode !== "idle"}>
      <button type="button" className={styles.title} onClick={onSelect} aria-current={active ? "true" : undefined}>
        {row.pinned ? <IconPin size={12} className={styles.pinMark} /> : null}
        <span>{row.title || "Untitled chat"}</span>
      </button>
      <button
        type="button"
        className={styles.more}
        aria-label={`Options for ${row.title || "chat"}`}
        aria-expanded={mode === "menu"}
        onClick={() => setMode(mode === "menu" ? "idle" : "menu")}
      >
        <IconDots size={14} />
      </button>
      {mode === "menu" ? (
        <div className={styles.menu} role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => void onPin(!row.pinned).finally(() => setMode("idle"))}
          >
            <IconPin size={13} /> {row.pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => setMode("rename")}
          >
            <IconPencil size={13} /> Rename
          </button>
          <button type="button" role="menuitem" data-danger onClick={() => setMode("confirm")}>
            <IconTrash size={13} /> Delete
          </button>
        </div>
      ) : null}
      {mode === "confirm" ? (
        <DeleteChatDialog
          onCancel={() => setMode("idle")}
          onConfirm={() => {
            void onDelete().catch((err: unknown) => {
              setError(err instanceof Error ? err.message : "Could not delete this chat");
              setMode("idle");
            });
          }}
        />
      ) : null}
      {error ? <p className={styles.rowError}>{error}</p> : null}
    </li>
  );
}

function DeleteChatDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div className={styles.scrim} onMouseDown={onCancel}>
      <div
        className={styles.confirm}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p id={titleId}>Delete this chat and its history?</p>
        <div className={styles.confirmRow}>
          <button type="button" autoFocus onClick={onCancel}>
            Cancel
          </button>
          <button type="button" data-danger onClick={onConfirm}>
            <IconTrash size={13} /> Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
