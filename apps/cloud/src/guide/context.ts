import type { DeviceRow, DeviceView } from "../devices/service";
import { deviceView } from "../devices/service";
import type { Balance } from "../subscription/service";

export type DeskHints = {
  secret_names?: string[];
  expert_names?: string[];
};

const UI_LEGEND =
  "UI: Chat=talk to the board LLM (model picker). Machine/Health=temp CPU GPU RAM disk. " +
  "Machine/Terminal=shell on the board. Machine/Files=board filesystem. " +
  "Board panel=status memory experts secrets(llavero names only). Plan=credits. Nav=pair boards.";

function clipNames(raw: unknown, max = 16): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const name = item.trim().slice(0, 40);
    if (!name || !/^[A-Za-z0-9_.:-]+$/.test(name)) continue;
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

export function sanitizeDeskHints(raw: unknown): DeskHints {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  return {
    secret_names: clipNames(row.secret_names),
    expert_names: clipNames(row.expert_names),
  };
}

function modelLines(boardEmu: boolean): string {
  if (boardEmu) {
    return (
      "Chat models (cloud-only board-emu): Nano (short), Lightning/fast (everyday), Super/heavy (hard). " +
      "No Local/Auto Qwen on this board."
    );
  }
  return (
    "Chat models: Auto (routes), Local (free Qwen on board), Nano (short Nebius), " +
    "Lightning/fast (everyday), Super/heavy (deep). Pick in Chat model picker."
  );
}

/** Compact desk snapshot for Millie — keep under ~800 tokens. */
export function buildDeskContext(
  fleet: DeviceView[],
  selected: DeviceRow,
  bal: Balance,
  hints: DeskHints = {}
): string {
  const view = deviceView(selected);
  const online = fleet.filter((d) => d.status === "online");
  const lines = fleet.map((d) => `${d.name} (${d.status}${d.id === selected.id ? ", selected" : ""})`);
  const secrets = hints.secret_names?.length ? hints.secret_names.join(", ") : "(none listed / board offline)";
  const experts = hints.expert_names?.length ? hints.expert_names.join(", ") : "(none)";

  return [
    `Fleet: ${fleet.length} board(s), ${online.length} online.`,
    lines.length ? `Boards: ${lines.join("; ")}.` : "Boards: none paired.",
    `Selected board: ${view.name}. status=${view.status}. hostname=${view.hostname || "unknown"}.`,
    `remote_access=${view.remote_enabled ? "on" : "off"}.`,
    view.board_emu ? "kind=board-emu (cloud chat only)." : "kind=jetson.",
    modelLines(view.board_emu),
    `Credits: cloud $${bal.cloud_remaining_usd.toFixed(2)} left of $${bal.cloud_credit_usd.toFixed(2)}; ` +
      `Tavily ${bal.tavily_credits_remaining}/${bal.tavily_credits} left. plan=${bal.plan_name} (${bal.status}).`,
    `Secrets (names only, never values): ${secrets}.`,
    `Experts/brains: ${experts}.`,
    UI_LEGEND,
    "Answer factual questions from this context. Navigate only when asked to open/show a screen.",
  ].join(" ");
}
