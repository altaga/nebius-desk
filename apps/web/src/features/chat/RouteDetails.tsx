import type { ChatMessageMeta } from "@nebius-desk/shared/index";
import { fmtCost, fmtMs, shortModel } from "@/features/chat/format";
import styles from "./AssistantTurn.module.css";

function selectorLabel(selector: string, deviceName: string): string {
  if (selector === "jetson") return `${deviceName} chose the model`;
  if (selector === "rules") return "Chosen from the message";
  if (selector === "manual") return "You chose the model";
  return selector;
}

function pickedBy(meta: ChatMessageMeta, deviceName: string): string | undefined {
  if (!meta.selector) return undefined;
  const took = meta.selector_ms ? ` in ${fmtMs(meta.selector_ms)}` : "";
  const why = meta.selector_reason ? ` — ${meta.selector_reason}` : "";
  return `${selectorLabel(meta.selector, deviceName)}${took}${why}`;
}

export function RouteDetails({ meta, deviceName = "Board" }: { meta: ChatMessageMeta; deviceName?: string }) {
  const cloud = meta.route === "nebius";
  const board = deviceName.trim() || "Board";
  const rows: Array<[string, string | undefined]> = [
    ["route", cloud ? `${board}, using Nebius` : `${board}, on this device`],
    ["model", meta.model ? `${shortModel(meta.model)} · ${meta.model}` : undefined],
    ["picked by", pickedBy(meta, board)],
    ["tier", meta.intent],
    ["prompt", `${meta.prompt_tokens ?? 0} tokens`],
    [
      "output",
      `${meta.completion_tokens ?? 0} tokens${meta.reasoning_tokens ? ` (${meta.reasoning_tokens} reasoning)` : ""}`,
    ],
    ["cost", cloud ? `${fmtCost(meta.cost_usd)} (${(meta.cost_usd ?? 0).toFixed(6)} USD)` : "$0 — ran on the Jetson"],
    ["latency", fmtMs(meta.latency_ms)],
    [
      "context",
      meta.compressed
        ? `older turns summarized on the Jetson · ${meta.saved_tokens ?? 0} tokens saved (${meta.saved_pct ?? 0}%)`
        : cloud
          ? "full history sent"
          : "recent turns only",
    ],
    ["note", meta.budget_note || undefined],
  ];
  return (
    <dl className={styles.details}>
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}
