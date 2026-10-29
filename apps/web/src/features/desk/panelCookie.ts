/** Right telemetry panel open/closed — cookie only (nav + live preview are not persisted). */

export const PANEL_COOKIE = "nebiusdesk_panel_open";
const MAX_AGE = 365 * 24 * 3600;

export function readPanelOpenCookie(): boolean {
  if (typeof document === "undefined") return false;
  const match = document.cookie.match(/(?:^|; )nebiusdesk_panel_open=([^;]*)/);
  if (!match) return false;
  return match[1] === "1";
}

export function writePanelOpenCookie(open: boolean) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${PANEL_COOKIE}=${open ? "1" : "0"}; path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`;
}
