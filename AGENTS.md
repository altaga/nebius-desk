# AGENTS.md

Orientation for AI coding agents working in **Nebius Desk**.
Humans should read [README.md](./README.md); this file is the machine-facing contract.

## What this repo is

A monorepo for a Claude-style operator desk that runs **on an NVIDIA Jetson** (or a
Docker `board-emu`). Chat drives shell / files / browser / jobs on the board. A hybrid
router keeps light work local (Ollama) and sends hard work to Nebius Token Factory.
Cloudflare is the account plane (auth, pairing, gateway keys, relay).

[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) and [docs/API.md](./docs/API.md) hold the
canonical detail. This file is the short contract — read it before touching cross-app
behavior, and keep both docs current when architecture changes.

## Layout

| Path | What | Language |
|---|---|---|
| `apps/api` | FastAPI on the board. Entry `app/main.py`. | Python 3.11 |
| `apps/web` | Next.js 15 desk UI (the product surface) + BFF at `/api/desk/*`. | TypeScript |
| `apps/cloud` | Cloudflare Worker + D1 + Durable Object relay. | TypeScript |
| `apps/board-agent` | Outbound-WS agent on the board. | Python |
| `apps/board-emu` | Docker fake boards (Natasha / Nova / Orin). | Docker |
| `apps/mobile` | Expo 52 thin client. | TypeScript |
| `packages/shared` | Shared API client + types. | TypeScript |
| `docs/` | `ARCHITECTURE.md` · `API.md` · `screenshots/`. Nothing else. | Markdown |
| `scripts/`, `Skills/`, `.cf/` | Local-only operator tooling — **gitignored on disk**. | Python / shell |

`apps/api/app/` modules: `auth` `router` `chat` `sessions` `telemetry` `tools` `vault`
`brains` `guide` `devices` `browser` `jobs` `ops` `edge` (`files` `cli` `services`
`preview` `identity` `monitor`) `setup` `subscription`.
`apps/cloud/src/` modules: `auth` `devices` `gateway` `guide` `ops` `pairing` `relay`
`subscription`.

Where the hot spots are:

- Desk tool fences — `apps/api/app/chat/desk_tools.py`
- Approval gates — `apps/api/app/chat/approval.py`, `apps/api/app/chat/guardrails.py`
- Vetted installs — `apps/api/app/chat/safe_install.py`
- Tier selection / compression — `apps/api/app/router/hybrid.py` (+ `intent.py`, `selector.py`, `context.py`)
- Secrets + metering (keys never leave) — `apps/cloud/src/gateway/`
- Relay — `apps/cloud/src/relay/DeviceRelay.ts`
- UI root — `apps/web/src/features/desk/DeskShell.tsx`

## Commands

Root `package.json` wrappers:

```bash
npm run install:api      # pip install -r apps/api/requirements.txt
npm run install:web      # npm install in apps/web
npm run install:mobile   # npm install in apps/mobile
npm run dev:api          # uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
npm run dev:web          # next dev
npm run dev:mobile       # expo start
```

API tests (from `apps/api`):

```bash
python -m pytest tests -q
```

Cloud (from `apps/cloud`):

```bash
npx wrangler dev
npx wrangler deploy
npx wrangler d1 migrations apply nebius-desk --remote
```

## Invariants — do not break these

- **Secrets never leave the Worker.** Nebius/Tavily keys live in `apps/cloud`
  (`gateway/`). The board holds only a `device_token`; never print secret values.
  `secrets.env`, `.env`, `.env.local`, `.dev.vars` stay gitignored — only `*.env.example`
  templates are tracked.
- **Board dials out, never in.** Remote traffic uses the outbound WebSocket relay
  (`/v1/agent/connect`). Do not add inbound ports to the board.
- **Every response carries `X-Request-Id`** (= `trace_id`). Errors use the
  `{ok, error:{code,message,field,retryable}, meta}` shape (see `docs/API.md`).
- **`LLM_MODE` values are `hybrid` | `cloud_only` | `local_only`.** `hybrid` is the
  code default. “dummy” is not a router mode.
