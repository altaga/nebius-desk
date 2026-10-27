const OPEN_KEY = "nebiusdesk.millie.open";
const POS_KEY = "nebiusdesk.millie.pos";
const SESSION_KEY = "nebiusdesk.millie.session";

export type MilliePos = { x: number; y: number };

export function readMillieOpen(): boolean {
  if (typeof window === "undefined") return true;
  const raw = localStorage.getItem(OPEN_KEY);
  if (raw == null) return true;
  return raw !== "0" && raw !== "false";
}

export function writeMillieOpen(open: boolean) {
  localStorage.setItem(OPEN_KEY, open ? "1" : "0");
}

export function readMilliePos(): MilliePos | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MilliePos;
    if (typeof parsed.x === "number" && typeof parsed.y === "number") return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export function writeMilliePos(pos: MilliePos) {
  localStorage.setItem(POS_KEY, JSON.stringify(pos));
}

export function readGuideSession(deviceId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    return map[deviceId] ?? null;
  } catch {
    return null;
  }
}

export function writeGuideSession(deviceId: string, sessionId: string) {
  let map: Record<string, string> = {};
  try {
    map = JSON.parse(localStorage.getItem(SESSION_KEY) || "{}") as Record<string, string>;
  } catch {
    map = {};
  }
  map[deviceId] = sessionId;
  localStorage.setItem(SESSION_KEY, JSON.stringify(map));
}

/** Docked home: bottom-right of the visible viewport. */
export function homeMilliePos(width = 260, height = 340, edge = 8): MilliePos {
  if (typeof window === "undefined") return { x: 24, y: 24 };
  const vw = window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  return {
    x: Math.max(edge, vw - width - edge),
    y: Math.max(edge, vh - height - edge),
  };
}

export function defaultMilliePos(width = 260, height = 340, edge = 8): MilliePos {
  return homeMilliePos(width, height, edge);
}

/** Keep the whole overlay inside the visible viewport (incl. mobile browser chrome). */
export function clampMilliePos(pos: MilliePos, width: number, height: number, edge = 8): MilliePos {
  const vw = window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const maxX = Math.max(edge, vw - width - edge);
  const maxY = Math.max(edge, vh - height - edge);
  return {
    x: Math.min(Math.max(edge, pos.x), maxX),
    y: Math.min(Math.max(edge, pos.y), maxY),
  };
}
