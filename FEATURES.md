# HomeBot — Feature Fix & Roadmap

Detailed specification for UI fixes, media handling, task interactions, image lifecycle, and calendar-style notifications.  
Use this document for implementation planning and for OpenClaw agent tasks.

**Repo:** https://github.com/samsarastudio/HomeBot  
**Last updated:** 2026-06-24

---

## Summary

| Area | Priority | Status today |
|------|----------|--------------|
| Status bar (tiny info chips) | P0 | Large chips; gateway text prominent |
| Close button (small) | P0 | 56×56px — too large |
| Image thumbnails in UI | P1 | API exists; **not shown** in dashboard |
| Task detail popup | P1 | Row tap toggles done only |
| Circle tap = column toggle | P1 | Circle and row share one action |
| Themed scrollbars | P2 | Browser default |
| End-of-day image compression + archive | P1 | Not implemented |
| Bot commands for media purge (with confirm) | P1 | Not implemented |
| Calendar notifications (10 min + at time) | P1 | Cron overlay only; no calendar model |

---

## 1. Status bar — compact info row

### Problem
The top status row (`Gateway online`, cron count, CPU/RAM/DISK, etc.) uses large `.chip` elements (~1rem font, 8×14px padding). It competes visually with the clock and plan columns. This row is **secondary telemetry**, not primary content.

### Target
- Single slim **info strip** under the header (max height ~32–36px).
- Typography: **10–11px**, uppercase or small caps, muted color (`--text-muted`).
- Gateway: small dot + short label `ONLINE` / `OFFLINE` (not “Gateway online”).
- Metrics abbreviated: `CRON 3` · `RUN 2` · `3/8` · `CPU 9%` · `RAM 32%` · `DISK 32%`.
- No wrap on landscape Pi display; horizontal scroll inside strip if needed (with themed scrollbar — see §6).
- Optional: tap info strip to expand full detail drawer (future).

### Files to change
- `apps/dashboard/src/styles/nexus.css` — `.status-bar`, `.chip`, add `.info-strip`, `.info-chip`
- `apps/dashboard/src/main.ts` — `render()` status section

### Acceptance
- [ ] Status row height ≤ 36px on 1280×800 kiosk
- [ ] Clock and plan columns remain the visual focus
- [ ] Gateway state still obvious via dot color

---

## 2. Close button — small, unobtrusive

### Problem
`.close-btn` is min 56×56px with bold “✕ CLOSE” — too dominant for an exit affordance that should stay out of the way.

### Target
- **32×32px** (or 36×36 minimum touch target with transparent padding).
- Icon-only `✕` or small “EXIT” label.
- Top-left, semi-transparent until pressed; no red glow box unless hovered/pressed.
- Still easy to tap on touchscreen (use invisible hit area 44×44 if visual is smaller).

### Files to change
- `apps/dashboard/src/styles/nexus.css` — `.close-btn`
- `apps/dashboard/src/main.ts` — button label/markup

### Acceptance
- [ ] Close control visually smaller than plan row check circles
- [ ] Touch target ≥ 44×44 effective area
- [ ] Still calls `POST /api/exit` and exits kiosk

---

## 3. Attached images & thumbnails

### Problem
Server supports thumbnails (`GET /api/media/thumb/:name?size=small|medium|large`) and file listing (`GET /api/files/list?dir=images`), but the **dashboard UI does not render images** on plan rows or detail views. Plan items have no `attachmentId` / `imageUrl` in the data model.

### Target

#### 3a. Data model — link tasks to attachments
Extend plan line format in `memory/YYYY-MM-DD.md` (agent-maintained):

```markdown
## Plan
- [ ] 09:00 WORKOUT — Gym session ![thumb](uploads/images/workout.jpg)
- [ ] 14:00 MEETING — Q2 review | attach:meeting-notes.pdf | img:standup.png
```

Or structured frontmatter per line (preferred for parser):

```markdown
- [ ] 09:00 STANDUP — Daily sync {img:standup.png}
```

Parser (`apps/server/src/plan-file.ts`) should extract:
- `image?: string` — filename in `uploads/images/`
- `attachment?: string` — filename in `uploads/attachments/`
- `thumbUrl`, `imageUrl`, `attachmentUrl` on `PlanItem` in `@homebot/shared`

#### 3b. UI — thumbnails in list
- Pending/done rows show **small square thumb** (48×48) when `thumbUrl` present.
- Fallback icon for attachments without image (pdf/md).
- Lazy-load images; placeholder shimmer matching NEXUS theme.

