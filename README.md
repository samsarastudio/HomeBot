# HomeBot — Pi 5 Touch Dashboard

A lightweight fullscreen touch dashboard for OpenClaw on Raspberry Pi 5. Shows a live clock, gateway status, today's plan from agent memory, and touch-friendly prompts for cron jobs and exec approvals.

## Install on Pi (from git)

**Full instructions:** [SETUP.md](SETUP.md) — use this when handing the repo URL to an OpenClaw agent.

```bash
git clone <GIT_URL> ~/homebot-src
cd ~/homebot-src
chmod +x deploy/install-pi.sh
./deploy/install-pi.sh
systemctl --user start homebot-kiosk
```

Then copy `skills/daily-plan` into `~/.openclaw/workspace/skills/` and ensure today's `memory/YYYY-MM-DD.md` has a `## Plan` section (see SETUP.md).

## Features

- **Co-located read access** — reads the full `~/.openclaw` state dir (workspace, cron, tasks, config)
- **Today's plan** — parses `memory/YYYY-MM-DD.md` `## Plan` checkboxes; tap to toggle done
- **Live Gateway events** — cron overlays, exec/plugin approval Approve/Deny
- **Fullscreen + Close** — top-left Close button exits the app (returns to Pi desktop)
- **NEXUS-inspired dark UI** — large touch targets for arm's-length use

## Development

```bash
pnpm install
pnpm build

export OPENCLAW_STATE_DIR=~/.openclaw   # or path to fixtures/.openclaw
pnpm --filter @homebot/server dev
```

Open http://localhost:5173 (dev) or http://127.0.0.1:8080 (production build served by server).

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/openclaw/status` | Aggregated snapshot |
| `GET /api/openclaw/workspace?path=...` | Read workspace file |
| `GET /api/openclaw/cron` | Cron jobs |
| `GET /api/openclaw/tasks` | Task ledger |
| `GET /api/plan` | Today's parsed plan |
| `PUT /api/plan` | Toggle checkbox `{ index, done }` |
| `POST /api/exit` | Close Chromium kiosk window |

## Architecture

- **apps/server** — Express, reads `OPENCLAW_STATE_DIR`, serves dashboard static files
- **apps/dashboard** — Vite SPA, Gateway WebSocket client for live events
- **apps/shared** — shared TypeScript types

Gateway WebSocket: `ws://127.0.0.1:18789` with token from URL `#token=...`

## Skills (for OpenClaw workspace)

| Skill | Purpose |
|-------|---------|
| `skills/daily-plan` | Agent maintains `## Plan` in daily memory file |
| `skills/homebot-setup` | Agent installs HomeBot from git URL |
