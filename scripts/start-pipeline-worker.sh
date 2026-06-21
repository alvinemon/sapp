#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/pipeline"

SECRET="${PIPELINE_WORKER_SECRET:-local-dev-secret}"
PORT="${PIPELINE_WORKER_PORT:-8765}"
NODE_BASE="${NODE_API_BASE:-http://127.0.0.1:3000}"

export PIPELINE_WORKER_SECRET="$SECRET"
export NODE_API_BASE="$NODE_BASE"
export PYTHONPATH="$ROOT/pipeline"

PY="$ROOT/pipeline/.venv/bin/python3"
if [[ ! -x "$PY" ]]; then
  PY=python3
fi

echo "[pipeline-worker] Starting on 127.0.0.1:${PORT} → relay ${NODE_BASE}"
exec "$PY" -m uvicorn worker:app --host 127.0.0.1 --port "$PORT"
