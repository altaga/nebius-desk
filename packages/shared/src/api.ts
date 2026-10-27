import type { ChatMessage, MissionThread, SessionTelemetry } from "./index";
import { DEFAULT_API_URL } from "./index";

export type ApiClientOptions = {
  baseUrl?: string;
  getToken?: () => string | null;
  getDeviceId?: () => string | null;
};

export function createApiClient(opts: ApiClientOptions = {}) {
  const baseUrl = (opts.baseUrl || DEFAULT_API_URL).replace(/\/$/, "");

  function resolve(path: string): string {
    if (!path.startsWith("/api/")) return path;
    const id = opts.getDeviceId?.();
    if (!id) throw new Error("No board selected");
    return `/v1/devices/${encodeURIComponent(id)}${path}`;
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers || {});
    if (!headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json");
    }
    const token = opts.getToken?.();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const res = await fetch(`${baseUrl}${resolve(path)}`, { ...init, headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
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
        }>
      >("/v1/devices"),
    renameBoard: async (deviceId: string, name: string) => {
      // Cloud only for the UI path — board sync is best-effort and must not block.
      const renamed = await request<{ id: string; name: string; agent_name?: string }>(
        `/v1/devices/${encodeURIComponent(deviceId)}`,
        { method: "PATCH", body: JSON.stringify({ name }) }
      );
      void request(`/v1/devices/${encodeURIComponent(deviceId)}/api/devices/${encodeURIComponent(deviceId)}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }).catch(() => undefined);
      return { ...renamed, agent_name: renamed.agent_name || renamed.name };
    },
    removeBoard: (deviceId: string) =>
      request<{ ok: true }>(`/v1/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" }),
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
    listSessions: (deviceId?: string | null) =>
      request<
        Array<{
          id: string;
          title: string;
          agent_id: string;
          device_id: string | null;
          parent_session_id: string | null;
          status: string;
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
    edgeStats: () =>
      request<{
        host: string;
        temp_c: number | null;
        cpu_pct: number | null;
        gpu_util_pct: number | null;
        ram_used_mb: number | null;
        ram_total_mb: number | null;
        disk_used_gb: number | null;
        disk_total_gb: number | null;
        disk_used_pct: number | null;
        jetson_online: boolean;
      }>("/api/edge/health"),
    runCli: (command: string) =>
      request<{
        command: string;
        cwd: string;
        exit_code: number | null;
        stdout: string;
        stderr: string;
        timed_out: boolean;
      }>("/api/edge/cli", { method: "POST", body: JSON.stringify({ command }) }),
    listFiles: (path = "") =>
      request<{
        root: string;
        path: string;
        entries: Array<{ name: string; kind: string; size: number | null }>;
      }>(`/api/edge/files?path=${encodeURIComponent(path)}`),
    readFile: (path: string) =>
      request<{ path: string; content: string }>(`/api/edge/files/read?path=${encodeURIComponent(path)}`),
    writeFile: (path: string, content: string) =>
      request<{ path: string; bytes: number }>("/api/edge/files", {
        method: "PUT",
        body: JSON.stringify({ path, content }),
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
