#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
source "$ROOT/scripts/android-env.sh"
APK="${1:-$HOME/Desktop/2hotatl-deploy/2hotatl.apk}"

if [[ ! -f "$APK" ]]; then
  echo "APK not found: $APK"
  echo "Run BUILD-APK.command first."
  exit 1
fi

echo "→ Connect phone via USB, enable USB debugging, then press Enter"
read -r _
adb devices
adb install -r "$APK"
adb shell am start -n com.phonehand.app/.HomeActivity
echo "✓ Installed on phone"
