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
- [ ] 14:00 REVIEW PRS — HomeBot {work}
```

### Field rules

- **Time** (optional): `HH:MM` or `HH:MM AM/PM`
- **Title** before ` — ` (em dash); **description** after
- **Done**: `[x]` / pending `[ ]`
- **Check-in tag**:
  - `{work}` — **9:00 AM** (with everything) **and** **11:30 PM**
  - `{personal}` or no tag — **9:00 AM** (with everything) **and** **6:00 PM**
  - `{checkin:morning}` — 9 AM only
  - `{checkin:evening}` — 6 PM only

Three check-ins fire **every day automatically** — see `skills/homebot-checkins/SKILL.md`.
- **Image**: `{img:file.jpg}` · **Attachment**: `{attach:file.pdf}`

## When to update

- User asks for todos, check-ins, or "what's on the Pi today"
- Tasks completed → flip checkbox to `[x]`
- New tasks → append with correct `{work}` or personal tag

## Example full daily file

```markdown
# 2026-06-24

## Plan
- [ ] 08:00 COFFEE — Morning routine
- [ ] 10:00 GROCERIES — Errands
- [ ] 14:00 CAMP GEAR — Clean floor
- [ ] 15:00 REVIEW PRS — OpenClaw {work}
- [x] 13:00 HOMEBOT — Deployed {work}

## Notes
- 9am = work + personal. 6pm = personal. 11:30pm = work. Repeats daily.
```

## Do not

- Put todos only in `MEMORY.md` — use `memory/<today>.md`
- Remove the `## Plan` header
- Put work tasks without `{work}` if they should only appear at 11:30 PM
