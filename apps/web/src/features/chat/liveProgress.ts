/** Labels for live tool progress while a turn is running. */

/** Board file produced by a ```record``` / ```render``` tool. */
export type ToolMediaRef = { type: "video" | "image"; path: string };

export type LiveStepStatus = "running" | "ok" | "fail" | "skipped";

export type LiveStep = {
  id: string;
  kind: string;
  label: string;
  status: LiveStepStatus;
  detail?: string;
  /** Video/image produced by ```record``` / ```render```. */
  media?: ToolMediaRef;
};

export type ActivityItem =
  | { type: "commands"; id: string; steps: LiveStep[] }
  | { type: "step"; step: LiveStep };

export type SavedToolRun = {
  kind?: string;
  command?: string;
  path?: string;
  query?: string;
  url?: string;
  action?: string;
  tool?: string;
  ok?: boolean;
  exit_code?: number | null;
  skipped?: boolean;
  error?: string | null;
  reason?: string;
  media?: ToolMediaRef | null;
};

type ToolLike = {
  phase?: string;
  kind?: string;
  command?: string;
  path?: string;
  query?: string;
  url?: string;
  action?: string;
  tool?: string;
  ok?: boolean;
  skipped?: boolean;
  error?: string | null;
  reason?: string;
  exit_code?: number | null;
  media?: ToolMediaRef | null;
};

function mediaOf(value: ToolMediaRef | null | undefined): ToolMediaRef | undefined {
  if (!value || typeof value.path !== "string" || !value.path) return undefined;
  return value.type === "video" || value.type === "image" ? value : undefined;
}

function clip(text: string, n = 320): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}

export function labelForTool(event: ToolLike): string {
  const kind = (event.kind || "tool").toLowerCase();
  if (kind === "run") return clip(event.command || "command");
  if (kind === "list") return `List ${clip(event.path || "home")}`;
  if (kind === "read") return `Read ${clip(event.path || "file")}`;
  if (kind === "patch") return `Edit ${clip(event.path || "file")}`;
  if (kind === "search") return `Search ${clip(event.query || "the web")}`;
  if (kind === "install") return `Install ${clip(event.tool || "package")}`;
  if (kind === "browse") {
    const where = event.url ? clip(event.url) : event.action || "the page";
    return `Open ${where}`;
  }
  if (kind === "record") return `Record demo of ${clip(event.url || "the page")}`;
  if (kind === "render") return `Render image ${clip(event.path || "")}`.trim();
  if (kind === "probe") return `Check ${clip(event.path || event.query || "the target")}`;
  if (kind === "mkdir") return `Create folder ${clip(event.path || "")}`.trim();
  if (kind === "work") return "Update work state";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Consecutive shell runs collapse into one "Ran N commands" row. */
export function activityItems(steps: LiveStep[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  let runs: LiveStep[] = [];
  const flush = () => {
    if (runs.length > 1) items.push({ type: "commands", id: runs[0].id, steps: runs });
    else if (runs.length === 1) items.push({ type: "step", step: runs[0] });
    runs = [];
  };
  for (const step of steps) {
    if (step.kind === "run") runs.push(step);
    else {
      flush();
      items.push({ type: "step", step });
    }
  }
  flush();
  return items;
}

export function stepsFromRuns(runs: SavedToolRun[]): LiveStep[] {
  return runs.map((run, index) => {
    const status: LiveStepStatus = run.skipped
      ? "skipped"
      : run.ok === false || (run.exit_code != null && run.exit_code !== 0)
        ? "fail"
        : "ok";
    return {
      id: `saved-${index}`,
      kind: run.kind || "tool",
      label: labelForTool(run),
      status,
      detail: run.error || run.reason || undefined,
      media: mediaOf(run.media),
    };
  });
}

export function applyToolEvent(steps: LiveStep[], event: ToolLike, seq: number): LiveStep[] {
  const kind = event.kind || "tool";
  const label = labelForTool(event);
  const phase = event.phase || "done";

  if (phase === "start") {
    return [
      ...steps.map((s) => (s.status === "running" ? { ...s, status: "ok" as const } : s)),
      { id: `t-${seq}`, kind, label, status: "running" },
    ];
  }

  // Match the latest running step of this kind, else append.
  const next = [...steps];
  let idx = -1;
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].status === "running" && next[i].kind === kind) {
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].status === "running") {
        idx = i;
        break;
      }
    }
  }
  const status: LiveStepStatus = event.skipped
    ? "skipped"
    : event.ok === false || (event.exit_code != null && event.exit_code !== 0)
      ? "fail"
      : "ok";
  const detail = (event.error || event.reason || "").replace(/\s+/g, " ").trim() || undefined;
  const media = mediaOf(event.media);
  if (idx >= 0) {
    next[idx] = { ...next[idx], label, status, detail, media };
    return next;
  }
  return [...next, { id: `t-${seq}`, kind, label, status, detail, media }];
}

export function formatElapsed(ms: number): string {
  const sec = Math.max(0, ms) / 1000;
  if (sec < 10) return `${sec.toFixed(1)}s`;
  if (sec < 60) return `${Math.floor(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
