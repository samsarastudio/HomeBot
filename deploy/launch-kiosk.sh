#!/usr/bin/env bash
# Launch HomeBot in true Chromium kiosk fullscreen (Pi touch display).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${HOMEBOT_ENV:-$SCRIPT_DIR/env}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

PORT="${HOMEBOT_PORT:-8080}"
URL="${KIOSK_URL:-http://127.0.0.1:${PORT}/}"

if [[ -n "${GATEWAY_TOKEN:-}" ]] && [[ "$URL" != *"#token="* ]]; then
  URL="http://127.0.0.1:${PORT}/#token=${GATEWAY_TOKEN}"
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

# True fullscreen — --app mode leaves a windowed frame; --kiosk fills the display.
exec "$CHROMIUM" \
  --kiosk \
  --start-fullscreen \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-translate \
  --no-first-run \
  --no-default-browser-check \
  --check-for-update-interval=31536000 \
  --overscroll-history-navigation=0 \
  --window-name=HomeBot \
  "$URL"
