---
name: homebot-checkins
description: Categorize daily todos into HomeBot check-in slots (9am all, 6pm personal, 11:30pm work). Repeats every day.
---

# HomeBot Daily Check-ins

**Three check-ins run every calendar day, automatically, forever** — no need to recreate them in `## Events`. The server builds slots from today's `## Plan` each day.

| Time | Slot | What appears |
|------|------|----------------|
| **9:00 AM** | Morning | **Work + personal** — full day kickoff |
| **6:00 PM** | Evening | **Personal** only — home/life review |
| **11:30 PM** | Work | **Work** only — end-of-day work wrap-up |

## File

`memory/YYYY-MM-DD.md` → `## Plan` (new file each day, same rules every day).

## Tags on plan lines

```markdown
## Plan
- [ ] 08:00 COFFEE — Morning routine
- [ ] 10:00 GROCERIES — Buy milk
- [ ] 14:00 OPENCLAW — Fix gateway {work}
- [ ] 16:00 LAUNDRY — Fold clothes {checkin:evening}
```

| Tag | Shows at |
|-----|----------|
| *(none)* or `{personal}` | 9:00 AM **and** 6:00 PM |
| `{work}` or `{checkin:work}` | 9:00 AM **and** 11:30 PM |
| `{checkin:morning}` | 9:00 AM only |
| `{checkin:evening}` | 6:00 PM only |

## Daily rhythm (every day)

1. **9 AM** — Popup + marquee: all pending work **and** personal items
2. **6 PM** — Popup: personal items still open
3. **11:30 PM** — Popup: work items still open

Completed items (`[x]`) stay visible in the check-in panel but not in popup summaries.

## When the user chats

**User:** "Add work task: review PRs"  
→ `- [ ] REVIEW PRS — Repo {work}` (shows 9am + 11:30pm)

**User:** "Call mom today"  
→ `- [ ] CALL MOM — Personal` (shows 9am + 6pm)

**User:** "9am check-in" / "morning check-in"  
→ List **all** pending personal **and** work items

**User:** "6pm check-in"  
→ Personal items only

**User:** "11:30 work check-in"  
→ Work items only

## Do not

- Recreate check-in times in `## Events` each day — they are automatic
- Put todos only in `## Events` without `## Plan` checkboxes
