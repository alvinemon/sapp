#!/usr/bin/env bash
# Keeps a backup copy of 2hotatl running on your Mac when Hostinger flakes out.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$HOME/Desktop"
URL_FILE="$DESKTOP/2hotatl-BACKUP-URL.txt"
RELAY_PORT=3847
LOG="$DESKTOP/2hotatl-backup.log"

cd "$ROOT"
npm run build >/dev/null 2>&1 || true
node scripts/build-cjs.mjs >/dev/null 2>&1 || true

# Don't start a second copy
if curl -sf "http://127.0.0.1:$RELAY_PORT/api/health" >/dev/null 2>&1; then
  echo "Backup server already running on port $RELAY_PORT" >>"$LOG"
else
  node server.cjs -p "$RELAY_PORT" >>"$LOG" 2>&1 &
  sleep 1
fi

echo "Starting backup tunnel…" >>"$LOG"
npx --yes cloudflared tunnel --url "http://127.0.0.1:$RELAY_PORT" 2>>"$LOG" | while IFS= read -r line; do
  echo "$(date) $line" >>"$LOG"
  if [[ "$line" =~ (https://[a-zA-Z0-9-]+\.trycloudflare\.com) ]] || [[ "$line" == *"trycloudflare.com"* ]]; then
    URL=$(echo "$line" | grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' | head -1)
    [[ -z "$URL" ]] && continue
    cat >"$URL_FILE" <<TXT
Use this URL when https://2hotatl.com shows 403:

$URL

Open it in your browser. Keep this Mac on and don't close Terminal.

When Hostinger works again, use https://2hotatl.com instead.
TXT
    osascript -e "display notification \"Backup ready — see 2hotatl-BACKUP-URL.txt on Desktop\" with title \"2hotatl\""
  fi
done
