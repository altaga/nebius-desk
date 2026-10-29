import { requireUser } from "../auth/guard";
import { Env } from "../env";
import { HttpError, readJson, str } from "../http";
import { guideFeatures } from "../ops/features";
import { recordOpsEvent } from "../ops/service";
import { rateLimit } from "../ratelimit";
import { Router } from "../router";
import { sanitizeDeskHints } from "./context";
import { streamGuideTurn } from "./service";

function sse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Millie runs in the cloud (Nano). Board is context only — no relay hop. */
export function guideRoutes(router: Router<Env>): void {
  router.post("/v1/guide/message/stream", async (req, env) => {
    const user = await requireUser(req, env);
    await rateLimit(env.DB, `guide:${user.id}`, 40, 60);
    const body = await readJson(req, 20_000);
    const content = str(body, "content", { max: 4000 });
    const deviceId = str(body, "device_id", { max: 80 });
    const sessionRaw = body.session_id;
    const sessionId = typeof sessionRaw === "string" && sessionRaw.trim() ? sessionRaw.trim() : null;
    const desk = sanitizeDeskHints(body.desk);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        const push = (event: unknown) => controller.enqueue(enc.encode(sse(event)));
        try {
          for await (const event of streamGuideTurn(env, user.id, {
            content,
            session_id: sessionId,
            device_id: deviceId,
            desk,
          })) {
            push(event);
          }
        } catch (err) {
          const detail =
            err instanceof HttpError ? err.code : err instanceof Error ? err.message : "guide_failed";
          await recordOpsEvent(env, {
            kind: "guide",
            status: "error",
            error_code: detail,
            user_id: user.id,
            username: user.username,
            device_id: deviceId,
            session_id: sessionId,
            features: guideFeatures(content, "", []),
            input_text: content,
            note: "guide_route_catch",
          });
          push({ type: "error", detail });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
      },
    });
  });
}
