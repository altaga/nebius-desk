"use client";

import { ChatRow } from "@/features/desk/ChatRow";
import { groupChats } from "@/features/desk/chatGroups";
import type { SessionRow } from "@/features/desk/types";
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
};

export function ChatList({ sessions, loading, error, query, activeId, onSelect, onRename, onPin, onDelete }: Props) {
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
  const groups = groupChats(sessions, query);
  if (groups.length === 0) {
    return <p className={styles.state}>{query ? "No chats match your search." : "No chats on this device yet."}</p>;
  }
  return (
    <div className={styles.groups}>
      {error ? (
        <p className={styles.state} role="alert">
          {error}
        </p>
      ) : null}
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h3 className={styles.groupLabel}>{g.label}</h3>
          <ul className={styles.list}>
            {g.items.map((row) => (
              <ChatRow
                key={row.id}
                row={row}
                active={row.id === activeId}
                onSelect={() => onSelect(row.id)}
                onRename={(title) => onRename(row.id, title)}
                onPin={(pinned) => onPin(row.id, pinned)}
                onDelete={() => onDelete(row.id)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