#### 3c. Server — robust thumb pipeline
- Ensure `sharp` runs on Pi (`pnpm approve-builds` / install docs).
- Thumbs for **attachments that are images** copied into `uploads/images` or generated on ingest.
- Support images dropped in `uploads/attachments/` with image extensions.
- Cache bust when source file mtime changes.

### Files to change
- `apps/shared/src/index.ts` — extend `PlanItem`
- `apps/server/src/plan-file.ts` — parse attachment/img tokens
- `apps/server/src/routes/media.ts` — mtime-aware thumb cache
- `apps/server/src/routes/files.ts` — unified list including thumbs for all images
- `apps/dashboard/src/main.ts` — render thumbs in rows
- `skills/daily-plan/SKILL.md` — document attachment syntax for agent

### Acceptance
- [ ] Image in `uploads/images/` referenced from plan line shows thumb in list
- [ ] Broken/missing image shows themed placeholder, not broken icon
- [ ] `/api/files/list?dir=images` thumbUrl works in UI

---

## 4. Task detail popup (tap row body)

### Problem
Tapping anywhere on a plan row **immediately toggles** done/undone. No way to view title, description, time, full image, or attachment details without accidentally moving the task.

### Target
- **Two tap zones** per row (see §5 for circle):
  - **Row body** (title, time, thumb) → opens **detail card** overlay.
  - **Left circle** → toggles column only.
- Detail card contents:
  - Title, time, description (full text)
  - Large image preview (`/api/media/image/...`) if present
  - Attachment link / inline preview for markdown
  - Metadata: created date, raw line, index
  - **Close** button (top-right ✕) — dismiss only, no state change
  - Optional actions: “Mark done” / “Mark pending” buttons inside card (secondary to circle)

### UI pattern
Reuse `.overlay-backdrop` / `.overlay-card` from approval modals; new variant `.detail-card`.

### Files to change
- `apps/dashboard/src/main.ts` — split handlers; `renderDetailOverlay(planItem)`
- `apps/dashboard/src/styles/nexus.css` — `.detail-card`, image preview area
- Optional: `apps/dashboard/src/components/detail-card.ts`

### Acceptance
- [ ] Tap row body opens closable detail card
- [ ] Tap outside card or ✕ closes without toggling done state
- [ ] Image shown at medium/large size in card
- [ ] Card scrollable if content long (themed scrollbar)

---

## 5. Circle tap — move between columns

### Problem
The left circle and the full row share one click handler — tapping always toggles done state.

### Target
- **Circle only** toggles `[ ]` ↔ `[x]` and moves item between **TODAY'S PLAN** and **DONE TODAY** columns.
- Row body opens detail card (§4).
- Visual feedback on circle tap: brief pulse animation; item animates to other column on success.
- `PUT /api/plan` unchanged; UI refreshes via Socket.IO / poll.

### Interaction diagram

```
┌─────────────────────────────────────┐
│  (○)  09:00 WORKOUT — Gym           │
│   ↑              ↑                  │
│ circle      row body                │
│ toggle      detail popup            │
└─────────────────────────────────────┘
```

### Files to change
- `apps/dashboard/src/main.ts` — `renderPlanItems()`: separate `button.plan-check` handler vs `button.plan-body`
- `apps/dashboard/src/styles/nexus.css` — `.plan-check` as isolated hit target

### Acceptance
- [ ] Circle tap never opens detail card
- [ ] Row body tap never toggles done without explicit button in card
- [ ] Item appears in correct column after toggle

---

## 6. Themed scrollbars

### Problem
`.panel-body` uses `overflow-y: auto` with default OS scrollbars (clashes with dark NEXUS theme).

### Target
- Custom scrollbar for plan panels and detail card:
  - Track: transparent or `rgba(255,255,255,0.04)`
  - Thumb: `var(--accent-purple)` at ~40% opacity, rounded
  - Thin width (~6px) on touch displays
- WebKit: `::-webkit-scrollbar-*`
- Firefox: `scrollbar-color`, `scrollbar-width: thin`
- Momentum scrolling on Pi: `-webkit-overflow-scrolling: touch`

### Files to change
- `apps/dashboard/src/styles/nexus.css` — global or `.panel-body`, `.detail-card-body`

### Acceptance
- [ ] Scrollbars visible but subtle on dark background
- [ ] No white/grey default scrollbar in plan columns

---

## 7. End-of-day image compression & archive

### Problem
Full-size images in `uploads/images/` accumulate on disk. No lifecycle policy.

### Target

