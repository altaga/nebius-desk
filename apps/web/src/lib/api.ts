"use client";

import { createApiClient } from "@nebius-desk/shared/api";
import { ensureSession } from "@/lib/session";

let boardId: string | null = null;

export function setActiveBoard(id: string | null) {
  boardId = id;
}

/**
 * Browser talks only to same-origin Next BFF (`/api/desk/...`).
 * Upstream URL + auth cookie stay server-side — never NEXT_PUBLIC secrets.
 */
export function api() {
  return createApiClient({
    baseUrl: "/api/desk",
    getToken: () => null,
    getDeviceId: () => boardId,
    recoverAuth: ensureSession,
  });
}

const SESSION_MAX_AGE = 30 * 24 * 3600;

/** Non-secret flag so the browser remembers that a login exists. The tokens stay httpOnly. */
export function markSession(active: boolean) {
  if (typeof window === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  if (active) {
    document.cookie = `nebiusdesk_session=1; path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax${secure}`;
    return;
  }
  document.cookie = "nebiusdesk_session=; path=/; Max-Age=0";
}
