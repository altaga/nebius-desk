import type { ChatMessage, GuideTurnEvent, MissionThread, ModelChoice, SessionTelemetry, TurnEvent } from "./index";

export type JetsonHealth = {
  host: string;
  model: string | null;
  jetson_online: boolean;
  uptime_sec: number | null;
  cpu_pct: number | null;
  gpu_util_pct: number | null;
  ram_used_mb: number | null;
  ram_total_mb: number | null;
  temp_c: number | null;
  disk_used_gb: number | null;
  disk_total_gb: number | null;
  disk_used_pct: number | null;
  disk_path: string | null;
  /** Present on Docker board-emu — no local Qwen / Auto route. */
  source?: string | null;
  board_emu?: boolean;
};

export type CliResult = {
  command: string;
  cwd: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
};

export type FileListing = {
  root: string;
  path: string;
  entries: Array<{ name: string; kind: "dir" | "file"; size: number | null }>;
};
import { DEFAULT_API_URL } from "./index";

export type ApiClientOptions = {
  baseUrl?: string;
  getToken?: () => string | null;
  getDeviceId?: () => string | null;
  recoverAuth?: () => Promise<boolean>;
};

function deskLinkMessage(text: string, status: number): string {
  if (text.includes("board_timeout") || text.includes("board_offline") || text.includes("board_reconnecting")) {
    return "The board link dropped before it could answer. It reconnects on its own.";
  }
  return text || `HTTP ${status}`;
}

async function readSse(
  url: string,
  body: unknown,
  onEvent: (event: unknown) => void,
  opts: ApiClientOptions,
  signal?: AbortSignal
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  const token = opts.getToken?.();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(deskLinkMessage(text, res.status));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf("\n\n");
    while (cut !== -1) {
      const frame = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 2);
      if (frame.startsWith("data: ")) onEvent(JSON.parse(frame.slice(6)));
      cut = buffer.indexOf("\n\n");
    }
  }
}