#### 7a. Daily archive job (server-side)
Run at **local midnight** (configurable TZ) or via OpenClaw cron hitting an API:

1. For each file in `uploads/images/` dated **today or earlier** (use mtime or filename date prefix):
   - Generate **log-quality** copy in `uploads/archive/YYYY-MM-DD/`:
     - Max dimension 640px, WebP quality ~50, or JPEG q=60
   - Write manifest `uploads/archive/YYYY-MM-DD/manifest.json`:

```json
{
  "date": "2026-06-24",
  "files": [
    {
      "original": "meeting.png",
      "archived": "meeting.webp",
      "originalBytes": 4200000,
      "archivedBytes": 82000,
      "deletedOriginal": true
    }
  ]
}
```

2. **Delete original** from `uploads/images/` after successful archive.
3. Keep thumbnails dir in sync (delete orphaned thumbs).
4. **Do not delete** files attached to **future** plan lines (parser cross-check).

#### 7b. Configuration (`deploy/env` / `openclaw.json` hook)

| Variable | Default | Purpose |
|----------|---------|---------|
| `HOMEBOT_ARCHIVE_ENABLED` | `true` | Enable nightly archive |
| `HOMEBOT_ARCHIVE_CRON` | `0 0 * * *` | Schedule |
| `HOMEBOT_ARCHIVE_QUALITY` | `50` | WebP quality |
| `HOMEBOT_ARCHIVE_MAX_PX` | `640` | Long edge max |

#### 7c. API

| Endpoint | Description |
|----------|-------------|
| `POST /api/media/archive` | Run archive now (operator) |
| `GET /api/media/archive/status` | Last run, bytes saved, errors |
| `GET /api/media/archive/:date` | List archived files for a day |

### Files to add/change
- `apps/server/src/media/archive.ts` — compression + manifest logic
- `apps/server/src/routes/media.ts` — archive endpoints
- `apps/server/src/server.ts` — optional node-cron scheduler
- `deploy/env.example` — archive vars
- OpenClaw cron example in `SETUP.md`

### Acceptance
- [ ] After archive run, originals removed, low-quality copies in `uploads/archive/YYYY-MM-DD/`
- [ ] Plan items referencing archived images resolve to archive URL
- [ ] Failed compressions do not delete originals (logged)

---

## 8. Bot commands — media purge with confirmation

### Problem
No safe way for OpenClaw agent to purge archived media or entire upload history on user request.

### Target

#### 8a. CLI scripts (Pi)

```bash
~/homebot/deploy/media.sh status          # disk usage, file counts
~/homebot/deploy/media.sh archive         # run archive now
~/homebot/deploy/media.sh purge-archive --before 2026-06-01 --dry-run
~/homebot/deploy/media.sh purge-archive --before 2026-06-01 --confirm
~/homebot/deploy/media.sh purge-all --confirm TOKEN
```

#### 8b. HTTP API (for agent via curl)

| Endpoint | Body | Behavior |
|----------|------|----------|
| `POST /api/media/purge` | `{ "scope": "archive", "before": "2026-06-01", "confirm": false }` | Returns `{ needsConfirm: true, summary }` |
| `POST /api/media/purge` | `{ "scope": "archive", "before": "2026-06-01", "confirm": true, "token": "..." }` | Executes purge |

Confirmation rules:
- **Never purge** without `confirm: true`.
- Optional **confirm token** from `deploy/env` (`HOMEBOT_PURGE_TOKEN`) for destructive `purge-all`.
- Dashboard can show **approval overlay** (like exec approval) when agent requests purge via Gateway webhook.

#### 8c. OpenClaw skill (`skills/homebot-media/SKILL.md`)

Agent workflow:
1. User: “Delete old HomeBot photos from before June”
2. Agent: `curl POST /api/media/purge` dry-run → reports count/size to user
3. Agent: asks “Confirm delete?”
4. User: yes → agent calls with `confirm: true`

### Acceptance
- [ ] Dry-run never deletes files
- [ ] Purge without confirm returns 400
- [ ] Skill documented for OpenClaw workspace

---

## 9. Calendar-style notifications

### Problem
Cron/approval overlays exist, but there is no **calendar event** model with:
- Reminder **10 minutes before**
- Reminder **at event time**
- Touch-closable popup for meetings, reports, etc. (Google Calendar–like)

### Target

#### 9a. Event data source
Store in OpenClaw workspace (agent-maintained):

`memory/YYYY-MM-DD.md`:

```markdown
## Events
- 10:00 TEAM STANDUP — Daily sync | remind:10,0
- 14:00 Q2 REVIEW — Meeting room | remind:10,0 | img:review.png
```

