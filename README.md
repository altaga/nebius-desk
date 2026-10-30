<p align="center">
  <img src="./apps/web/public/brand/nebius-desk-logo-4x3-fhd.png" width="320" alt="Nebius Desk" />
</p>

<h1 align="center">Nebius Desk</h1>

<p align="center">
  A Claude-style operator desk whose brain lives on <strong>your</strong> NVIDIA Jetson.
  Chat drives the shell, files, browser, and background jobs on the box — light work
  stays local, hard work goes to Nebius.
</p>

<img src="./docs/screenshots/landing.png" width="900" alt="Nebius Desk landing page" />

## Signing in

Operators sign in once and land straight on their desk. The desk remembers your boards,
your last chat, and where you left the machine — no configuration.

<img src="./docs/screenshots/login.png" width="780" alt="Signing in to Nebius Desk" />

## The desk

One surface for the whole machine: a chat on the left, live board context on the right,
and the board itself — health, shell, files, services, agents — one click away. The model
sees real observations from the box, not a mock.

<img src="./docs/screenshots/desk.png" width="1000" alt="The Nebius Desk operator console with a live conversation" />

## Millie, the desk guide

Millie is the little guide living in the corner of the desk. She is not a second chatbot:
she knows the product, answers in your language, and can actually drive the screen for you.
Ask her to open the terminal, find the secrets, or switch boards — she navigates there
herself and points at the exact control she means. Drag her anywhere; she remembers where
you left her.

<img src="./docs/screenshots/millie.png" width="860" alt="Millie docked on the desk with her intro line" />

New here? Type `/tour` — or just say *introduce yourself* — and she walks you through the desk step
by step (boards, chat, model tiers, the machine shell, secrets, credits), lighting up each
control as she talks. `/autotour` does the same hands-free.

<img src="./docs/screenshots/millie-tour.png" width="920" alt="Millie running the guided tour, spotlighting the board list" />

She always runs on the cheapest cloud tier (`nano`) and can only ever touch an allowlisted
set of UI actions: open a screen, highlight a control, react. She never runs shell, never
writes files, and never sends chat on your behalf.

## The one idea

Most chat apps pick one model and bill every token. Nebius Desk treats the Jetson as a
**ladder**: a small local model answers free when it can, picks the cheapest cloud tier
when it can't, and **shrinks the prompt** before paid tokens ever leave the board. The
GPU you already own becomes the cost control plane.

```mermaid
flowchart LR
  subgraph Input["On the board"]
    direction TB
    Msg["Your message"] --> Decide["Board router<br/>rules + local selector"]
  end
  subgraph Paths["Cheapest capable path"]
    direction TB
    Local["Local Ollama<br/>Qwen on Jetson"]
    Cloud["Cloud route<br/>compress + Nebius"]
  end
  subgraph Finish["Result"]
    direction TB
    Stream["Answer + savings"]
  end

  Decide --> Local
  Decide --> Cloud
  Local --> Stream
  Cloud --> Stream
```

Leave it on `Auto` and the router decides per turn — or pin a tier by hand from the model
picker in the composer:

<img src="./docs/screenshots/model-picker.png" width="760" alt="Choosing a routing tier from the model picker" />

## How Routing And Tavily Actually Work

The desk does not blindly send every turn to one big cloud model. Routing is a staged
decision that starts on the board, uses cheap rules first, and only spends cloud tokens
when the request justifies it.

```mermaid
flowchart LR
  subgraph Pick["Pick the route"]
    direction TB
    Msg["User message"] --> Manual["Manual pick or Auto"]
    Manual --> Rules["Rules"]
    Rules --> Selector["Borderline?<br/>ask local Qwen"]
  end
  subgraph Route["Apply board constraints"]
    direction TB
    Override["Mode + board checks<br/>hybrid / local_only / cloud_only / board-emu"]
    Local["Local<br/>Ollama"]
    Cloud["Cloud<br/>Nebius tier"]
  end
  subgraph Execute["Run the turn"]
    direction TB
    Tools["Optional tools"]
    Answer["Final answer + route telemetry"]
  end

  Selector --> Override
  Override --> Local
  Override --> Cloud
  Local --> Tools
  Cloud --> Tools
  Tools --> Answer
```

In plain English:

- `manual` wins first: if you pin a tier in the composer, the router respects it.
- `rules` handle the cheap obvious cases first:
  - greetings, tiny rewrites, typos, translation, short formatting -> `local`
  - normal questions and coding help -> `fast`
  - architecture, hard debugging, long plans, expensive-to-be-wrong tasks -> `heavy`
- `jetson selector` only wakes up for borderline requests. It asks the local Qwen model
  for the cheapest tier that can still answer well.
