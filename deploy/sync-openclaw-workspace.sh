#!/usr/bin/env bash
# Sync HomeBot skills and lean AGENTS snippet into OpenClaw workspace.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
WORKSPACE="$STATE_DIR/workspace"
SKILLS_DST="$WORKSPACE/skills"
AGENTS_FILE="$WORKSPACE/AGENTS.md"
TEMPLATE_AGENTS="$REPO_ROOT/openclaw/templates/AGENTS.md"
SNIPPET="$REPO_ROOT/openclaw/templates/AGENTS.homebot-snippet.md"
REPLACE_AGENTS=false

for arg in "$@"; do
  case "$arg" in
    --replace-agents) REPLACE_AGENTS=true ;;
    -h|--help)
      echo "Usage: sync-openclaw-workspace.sh [--replace-agents]"
      echo "  Copies HomeBot skills to ~/.openclaw/workspace/skills/"
      echo "  Merges HomeBot section into AGENTS.md (or replaces with lean template)"
      exit 0
      ;;
  esac
done

echo "==> Sync OpenClaw workspace for HomeBot"
echo "    State dir: $STATE_DIR"
echo "    Workspace: $WORKSPACE"

mkdir -p "$SKILLS_DST" "$WORKSPACE/memory"

for skill in daily-plan homebot-events homebot-media homebot-setup; do
  src="$REPO_ROOT/skills/$skill"
  if [[ ! -d "$src" ]]; then
    echo "Warning: missing skill $src" >&2
    continue
  fi
  mkdir -p "$SKILLS_DST/$skill"
  cp "$src/SKILL.md" "$SKILLS_DST/$skill/SKILL.md"
  echo "    skill: $skill"
done

if [[ "$REPLACE_AGENTS" == true ]]; then
  if [[ -f "$AGENTS_FILE" ]]; then
    cp "$AGENTS_FILE" "$AGENTS_FILE.bak.$(date +%Y%m%d%H%M%S)"
    echo "    backed up existing AGENTS.md"
  fi
  cp "$TEMPLATE_AGENTS" "$AGENTS_FILE"
  echo "    AGENTS.md: replaced with lean HomeBot template"
else
  if [[ ! -f "$AGENTS_FILE" ]]; then
    cp "$TEMPLATE_AGENTS" "$AGENTS_FILE"
    echo "    AGENTS.md: created from lean template"
  elif grep -q 'homebot:begin' "$AGENTS_FILE" 2>/dev/null; then
    BEGIN_LINE=$(grep -n 'homebot:begin' "$AGENTS_FILE" | head -1 | cut -d: -f1)
    END_LINE=$(grep -n 'homebot:end' "$AGENTS_FILE" | head -1 | cut -d: -f1)
    if [[ -n "$BEGIN_LINE" && -n "$END_LINE" && "$END_LINE" -gt "$BEGIN_LINE" ]]; then
      {
        head -n "$((BEGIN_LINE - 1))" "$AGENTS_FILE"
        cat "$SNIPPET"
        tail -n "+$((END_LINE + 1))" "$AGENTS_FILE"
      } > "$AGENTS_FILE.tmp"
      mv "$AGENTS_FILE.tmp" "$AGENTS_FILE"
      echo "    AGENTS.md: updated HomeBot section (markers)"
    fi
  else
    echo "" >> "$AGENTS_FILE"
    cat "$SNIPPET" >> "$AGENTS_FILE"
    echo "    AGENTS.md: appended HomeBot section"
  fi
fi

echo ""
echo "Bootstrap file sizes:"
for f in "$WORKSPACE"/*.md; do
  [[ -f "$f" ]] || continue
  bytes=$(wc -c < "$f" | tr -d ' ')
  lines=$(wc -l < "$f" | tr -d ' ')
  printf "  %6s bytes  %4s lines  %s\n" "$bytes" "$lines" "$(basename "$f")"
done

echo ""
echo "Skills installed:"
ls -1 "$SKILLS_DST" 2>/dev/null || true
echo ""
echo "Done. For a full lean AGENTS reset: $0 --replace-agents"
