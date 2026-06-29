# HomeBot Setup Guide

Use this document when installing HomeBot on a **Raspberry Pi 5** that already runs **OpenClaw**.  
Designed to be followed by a human or by an OpenClaw agent given a git URL.

---

## What you are installing

**HomeBot** is a fullscreen touch dashboard that:

- Shows a live clock and OpenClaw gateway status
- Displays today's todos from `~/.openclaw/workspace/memory/YYYY-MM-DD.md` (`## Plan` section)
- Surfaces cron job prompts and exec approval buttons on a touchscreen
- Reads the full local OpenClaw state dir (`~/.openclaw`) — no remote API needed for data

**Runs on:** same Pi as OpenClaw  
**Display:** optimized for **Freenove FNK0078** 7" DSI (**800×480**, capacitive touch). Kiosk uses Chromium touch flags; dashboard auto-switches to tabbed PLAN/DONE layout at this resolution.  
**Listens on:** `http://127.0.0.1:8080`  
**Gateway WebSocket:** `ws://127.0.0.1:18789` (default OpenClaw port)

---

## Prerequisites (verify before install)

Run these on the Pi:

```bash
# OpenClaw gateway must be running
systemctl --user status openclaw-gateway

# Node 22+ required
node --version

# Desktop session for touch kiosk (DISPLAY must be set when kiosk starts)
echo $DISPLAY   # usually :0

# Optional but recommended: allow user services after logout
loginctl enable-linger "$USER"
```

Install Node 22+ if missing (OpenClaw Pi docs recommend Node 22 or 24).

---

## Install from git (standard path)

Replace `<GIT_URL>` with the repository URL (HTTPS or SSH).

```bash
git clone <GIT_URL> ~/homebot-src
cd ~/homebot-src
chmod +x deploy/install-pi.sh
./deploy/install-pi.sh
```

What the installer does:

1. Copies the repo to `~/homebot` (override with `HOMEBOT_DIR=/path ./deploy/install-pi.sh`)
2. Runs `pnpm install` and `pnpm build`
3. Writes `~/homebot/deploy/env` with `OPENCLAW_STATE_DIR` and gateway token (from `~/.openclaw/openclaw.json` if found)
4. Installs systemd user units: `homebot-server.service`, `homebot-kiosk.service`
5. Enables and starts `homebot-server`

### Install in-place (clone directly to ~/homebot)

```bash
git clone <GIT_URL> ~/homebot
cd ~/homebot
chmod +x deploy/install-pi.sh
HOMEBOT_DIR=~/homebot ./deploy/install-pi.sh
```

---

## Post-install steps (required)

### 1. Sync OpenClaw workspace (skills + lean AGENTS)

Keeps bootstrap context small: detailed rules live in **skills** (loaded on demand), not a 300-line AGENTS.md.

```bash
~/homebot/deploy/sync-openclaw-workspace.sh
```

This copies `daily-plan`, `homebot-events`, `homebot-media`, and `homebot-setup` into `~/.openclaw/workspace/skills/` and merges a compact HomeBot section into `AGENTS.md`.

For a full lean AGENTS reset (backs up first):

```bash
~/homebot/deploy/sync-openclaw-workspace.sh --replace-agents
```

See [openclaw/README.md](openclaw/README.md) for context budget notes.

### 2. Tell the agent to maintain the plan (if not using sync script)

If you manage AGENTS.md manually, add only this — full format is in `skills/daily-plan/SKILL.md`:

```markdown
## HomeBot dashboard

Keep today's plan in `memory/YYYY-MM-DD.md` under a `## Plan` section using checkbox lines:

- [ ] 09:00 TASK TITLE — optional description
- [x] 10:00 DONE TASK — optional description

Update this when the user asks for todos or during morning brief. The Pi touch dashboard reads this file.
```

### 3. Create today's plan file (if empty)

```bash
TODAY=$(date +%Y-%m-%d)
FILE=~/.openclaw/workspace/memory/$TODAY.md
mkdir -p ~/.openclaw/workspace/memory

if [[ ! -f "$FILE" ]]; then
  cat > "$FILE" <<EOF
# $TODAY

## Plan
- [ ] 09:00 EXAMPLE — Replace with real tasks

