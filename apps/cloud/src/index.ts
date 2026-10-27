import { authRoutes } from "./auth/routes";
import { deviceRoutes } from "./devices/routes";
import { Env } from "./env";
import { gatewayRoutes } from "./gateway/routes";
import { json } from "./http";
import { pairingRoutes } from "./pairing/routes";
import { DeviceRelay } from "./relay/DeviceRelay";
import { relayRoutes } from "./relay/routes";
import { Router } from "./router";
import { subscriptionRoutes } from "./subscription/routes";

export { DeviceRelay };

const router = new Router<Env>();
authRoutes(router);
deviceRoutes(router);
pairingRoutes(router);
subscriptionRoutes(router);
gatewayRoutes(router);
relayRoutes(router);

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

function withCors(res: Response): Response {
  if (res.status === 101 || res.webSocket) return res;
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(CORS)) headers.set(key, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method === "GET" && pathname === "/health") {
      return withCors(json({ ok: true, app: "NebiusDesk", service: "cloud" }));
    }
    return withCors(await router.handle(req, env, ctx));
  },
};
