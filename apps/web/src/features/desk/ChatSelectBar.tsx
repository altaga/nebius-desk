"use client";

import { useState } from "react";
import { CheckMark } from "@/features/desk/CheckMark";
import { DeleteChatDialog } from "@/features/desk/ChatRow";
import { IconTrash } from "@/ui/icons";
import styles from "./ChatList.module.css";

type Props = {
  count: number;
  total: number;
  onToggleAll: () => void;
  onDelete: () => Promise<void>;
};

/** Floating action bar pinned to the bottom of the chat list while picking chats. */
export function ChatSelectBar({ count, total, onToggleAll, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const all = total > 0 && count === total;

  const confirm = () => {
    setConfirming(false);
    setBusy(true);
    void onDelete().finally(() => setBusy(false));
  };

  return (
    <div className={styles.selectBar} role="toolbar" aria-label="Bulk chat actions">
      <button
        type="button"
        role="checkbox"
        aria-checked={all ? true : count ? "mixed" : false}
        className={styles.selectAll}
        onClick={onToggleAll}
        disabled={total === 0 || busy}
      >
        <CheckMark state={all ? "on" : count ? "mixed" : "off"} />
        <span aria-live="polite">{count ? `${count} selected` : "Select all"}</span>
      </button>
      <button
        type="button"
        className={styles.selectDelete}
        disabled={count === 0 || busy}
        onClick={() => setConfirming(true)}
      >
        <IconTrash size={13} />
        {busy ? "Deleting…" : "Delete"}
      </button>
      {confirming ? (
        <DeleteChatDialog
          prompt={count === 1 ? "Delete 1 chat and its history?" : `Delete ${count} chats and their history?`}
          onCancel={() => setConfirming(false)}
          onConfirm={confirm}
        />
      ) : null}
    </div>
  );
}
