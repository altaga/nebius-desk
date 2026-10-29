"use client";

import { useState } from "react";
import { activityItems, type LiveStep } from "@/features/chat/liveProgress";
import { ToolMedia } from "@/features/chat/ToolMedia";
import { IconChevronRight } from "@/ui/icons";
import styles from "./ActivityFeed.module.css";

type Props = {
  steps: LiveStep[];
  /** While the turn is running, open the command group so each command stays visible. */
  live?: boolean;
  note?: string | null;
};

export function ActivityFeed({ steps, live = false, note }: Props) {
  const items = activityItems(steps);
  if (!items.length && !note) return null;
  return (
    <div className={styles.feed}>
      {items.map((item) =>
        item.type === "commands" ? (
          <CommandGroup key={item.id} steps={item.steps} live={live} />
        ) : (
          <StepLine key={item.step.id} step={item.step} />
        )
      )}
      {note ? <p className={styles.line}>{note}</p> : null}
    </div>
  );
}

function CommandGroup({ steps, live }: { steps: LiveStep[]; live: boolean }) {
  const [open, setOpen] = useState(live);
  const count = steps.length;
  return (
    <div className={styles.group} data-open={open}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <IconChevronRight size={12} className={styles.chev} data-open={open} />
        Ran {count} command{count === 1 ? "" : "s"}
      </button>
      {open ? (
        <ul className={styles.commands}>
          {steps.map((step) => (
            <li key={step.id} data-status={step.status}>
              <span>{step.label}</span>
              {step.detail ? <small>{step.detail}</small> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function StepLine({ step }: { step: LiveStep }) {
  return (
    <>
      <p className={styles.line} data-status={step.status}>
        <span>{step.label}</span>
        {step.detail ? <small>{step.detail}</small> : null}
      </p>
      {step.media && step.status === "ok" ? <ToolMedia media={step.media} /> : null}
    </>
  );
}
