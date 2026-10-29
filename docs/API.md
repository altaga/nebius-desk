# Nebius Desk API — canonical contract

One language for humans, the webpage, and AI agents.

## Lanes

| Lane | Prefix | Auth | Who |
|------|--------|------|-----|
| **control** | `/v1/...` | User JWT (via BFF cookies) | Web / Millie / admin |
| **gateway** | `/v1/gateway/...` | Device token (+ optional HMAC) | Board only — Nebius/Tavily keys stay here |
| **board** | `/v1/devices/{id}/api/...` | User JWT + ownership | Web → relay → Jetson `/api/...` |
| **ops** | `/v1/ops/...` | User JWT or device token | Telemetry / debug |

Browser never talks to the Worker with secrets in JS. Always `https://app…/api/desk/...` (Next BFF).

## Response shape

- Every response includes header `X-Request-Id` (also usable as `trace_id`).
- Errors (new):

```json
{
  "ok": false,
  "error": { "code": "board_offline", "message": "…", "field": null, "retryable": true },
  "meta": { "request_id": "req_…", "lane": "board" },
  "detail": { "error": "board_offline" }
}
```

`detail` remains for one release of compatibility.

## CORS

Allowlist only: production Vercel app, `nebius-desk*.vercel.app` previews, `localhost` / `127.0.0.1`.  
No `*`. Credentials allowed when origin matches.

## Gateway HMAC (optional → required)

Headers: `X-Desk-Timestamp`, `X-Desk-Nonce`, `X-Desk-Signature`  
Payload: `METHOD\npath?query\ntimestamp\nnonce\nsha256_hex(body)`  
Key: device bearer token.  
Enable with Worker var `GATEWAY_HMAC=required`. Until then signatures are verified if present.

## Ops / traces (debug)

| Endpoint | Who | What |
|----------|-----|------|
| `GET /v1/ops/events` | Admin | Full timeline (bootstrap I/O only) |
| `GET /v1/ops/traces/:trace_id` | Admin | One request’s guide + tools |
| `GET /v1/ops/me/failures` | User | Failures only — no prompts/stdout |
| `POST /v1/ops/ingest` | Device | Board chat/tool events |
| `POST /v1/ops/guide-apply` | User | Millie UI apply/reject (no spoken text) |

Privacy: non-admin rows never store `input_text` / `output_text`. Commands stripped from features for users.

Kinds: `guide` · `chat` · `tool` · `gateway` · `relay` · `tavily`  
Phases: `plan` · `apply` · `result` · `done`

## Cheat sheet

| Want | Call |
|------|------|
| Login / me | `/v1/auth/*` |
| Fleet | `GET /v1/devices` |
| Millie | `POST /v1/guide/message/stream` |
| Chat on board | `/v1/devices/{id}/api/chat/message/stream` |
| Files | `/v1/devices/{id}/api/edge/files` |
| Browser (Playwright) | `/v1/devices/{id}/api/browser/...` |
| Nebius (board only) | `/v1/gateway/nebius/chat/completions` |

## Safe install (board chat tools)

Model fences:

```search
official Node.js install nvm
```

```install
tool: node
```

`install` re-searches via Tavily, keeps only trusted hosts (nodejs.org, python.org, docs.expo.dev, nvm-sh/nvm, npmjs.com, pypi.org, …), refuses typosquats / `curl|bash` from unknown domains, then runs a curated recipe after human approval. See `apps/api/app/chat/safe_install.py`.
