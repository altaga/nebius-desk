import { requireDevice } from "../devices/service";
import { Env } from "../env";
import { json, readJson } from "../http";
import { rateLimit } from "../ratelimit";
import { Router } from "../router";
import { balance } from "../subscription/service";
import { proxyNebius } from "./nebius";
import { tavilySearch } from "./tavily";

/** Boards call these with their device token. Provider keys never leave the cloud. */
export function gatewayRoutes(router: Router<Env>): void {
  router.post("/v1/gateway/nebius/chat/completions", async (req, env, ctx) => {
    const device = await requireDevice(req, env);
    await rateLimit(env.DB, `gw-nebius:${device.id}`, 120, 60);
    return proxyNebius(env, ctx, device, await readJson(req, 2_000_000));
  });

  router.post("/v1/gateway/tavily/search", async (req, env) => {
    const device = await requireDevice(req, env);
    await rateLimit(env.DB, `gw-tavily:${device.id}`, 30, 60);
    return json(await tavilySearch(env, device, await readJson(req)));
  });

  router.get("/v1/gateway/balance", async (req, env) => {
    const device = await requireDevice(req, env);
    return json(await balance(env, device.user_id));
  });
}
