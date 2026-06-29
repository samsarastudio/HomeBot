# OpenClaw workspace integration

HomeBot keeps **lean bootstrap files** in the repo so OpenClaw does not burn your model context on every turn.

## Context budget (typical)

OpenClaw injects workspace bootstrap files (`AGENTS.md`, `SOUL.md`, etc.) into each turn. Caps are roughly:

- Per file: ~20,000 chars
- Total: ~60,000 chars (`bootstrapTotalMaxChars`)

With a 66k context model, a bloated `AGENTS.md` leaves little room for replies. **`contextInjection: continuation-skip` is protected** in current OpenClaw — you cannot disable per-turn injection via config.

**Fix:** keep `AGENTS.md` short; put detailed rules in **skills** (loaded on demand).

## What HomeBot provides

| Path | Purpose |
|------|---------|
| [templates/AGENTS.md](templates/AGENTS.md) | Lean ~40-line agent template (HomeBot + skill-on-demand) |
| [templates/AGENTS.homebot-snippet.md](templates/AGENTS.homebot-snippet.md) | Merge block for existing AGENTS.md |
| [../skills/](../skills/) | `daily-plan`, `homebot-events`, `homebot-media`, `homebot-setup` |
| [../deploy/sync-openclaw-workspace.sh](../deploy/sync-openclaw-workspace.sh) | Install skills + merge snippet |

## After git pull on Pi

```bash
cd ~/homebot-src && git pull
./deploy/install-pi.sh
./deploy/sync-openclaw-workspace.sh
```

Or sync workspace only (no rebuild):

```bash
~/homebot/deploy/sync-openclaw-workspace.sh
```

## Optional OpenClaw config

If your OpenClaw version allows patching (not protected), lower injection caps to leave room for output:

```json
{
  "agents": {
    "defaults": {
      "bootstrapTotalMaxChars": 40000,
      "bootstrapMaxChars": 15000
    }
  }
}
```

Align Ollama `num_ctx` with OpenClaw `contextWindow` if you increase context size.

## Audit bootstrap size on Pi

```bash
wc -c ~/.openclaw/workspace/*.md
ls ~/.openclaw/workspace/skills/
```

Target: `AGENTS.md` under ~3KB; trim duplicate content from `HEARTBEAT.md` if it repeats AGENTS.
