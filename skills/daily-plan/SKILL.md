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

- **Time** (optional): `HH:MM` or `HH:MM AM/PM` — set on the Pi via touch clock picker (tap a row)
- **Title** before ` — ` (em dash); **description** after
- **Done**: `[x]` / pending `[ ]`
- **Category**: `{work}` or `{personal}` (default is personal if omitted)
- **Important**: `{important}` — floats to top of the list
- **Due date**: `{date:YYYY-MM-DD}` — floats to top; turns red after the date passes
- **Image**: `{img:file.jpg}` in `uploads/images/`
- **Attachment**: `{attach:file.pdf}`

### Sorting on the dashboard

1. Items with a **time** or **due date** appear first (earliest schedule on top)
2. Items without a schedule follow, **newest added first**
3. Items with a past time (today) or past due date show in **red**

### Added timestamp

- Optional `{added:UNIX_MS}` token (milliseconds since epoch) — shown on the Pi as elapsed minutes (e.g. `12m`)
- If omitted, the dashboard records first-seen time for that session

## When to update

- User asks for todos or plan changes
- Tasks completed → flip checkbox to `[x]`
- User changes time → update the time prefix on the matching line

## Example full daily file

```markdown
# 2026-06-24

## Plan
- [ ] 08:00 COFFEE — Morning routine
- [ ] 14:00 CAMP GEAR — Clean floor {important}
- [ ] 15:00 REVIEW PRS — OpenClaw {work}
- [ ] 18:00 DENTIST — Appointment {date:2026-06-25} {work}

## Notes
- Tap a row on the Pi to edit time, date, category, and important flag.
```

## Do not

- Put todos only in `MEMORY.md` — use `memory/<today>.md`
- Remove the `## Plan` header
