import { LOCAL_BOARD_TARGETS } from "./targets";

export type BoardWifi = {
  ssid: string | null;
  connected: boolean;
  dummy: boolean;
  detail?: string;
};

export type SetupStatus = {
  ok?: boolean;
  name: string | null;
  factory_id?: string | null;
  hostname: string;
  board_emu: boolean;
  paired: boolean;
  code: string | null;
  expires_in?: number | null;
  pair_status?: string | null;
  has_password: boolean;
  wifi: BoardWifi | null;
  error?: string | null;
};

export type SetupInput = {
  name: string;
  password: string;
  wifi_ssid: string;
  wifi_password: string;
};

const TIMEOUT_MS = 2500;

export function httpsBlocksLocalProbe(): boolean {
  if (typeof window === "undefined") return false;
  const { protocol, hostname } = window.location;
  if (protocol !== "https:") return false;
  return hostname !== "localhost" && hostname !== "127.0.0.1";
}

async function readSetup(base: string, init: RequestInit): Promise<SetupStatus> {
  const res = await fetch(`${base}/setup`, { ...init, mode: "cors" });
  const body = (await res.json().catch(() => ({}))) as SetupStatus & { detail?: { error?: string } | string };
  if (!res.ok) {
    const detail = body.detail;
    const error = typeof detail === "object" && detail ? detail.error : typeof detail === "string" ? detail : `HTTP ${res.status}`;
    throw new Error(error || `HTTP ${res.status}`);
  }
  return body;
}

export async function probeBoard(base: string): Promise<{ base: string; status: SetupStatus } | null> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const status = await readSetup(base, { method: "GET", signal: ctrl.signal });
    return { base, status };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export type FoundBoard = { base: string; status: SetupStatus };

export function boardHost(base: string): string {
  return base.replace(/^https?:\/\//, "");
}

export function boardLabel(row: FoundBoard): string {
  return row.status.name || row.status.hostname || boardHost(row.base);
}

export async function findLocalBoards(): Promise<FoundBoard[]> {
  const found = await Promise.all(LOCAL_BOARD_TARGETS.map((base) => probeBoard(base)));
  return found.filter((row): row is FoundBoard => row != null && !row.status.paired);
}

export async function configureBoard(base: string, input: SetupInput): Promise<SetupStatus> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 20_000);
  try {
    return await readSetup(base, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } finally {
    window.clearTimeout(timer);
  }
}
