#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${HOMEBOT_ENV:-$SCRIPT_DIR/env}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

PORT="${HOMEBOT_PORT:-8080}"
BASE="http://127.0.0.1:${PORT}/api/media"

usage() {
  cat <<EOF
Usage: media.sh <command> [options]

Commands:
  status                          Show archive status and disk usage
  archive                         Run image archive now
  purge-archive --before DATE     Dry-run purge of archives before DATE
  purge-archive --before DATE --confirm [--token TOKEN]
  purge-all --confirm TOKEN       Purge all uploads (destructive)

Examples:
  ./media.sh status
  ./media.sh archive
  ./media.sh purge-archive --before 2026-06-01
  ./media.sh purge-archive --before 2026-06-01 --confirm
EOF
}

cmd_status() {
  echo "=== Archive status ==="
  curl -sf "${BASE}/archive/status" | python3 -m json.tool 2>/dev/null || curl -sf "${BASE}/archive/status"
  echo
  UPLOADS="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/uploads"
  if [[ -d "$UPLOADS" ]]; then
    echo "=== Disk usage ($UPLOADS) ==="
    du -sh "$UPLOADS"/images "$UPLOADS"/archive "$UPLOADS"/thumbnails 2>/dev/null || du -sh "$UPLOADS"/*
  fi
}

cmd_archive() {
  curl -sf -X POST "${BASE}/archive" | python3 -m json.tool 2>/dev/null || curl -sf -X POST "${BASE}/archive"
  echo
}

cmd_purge_archive() {
  local before="" confirm="false" token=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --before) before="$2"; shift 2 ;;
      --confirm) confirm="true"; shift ;;
      --token) token="$2"; shift 2 ;;
      *) echo "Unknown option: $1"; exit 1 ;;
    esac
  done

  if [[ -z "$before" ]]; then
    echo "Error: --before YYYY-MM-DD required"
    exit 1
  fi

  local body
  body=$(printf '{"scope":"archive","before":"%s","confirm":%s' "$before" "$confirm")
  if [[ -n "$token" ]]; then
    body="${body},\"token\":\"${token}\""
  fi
  body="${body}}"

  curl -sf -X POST "${BASE}/purge" \
    -H "Content-Type: application/json" \
    -d "$body" | python3 -m json.tool 2>/dev/null || curl -sf -X POST "${BASE}/purge" -H "Content-Type: application/json" -d "$body"
  echo
}

cmd_purge_all() {
  local token=""
  local confirm="false"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --confirm) confirm="true"; shift ;;
      --token) token="$2"; shift 2 ;;
      *) echo "Unknown option: $1"; exit 1 ;;
    esac
  done

  if [[ "$confirm" != "true" ]]; then
    echo "Error: purge-all requires --confirm and --token"
    exit 1
  fi

  if [[ -z "$token" ]]; then
    token="${HOMEBOT_PURGE_TOKEN:-}"
  fi

  if [[ -z "$token" ]]; then
    echo "Error: HOMEBOT_PURGE_TOKEN or --token required"
    exit 1
  fi

  curl -sf -X POST "${BASE}/purge" \
    -H "Content-Type: application/json" \
    -d "{\"scope\":\"all\",\"confirm\":true,\"token\":\"${token}\"}" \
    | python3 -m json.tool 2>/dev/null || true
  echo
}

main() {
  local cmd="${1:-}"
  shift || true

  case "$cmd" in
    status) cmd_status ;;
    archive) cmd_archive ;;
    purge-archive) cmd_purge_archive "$@" ;;
    purge-all) cmd_purge_all "$@" ;;
    -h|--help|help|"") usage ;;
    *) echo "Unknown command: $cmd"; usage; exit 1 ;;
  esac
}

main "$@"
