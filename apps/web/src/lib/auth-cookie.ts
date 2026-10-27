import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

export const AUTH_COOKIE = "nebiusdesk_token";
export const REFRESH_COOKIE = "nebiusdesk_refresh";
export const REFRESH_MAX_AGE = 30 * 24 * 3600;

function cookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}

export async function setAuthCookie(token: string, maxAgeSec: number) {
  const jar = await cookies();
  jar.set(AUTH_COOKIE, token, cookieOptions(maxAgeSec));
}

export async function setRefreshCookie(token: string) {
  const jar = await cookies();
  jar.set(REFRESH_COOKIE, token, cookieOptions(REFRESH_MAX_AGE));
}

export function writeSessionCookies(
  res: NextResponse,
  access: string,
  accessMaxAge: number,
  refresh?: string
) {
  res.cookies.set(AUTH_COOKIE, access, cookieOptions(accessMaxAge));
  if (refresh) res.cookies.set(REFRESH_COOKIE, refresh, cookieOptions(REFRESH_MAX_AGE));
}

export async function clearAuthCookie() {
  const jar = await cookies();
  jar.delete(AUTH_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

export async function getRefreshToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(REFRESH_COOKIE)?.value ?? null;
}

export async function getAuthToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(AUTH_COOKIE)?.value ?? null;
}
