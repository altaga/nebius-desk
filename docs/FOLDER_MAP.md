# Folder map

```
Nebius Desk/
│
├── apps/
│   ├── api/                         # Backend (Jetson / local)
│   │   ├── app/
│   │   │   ├── auth/                # Login, bcrypt, TOTP, JWT
│   │   │   ├── router/              # Hybrid token optimizer
│   │   │   ├── chat/                # Sessions + messages
│   │   │   ├── sessions/            # Mission Control forks
│   │   │   ├── telemetry/           # Tokens saved ledger
│   │   │   ├── tools/               # Tavily etc.
│   │   │   ├── edge/                # tegrastats / GPU mock
│   │   │   ├── config.py
│   │   │   ├── db.py
│   │   │   └── main.py
│   │   ├── data/                    # SQLite (gitignored contents)
│   │   ├── requirements.txt
│   │   └── .env.example
│   │
│   ├── web/                         # Next.js desktop/web UI
│   │   └── src/
│   │       ├── app/                 # Routes (thin)
│   │       ├── features/
│   │       │   ├── auth/
│   │       │   ├── chat/
│   │       │   ├── desk/
│   │       │   ├── missions/
│   │       │   ├── artifacts/
│   │       │   └── telemetry/
│   │       └── lib/
│   │
│   └── mobile/                      # Expo Android + iOS (+ Apple-ready)
│       ├── app/                     # expo-router screens
│       └── lib/
│
├── packages/
│   └── shared/                      # Types + createApiClient()
│
└── docs/
    ├── ARCHITECTURE.md
    └── FOLDER_MAP.md
```