export function createApiClient(opts: ApiClientOptions = {}) {
  const baseUrl = (opts.baseUrl || DEFAULT_API_URL).replace(/\/$/, "");

  function resolve(path: string): string {
    if (!path.startsWith("/api/")) return path;
    const id = opts.getDeviceId?.();
    if (!id) throw new Error("No board selected");
    return `/v1/devices/${encodeURIComponent(id)}${path}`;
  }

  async function request<T>(path: string, init: RequestInit = {}, authRetried = false, linkRetried = false): Promise<T> {
    const headers = new Headers(init.headers || {});
    if (!headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json");
    }
    const token = opts.getToken?.();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const res = await fetch(`${baseUrl}${resolve(path)}`, { ...init, headers });
    if (res.status === 401 && !authRetried && opts.recoverAuth) {
      const text = await res.text();
      if (await opts.recoverAuth()) return request(path, init, true, linkRetried);
      throw new Error(text || "HTTP 401");
    }
    if (!res.ok) {
      const text = await res.text();
      const method = (init.method || "GET").toUpperCase();
      const safe = method === "GET" || method === "HEAD";
      if (safe && !linkRetried && (res.status === 502 || res.status === 503 || res.status === 504)) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return request(path, init, authRetried, true);
      }
      throw new Error(deskLinkMessage(text, res.status));
    }
    return res.json() as Promise<T>;
  }

  return {
    health: () => request<{ ok: boolean; llm_mode: string }>("/health"),
    setup2fa: () =>
      request<{
        username: string;
        totp_secret: string;
        otpauth_url: string;
        qr_png_base64: string;
        message: string;
      }>("/v1/auth/setup-2fa"),
    login: (username: string, password: string, totp_code = "") =>
      request<{ access_token: string; refresh_token: string; expires_in: number }>("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password, totp_code }),
      }),
    me: () =>
      request<{ id: number; username: string; totp_enabled: boolean }>("/v1/auth/me"),
    listDevices: () =>
      request<
        Array<{
          id: string;
          name: string;
          hostname: string;
          agent_name: string;
          kind: string;
          status: string;
          last_seen_at: string | null;
          agent_count: number;
          remote_enabled?: boolean;
          board_emu?: boolean;
        }>
      >("/v1/devices"),
    edgeCapabilities: () =>
      request<{ board_emu: boolean; local: boolean; auto: boolean; models: string[] }>("/api/edge/capabilities"),
    renameBoard: async (deviceId: string, name: string) => {
      // Cloud is the fleet source of truth — never await the board tunnel here
      // (Millie/Jetson latency was freezing the Rename "Saving" button for minutes).
      const renamed = await request<{ id: string; name: string; agent_name?: string }>(
        `/v1/devices/${encodeURIComponent(deviceId)}`,
        { method: "PATCH", body: JSON.stringify({ name }) }
      );
      // Best-effort local copy on that board only; ignore failures / slowness.
      void request(`/v1/devices/${encodeURIComponent(deviceId)}/api/devices/${encodeURIComponent(deviceId)}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }).catch(() => undefined);
      return { ...renamed, agent_name: renamed.agent_name || renamed.name };
    },
    removeBoard: (deviceId: string) =>
      request<{ ok: true }>(`/v1/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" }),
    setRemote: (deviceId: string, remote_enabled: boolean) =>
      request<{ id: string; remote_enabled: boolean }>(`/v1/devices/${encodeURIComponent(deviceId)}`, {
        method: "PATCH",
        body: JSON.stringify({ remote_enabled }),
      }),
    claimPair: (code: string) =>
      request<{ id: string; name: string; status: string }>("/v1/pair/claim", {
        method: "POST",
        body: JSON.stringify({ code }),
      }),
    terminalTicket: (deviceId: string) =>
      request<{ ws_url: string; expires_in: number }>(
        `/v1/devices/${encodeURIComponent(deviceId)}/terminal-ticket`,
        { method: "POST" }
      ),
    listDeviceMemory: (deviceId: string) =>
      request<
        Array<{
          id: number;
          device_id: string;
          title: string;
          content: string;
          updated_at: string;
        }>
      >(`/api/devices/${encodeURIComponent(deviceId)}/memory`),
    addDeviceMemory: (deviceId: string, content: string, title = "") =>
      request<{
        id: number;
        device_id: string;
        title: string;
        content: string;
        updated_at: string;
      }>(`/api/devices/${encodeURIComponent(deviceId)}/memory`, {
        method: "POST",
        body: JSON.stringify({ content, title }),
      }),
    updateDeviceMemory: (deviceId: string, entryId: number, content: string, title = "") =>
      request<{
        id: number;
        device_id: string;
        title: string;
        content: string;
        updated_at: string;
      }>(`/api/devices/${encodeURIComponent(deviceId)}/memory/${entryId}`, {
        method: "PATCH",
        body: JSON.stringify({ content, title }),
      }),
    sendMessage: (
      content: string,
      session_id?: string | null,
      device_id?: string | null
    ) =>
      request<{
        session_id: string;
        messages: ChatMessage[];
        telemetry: SessionTelemetry;
      }>("/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          content,
          session_id: session_id || null,
          device_id: device_id || null,
        }),
      }),
    streamMessage: async (
      body: { content: string; session_id: string | null; device_id: string | null; model?: ModelChoice },
      onEvent: (event: TurnEvent) => void,
      signal?: AbortSignal
    ) => {
      await readSse(`${baseUrl}${resolve("/api/chat/message/stream")}`, body, onEvent as (e: unknown) => void, opts, signal);
    },
    streamGuideMessage: async (
      body: { content: string; session_id: string | null; device_id: string | null },
      onEvent: (event: GuideTurnEvent) => void,
      signal?: AbortSignal
    ) => {
      await readSse(`${baseUrl}${resolve("/api/guide/message/stream")}`, body, onEvent as (e: unknown) => void, opts, signal);
    },
    listSessions: (deviceId?: string | null) =>
      request<
        Array<{
          id: string;
          title: string;
          agent_id: string;
          device_id: string | null;
          parent_session_id: string | null;
          status: string;
          pinned?: boolean;
          pinned_at?: string | null;
          updated_at?: string | null;
        }>
      >(
        `/api/chat/sessions${
          deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ""
        }`
      ),
    createSession: (deviceId: string, title = "New chat", agent_id = "main") =>
      request<{
        id: string;
        title: string;
        agent_id: string;
        device_id: string | null;
        parent_session_id: string | null;
        status: string;
      }>("/api/chat/sessions", {
        method: "POST",
        body: JSON.stringify({ title, agent_id, device_id: deviceId }),
      }),
    renameSession: (sessionId: string, title: string) =>
      request<{ id: string; title: string }>(
        `/api/chat/sessions/${encodeURIComponent(sessionId)}`,
        { method: "PATCH", body: JSON.stringify({ title }) }
      ),
    pinSession: (sessionId: string, pinned: boolean) =>
      request<{ id: string; pinned: boolean; pinned_at?: string | null }>(
        `/api/chat/sessions/${encodeURIComponent(sessionId)}/pin`,
        { method: "POST", body: JSON.stringify({ pinned }) }
      ),
    deleteSession: (sessionId: string) =>
      request<{ ok: boolean }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      }),
    listBrains: () =>
      request<
        Array<{
          id: string;
          name: string;
          description: string;
          device_id?: string | null;
          profile?: string;
        }>
      >("/api/brains"),
    createBrain: (name: string, angle = "", deviceId?: string, method = "") =>
      request<{ id: string; name: string; profile: string }>("/api/brains", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: angle,
          method,
          device_id: deviceId ?? null,
        }),
      }),
    deleteBrain: (brainId: string) =>
      request<{ ok: boolean }>(`/api/brains/${encodeURIComponent(brainId)}`, { method: "DELETE" }),
    addBrainEntry: (brainId: string, body: string, title = "") =>
      request<{ id: number }>(`/api/brains/${encodeURIComponent(brainId)}/entries`, {
        method: "POST",
        body: JSON.stringify({ title, body }),
      }),
    deleteBrainEntry: (brainId: string, entryId: number) =>
      request<{ ok: boolean }>(`/api/brains/${encodeURIComponent(brainId)}/entries/${entryId}`, {
        method: "DELETE",
      }),
    listSecrets: () => request<Array<{ name: string }>>("/api/vault"),
    putSecret: (name: string, value: string) =>
      request<{ name: string }>("/api/vault", {
        method: "PUT",
        body: JSON.stringify({ name, value }),
      }),
    deleteSecret: (name: string) =>
      request<{ ok: boolean }>(`/api/vault/${encodeURIComponent(name)}`, { method: "DELETE" }),
    listMessages: (sessionId: string) =>
      request<ChatMessage[]>(
        `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`
      ),
    sessionTelemetry: (sessionId: string) =>
      request<SessionTelemetry>(`/api/telemetry/session/${sessionId}`),
    budget: () =>
      request<{
        llm_mode: string;
        daily_budget_usd: number;
        daily_spent_usd: number;
        remaining_usd: number;
      }>("/api/telemetry/budget"),
    subscription: () =>
      request<{
        plan_id: string;
        plan_name: string;
        status: string;
        price_label: string;
        install: string;
        active: boolean;
        allowances: {
          cloud_credit_usd: number;
          cloud_spent_usd: number;
          cloud_remaining_usd: number;
          tavily_credits: number;
          tavily_credits_spent: number;
          tavily_credits_remaining: number;
          remote_access: string;
          local_processing: string;
        };
        savings: {
          local_turns: number;
          local_tokens: number;
          avoided_usd: number;
          rate_per_million: number;
          basis: string;
        };
        tools: Array<{ id: string; lane: string; name: string; detail: string; included: boolean }>;
      }>("/api/subscription"),
    models: () =>
      request<{
        llm_mode: string;
        cloud: Array<{
          role: string;
          model: string;
          input_per_m: number;
          output_per_m: number;
          context_window: number;
        }>;
        local: { model: string; available: boolean; context_window: number };
      }>("/api/telemetry/models"),
    edgeStats: () => request<JetsonHealth>("/api/edge/health"),
    runCli: (command: string) =>
      request<CliResult>("/api/edge/cli", { method: "POST", body: JSON.stringify({ command }) }),
    listFiles: (path = "") =>
      request<FileListing>(`/api/edge/files?path=${encodeURIComponent(path)}`),
    readFile: (path: string) =>
      request<{ path: string; content: string }>(`/api/edge/files/read?path=${encodeURIComponent(path)}`),
    writeFile: (path: string, content: string) =>
      request<{ path: string; bytes: number }>("/api/edge/files", {
        method: "PUT",
        body: JSON.stringify({ path, content }),
      }),
    editFile: (path: string, old: string, neu: string) =>
      request<{ path: string; replaced: boolean }>("/api/edge/files/edit", {
        method: "POST",
        body: JSON.stringify({ path, old, new: neu }),
      }),
    listThreads: (agentId?: string) =>
      request<{ threads: MissionThread[] }>(
        `/api/missions/threads${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ""}`
      ),
    forkMissions: (tasks: string[], agent_id = "main") =>
      request<{ parent_session_id: string; threads: MissionThread[] }>(
        "/api/missions/fork",
        {
          method: "POST",
          body: JSON.stringify({ agent_id, tasks }),
        }
      ),
  };
}