- `overrides` then apply product constraints:
  - on `board-emu`, `Auto` and `local` are remapped to cloud `nano`
  - `local_only` never opens Nebius
  - `cloud_only` bumps local requests to cloud
- `compression` happens only on cloud routes: older history is shrunk on the Jetson before
  paid tokens leave the board.
- `budget checks` run before Nebius: inactive subscription or exhausted cloud credit falls
  back to local when possible.

### Tool Selection

The model does not call internal functions directly. It asks for work by emitting fenced
blocks such as `run`, `read`, `list`, `browse`, `search`, or `job`, and the desk executes
those blocks on the board after applying approval and safety rules.

```mermaid
flowchart LR
  subgraph Ask["Ask"]
    direction TB
    User["User asks for work"] --> Model["Model reply"]
  end
  subgraph Act["Act"]
    direction TB
    Parse["Parse fenced tools"]
    Guard["Approval + safety gates"]
    Exec["Run on the board"]
  end
  subgraph Return["Return"]
    direction TB
    Results["Tool results"]
    Final["Final answer"]
  end

  Model --> Parse
  Parse --> Guard
  Guard --> Exec
  Exec --> Results
  Results --> Final
```

That is how the agent decides which tool to use:

- shell or machine inspection -> `run`, `health`, `probe`, `verify`, `checks`
- filesystem work -> `read`, `list`, `patch`
- browser work -> `browse`, `record`, `render`
- background work that should survive the tab -> `job`
- web research or trusted install lookups -> `search`

### Tavily: where it is used

Tavily is the desk's web-search tool, not the main reasoning model. It is called when the
agent needs fresh web results, and it is especially important in two paths:

1. `search` fences
2. `install` fences, where the desk re-searches the package/tool before running anything

```mermaid
flowchart LR
  subgraph Trigger["When Tavily is used"]
    direction TB
    Need["Need fresh web context"]
    Search["search fence"]
    Install["install fence"]
  end
  subgraph Fetch["Gateway path"]
    direction TB
    Gateway["Cloudflare gateway"]
    Tavily["Tavily<br/>cap + breaker"]
    Results["Results to the board"]
  end
  subgraph Use["How results are used"]
    direction TB
    Model["Model continues"]
    Filter["Trusted-host filter<br/>for installs"]
  end

  Need --> Search
  Need --> Install
  Search --> Gateway
  Install --> Gateway
  Gateway --> Tavily
  Tavily --> Results
  Results --> Model
  Results --> Filter
  Filter --> Model
```

Important Tavily behavior:

- paired boards usually call Tavily through the Cloudflare gateway, so the key never leaves
  the Worker
- without a configured key, Tavily returns a mock result instead of breaking the flow
- searches are capped with credits; hitting the cap returns a clear error
- repeated upstream failures open a circuit breaker and fall back to a soft mock
- `install` is stricter than `search`: it uses Tavily results to keep only trusted hosts
  such as official registries and vendor docs, and refuses suspicious install paths

So the split is:

- **Nebius** answers and reasons
- **Tavily** fetches fresh web context
- **the Jetson** decides when either one is worth using

## Why a physical Jetson is the product

- **Split-plane inference.** The edge answers, routes, and compresses; the cloud is
  rented only after the edge admits the request. Cost is a routing policy on silicon you own.
- **Data locality.** Desk tools run next to the board. The model sees observations, not a
  remote filesystem mount.
- **No inbound ports.** The board dials **out** to a Cloudflare relay, so it works behind
  home/lab NAT. Pairing is a short claim code, not an exposed `:8000`.
- **Real machine context.** Health, GPU, RAM, disk, per-board memory, and shell tools all
  come from the actual device — not a mock.

## What the agent can do on the board

The model asks for actions with fenced blocks; each one runs on the board (approval-gated
where it matters). The tool set lives in [`desk_tools.py`](./apps/api/app/chat/desk_tools.py).

| Fence | What it does | Approval |
|---|---|---|
| `run` | Shell command on the board (vault secrets injected, never printed) | destructive only |
| `read` / `list` | Read a file / list a directory under the desk root | — |
| `patch` | Scoped single-match code edit | **always** |
| `search` | Tavily web search (mock without a key) | — |
| `work` | Rewrite durable `.desk/WORK.md` state | — |
| `probe` | Me-vs-service network probe | — |
| `health` | GPU / RAM / temp / disk snapshot | — |
| `verify` | Run `.desk/verify.json` harness | — |
| `deploy` | Recipe → verify → rollback on failure | **always** |
| `checks` | Lint / type / vuln gate | — |
| `bakeoff` | Provider latency comparison report | — |
| `browse` | Playwright on the board (screenshots) | — |
| `record` | Scripted demo video of a page | — |
| `render` | HTML/SVG → PNG/JPEG image | — |
| `job` | Durable background job that survives the chat | — |
| `install` | Searches official sources, trusts only vetted hosts, then installs | safe |

