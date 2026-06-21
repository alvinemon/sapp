#!/usr/bin/env bash
# Start local pipeline stack: qBittorrent (if needed) + Python worker + Node relay.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SECRET="${PIPELINE_WORKER_SECRET:-local-dev-secret}"
WORKER_PORT="${PIPELINE_WORKER_PORT:-8765}"
RELAY_PORT="${PORT:-3000}"

echo "=== 2hotatl local pipeline stack ==="

# qBittorrent Web UI
if ! curl -sf "http://127.0.0.1:8080/api/v2/app/version" >/dev/null 2>&1; then
  echo "[stack] Starting qBittorrent..."
  npm run start:qbit &
  for i in $(seq 1 30); do
    curl -sf "http://127.0.0.1:8080/api/v2/app/version" >/dev/null 2>&1 && break
    sleep 2
  done
fi
echo "[stack] qBittorrent OK"

# Pipeline worker
if ! curl -sf -H "Authorization: Bearer $SECRET" "http://127.0.0.1:${WORKER_PORT}/health" >/dev/null 2>&1; then
  echo "[stack] Starting pipeline worker on :${WORKER_PORT}..."
  PIPELINE_WORKER_SECRET="$SECRET" NODE_API_BASE="http://127.0.0.1:${RELAY_PORT}" \
    bash scripts/start-pipeline-worker.sh &
  for i in $(seq 1 20); do
    curl -sf -H "Authorization: Bearer $SECRET" "http://127.0.0.1:${WORKER_PORT}/health" >/dev/null 2>&1 && break
    sleep 1
  done
fi
echo "[stack] Pipeline worker OK"

# Node relay (foreground if not already running)
if curl -sf "http://127.0.0.1:${RELAY_PORT}/api/pipeline/status" >/dev/null 2>&1; then
  echo "[stack] Node relay already on :${RELAY_PORT}"
else
  echo "[stack] Starting Node relay on :${RELAY_PORT}..."
  PORT="$RELAY_PORT" npm run dev:server
fi
