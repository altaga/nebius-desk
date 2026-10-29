"use client";

import { useBoardJobs, type BoardJob } from "./useBoardJobs";
import styles from "./JobsPane.module.css";

function labelKind(kind: string): string {
  if (kind === "research") return "Research agent";
  if (kind === "record") return "Record agent";
  if (kind === "verify") return "Verify agent";
  if (kind === "bakeoff") return "Bakeoff agent";
  if (kind === "probe") return "Probe agent";
  if (kind === "health") return "Health agent";
  if (kind === "deploy") return "Deploy agent";
  if (kind === "checks") return "Checks agent";
  if (kind === "shell") return "Shell agent";
  return `${kind} agent`;
}

function detailOf(job: BoardJob): string {
  if (job.status === "cancelled") return job.error || "Stopped by you";
  if (job.error && job.status === "error") return job.error;
  const payload = job.payload || {};
  if (typeof payload.topic === "string" && payload.topic) return payload.topic;
  if (typeof payload.command === "string" && payload.command) return payload.command;
  if (typeof payload.body === "string" && payload.body) {
    const url = payload.body.match(/^url:\s*(\S+)/m)?.[1];
    const name = payload.body.match(/^name:\s*(\S+)/m)?.[1];
    if (url || name) return [name, url].filter(Boolean).join(" · ");
  }
  if (payload.repeats != null) return `repeats: ${payload.repeats}`;
  if (typeof payload.target === "string") return payload.target;
  if (job.status === "done") {
    const result = job.result || {};
    if (typeof result.path === "string") return result.path;
    if (typeof result.pass_rate === "number") return `pass rate ${(result.pass_rate * 100).toFixed(0)}%`;
    if (result.ok === true) return "Completed on the board";
  }
  if (job.status === "running") {
    if (job.kind === "research") return "Deep research on the Jetson…";
    if (job.kind === "record") return "Recording on the Jetson…";
    return "Working on the Jetson…";
  }
  if (job.status === "queued") return "Queued — waiting for the board worker";
  return "";
}

function when(job: BoardJob): string {
  const raw = job.finished_at || job.started_at || job.created_at;
  if (!raw) return "";
  try {
    return new Date(raw).toLocaleTimeString();
  } catch {
    return "";
  }
}

function JobRow({
  job,
  busy,
  onStop,
  onRemove,
}: {
  job: BoardJob;
  busy: boolean;
  onStop?: () => void;
  onRemove: () => void;
}) {
  const live = job.status === "queued" || job.status === "running";
  return (
    <li className={styles.row}>
      <div className={styles.head}>
        <span className={styles.kind}>{labelKind(job.kind)}</span>
        <span className={styles.status} data-on={job.status}>
          {job.status}
        </span>
      </div>
      {detailOf(job) ? <p className={styles.detail}>{detailOf(job)}</p> : null}
      <div className={styles.footer}>
        {when(job) ? <p className={styles.time}>{when(job)}</p> : <span />}
        <div className={styles.actions}>
          {live && onStop ? (
            <button type="button" className={styles.action} disabled={busy} onClick={onStop}>
              Stop
            </button>
          ) : null}
          <button type="button" className={styles.action} disabled={busy} onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

type Props = { deviceId?: string };

/**
 * Background agents on the board — durable ```job``` workers that keep going
 * after you close the browser (Jetson-side upgrade over a chat-only turn).
 */
export function JobsPane({ deviceId: _deviceId }: Props) {
  const { active, recent, error, ready, busyId, refresh, stopJob, removeJob } = useBoardJobs(true);

  return (
    <div className={styles.pane}>
      <p className={styles.meta}>
        Background agents run on this board. Close the tab — they keep working and post the result in
        chat when done. Stop cancels a live agent; Remove clears it from this list.
      </p>
      <p className={styles.upgrade}>
        Board upgrade: durable agents (deep research ~30s, record, deploy, …) survive browser disconnect.
        Chat turns stream; agents persist.
      </p>

      {!ready ? (
        <div className={styles.skeleton} aria-label="Loading background agents">
          <span />
          <span />
        </div>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {ready && !error && active.length === 0 && recent.length === 0 ? (
        <p className={styles.empty}>
          No background agents yet. In chat: “start a deep research on Jetson edge agents in the
          background and ping me when the report is ready” — then watch this tab (~30s).
        </p>
      ) : null}

      {active.length ? (
        <section className={styles.section} aria-label="Active agents">
          <h3 className={styles.sectionTitle}>Active · {active.length}</h3>
          <ul className={styles.list}>
            {active.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                busy={busyId === job.id}
                onStop={() => void stopJob(job.id)}
                onRemove={() => void removeJob(job.id)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {recent.length ? (
        <section className={styles.section} aria-label="Recent agents">
          <div className={styles.head}>
            <h3 className={styles.sectionTitle}>Recent</h3>
            <button type="button" className={styles.refresh} onClick={() => refresh(false)}>
              Refresh
            </button>
          </div>
          <ul className={styles.list}>
            {recent.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                busy={busyId === job.id}
                onRemove={() => void removeJob(job.id)}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
