import { NextRequest, NextResponse } from "next/server";
import { getAuthToken, getRefreshToken, writeSessionCookies } from "@/lib/auth-cookie";
import { getDeskApiUrl } from "@/lib/server-env";

type Issued = { access: string; refresh?: string; expires: number };

async function refreshAccess(base: string): Promise<Issued | null> {
  const refresh = await getRefreshToken();
  if (!refresh) return null;
  const res = await fetch(`${base}/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  return { access: data.access_token, refresh: data.refresh_token, expires: data.expires_in ?? 900 };
}

function seal(status: number, body: BodyInit | null, headers: Headers, issued: Issued | null) {
  const out = new NextResponse(body, { status, headers });
  if (issued) writeSessionCookies(out, issued.access, issued.expires, issued.refresh);
  return out;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function proxy(req: NextRequest, path: string[]) {
  const target = `${getDeskApiUrl()}/${path.join("/")}${req.nextUrl.search}`;
  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const token = await getAuthToken();
  if (token) headers.set("authorization", `Bearer ${token}`);

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
    signal: req.signal,
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  try {
    let issued: Issued | null = null;
    let upstream = await fetch(target, init);
    const refreshing = !path.join("/").startsWith("v1/auth/");
    if (upstream.status === 401 && refreshing) {
      issued = await refreshAccess(getDeskApiUrl());
      if (issued) {
        headers.set("authorization", `Bearer ${issued.access}`);
        upstream = await fetch(target, init);
      }
    }
    const ct = upstream.headers.get("content-type") ?? "";
    if (ct.startsWith("text/event-stream") && upstream.body) {
      return seal(upstream.status, upstream.body, new Headers({
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
      }), issued);
    }
    const outHeaders = new Headers();
    if (ct) outHeaders.set("content-type", ct);
    return seal(upstream.status, await upstream.arrayBuffer(), outHeaders, issued);
  } catch (err) {
    return NextResponse.json(
      { detail: err instanceof Error ? err.message : "Upstream API unreachable" },
      { status: 502 }
    );
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
