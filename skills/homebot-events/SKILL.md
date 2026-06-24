---
name: homebot-events
description: Optional one-off calendar events (not daily check-ins — use homebot-checkins for those).
---

# HomeBot One-off Events (optional)

**Daily check-ins (9am / 6pm / 11:30pm) come from `## Plan` tags.** See `skills/homebot-checkins/SKILL.md`.

Use `## Events` only for **extra** timed reminders (meetings, appointments) outside the check-in model:

```markdown
## Events
- 14:00 DENTIST — Downtown clinic {remind:10,0}
```

For normal todos and check-ins, use `## Plan` with `{work}` or `{personal}` instead.
