#!/usr/bin/env bash
# Control HomeBot kiosk — use this instead of launching Chromium manually.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${HOMEBOT_ENV:-$SCRIPT_DIR/env}"
USER_DATA_DIR="${HOMEBOT_KIOSK_PROFILE:-$HOME/.config/homebot-kiosk}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  USER_DATA_DIR="${HOMEBOT_KIOSK_PROFILE:-$USER_DATA_DIR}"
fi

is_running() {
  pgrep -f "user-data-dir=${USER_DATA_DIR}" >/dev/null 2>&1
}

cmd="${1:-status}"

case "$cmd" in
  start)
    if is_running; then
      echo "already running"
      exit 0
    fi
    exec "$SCRIPT_DIR/launch-kiosk.sh"
    ;;
  stop)
    exec "$SCRIPT_DIR/stop-kiosk.sh"
    ;;
  restart)
    "$SCRIPT_DIR/stop-kiosk.sh"
    sleep 1
    exec "$SCRIPT_DIR/launch-kiosk.sh"
    ;;
  status)
    if is_running; then
      echo "running"
      pgrep -af "user-data-dir=${USER_DATA_DIR}" || true
      exit 0
    fi
    echo "stopped"
    exit 1
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}" >&2
    exit 2
    ;;
esac
