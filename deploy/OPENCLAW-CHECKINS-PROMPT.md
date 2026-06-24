# OpenClaw prompt — HomeBot check-ins

Copy this into OpenClaw workspace instructions, `AGENTS.md`, or paste as a one-shot agent task.

---

## System behavior

You maintain today's HomeBot dashboard file at `memory/YYYY-MM-DD.md` (today's date).

**Check-ins are not separate events.** Every todo is a `## Plan` checkbox tagged for when it should be reviewed on the Pi touchscreen.

### Fixed daily schedule

| Time | Check-in | Items |
|------|----------|-------|
| 9:00 AM | Morning | Personal / home / life (default) |
| 6:00 PM | Evening | Same personal items — status review |
| 11:30 PM | Work | Work / job / coding / office only |

### Tagging rules

```
{personal}  or no tag  →  9 AM + 6 PM check-ins
{work}                 →  11:30 PM check-in only
{checkin:morning}      →  9 AM only
{checkin:evening}      →  6 PM only
```

### Example `memory/2026-06-24.md`

```markdown
# 2026-06-24

## Plan
- [ ] 08:00 WORKOUT — Gym
- [ ] 12:00 GROCERIES — Milk and eggs
- [ ] 14:00 CAMP GEAR — Clean garage floor
- [ ] 15:00 REVIEW PRS — HomeBot repo {work}
- [ ] 16:00 STANDUP NOTES — Prep for tomorrow {work}
- [x] 13:40 HOMEBOT — Server running {work}

## Notes
- Personal items show at 9am and 6pm check-ins on the Pi.
- Work items show at 11:30pm check-in.
```

### Chat interpretation

When the user mentions tasks in natural language, classify and tag:

| User says | Tag | Example line |
|-----------|-----|----------------|
| chores, gym, family, errands, home | personal (default) | `- [ ] GYM — Session` |
| work, job, PR, meeting, office, code | work | `- [ ] REVIEW PR — Repo {work}` |
| "only this evening" | evening | `{checkin:evening}` |
| "only tomorrow morning" | morning | `{checkin:morning}` |

### Install skills on Pi

```bash
STATE=~/.openclaw
cp -r ~/homebot/skills/daily-plan "$STATE/workspace/skills/"
cp -r ~/homebot/skills/homebot-checkins "$STATE/workspace/skills/"
```

### After updating memory file

No server restart needed — dashboard polls every 5s. User sees a scrolling **CHECK-INS** marquee; tap opens full panel.

---

## One-shot agent task

```
Read skills/homebot-checkins/SKILL.md in the HomeBot repo.

Update memory/<TODAY>.md:
1. Ensure ## Plan exists with checkbox todos for today.
2. Tag personal/home items (default or {personal}) — they appear at 9am and 6pm check-ins.
3. Tag all work/job items with {work} — they appear at 11:30pm check-in only.
4. When user adds tasks via chat, always write to ## Plan with the correct tag.

Do not use ## Events for daily check-ins unless it's a one-off meeting outside this model.
```
