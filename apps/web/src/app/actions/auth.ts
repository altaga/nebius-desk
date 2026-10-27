"use server";

import { clearAuthCookie, setAuthCookie, setRefreshCookie } from "@/lib/auth-cookie";
import { getDeskApiUrl } from "@/lib/server-env";

export type LoginResult =
  | { ok: true }
  | { ok: false; error: string };

export async function loginAction(
  username: string,
  password: string
): Promise<LoginResult> {
  const base = getDeskApiUrl();
  try {
    const res = await fetch(`${base}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, totp_code: "" }),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: text || `Login failed (${res.status})` };
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    await setAuthCookie(data.access_token, data.expires_in ?? 900);
    if (data.refresh_token) await setRefreshCookie(data.refresh_token);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Login failed",
    };
  }
}

export async function logoutAction(): Promise<void> {
  await clearAuthCookie();
}
