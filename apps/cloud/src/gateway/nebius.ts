import { DeviceRow } from "../devices/service";
import { Env, nowSec } from "../env";
import { HttpError } from "../http";
import { balance } from "../subscription/service";
import { costUsd } from "./pricing";

const MAX_OUTPUT_TOKENS = 8192;

type Usage = { prompt_tokens: number; completion_tokens: number };

function chatBody(body: Record<string, unknown>): Record<string, unknown> & { model: string } {
  if (typeof body.model !== "string" || !body.model) throw new HttpError(422, "missing_field", { field: "model" });
  if (!Array.isArray(body.messages)) throw new HttpError(422, "missing_field", { field: "messages" });
  const maxTokens = Math.min(Number(body.max_tokens) || 4096, MAX_OUTPUT_TOKENS);
  return {
    ...body,
    model: body.model,
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };
}

/** Reads a copy of the SSE stream to the end and returns the final usage block. */
async function readUsage(stream: ReadableStream<Uint8Array>): Promise<Usage> {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let usage: Usage = { prompt_tokens: 0, completion_tokens: 0 };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ") || !line.includes('"usage"')) continue;
      try {
        const u = JSON.parse(line.slice(6)).usage;
        if (u) usage = { prompt_tokens: Number(u.prompt_tokens) || 0, completion_tokens: Number(u.completion_tokens) || 0 };
      } catch {
        // partial or non-JSON line
      }
    }
  }
  return usage;
}

async function record(env: Env, device: DeviceRow, model: string, usage: Usage): Promise<void> {
  const cost = await costUsd(model, usage.prompt_tokens, usage.completion_tokens);
  await env.DB.prepare(
    `INSERT INTO usage_ledger (user_id, device_id, kind, model, prompt_tokens, completion_tokens, cost_usd, created_at)
     VALUES (?1, ?2, 'nebius', ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(device.user_id, device.id, model, usage.prompt_tokens, usage.completion_tokens, cost, nowSec())
    .run();
}

export async function proxyNebius(
  env: Env,
  ctx: ExecutionContext,
  device: DeviceRow,
  body: Record<string, unknown>
): Promise<Response> {
  if (!env.NEBIUS_API_KEY) throw new HttpError(503, "gateway_unconfigured");
  const bal = await balance(env, device.user_id);
  if (!bal.active) throw new HttpError(402, "subscription_inactive");
  if (bal.cloud_remaining_usd <= 0) throw new HttpError(402, "cloud_credit_used", { spent: bal.cloud_spent_usd });

  const payload = chatBody(body);
  const upstream = await fetch(`${env.NEBIUS_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.NEBIUS_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.text()).slice(0, 300);
    return new Response(JSON.stringify({ detail: { error: "nebius_error", status: upstream.status, body: detail } }), {
      status: upstream.status >= 500 ? 502 : upstream.status,
      headers: { "content-type": "application/json" },
    });
  }
  const [toBoard, toMeter] = upstream.body.tee();
  ctx.waitUntil(readUsage(toMeter).then((usage) => record(env, device, payload.model, usage)));
  return new Response(toBoard, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}
