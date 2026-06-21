#!/usr/bin/env bash
# Start qBittorrent with Web UI enabled (uses ~/.config/qBittorrent/qBittorrent.ini on macOS).
set -euo pipefail

INI="$HOME/.config/qBittorrent/qBittorrent.ini"
INCOMING="${1:-$(cd "$(dirname "$0")/.." && pwd)/data/pipeline/incoming}"

mkdir -p "$(dirname "$INI")" "$INCOMING"

if ! grep -q 'WebUI\\Enabled=true' "$INI" 2>/dev/null; then
  cat >> "$INI" <<INI

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
Session\\DefaultSavePath=$INCOMING
Categories\\AutoFetch\\SavePath=$INCOMING
INI
  echo "Wrote Web UI settings to $INI"
fi

if curl -sf --connect-timeout 2 http://127.0.0.1:8080/api/v2/app/version >/dev/null 2>&1; then
  echo "qBittorrent Web UI already running on :8080"
  exit 0
fi

if [[ ! -d "/Applications/qBittorrent.app" ]]; then
  echo "qBittorrent.app not found. Install from https://www.qbittorrent.org/download.php"
  exit 1
fi

open -a qBittorrent

for i in $(seq 1 30); do
  if curl -sf --connect-timeout 2 http://127.0.0.1:8080/api/v2/app/version >/dev/null 2>&1; then
    echo "qBittorrent Web UI ready — http://127.0.0.1:8080 (admin / adminadmin)"
    exit 0
  fi
  sleep 2
done

echo "Timed out waiting for Web UI. Config is at $INI"
exit 1