**Safe install** is the headline safety feature: `install` re-searches with Tavily, keeps
only trusted hosts (nodejs.org, python.org, nvm-sh/nvm, npmjs.com, pypi.org, …), refuses
typosquats and `curl|bash` from unknown domains, and runs a curated recipe.

## The machine console

The same desk flips to the board itself. Every tab is wired to the live device — no
polling mock — so what the model reads and what you see are the same numbers.

| Health | Terminal |
|---|---|
| <img src="./docs/screenshots/machine-health.png" width="440" alt="Machine health: GPU, RAM, temperature, disk" /> | <img src="./docs/screenshots/machine-terminal.png" width="440" alt="Terminal running on the board" /> |

| Files | Services | Agents |
|---|---|---|
| <img src="./docs/screenshots/machine-files.png" width="290" alt="Browsing files on the board" /> | <img src="./docs/screenshots/machine-services.png" width="290" alt="Managing board services" /> | <img src="./docs/screenshots/machine-agents.png" width="290" alt="Agents registered on the board" /> |

## Telemetry, memory, and plan

The right rail keeps the reasoning honest: the chat transcript, the board's shared memory
and status, and the plan the agent is working through — all in one column.

| Chat | Board memory | Plan |
|---|---|---|
| <img src="./docs/screenshots/panel-chat.png" width="290" alt="Telemetry panel: chat" /> | <img src="./docs/screenshots/panel-board.png" width="290" alt="Telemetry panel: board status and memory" /> | <img src="./docs/screenshots/panel-plan.png" width="290" alt="Telemetry panel: plan, credits, and included tools" /> |

## Pairing a board

A board comes online with a short claim code, not an exposed port. The desk → cloud →
board handshake is dial-out only, so a Jetson behind a home router pairs the same way one
in a lab does.

<img src="./docs/screenshots/pair.png" width="760" alt="Pairing a board with a claim code" />

## Architecture

```mermaid
flowchart LR
  subgraph Surface["Operator surface"]
    direction TB
    Client["Browser"] --> BFF["Next BFF on Vercel"]
  end
  subgraph Cloud["Cloud plane"]
    direction TB
    Worker["Cloudflare Worker"]
    Relay["DeviceRelay"]
    Nebius["Nebius"]
    Tavily["Tavily"]
  end
  subgraph Board["Board plane"]
    direction TB
    Agent["board-agent"] --> API["FastAPI on the board"]
  end

  BFF --> Worker
  Worker --> Relay
  Worker --> Nebius
  Worker --> Tavily
  Relay --> Agent
  API -->|"device token + HMAC"| Worker
```

Six apps, one repo:

| App | Role |
|---|---|
| `apps/api` | FastAPI on the board: router, chat tools, edge FS/CLI, jobs, browser |
| `apps/web` | Next.js 15 desk UI — the real product surface |
| `apps/cloud` | Worker + D1 + relay: accounts, pairing, metering, keys |
| `apps/board-agent` | Dials out and proxies the cloud to the local API |
| `apps/board-emu` | Docker fake boards (Natasha / Nova / Orin) for demos |
| `apps/mobile` | Expo thin client |

## Security model

```mermaid
flowchart LR
  subgraph Access["Access"]
    direction TB
    Browser["Browser"] --> Auth["Cloudflare auth"]
    Board["Board"] --> Pair["Claim code pairing"]
  end
  subgraph Secrets["Issued credentials"]
    direction TB
    JWT["JWT cookie"]
    Device["Device token"]
  end
  subgraph Keys["Worker-only secrets"]
    direction TB
    Vault["Nebius + Tavily keys"]
  end

  Auth --> JWT
  Pair --> Device
  Vault -.-> Auth
  Vault -.-> Pair
```

- Product login is Cloudflare-issued (short-lived JWT + refresh, optional TOTP). The
  browser never holds API keys.
- The gateway stores only the **hash** of the device token; the board holds the secret.
- Human brakes: approval cards for edits and destructive shell, no free sudo, vetted installs.

## Layout

```
Nebius Desk/
├── apps/{api,web,cloud,board-agent,board-emu,mobile}
├── packages/shared/        # API client + types
├── docs/                   # ARCHITECTURE.md · API.md
├── AGENTS.md               # how AI agents should work in this repo
└── README.md               # you are here
```

## Docs

- [Architecture](./docs/ARCHITECTURE.md) — apps, model ladder, Millie the guide, security, money, deploy
- [API contract](./docs/API.md) — lanes, errors, CORS, gateway HMAC, ops
- [AGENTS.md](./AGENTS.md) — the machine-facing contract for coding agents

## License

MIT — see [LICENSE](./LICENSE).
