import { NextResponse } from "next/server";
import { getAuthToken, getRefreshToken, writeSessionCookies } from "@/lib/auth-cookie";
import { getDeskApiUrl } from "@/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Tokens = { access_token: string; refresh_token?: string; expires_in?: number };

/** Renew the httpOnly session from the refresh cookie. One call per page load. */
export async function POST() {
  const base = getDeskApiUrl();
  const access = await getAuthToken();
  if (access) {
    const me = await fetch(`${base}/v1/auth/me`, {
      headers: { authorization: `Bearer ${access}` },
      cache: "no-store",
    });
    if (me.ok) return NextResponse.json({ ok: true });
  }

  const refresh = await getRefreshToken();
  if (!refresh) return NextResponse.json({ ok: false }, { status: 401 });

  const renewed = await fetch(`${base}/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
    cache: "no-store",
  });
  if (!renewed.ok) return NextResponse.json({ ok: false }, { status: 401 });

  const data = (await renewed.json()) as Tokens;
  const out = NextResponse.json({ ok: true });
  writeSessionCookies(out, data.access_token, data.expires_in ?? 900, data.refresh_token);
  return out;
}
