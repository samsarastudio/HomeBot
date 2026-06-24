---
name: homebot-setup
description: Install and configure the HomeBot Pi touch dashboard from a git repository URL.
---

# HomeBot Setup Skill

Use when the user asks to install, deploy, or set up **HomeBot** from a git URL on a Raspberry Pi running OpenClaw.

## Read first

Open `SETUP.md` in the cloned repository. Follow it step by step.

## Quick checklist

1. **Verify:** `systemctl --user status openclaw-gateway` is active; `node --version` is 22+
2. **Clone:** `git clone <GIT_URL> ~/homebot-src && cd ~/homebot-src`
3. **Install:** `chmod +x deploy/install-pi.sh && ./deploy/install-pi.sh`
4. **Skill:** `cp -r ~/homebot/skills/daily-plan ~/.openclaw/workspace/skills/`
5. **Agent docs:** Add `## HomeBot dashboard` section to `AGENTS.md` (see SETUP.md)
6. **Plan file:** Ensure `~/.openclaw/workspace/memory/<today>.md` has `## Plan` with `- [ ]` items
7. **Kiosk:** `systemctl --user start homebot-kiosk`
8. **Verify:** `curl -s http://127.0.0.1:8080/api/plan` and report dashboard URL from install output

## Rules

- Do **not** stop OpenClaw gateway unless it is not running
- Install to `~/homebot` unless user specifies otherwise (`HOMEBOT_DIR=...`)
- Gateway token is embedded in kiosk URL as `#token=...` (fragment, not query string)
- Same Pi co-location: HomeBot reads `OPENCLAW_STATE_DIR` directly (default `~/.openclaw`)

## Report back to user

After install, tell the user:

- Dashboard URL (with token fragment if configured)
- `systemctl --user status homebot-server` result
- Whether today's plan file exists and how many items were parsed
- How to start/stop kiosk: `systemctl --user start|stop homebot-kiosk`
