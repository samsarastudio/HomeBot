#!/usr/bin/env bash
# Launch HomeBot in true Chromium kiosk fullscreen — single instance only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${HOMEBOT_ENV:-$SCRIPT_DIR/env}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

PORT="${HOMEBOT_PORT:-8080}"
URL="${KIOSK_URL:-http://127.0.0.1:${PORT}/}"
USER_DATA_DIR="${HOMEBOT_KIOSK_PROFILE:-$HOME/.config/homebot-kiosk}"
LOCK_FILE="${SCRIPT_DIR}/kiosk.lock"

if [[ -n "${GATEWAY_TOKEN:-}" ]] && [[ "$URL" != *"#token="* ]]; then
  URL="http://127.0.0.1:${PORT}/#token=${GATEWAY_TOKEN}"
fi

is_running() {
  pgrep -f "user-data-dir=${USER_DATA_DIR}" >/dev/null 2>&1
}

if is_running; then
  echo "HomeBot kiosk already running (profile: ${USER_DATA_DIR})"
  exit 0
fi

CHROMIUM=""
for candidate in chromium-browser chromium google-chrome; do
  if command -v "$candidate" >/dev/null 2>&1; then
    CHROMIUM="$candidate"
    break
  fi
done

if [[ -z "$CHROMIUM" ]]; then
  echo "Error: chromium-browser not found" >&2
  exit 1
fi

export DISPLAY="${DISPLAY:-:0}"
mkdir -p "$USER_DATA_DIR"

# Prevent concurrent launches (bot/systemd double-start).
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  if is_running; then
    echo "HomeBot kiosk already running"
    exit 0
  fi
  flock 9
fi

# Clean stale Chromium from prior crashes before starting exactly one window.
"$SCRIPT_DIR/stop-kiosk.sh" >/dev/null 2>&1 || true
sleep 0.5

if is_running; then
  echo "HomeBot kiosk already running"
  exit 0
fi

# One dedicated profile + one URL = one kiosk window, no restored tabs.
exec "$CHROMIUM" \
  --user-data-dir="$USER_DATA_DIR" \
  --kiosk \
  --start-fullscreen \
  --new-window \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --disable-translate \
  --no-first-run \
  --no-default-browser-check \
  --check-for-update-interval=31536000 \
  --overscroll-history-navigation=0 \
  --window-name=HomeBot \
  "$URL"
