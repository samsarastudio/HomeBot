---
name: daily-plan
description: Maintain today's plan in the daily memory file for the HomeBot touch dashboard.
---

# Daily Plan for HomeBot Dashboard

The HomeBot Pi dashboard reads today's todos from the daily memory file.

## File location

Write and update the plan in:

```
memory/YYYY-MM-DD.md
```

Use today's date in `YYYY-MM-DD` format (same as OpenClaw's daily memory log).

## Required format

Include a `## Plan` section with GitHub-style checkboxes:

```markdown
## Plan
- [ ] 09:00 WORKOUT — Gym session
- [x] 10:00 STANDUP — Daily sync
- [ ] 14:00 REVIEW — Open PRs
```

### Field rules

- **Time** (optional): `HH:MM` or `HH:MM AM/PM` at the start of the line body
- **Title**: bold task name in ALL CAPS or Title Case before the em dash
- **Description** (optional): after ` — ` (em dash)
- **Done**: `[x]` checked; pending: `[ ]`

## When to update

- When the user asks for today's plan or todos
- During morning brief / heartbeat if a plan exists for the day
- When tasks are completed — flip the matching checkbox to `[x]`
- When new tasks are added — append new `- [ ]` lines under `## Plan`

## Do not

- Put the plan only in `MEMORY.md` — the dashboard reads `memory/<today>.md`
- Remove the `## Plan` header — the dashboard parser requires it
- Use nested lists under Plan — keep a flat checkbox list

## Example full daily file

```markdown
# 2026-06-24

## Plan
- [ ] 09:00 WORKOUT — Gym session
- [ ] 11:00 DEEP WORK — HomeBot dashboard
- [x] 08:00 COFFEE — Morning routine

## Notes
- User wants focus on Pi deployment today.
```
