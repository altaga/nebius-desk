const LOCK = "nebiusdesk.auth.lock";
const LOCK_MS = 8_000;

let inflight: Promise<boolean> | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForOtherTab() {
  const start = Date.now();
  while (Date.now() - start < LOCK_MS) {
    const held = Number(window.localStorage.getItem(LOCK) || 0);
    if (!held || Date.now() - held > LOCK_MS) return;
    await sleep(150);
  }
}

/** Restore the httpOnly session. Network errors are not a logout. */
export function ensureSession(): Promise<boolean> {
  if (!inflight) inflight = restore().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function restore(): Promise<boolean> {
  await waitForOtherTab();
  window.localStorage.setItem(LOCK, String(Date.now()));
  try {
    const res = await fetch("/api/auth/session", { method: "POST", cache: "no-store" });
    if (res.status === 401) return false;
    return true;
  } catch {
    return true;
  } finally {
    window.localStorage.removeItem(LOCK);
  }
}

export function isUnauthorized(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /\b401\b/.test(text) || /invalid_token|missing_token|invalid_refresh/.test(text);
}
