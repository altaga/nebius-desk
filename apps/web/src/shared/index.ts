export type LlmMode = "hybrid" | "cloud_only" | "local_only";

export type ChatMessageMeta = {
  route?: "local" | "nebius" | string;
  model?: string;
  intent?: string;
  original_tokens?: number;
  sent_tokens?: number;
  saved_tokens?: number;
  saved_pct?: number;
  nebius_tokens?: number;
  local_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  cost_usd?: number;
  latency_ms?: number;
  context_window?: number;
  compressed?: boolean;
  thinking?: string;
  budget_note?: string;
  selector?: Selector;
  selector_reason?: string;
  selector_ms?: number;
  tool_runs?: Array<{
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
    media?: { type: "video" | "image"; path: string } | null;
  }>;
};

export type ModelChoice = "auto" | "local" | "nano" | "fast" | "heavy" | "ultra";
export type Selector = "manual" | "jetson" | "rules";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  meta?: ChatMessageMeta;
  created_at?: string | null;
};

export type SessionTelemetry = {
  session_id: string;
  turns: number;
  saved_tokens: number;
  original_tokens: number;
  nebius_tokens: number;
  local_tokens: number;
  saved_pct: number;
  cost_usd: number;
  last_prompt_tokens: number;
  last_model: string | null;
  last_route: string | null;
};

export type ApprovalAction = {
  kind: string;
  needs_approval?: boolean;
  command?: string;
  path?: string;
  query?: string;
  bytes?: number;
  /** Human reason shown before Approve (e.g. rename saveItemz → saveItems). */
  explain?: string;
  old?: string;
  new?: string;
};

export type TurnEvent =
  | {
      type: "start";
      session_id: string;
      route: string;
      model: string;
      intent: string;
      thinking: boolean;
      compressed: boolean;
      note: string;
      selector: Selector;
      selector_reason: string;
      selector_ms: number;
    }
  | { type: "delta"; kind: "text" | "thinking"; text: string }
  | { type: "status"; phase?: string; text?: string }
  | {
      type: "tool";
      phase?: "start" | "done" | string;
      kind?: string;
      command?: string;
      path?: string;
      query?: string;
      url?: string;
      action?: string;
      tool?: string;
      ok?: boolean;
      exit_code?: number | null;
      stdout?: string;
      stderr?: string;
      timed_out?: boolean;
      skipped?: boolean;
      error?: string;
      reason?: string;
      media?: { type: "video" | "image"; path: string } | null;
    }
  | {
      type: "approval";
      approval_id: string;
      session_id: string;
      actions: ApprovalAction[];
      timeout_sec: number;
    }
  | { type: "approval_resolved"; approval_id: string; decision: "approve" | "deny" | string }
  | { type: "done"; session_id: string; message: ChatMessage; telemetry: SessionTelemetry }
  | { type: "error"; detail: string };

export type GuideActionPayload = { type: string; target?: string; emotion?: string };

export type GuideTurnEvent =
  | {
      type: "start";
      session_id: string;
      route?: string;
      model?: string;
      intent?: string;
      thinking?: boolean;
      compressed?: boolean;
      note?: string;
      selector?: Selector;
      selector_reason?: string;
      selector_ms?: number;
    }
  | { type: "delta"; kind: "text" | "thinking"; text: string }
  | { type: "action"; action: GuideActionPayload }
  | {
      type: "done";
      session_id: string;
      message: ChatMessage;
      telemetry?: SessionTelemetry;
      actions?: GuideActionPayload[];
    }
  | { type: "error"; detail: string };

export type MissionThread = {
  id: string;
  agent_id: string;
  label: string;
  status: string;
  route: string;
  created_at: string;
  result_preview: string;
};

export const DEFAULT_API_URL = "http://127.0.0.1:8000";

/** Server rejects longer chat messages (apps/api/app/chat/schemas.py). */
export const MAX_CHAT_INPUT_CHARS = 8_000;

/** Cloud guide route cap (apps/cloud/src/guide/routes.ts). */
export const MAX_GUIDE_INPUT_CHARS = 4_000;
