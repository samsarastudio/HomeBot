#!/usr/bin/env bash
# Stop all HomeBot kiosk Chromium instances (safe to run before start).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${HOMEBOT_ENV:-$SCRIPT_DIR/env}"
PORT="${HOMEBOT_PORT:-8080}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  PORT="${HOMEBOT_PORT:-8080}"
fi

USER_DATA_DIR="${HOMEBOT_KIOSK_PROFILE:-$HOME/.config/homebot-kiosk}"

kill_pattern() {
  local pattern="$1"
  if pgrep -f "$pattern" >/dev/null 2>&1; then
    pkill -f "$pattern" 2>/dev/null || true
    return 0
  fi
  return 1
}

killed=false
kill_pattern "user-data-dir=${USER_DATA_DIR}" && killed=true
kill_pattern "chromium.*--kiosk.*127.0.0.1:${PORT}" && killed=true
kill_pattern "chromium.*--kiosk.*localhost:${PORT}" && killed=true
kill_pattern "chromium-browser.*--kiosk.*127.0.0.1:${PORT}" && killed=true

if $killed; then
  sleep 1
  # Force any survivors
  pkill -9 -f "user-data-dir=${USER_DATA_DIR}" 2>/dev/null || true
fi

rm -f "${SCRIPT_DIR}/kiosk.lock" 2>/dev/null || true

echo "HomeBot kiosk stopped"
