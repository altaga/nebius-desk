# NebiusDesk — Architecture (budget-locked)

## Constraints that drive every choice

| Resource | Cap | Implication |
|---|---|---|
| Nebius Token Factory | **$25 total** | Dummy mode by default. Hard daily spend caps. Prefer local LLM. Prefer Nano/Lightning over Super/Ultra. |
| Jetson | arrives later | API runs locally with mock Ollama until Jetson SSH is available. |
| Hosting | free tiers only | Vercel (web), Expo (mobile), Cloudflare Tunnel (Jetson), SQLite (no Redis/Postgres paid). |

## Locked decisions

1. **Monorepo** — `apps/api` (FastAPI on Jetson), `apps/web` (Next.js = desktop + web demo), `apps/mobile` (Expo = Android + iOS).
2. **No Electron/Tauri in v1** — “Desktop” = Next.js PWA / browser chrome. Saves ~3 days; looks like Claude Web.
3. **SQLite only** — sessions, users, telemetry, shared memory. No Redis until Jetson proves need.
4. **`LLM_MODE=dummy` default** — Nebius + Ollama clients return fixtures. Flip to `hybrid` only for demos with real keys.
5. **Local-first hybrid router** — light intents never leave the edge; medium → Lightning/Nano; high → Super (Ultra only if user forces).
6. **Auth** — username + bcrypt password + TOTP 2FA + short-lived JWT. No OAuth (extra free-tier complexity).
7. **Tavily** — optional free-tier key; mocked when absent (still demo-able for Best Use of Tavily track with env set).
8. **Multi-session** — `asyncio` task map + SQLite locks. LangGraph deferred (heavy dependency, can add Day 3–4 if time).

## Token budget policy (enforced in code)

- Soft daily Nebius cap: **$2.00** (≈ 12 demo days from $25).
- Soft session cap: **50k Nebius tokens**.
- Compression target: ≥ **60%** reduction before cloud call.
- If estimated cost would exceed remaining budget → force local or refuse with clear UI message.

## Data flow

```
Client (Web / Expo)
  → JWT + optional TOTP gate
  → FastAPI orchestrator
      → Intent classifier (local / rules / SLM)
      → light? → Local LLM (Ollama / mock)
      → heavy? → compress context → Nebius Nemotron
      → tools? → Tavily (optional)
  → SSE stream + telemetry (tokens saved)
```

## Deploy map

| Piece | Where |
|---|---|
| `apps/web` | Vercel free |
| `apps/mobile` | Expo Go / EAS free |
| `apps/api` | Jetson (Cloudflare Tunnel or Tailscale) |
| Secrets | `.env` on Jetson only — never in client bundles |
