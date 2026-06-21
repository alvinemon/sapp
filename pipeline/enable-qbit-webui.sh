#!/usr/bin/env bash
# Wait until qBittorrent Web UI is reachable, then run pipeline setup.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "Enable Web UI in qBittorrent first:"
echo "  qBittorrent → Settings → Web UI → check 'Web User Interface (Remote control)'"
echo "  Port: 8080 | Username: admin | Password: adminadmin"
echo ""
open -a qBittorrent 2>/dev/null || true

for i in $(seq 1 60); do
  if curl -sf --connect-timeout 2 http://127.0.0.1:8080/api/v2/app/version >/dev/null 2>&1; then
    echo "Web UI detected — configuring AutoFetch category..."
    cd "$ROOT/pipeline"
    PYTHONPATH=. .venv/bin/python3 cli.py setup
    echo "Done. Re-run RSS scan or wait for the next interval."
    exit 0
  fi
  printf "Waiting for Web UI on :8080 (%s/60)...\r" "$i"
  sleep 5
done

echo ""
echo "Timed out. Enable Web UI in qBittorrent, then run: npm run setup:qbit"
