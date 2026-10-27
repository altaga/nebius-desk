export type LlmMode = "dummy" | "hybrid" | "cloud_only" | "local_only";

export type ChatMessageMeta = {
  route?: string;
  model?: string;
  intent?: string;
  original_tokens?: number;
  sent_tokens?: number;
  saved_tokens?: number;
  saved_pct?: number;
  nebius_tokens?: number;
  local_tokens?: number;
  dummy?: boolean;
  budget_note?: string;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  meta?: ChatMessageMeta;
};

export type SessionTelemetry = {
  session_id: string;
  turns: number;
  saved_tokens: number;
  original_tokens: number;
  nebius_tokens: number;
  local_tokens: number;
  saved_pct: number;
  badge: string;
};

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
