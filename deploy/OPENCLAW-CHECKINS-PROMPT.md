# OpenClaw prompt — HomeBot check-ins (daily, forever)

Copy into OpenClaw workspace instructions or use as a one-shot task.

---

## Permanent daily schedule

These three check-ins **repeat every day** on the Pi dashboard. You only maintain `memory/<TODAY>.md` — the server handles times and popups.

| Time | What the user sees |
|------|---------------------|
| **9:00 AM** | **Work + personal** — everything still pending |
| **6:00 PM** | **Personal** only |
| **11:30 PM** | **Work** only |

## Tags on `## Plan` lines

```
(no tag) or {personal}  →  9 AM + 6 PM
{work}                  →  9 AM + 11:30 PM
{checkin:morning}       →  9 AM only
{checkin:evening}       →  6 PM only
```

## Example (copy pattern every day)

```markdown
# 2026-06-24

## Plan
- [ ] 08:00 WORKOUT — Gym
- [ ] 12:00 GROCERIES — Errands
- [ ] 14:00 REVIEW PRS — HomeBot {work}
- [ ] 16:00 CAMP GEAR — Garage {personal}

## Notes
- 9am = work + personal. 6pm = personal. 11:30pm = work.
```

## Agent rules

1. **Every day** — create or update `memory/YYYY-MM-DD.md` with today's date.
2. Classify chat tasks: home/life → personal; job/code/PR/meeting → `{work}`.
3. **9 AM check-in** always includes both work and personal pending items.
4. Do **not** add daily check-in rows to `## Events` — automatic forever.

## Install skill

```bash
cp -r ~/homebot/skills/homebot-checkins ~/.openclaw/workspace/skills/
```

## One-shot task

```
Read skills/homebot-checkins/SKILL.md. Update memory/<TODAY>.md:
- ## Plan checkboxes with {work} on job tasks, personal untagged on life tasks.
- 9am check-in = work + personal. 6pm = personal. 11:30pm = work.
- This repeats every day; only the date file changes.
```
