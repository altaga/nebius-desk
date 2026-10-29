"use client";

import { ChatRow, SelectableChatRow } from "@/features/desk/ChatRow";
import { ChatSelectBar } from "@/features/desk/ChatSelectBar";
import { groupChats } from "@/features/desk/chatGroups";
import type { SessionRow } from "@/features/desk/types";
import { useChatSelection } from "@/features/desk/useChatSelection";
import styles from "./ChatList.module.css";

type Props = {
  sessions: SessionRow[];
  loading: boolean;
  error: string | null;
  query: string;
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onPin: (id: string, pinned: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDeleteMany: (ids: string[]) => Promise<void>;
  /** Bulk-select mode, toggled from the Chats header. */
  selecting: boolean;
  onSelectingDone: () => void;
};

export function ChatList(p: Props) {
  const { sessions, loading, error, query, activeId, selecting } = p;
  const groups = groupChats(sessions, query);
  const visibleIds = groups.flatMap((g) => g.items.map((row) => row.id));
  const pick = useChatSelection(visibleIds, selecting, p.onSelectingDone);

  if (loading && sessions.length === 0) {
    return (
      <div className={styles.skeleton} aria-label="Loading chats">
        <span />
        <span />
        <span />
      </div>
    );
  }
  if (error && sessions.length === 0) {
    return (
      <p className={styles.state} role="alert">
        {error}
      </p>
    );
  }
  if (groups.length === 0) {
    return <p className={styles.state}>{query ? "No chats match your search." : "No chats on this device yet."}</p>;
  }
  return (
    <div className={styles.groups} data-selecting={selecting}>
      {error ? (
        <p className={styles.state} role="alert">
          {error}
        </p>
      ) : null}
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h3 className={styles.groupLabel}>{g.label}</h3>
          <ul className={styles.list}>
            {g.items.map((row) =>
              selecting ? (
                <SelectableChatRow
                  key={row.id}
                  row={row}
                  checked={pick.selected.has(row.id)}
                  onToggle={(range) => pick.toggle(row.id, range)}
                />
              ) : (
                <ChatRow
                  key={row.id}
                  row={row}
                  active={row.id === activeId}
                  onSelect={() => p.onSelect(row.id)}
                  onRename={(title) => p.onRename(row.id, title)}
                  onPin={(pinned) => p.onPin(row.id, pinned)}
                  onDelete={() => p.onDelete(row.id)}
                />
              )
            )}
          </ul>
        </section>
      ))}
      {selecting ? (
        <ChatSelectBar
          count={pick.selected.size}
          total={visibleIds.length}
          onToggleAll={pick.toggleAll}
          onDelete={() => p.onDeleteMany([...pick.selected]).then(p.onSelectingDone, () => undefined)}
        />
      ) : null}
    </div>
  );
}
