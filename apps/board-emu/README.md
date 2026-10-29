# board-emu — Docker cloud board for Nebius Desk

A **Linux container** that pairs like a real board: Terminal, Files, Health,
Jobs, Services, and Browser are real (the container). Chat uses
**Nano / Lightning / Super** via the Nebius gateway (**spends user credits**).

Not a Jetson: no CUDA, no Ollama, no Auto/Local models. Think “VM enrolled in Desk”
without on-device inference.

## Run

```powershell
cd apps/board-emu
copy .env.example .env
docker compose build
docker compose up -d natasha
```

Then open Desk at `http://localhost:3000/pair` (must be localhost HTTP so the browser can reach the container). Host ports: Natasha `18001`, Nova `18002`, Orin `18003`.

CLI pair still works if you want the old paste-code path:

```powershell
docker compose run --rm natasha pair
docker compose up -d
```

Board display names: **Natasha**, **Nova**, **Orin** — never **Kratos** (the USB Jetson) and never **Millie** (waifu guide only).

## What works

| Feature | Behavior |
|---|---|
| Pair / Online | Real `desk_agent` → cloud WebSocket |
| Chat Nano / Lightning / Super | Nebius gateway |
| Auto / Local in picker | Remapped to **Nano** (`board_emu`) |
| Terminal | Real bash inside the container (`jetson@…`) |
| Files | Real FS under `/home/jetson` |
| Health | Real CPU / RAM / disk / uptime (GPU/temp only if the host exposes them) |
| Jobs / probe / deploy / checks | Real job runner inside the container |
| Browser / record / Live preview | Playwright Chromium baked into the image |
| Services / preview | Listeners via `/proc` (no Docker-in-Docker) |
| HTTP CLI (`/edge/cli`) | Real shell in the desk file root |
| Safe install (curl/git) | Available; Node via nvm at runtime if approved |

Data lives on the host (bind mounts), default:

`C:\Users\VAI\Documents\Docker\board-emu\<natasha|nova|orin>\{config,data}`

Override with `BOARD_EMU_DATA=...` in `.env`. Wipe a board by deleting that folder.

Local cloud: `CLOUD_URL=http://host.docker.internal:8787` in `.env`.
