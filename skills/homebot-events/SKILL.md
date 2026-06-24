---
name: homebot-events
description: Add calendar events to today's memory file for HomeBot timed notifications.
---

# HomeBot Calendar Events

The Pi dashboard shows touch notifications **10 minutes before** and **at** each event time.

## File location

Add events to today's daily memory file:

```
memory/YYYY-MM-DD.md
```

## Format

Include a `## Events` section:

```markdown
## Events
- 10:00 TEAM STANDUP — Daily sync {remind:10,0}
- 14:00 Q2 REVIEW — Meeting room {remind:10,0} {img:review.png}
```

### Field rules

- **Time**: `HH:MM` or `HH:MM AM/PM` after the list marker
- **Title**: before the em dash
- **Notes** (optional): after ` — `
- **Remind**: `{remind:10,0}` — minutes before start (10 = upcoming, 0 = at start)
- **Image** (optional): `{img:filename.png}` in `uploads/images/`

## Notification behavior

- Server checks every minute; fires each remind time once per day
- Dashboard shows a dismissible overlay (`DISMISS` button)
- Dismissed notifications do not reappear
- Works while kiosk is open all day

## When to update

- User asks to schedule a meeting or reminder on the Pi display
- Morning brief: add today's meetings from calendar
- When meetings are cancelled — remove or comment out the line

## Example full daily file

```markdown
# 2026-06-24

## Plan
- [ ] 09:00 WORKOUT — Gym {img:workout.jpg}

## Events
- 10:00 TEAM STANDUP — Daily sync {remind:10,0}
- 15:00 DOCTOR — Annual checkup {remind:10,0}

## Notes
- Standup moved to 10:00
```

## Do not

- Put events only in external calendar without updating today's file — the dashboard reads `memory/<today>.md`
- Remove the `## Events` header — the parser requires it
- Use nested lists under Events
