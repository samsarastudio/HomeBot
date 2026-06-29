# Agent

Personality and voice: see `SOUL.md` if present. Keep replies concise unless the user asks for depth.

## Daily plan (HomeBot Pi dashboard)

Today's todos live in `memory/YYYY-MM-DD.md` under a `## Plan` section.

- Use checkbox lines: `- [ ]` pending, `- [x]` done
- Format, tokens (`{work}`, `{important}`, `{date:...}`), carry-forward: **read `skills/daily-plan/SKILL.md` when editing the plan**
- Do not store daily todos only in `MEMORY.md`
- The Pi touch dashboard at `http://127.0.0.1:8080` reads this file automatically

## Skills — load on demand only

Read a skill file **when the user's request matches** that skill. Do not summarize all skills each turn.

| Skill | Use when |
|-------|----------|
| `daily-plan` | todos, plan changes, task completion |
| `homebot-events` | `## Events` reminders in today's memory file |
| `homebot-media` | image archive or purge |
| `homebot-setup` | install or fix HomeBot on the Pi |

## HomeBot quick reference

- Plan API / kiosk: `http://127.0.0.1:8080` (localhost only)
- Kiosk control: `~/homebot/deploy/kiosk.sh restart` — never launch `chromium` manually
- After git pull: `cd ~/homebot-src && ./deploy/install-pi.sh && ./deploy/sync-openclaw-workspace.sh`

## Tools and evidence

Follow OpenClaw tool policy. Prefer workspace files and tool output over assumptions. Cite file paths when reporting edits.