## Notes
EOF
fi
```

### 4. Start the touch kiosk

**Use only one of these** (do not run `chromium` manually — that opens duplicate windows):

```bash
# Preferred: systemd (single instance, fullscreen)
systemctl --user restart homebot-kiosk

# Or helper script (stops any existing instance first)
~/homebot/deploy/kiosk.sh restart
```

Check only one Chromium is running:

```bash
~/homebot/deploy/kiosk.sh status
```

Chromium opens in **true kiosk fullscreen** (`--kiosk`). Use the **✕ CLOSE** button (top-left) to exit back to the desktop.

### 5. Enable kiosk on boot (optional)

```bash
systemctl --user enable homebot-kiosk
```

---

## Verify installation

```bash
# Server health
systemctl --user status homebot-server
curl -s http://127.0.0.1:8080/api/openclaw/status | head -c 500

# Plan API (should list items if ## Plan exists in today's memory file)
curl -s http://127.0.0.1:8080/api/plan

# Open in browser (token in URL fragment — not sent to server logs)
# URL is printed at end of install-pi.sh, e.g.:
# http://127.0.0.1:8080/#token=YOUR_GATEWAY_TOKEN
```

**Success looks like:**

- `homebot-server` is `active (running)`
- `/api/plan` returns `items` with today's tasks
- Kiosk shows clock, status chips, plan columns
- Tapping a task toggles `[ ]` ↔ `[x]` in the memory file

---

## OpenClaw agent: one-shot install prompt

Copy this prompt to your OpenClaw bot (replace the git URL):

```
Install HomeBot touch dashboard from git on this Pi.

Git URL: <GIT_URL>

Follow SETUP.md in the repo exactly:
1. Verify openclaw-gateway is running and Node 22+ is installed
2. git clone, run deploy/install-pi.sh
3. Run deploy/sync-openclaw-workspace.sh (skills + lean AGENTS snippet)
4. Ensure today's memory/YYYY-MM-DD.md has a ## Plan section with checkbox items
5. systemctl --user start homebot-kiosk
6. Verify with curl http://127.0.0.1:8080/api/plan and report the URL to open the dashboard

Do not stop or reconfigure openclaw-gateway unless it is not running.
Install target directory: ~/homebot
```

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENCLAW_STATE_DIR` | `~/.openclaw` | OpenClaw state root (workspace, cron, tasks) |
| `HOMEBOT_PORT` | `8080` | HomeBot HTTP server |
| `OPENCLAW_GATEWAY_PORT` | `18789` | Gateway port for health check |
| `HOMEBOT_DIR` | `~/homebot` | Install target (install script only) |
| `DISPLAY` | `:0` | Required for Chromium kiosk |

Config file: `~/homebot/deploy/env`

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Plan empty but file exists | Ensure `## Plan` header and `- [ ]` / `- [x]` lines exist in `memory/<today>.md` |
| Gateway offline in UI | `systemctl --user restart openclaw-gateway`; check token in kiosk URL `#token=...` |
| Kiosk won't start | Ensure graphical session: `echo $DISPLAY`, start from desktop or set `DISPLAY=:0` |
| `pnpm install` fails on Pi | Run `npm install -g pnpm` then retry; Node 22+ required |
| Multiple Chromium windows/tabs | Never launch `chromium` manually; use `kiosk.sh restart` or `systemctl --user restart homebot-kiosk` only |
| Keyring unlock dialog on boot | Re-run install; kiosk uses `--password-store=basic` and skips GNOME keyring |
| "Press Esc to exit" on first tap | Update dashboard build; kiosk mode no longer calls browser Fullscreen API |
| Close button doesn't exit | Re-run install so `deploy/launch-kiosk.sh` is used; Close calls `pkill` on kiosk Chromium |
| Permission denied on `~/.openclaw` | Run HomeBot as the same user that runs OpenClaw |

---

## Updating from git

```bash
cd ~/homebot-src
git pull
./deploy/install-pi.sh
systemctl --user restart homebot-server
systemctl --user restart homebot-kiosk
```

---

## Architecture (short)

- **apps/server** — reads `~/.openclaw` from disk, serves REST + static UI on :8080
- **apps/dashboard** — fullscreen browser UI; WebSocket to OpenClaw gateway for live cron/approvals
- **skills/daily-plan** — teaches the agent the `## Plan` markdown format

See [README.md](README.md) for API reference.
