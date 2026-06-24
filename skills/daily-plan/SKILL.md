---
name: daily-plan
description: Maintain today's plan in the daily memory file for the HomeBot touch dashboard.
---

# Daily Plan for HomeBot Dashboard

The HomeBot Pi dashboard reads today's todos from the daily memory file.

## File location

```
memory/YYYY-MM-DD.md
```

## Required format

```markdown
## Plan
- [ ] 09:00 WORKOUT — Gym session
- [x] 10:00 STANDUP — Daily sync
- [ ] 14:00 REVIEW PRS — HomeBot
```

### Field rules

- **Time** (optional): `HH:MM` or `HH:MM AM/PM` — editable on the Pi by tapping a row
- **Title** before ` — ` (em dash); **description** after
- **Done**: `[x]` / pending `[ ]`
- **Image**: `{img:file.jpg}` in `uploads/images/`
- **Attachment**: `{attach:file.pdf}`

## When to update

- User asks for todos or plan changes
- Tasks completed → flip checkbox to `[x]`
- User changes time → update the time prefix on the matching line

## Example full daily file

```markdown
# 2026-06-24

## Plan
- [ ] 08:00 COFFEE — Morning routine
- [ ] 14:00 CAMP GEAR — Clean floor
- [ ] 15:00 REVIEW PRS — OpenClaw

## Notes
- Tap a row on the Pi to edit time.
```

## Do not

- Put todos only in `MEMORY.md` — use `memory/<today>.md`
- Remove the `## Plan` header
