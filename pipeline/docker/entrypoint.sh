#!/usr/bin/env bash
set -euo pipefail
export PYTHONPATH=/app/pipeline
export PIPELINE_CONFIG="${PIPELINE_CONFIG:-/app/pipeline/config.yaml}"
mkdir -p /data/pipeline/incoming /data/pipeline/ready /data/pipeline/logs /tmp/phone-hand-pipeline/incoming /tmp/phone-hand-pipeline/ready
exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/pipeline.conf
