# NebiusDesk

Hybrid **NVIDIA Jetson** edge orchestrator + **Nebius Token Factory** (Nemotron) desk — Claude-style UI for web/desktop, Expo for Android & iOS.

> Default `LLM_MODE=dummy` — **$0 Nebius spend** until you flip the switch for a live demo.

## Monorepo layout

```
Nebius Desk/
├── apps/
│   ├── api/          # FastAPI on Jetson (auth 2FA, hybrid router, missions)
│   ├── web/          # Next.js Claude-style desk (Vercel)
│   └── mobile/       # Expo (Android + iOS + Expo web)
├── packages/
│   └── shared/       # Types + API client shared by web/mobile
├── docs/
│   └── ARCHITECTURE.md
└── .env.example
```

### API domains (`apps/api/app/`)

| Folder | Responsibility |
|---|---|
| `auth/` | bcrypt + TOTP 2FA + JWT |
| `router/` | Intent → local Ollama / Nebius + compression + budget caps |
| `chat/` | Sessions & messages (SQLite) |
| `sessions/` | Mission Control multi-thread fork |
| `telemetry/` | Token savings ledger + live badge |
| `tools/` | Tavily (mocked without key) |
| `edge/` | Jetson GPU/RAM monitor (mock until device online) |

### Web features (`apps/web/src/features/`)

`auth/` · `chat/` · `desk/` · `missions/` · `artifacts/` · `telemetry/`

## Quick start (local)

### 1. API

```bash
cd apps/api
python -m venv .venv

# Windows PowerShell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- Health: http://127.0.0.1:8000/health  
- Docs: http://127.0.0.1:8000/docs  
- First-run 2FA QR: `GET /api/auth/setup-2fa` (or open the web login page)

Default user: `admin` / `changeme` + TOTP from the QR.

### 2. Web (desktop/browser)

```bash
cd apps/web
copy .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000

### 3. Mobile (Expo)

```bash
cd apps/mobile
copy .env.example .env
npm install
npx expo start
```

Scan with Expo Go (Android / iOS). Same API; Android emulator uses `10.0.2.2:8000`.

## Budget rules (locked)

| Guard | Value |
|---|---|
| Contest Nebius budget | **$25** |
| Soft daily cap in code | **$2.00** |
| Default mode | `dummy` (no real Token Factory calls) |
| Light intents | Always local (translate / format / short summarize) |
| Heavy intents | Compress on edge → Nemotron (when `hybrid`) |

Flip live only for demos:

```env
LLM_MODE=hybrid
NEBIUS_API_KEY=your-real-key
```

## Free-tier map

| Piece | Host |
|---|---|
| Web | Vercel |
| Mobile | Expo Go / EAS free |
| API | Jetson + Cloudflare Tunnel / Tailscale |
| DB | SQLite on device |
| Search | Tavily free tier (optional) |

## License

MIT — see `LICENSE`.
