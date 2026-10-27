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
