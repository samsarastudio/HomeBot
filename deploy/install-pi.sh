#!/usr/bin/env bash
set -euo pipefail

HOMEBOT_DIR="${HOMEBOT_DIR:-$HOME/homebot}"
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
CONFIG="$STATE_DIR/openclaw.json"
ENV_FILE="$HOMEBOT_DIR/deploy/env"

echo "==> HomeBot Pi installer"
echo "    Target: $HOMEBOT_DIR"
echo "    OpenClaw state: $STATE_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js 22+ required"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Installing pnpm..."
  npm install -g pnpm
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ "$(cd "$REPO_ROOT" && pwd)" != "$(cd "$HOMEBOT_DIR" && pwd)" ]]; then
  mkdir -p "$HOMEBOT_DIR"
  rsync -a --delete \
    --exclude node_modules \
    --exclude .git \
    "$REPO_ROOT/" "$HOMEBOT_DIR/"
fi

cd "$HOMEBOT_DIR"
pnpm install
pnpm build

mkdir -p "$(dirname "$ENV_FILE")"
cp deploy/env.example "$ENV_FILE"

# Extract gateway token from openclaw.json (JSON5-ish — best effort)
TOKEN=""
if [[ -f "$CONFIG" ]]; then
  TOKEN=$(node -e "
    const fs = require('fs');
    const raw = fs.readFileSync('$CONFIG','utf8');
    const m = raw.match(/\"token\"\\s*:\\s*\"([^\"]+)\"/);
    if (m) console.log(m[1]);
    else {
      const m2 = raw.match(/gateway[\\s\\S]*?auth[\\s\\S]*?token\\s*:\\s*['\"]([^'\"]+)['\"]/);
      if (m2) console.log(m2[1]);
    }
  " 2>/dev/null || true)
fi

{
  echo "OPENCLAW_STATE_DIR=$STATE_DIR"
  echo "HOMEBOT_PORT=8080"
  echo "OPENCLAW_GATEWAY_PORT=18789"
  echo "DISPLAY=:0"
  if [[ -n "$TOKEN" ]]; then
    echo "GATEWAY_TOKEN=$TOKEN"
  else
    echo "# GATEWAY_TOKEN=set-manually"
  fi
} > "$ENV_FILE"

# systemd user units
mkdir -p "$HOME/.config/systemd/user"

sed "s|%h/homebot|$HOMEBOT_DIR|g" deploy/homebot-server.service > "$HOME/.config/systemd/user/homebot-server.service"

KIOSK_URL="http://127.0.0.1:8080/"
if [[ -n "$TOKEN" ]]; then
  KIOSK_URL="http://127.0.0.1:8080/#token=$TOKEN"
fi

sed "s|%h/homebot|$HOMEBOT_DIR|g" deploy/homebot-kiosk.service \
  | sed "s|__KIOSK_URL__|$KIOSK_URL|g" \
  > "$HOME/.config/systemd/user/homebot-kiosk.service"

systemctl --user daemon-reload
systemctl --user enable homebot-server.service
systemctl --user restart homebot-server.service

echo ""
echo "Installed. Server: systemctl --user status homebot-server"
echo "Start kiosk:      systemctl --user start homebot-kiosk"
echo "Open in browser:  $KIOSK_URL"
echo ""
echo "Copy skills/daily-plan to your OpenClaw workspace if desired:"
echo "  cp -r $HOMEBOT_DIR/skills/daily-plan $STATE_DIR/workspace/skills/"
