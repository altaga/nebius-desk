export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(code);
  }
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ detail: { error: err.code, ...err.extra } }, err.status);
  }
  console.error("unhandled", err instanceof Error ? err.stack : String(err));
  return json({ detail: { error: "internal" } }, 500);
}

export async function readJson(req: Request, maxBytes = 64_000): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "body_too_large");
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }
  throw new HttpError(400, "invalid_json");
}

export function str(body: Record<string, unknown>, key: string, opts: { min?: number; max: number; optional?: boolean }): string {
  const value = body[key];
  if (value == null || value === "") {
    if (opts.optional) return "";
    throw new HttpError(422, "missing_field", { field: key });
  }
  if (typeof value !== "string") throw new HttpError(422, "invalid_field", { field: key });
  const clean = value.trim();
  if (clean.length < (opts.min ?? 1) || clean.length > opts.max) {
    throw new HttpError(422, "invalid_length", { field: key });
  }
  return clean;
}

export function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") || "unknown";
}
