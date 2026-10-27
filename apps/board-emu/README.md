# board-emu — Docker cloud board for Nebius Desk

A **Linux container** that pairs like a real board: Terminal, Files, and Health are
real (the container). Chat uses **Nano / Lightning / Super** via the Nebius gateway
(**spends user credits**).

Not a Jetson: no CUDA, no Ollama, no Auto/Local models. Think “VM enrolled in Desk”
without on-device inference.

## Run

```powershell
cd apps/board-emu
copy .env.example .env
docker compose build

docker compose run --rm natasha pair   # paste CODE into Pair a board
docker compose run --rm nova pair
docker compose run --rm orin pair

docker compose up -d
```

Board display names: **Natasha**, **Nova**, **Orin** — never Millie (reserved for the real Jetson).

## What works

| Feature | Behavior |
|---|---|
| Pair / Online | Real `desk_agent` → cloud WebSocket |
| Chat Nano / Lightning / Super | Nebius gateway |
| Auto / Local in picker | Remapped to **Nano** (`board_emu`) |
| Terminal | Real bash inside the container (`jetson@…`) |
| Files | Real FS under `/home/jetson` |
| Health | Real CPU / RAM / disk / uptime (GPU/temp only if the host exposes them) |
| HTTP CLI (`/edge/cli`) | Real shell in the desk file root |

Data lives on the host (bind mounts), default:

`C:\Users\VAI\Documents\Docker\board-emu\<natasha|nova|orin>\{config,data}`

Override with `BOARD_EMU_DATA=...` in `.env`. Wipe a board by deleting that folder.

Local cloud: `CLOUD_URL=http://host.docker.internal:8787` in `.env`.
