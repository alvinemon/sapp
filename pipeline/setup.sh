#!/usr/bin/env bash
# Bootstrap the content pipeline: dirs, Python venv, ffmpeg, qBittorrent Web UI.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIPELINE="$ROOT/pipeline"
DATA="$ROOT/data/pipeline"

echo "==> Creating data directories"
mkdir -p "$DATA"/{incoming,ready,logs}
[[ -f "$ROOT/data/catalog.json" ]] || echo '{"items":[]}' > "$ROOT/data/catalog.json"
[[ -f "$DATA/state.json" ]] || echo '{}' > "$DATA/state.json"
[[ -f "$DATA/upload_log.json" ]] || echo '{"uploads":[]}' > "$DATA/upload_log.json"

echo "==> Python venv + dependencies"
cd "$PIPELINE"
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt

echo "==> ffmpeg / ffprobe"
if ! command -v ffprobe >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install ffmpeg
  else
    echo "WARN: ffprobe missing — install ffmpeg for subtitle extraction"
  fi
fi

echo "==> qBittorrent"
QBIT_INI="$HOME/.config/qBittorrent/qBittorrent.ini"
INCOMING_DIR="$DATA/incoming"
if ! command -v qbt >/dev/null 2>&1 && [[ ! -d "/Applications/qBittorrent.app" ]]; then
  if command -v brew >/dev/null 2>&1; then
    brew install --cask qbittorrent || true
  fi
fi

configure_qbit_ini() {
  mkdir -p "$(dirname "$QBIT_INI")" "$INCOMING_DIR"
  if ! grep -q 'WebUI\\Enabled=true' "$QBIT_INI" 2>/dev/null; then
    cat >> "$QBIT_INI" <<INI

[Preferences]
WebUI\\Enabled=true
WebUI\\Address=127.0.0.1
WebUI\\Port=8080
WebUI\\Username=admin
WebUI\\Password_PBKDF2="@ByteArray(ARQAAAAH5vo3QApyXPQT4FARAAAKC8H5vo3QDE7j+2C7g=)"
WebUI\\LocalHostAuth=false
WebUI\\BypassLocalAuth=true
WebUI\\CSRFProtection=false
WebUI\\ClickjackingProtection=false
WebUI\\SecureCookie=false
WebUI\\HostHeaderValidation=false
Session\\DefaultSavePath=$INCOMING_DIR
Categories\\AutoFetch\\SavePath=$INCOMING_DIR
INI
    echo "Appended Web UI settings to ~/.config/qBittorrent/qBittorrent.ini"
  fi
}

configure_qbit_ini

if [[ -d "/Applications/qBittorrent.app" ]]; then
  bash "$(dirname "$0")/start-qbittorrent.sh" "$INCOMING_DIR" || true
fi

echo "==> Pipeline setup (qBittorrent category + paths)"
PYTHONPATH="$PIPELINE" python3 cli.py setup || echo "WARN: qBittorrent setup deferred — start qBittorrent and re-run: cd pipeline && python3 cli.py setup"

echo "==> Done"
echo "  incoming: $DATA/incoming"
echo "  ready:    $DATA/ready"
echo "  config:   $PIPELINE/config.yaml"
echo "Start server: cd $ROOT && npm run build && npm run dev:server"
