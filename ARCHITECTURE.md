# Dashboard Data Access Architecture

HomeBot aligns with the OpenClaw **clawbot-dashboard / clawbot-api** pattern.  
In this repo the names are `apps/dashboard` (Vite + TS frontend) and `apps/server` (Express API).

When installed on a Pi via `deploy/install-pi.sh`, the runtime lives at `~/homebot`.  
OpenClaw may also reference these paths inside the workspace:

```
~/.openclaw/workspace/
├── clawbot-dashboard/    # optional symlink → ~/homebot/apps/dashboard
├── clawbot-api/          # optional symlink → ~/homebot/apps/server
└── ...
```

## Directory structure (this repo)

```
HomeBot/
├── apps/
│   ├── dashboard/              # Vite + TS frontend (clawbot-dashboard)
│   │   └── src/
│   │       ├── live-dashboard.ts   # HTTP poll + Socket.IO (like useLiveDashboard)
│   │       ├── gateway/client.ts   # OpenClaw Gateway WebSocket (cron, approvals)
│   │       └── main.ts
│   └── server/                 # Express API (clawbot-api)
│       ├── src/
│       │   ├── routes/
│       │   │   ├── dashboard.ts    # GET /api/dashboard/data
│       │   │   ├── files.ts        # /api/files/*
│       │   │   └── media.ts        # /api/media/*
│       │   ├── openclaw/           # reads ~/.openclaw state dir
│       │   └── server.ts
│       └── uploads/
│           ├── images/
│           ├── attachments/
│           └── thumbnails/
```

## Data sources

| Source | How API reads it |
|--------|------------------|
| Today's todos | `~/.openclaw/workspace/memory/YYYY-MM-DD.md` (`## Plan`) |
| Cron jobs | `~/.openclaw/cron/jobs.json` + run history |
| Tasks | `~/.openclaw/tasks/runs.sqlite` |
| Sessions | `~/.openclaw/sessions/` file counts |
| System metrics | `/proc/stat`, `os.freemem`, `df` on Pi |
| Uploads | `apps/server/uploads/` (images, attachments) |
| Live events | OpenClaw Gateway WebSocket (`cron`, approvals) |

## Express API

### `GET /api/dashboard/data` — all metrics at once

```json
{
  "todolist": { "completed": 1, "pending": 2, "plan": { ... } },
  "sessions": { "active": 4, "total": 12 },
  "system": { "cpu": "9%", "ram": "32%", "disk": "32%" },
  "cron_jobs": [ ... ],
  "gateway": { "online": true, "port": 18789 },
  "tasks": { "running": 0, "queued": 0, "recent": [] },
  "openclaw": { ... },
  "timestamp": "2026-06-24T13:00:00Z"
}
```

### Files

| Endpoint | Description |
|----------|-------------|
| `GET /api/files/list?dir=uploads` | List images in `uploads/images/` |
| `GET /api/files/list?dir=attachments` | List `uploads/attachments/` |
| `GET /api/files/list?dir=workspace/memory` | List OpenClaw workspace files |
| `GET /api/files/get/:filename` | Serve attachment or workspace file |

### Media

| Endpoint | Description |
|----------|-------------|
| `GET /api/media/image/:filename` | Serve image (PNG/JPEG/WebP) |
| `GET /api/media/thumb/:filename?size=small\|medium\|large` | WebP thumbnail via sharp (cached) |

### Legacy (still supported)

- `GET /api/openclaw/status`, `/api/plan`, `/api/openclaw/workspace`, etc.

## Live updates (frontend)

`apps/dashboard/src/live-dashboard.ts` mirrors `useLiveDashboard`:

1. **HTTP polling** — `GET /api/dashboard/data` every 5s
2. **Socket.IO** — `dashboard:update` events from the same server (port 8080)

OpenClaw Gateway WebSocket remains separate for **instant** cron/approval overlays.

## Upload paths for agents

Agents can drop files for the dashboard to list/serve:

| Type | Path on Pi | URL |
|------|------------|-----|
| Images | `~/homebot/apps/server/uploads/images/` | `/api/media/image/photo.jpg` |
| Attachments | `~/homebot/apps/server/uploads/attachments/` | `/api/files/get/report.pdf` |
| Thumbnails | `~/homebot/apps/server/uploads/thumbnails/` (auto) | `/api/media/thumb/photo?size=small` |

Override uploads root: `HOMEBOT_UPLOADS_DIR=/path/to/uploads`

## Environment

| Variable | Default |
|----------|---------|
| `OPENCLAW_STATE_DIR` | `~/.openclaw` |
| `HOMEBOT_PORT` | `8080` |
| `HOMEBOT_REFRESH_MS` | `5000` (Socket.IO broadcast interval) |
| `HOMEBOT_UPLOADS_DIR` | `apps/server/uploads` |