- **Approval gates stay on.** `patch`, destructive `run`, and `deploy` require human
  approval. `install` re-searches and only runs vetted recipes from trusted hosts
  (`apps/api/app/chat/safe_install.py`).
- **Money has one source of truth.** Plan `desk` = **$3** Nebius credit (D1
  `usage_ledger`) + soft **$2/day** local. No Stripe, no SKUs. Don't reintroduce a
  `$25` contest budget into code or docs.
- **One writer per surface.** The board owns local disk/SQLite; Cloudflare D1 owns
  accounts/fleet/ledger. Don't mirror what you can fetch.

## Conventions

- **Language:** code, comments, UI copy, and docs are **English**. Commit messages too.
  (Conversation with the operator may be Spanish.)
- **Naming.** The human-facing product name is **Nebius Desk** (two words, title case)
  everywhere it is shown to a person. Machine identifiers stay lowercase-kebab
  `nebius-desk`: npm scope `@nebius-desk/*`, the D1 database `nebius-desk`, the config dir
  `~/.config/nebius-desk`, the Expo slug `nebius-desk`. Legacy client keys keep their
  `nebiusdesk_` / `nebiusdesk.` prefix (auth cookies, `localStorage`, mobile secure store)
  and the SQLite file stays `nebiusdesk.db` — do **not** churn these, they carry live
  sessions and data. Boards: `Kratos` = the USB Jetson, `Natasha` / `Nova` / `Orin` =
  Docker `board-emu` boards, `Millie` = the on-screen guide only.
- **Docs are split by audience:** `README.md` = humans, `AGENTS.md` = agents.
- **Mermaid diagrams** must be vertical or multi-row (`flowchart TB`). Avoid wide `LR`.
  In docs, images use `<img width="…">` HTML tags, never bare Markdown `![](…)`.
- **Dependencies:** pin exact versions (no `^`/`~`) and respect the operator's minimum
  age policy for new releases.
- **`.gitignore` is folder-first.** Every rule that targets a directory ends in `/`
  (`logs/`, `dist/`, `.next/`, `.cache/`, `scripts/`). File rules and globs stay bare
  (`.env`, `*.log`, `*.db`, `*.tgz`). Add new directories as `foo/`, not `foo`.
- **Local-only, gitignored:** `scripts/` (operator tooling, ~37 files), `Skills/`
  (local skills, e.g. `ssh-millie-jetson`), `.cf/` (Cloudflare CLI state), `apps/api/data/`,
  and scratch files (`_tmp*`, `_tmp_*/`). Don't commit them, don't read them into docs.
- Prefer local tooling (`npx`, project venv) over global installs.

## Git state — read before you touch the index

The history was rewritten with `git-filter-repo` to purge `scripts/`; **there is no
remote**, and every commit hash changed (HEAD moved from `3445e8f` to `0cbd27e`).

The working tree is far ahead of `HEAD`:

- ~76 **untracked** paths hold real code (`features/pairing`, `machine/BrowserPane`,
  `machine/JobsPane`, `machine/ServicesPane`, `app/{browser,jobs,ops,setup}`,
  `cloud/src/{guide,ops}`, D1 migrations `0003`–`0005`, the e2e suites, `docs/screenshots/`).
- ~86 tracked files are modified and 4 are deleted pending commit (`.env.example`,
  `docs/CLOUDFLARE.md`, `docs/CONNECTIONS.md`, `docs/FOLDER_MAP.md`).

Never run `git clean -fd`, `git checkout .`, `git stash`, `git reset --hard`, or another
history rewrite without inspecting `git status` first — untracked work is not recoverable
from git.

## Known rough edges (don't be surprised)

- `apps/web/src/features/missions/MissionControl.tsx` and
  `features/artifacts/ArtifactsPanel.tsx` exist but are **not mounted** in `DeskShell`.
- Tavily returns mock results when no key is set.
- TOTP is implemented but off by default (`AUTH_REQUIRE_TOTP=false`).
- `apps/web` contains its own `src/shared/` client alongside `packages/shared/`.
