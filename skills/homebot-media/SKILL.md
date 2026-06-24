---
name: homebot-media
description: Manage HomeBot upload images — archive, purge, and disk status with user confirmation.
---

# HomeBot Media Lifecycle

HomeBot stores images in `uploads/images/` under the OpenClaw state directory. The server can compress and archive old images nightly and purge archives on request.

## CLI (Pi)

```bash
~/homebot/deploy/media.sh status
~/homebot/deploy/media.sh archive
~/homebot/deploy/media.sh purge-archive --before 2026-06-01
~/homebot/deploy/media.sh purge-archive --before 2026-06-01 --confirm
~/homebot/deploy/media.sh purge-all --confirm "$HOMEBOT_PURGE_TOKEN"
```

## HTTP API

Base: `http://127.0.0.1:8080/api/media`

| Endpoint | Method | Body |
|----------|--------|------|
| `/archive` | POST | — run archive now |
| `/archive/status` | GET | last run stats |
| `/archive/list/:date` | GET | manifest for date |
| `/purge` | POST | see below |

### Purge (always confirm with user first)

**Dry run** (no files deleted):

```bash
curl -s -X POST http://127.0.0.1:8080/api/media/purge \
  -H "Content-Type: application/json" \
  -d '{"scope":"archive","before":"2026-06-01","confirm":false}'
```

Response includes `needsConfirm: true` and a summary of files/bytes.

**Execute** after user says yes:

```bash
curl -s -X POST http://127.0.0.1:8080/api/media/purge \
  -H "Content-Type: application/json" \
  -d '{"scope":"archive","before":"2026-06-01","confirm":true}'
```

**Purge all** (destructive — requires token from `deploy/env`):

```bash
curl -s -X POST http://127.0.0.1:8080/api/media/purge \
  -H "Content-Type: application/json" \
  -d '{"scope":"all","confirm":true,"token":"YOUR_PURGE_TOKEN"}'
```

## Agent workflow

1. User asks to delete old photos or free disk space.
2. Run **dry-run** purge and report count + size to the user.
3. Ask: "Confirm delete? This cannot be undone."
4. Only if user confirms, call with `"confirm": true`.
5. Never call purge with `confirm: true` without explicit user approval.

## Archive behavior

- Runs at local midnight when `HOMEBOT_ARCHIVE_ENABLED=true`
- Compresses images to WebP in `uploads/archive/YYYY-MM-DD/`
- Deletes originals after successful archive
- Skips images referenced in today's `## Plan` lines (`{img:...}`)

## Plan image syntax

Reference images in plan lines:

```markdown
- [ ] 09:00 WORKOUT — Gym {img:workout.jpg}
```

Archived images resolve via `/api/media/archive/:date/:filename`.
