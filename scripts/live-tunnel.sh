#!/usr/bin/env bash
# Run 2hotatl on your Mac + public Cloudflare URL (works while Hostinger is broken).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
RELAY_PORT=3847

npm run build >/dev/null
node scripts/build-cjs.mjs >/dev/null

echo "Starting server on port $RELAY_PORT..."
node server.cjs -p "$RELAY_PORT" &
SRV=$!
cleanup() { kill "$SRV" 2>/dev/null || true; }
trap cleanup EXIT

sleep 1
curl -sf "http://127.0.0.1:$RELAY_PORT/api/health" >/dev/null || { echo "Server failed to start"; exit 1; }

echo ""
echo "Opening Cloudflare tunnel (public HTTPS URL)..."
echo ""

npx --yes cloudflared tunnel --url "http://127.0.0.1:$RELAY_PORT" 2>&1 | while IFS= read -r line; do
  echo "$line"
  if [[ "$line" =~ (https://[a-zA-Z0-9-]+\.trycloudflare\.com) ]]; then
    URL="${BASH_REMATCH[1]}"
    echo ""
    echo "════════════════════════════════════════"
    echo "  LIVE URL (use until Hostinger fixed):"
    echo "  $URL"
    echo "════════════════════════════════════════"
    echo ""
    echo "  Browser: open that URL"
    echo "  Phone:   change relay_host in strings.xml to host only (no https)"
    echo "           then rebuild APK, or wait for Hostinger fix"
    echo ""
  fi
done
