---
name: homebot-checkins
description: Categorize daily todos into HomeBot check-in slots (9am, 6pm personal; 11:30pm work).
---

# HomeBot Daily Check-ins

The Pi dashboard has **three fixed check-ins every day**. Plan items are grouped by tag — not a separate events list.

| Time | Slot | What goes here |
|------|------|----------------|
| **9:00 AM** | Morning check-in | Personal / home todos (default) |
| **6:00 PM** | Evening check-in | Same personal todos — review what's left |
| **11:30 PM** | Work check-in | Work / job / office todos only |

## File

`memory/YYYY-MM-DD.md` → `## Plan` section (same as daily todos).

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
| `{work}` or `{checkin:work}` | 11:30 PM only |
| `{checkin:morning}` or `{checkin:9am}` | 9:00 AM only |
| `{checkin:evening}` or `{checkin:6pm}` | 6:00 PM only |

## When the user chats

**User:** "Add work task: review PRs by tonight"  
→ `- [ ] REVIEW PRS — OpenClaw repo {work}`

**User:** "Remind me to call mom today"  
→ `- [ ] CALL MOM — Personal {personal}` (or no tag)

**User:** "What's on my 6pm check-in?"  
→ List pending plan items tagged personal/evening for today

**User:** "Morning check-in" / "9am check-in"  
→ List personal items still pending

**User:** "11:30 work check-in"  
→ List only `{work}` items

## Notifications

At 9:00, 18:00, and 23:30 the dashboard pops up with pending items for that slot (10 min warning + at time). Keep items in `## Plan` with correct tags.

## Do not

- Put check-in todos only in `## Events` — they must be `## Plan` checkboxes with tags
- Tag personal home tasks with `{work}`
- Use a separate file per check-in