Or dedicated file: `workspace/homebot/events.json`:

```json
{
  "events": [
    {
      "id": "evt-1",
      "title": "Team standup",
      "start": "2026-06-24T10:00:00",
      "end": "2026-06-24T10:30:00",
      "remindMinutes": [10, 0],
      "notes": "Daily sync",
      "image": "standup.png"
    }
  ]
}
```

#### 9b. Server scheduler
- Every minute (or on dashboard poll), compute upcoming triggers:
  - `now + 10min` → fire **upcoming** notification
  - `now` → fire **start** notification
- Persist fired state in `uploads/.notifications/YYYY-MM-DD.json` to avoid duplicates.
- Push via **Socket.IO** `notification:push` to dashboard.

#### 9c. Dashboard UI
- New overlay type `.notification-card` (distinct from cron/approval):
  - Title, time, notes
  - Thumbnail if event has image
  - Large **DISMISS** touch button
  - Optional **SNOOZE 5m** (re-queue)
- Stack at most 1 visible notification; queue others.
- Sound optional (off by default on Pi).

#### 9d. Notification payload

```typescript
interface CalendarNotification {
  id: string;
  eventId: string;
  kind: "upcoming" | "start";  // 10 min vs at-time
  title: string;
  startAt: string;
  notes?: string;
  imageUrl?: string;
  thumbUrl?: string;
}
```

### Files to add/change
- `apps/shared/src/index.ts` — event + notification types
- `apps/server/src/events/` — parser, scheduler, dedupe store
- `apps/server/src/routes/notifications.ts`
- `apps/dashboard/src/main.ts` — notification overlay + socket listener
- `skills/daily-plan/SKILL.md` or new `skills/homebot-events/SKILL.md`

### Acceptance
- [ ] Event at 10:00 shows popup at 9:50 and 10:00
- [ ] Dismiss does not re-show same firing
- [ ] Works when dashboard open full day (kiosk)
- [ ] Agent can add events to today's file via skill

---

## 10. Implementation phases

### Phase A — UI polish (1–2 days)
1. Compact status strip (§1)
2. Small close button (§2)
3. Themed scrollbars (§6)
4. Circle vs row tap split (§5)

### Phase B — Task media & detail (2–3 days)
5. Plan parser attachment fields (§3)
6. Thumbnails in list (§3)
7. Detail popup card (§4)

### Phase C — Media lifecycle (2–3 days)
8. Nightly archive job (§7)
9. Bot purge commands + skill (§8)

### Phase D — Notifications (2–3 days)
10. Events model + parser (§9)
11. Scheduler + Socket.IO push (§9)
12. Notification overlay UI (§9)

---

## 11. OpenClaw agent — prompt template

```
Read FEATURES.md in the HomeBot repo. Implement Phase <A|B|C|D> on the Pi.

Git URL: https://github.com/samsarastudio/HomeBot.git

After changes:
  cd ~/homebot-src && git pull && ./deploy/install-pi.sh
  ~/homebot/deploy/kiosk.sh restart

For media/events: update workspace skills and today's memory file formats per FEATURES.md.
```

---

## 12. Current vs target layout (wireframe)

```
┌──────────────────────────────────────────────────────────┐
│ ✕   GOOD EVENING                          08:45 PM      │  ← small close
│     Wed, Jun 24                                          │
├──────────────────────────────────────────────────────────┤
│ ● ON  CRON 3  RUN 2  3/8  CPU 9%  RAM 32%  DISK 32%     │  ← tiny info strip
├─────────────────────────┬────────────────────────────────┤
│ TODAY'S PLAN            │ DONE TODAY                     │
│ ┌──┬──────────────────┐ │ ┌──┬──────────────────┐       │
│ │○ │ [thumb] WORKOUT  │ │ │✓ │ [thumb] STANDUP  │       │
│ └──┴──────────────────┘ │ └──┴──────────────────┘       │
│      ↑ row tap = detail popup                          │
│      ↑ circle = toggle column                          │
└─────────────────────────┴────────────────────────────────┘

        ┌─────────────────────────────┐
        │ NOTIFICATION / DETAIL CARD  │  ← closable overlay
        │ [image]  Meeting in 10 min  │
        │          [DISMISS]          │
        └─────────────────────────────┘
```

---

## Related docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — API and data paths
- [SETUP.md](SETUP.md) — Pi install
- [skills/daily-plan/SKILL.md](skills/daily-plan/SKILL.md) — plan format (to extend)
