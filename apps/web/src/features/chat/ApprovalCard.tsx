"use client";

import type { ApprovalAction } from "@nebius-desk/shared/index";
import styles from "./ApprovalCard.module.css";

type Props = {
  actions: ApprovalAction[];
  busy?: boolean;
  onDecide: (decision: "approve" | "deny") => void;
};

function clip(text: string, n = 280): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}

export function ApprovalCard({ actions, busy, onDecide }: Props) {
  return (
    <div className={styles.card} role="alertdialog" aria-label="Approve board action" data-guide="chat.approval">
      <p className={styles.title}>Review the proposed fix</p>
      <p className={styles.hint}>
        Nothing runs on the board until you Approve. Read the change below first.
      </p>
      <ul className={styles.list}>
        {actions.map((action, i) => (
          <li key={`${action.kind}-${i}`} className={styles.item}>
            {action.explain ? <p className={styles.explain}>{action.explain}</p> : null}
            {action.kind === "patch" && (action.old || action.new) ? (
              <pre className={styles.diff} aria-label="Proposed edit">
                {action.path ? <span className={styles.path}>{action.path}</span> : null}
                {action.old ? <span className={styles.del}>- {clip(action.old)}</span> : null}
                {action.new ? <span className={styles.add}>+ {clip(action.new)}</span> : null}
              </pre>
            ) : (
              <code>
                {action.kind === "run" && action.command
                  ? `$ ${action.command}`
                  : action.path
                    ? `${action.kind} ${action.path}`
                    : action.query
                      ? `${action.kind} ${action.query}`
                      : action.kind}
              </code>
            )}
          </li>
        ))}
      </ul>
      <div className={styles.row}>
        <button type="button" className={styles.deny} disabled={busy} onClick={() => onDecide("deny")}>
          Deny
        </button>
        <button type="button" className={styles.approve} disabled={busy} onClick={() => onDecide("approve")}>
          Approve
        </button>
      </div>
    </div>
  );
}
