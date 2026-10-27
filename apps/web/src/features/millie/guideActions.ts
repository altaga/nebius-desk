/** Allowlisted guide actions — client gate. Never includes execute/send/mutate. */

export const GUIDE_ACTION_TYPES = [
  "open_chat",
  "open_machine",
  "open_terminal",
  "open_files",
  "open_health",
  "open_panel",
  "open_board",
  "open_plan",
  "open_nav",
  "highlight",
  "react",
] as const;

export type GuideActionType = (typeof GUIDE_ACTION_TYPES)[number];

export type GuideEmotion =
  | "neutral"
  | "happy"
  | "excited"
  | "relaxed"
  | "sleepy"
  | "laugh"
  | "cat"
  | "determined";

export type GuideTarget =
  | "nav.open_machine"
  | "nav.new_chat"
  | "nav.pair"
  | "machine.health"
  | "machine.terminal"
  | "machine.files"
  | "panel.chat"
  | "panel.board"
  | "panel.plan"
  | "board.status"
  | "board.memory"
  | "board.experts"
  | "board.secrets"
  | "chat.model_picker";

export type GuideAction =
  | { type: Exclude<GuideActionType, "highlight" | "react"> }
  | { type: "highlight"; target: GuideTarget }
  | { type: "react"; emotion: GuideEmotion };

const TARGETS = new Set<string>([
  "nav.open_machine",
  "nav.new_chat",
  "nav.pair",
  "machine.health",
  "machine.terminal",
  "machine.files",
  "panel.chat",
  "panel.board",
  "panel.plan",
  "board.status",
  "board.memory",
  "board.experts",
  "board.secrets",
  "chat.model_picker",
]);

const EMOTIONS = new Set<string>([
  "neutral",
  "happy",
  "excited",
  "relaxed",
  "sleepy",
  "laugh",
  "cat",
  "determined",
]);

const TYPES = new Set<string>(GUIDE_ACTION_TYPES);

export function isGuideAction(value: unknown): value is GuideAction {
  if (!value || typeof value !== "object") return false;
  const row = value as { type?: unknown; target?: unknown; emotion?: unknown; name?: unknown };
  if (typeof row.type !== "string" || !TYPES.has(row.type)) return false;
  if (row.type === "highlight") {
    return typeof row.target === "string" && TARGETS.has(row.target);
  }
  if (row.type === "react") {
    const emotion = typeof row.emotion === "string" ? row.emotion : typeof row.name === "string" ? row.name : null;
    return !!emotion && EMOTIONS.has(emotion);
  }
  // Nano sometimes attaches a target to open_*; ignore extras.
  return true;
}

function ingestActionsPayload(parsed: unknown, into: GuideAction[]): boolean {
  const before = into.length;
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { actions?: unknown }).actions)
      ? (parsed as { actions: unknown[] }).actions
      : [parsed];
  into.push(...gateActions(list));
  return into.length > before;
}

export function gateActions(raw: unknown[]): GuideAction[] {
  const out: GuideAction[] = [];
  for (const item of raw) {
    if (!isGuideAction(item)) continue;
    if (item.type === "react") {
      const row = item as { emotion?: string; name?: string };
      out.push({ type: "react", emotion: (row.emotion || row.name) as GuideEmotion });
      continue;
    }
    if (item.type === "highlight") {
      out.push({ type: "highlight", target: item.target });
      continue;
    }
    // Drop any hallucinated target/emotion on nav opens.
    out.push({ type: item.type });
  }
  return out;
}

/** Strip ```guide … ``` fences (and bare action JSON); return clean text + parsed actions. */
export function parseGuidePayload(text: string): { text: string; actions: GuideAction[] } {
  const actions: GuideAction[] = [];
  let cleaned = text.replace(/```guide\s*([\s\S]*?)```/gi, (_m, body: string) => {
    try {
      ingestActionsPayload(JSON.parse(String(body).trim()), actions);
    } catch {
      /* ignore malformed blocks */
    }
    return "";
  });
  // Unclosed trailing fence — never show tool JSON in the bubble.
  cleaned = cleaned.replace(/```guide\s*[\s\S]*$/i, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  if (!actions.length && (cleaned.startsWith("{") || cleaned.startsWith("["))) {
    try {
      if (ingestActionsPayload(JSON.parse(cleaned), actions)) cleaned = "";
    } catch {
      /* keep text */
    }
  }
  return { text: cleaned, actions };
}

export function emotionFromActions(actions: GuideAction[]): GuideEmotion | null {
  for (let i = actions.length - 1; i >= 0; i--) {
    const a = actions[i];
    if (a.type === "react") return a.emotion;
  }
  return null;
}
