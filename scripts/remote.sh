#!/usr/bin/env bash
# Start PhoneHand for cross-network use: phone on SIM, browser on different Wi‑Fi.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

rm -f .relay-url
echo "📡 PhoneHand — cross-network mode"
echo "   Phone can use 4G/5G · Browser can use any Wi‑Fi"
echo ""

npm run dev &
DEV_PID=$!
cleanup() { kill "$DEV_PID" 2>/dev/null || true; }
trap cleanup EXIT

echo "Waiting for dev server..."
for i in $(seq 1 30); do
  curl -sf http://localhost:5173/api/health >/dev/null 2>&1 && break
  sleep 1
done

echo "Opening internet tunnel (Cloudflare)..."
echo ""

npx --yes cloudflared tunnel --url http://localhost:5173 2>&1 | while IFS= read -r line; do
  echo "$line"
  if [[ "$line" =~ (https://[a-zA-Z0-9-]+\.trycloudflare\.com) ]]; then
    URL="${BASH_REMATCH[1]}"
    echo "$URL" > .relay-url
    echo ""
    echo "══════════════════════════════════════════════════"
    echo "  PUBLIC RELAY URL (use in Android app):"
    echo "  $URL"
    echo "══════════════════════════════════════════════════"
    echo ""
    echo "  1. Open that URL in your browser (any Wi‑Fi)"
    echo "  2. Turn OFF Wi‑Fi on phone → use SIM data only"
    echo "  3. Paste URL + pairing code in PhoneHand app"
    echo ""
  fi
done
