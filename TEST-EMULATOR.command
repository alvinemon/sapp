#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
source "$ROOT/scripts/android-env.sh"
APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
AVD="${1:-Pixel_6_API_34}"

if [[ ! -f "$APK" ]]; then
  echo "APK missing — run BUILD-APK.command first"
  exit 1
fi

if ! adb devices | grep -qE 'device$'; then
  echo "→ Starting emulator $AVD (headless — first boot can take 1–2 min on 8GB RAM)…"
  nohup emulator -avd "$AVD" -no-window -no-boot-anim -memory 1536 -cores 2 >/tmp/2hotatl-emulator.log 2>&1 &
  echo "→ Waiting for device…"
  adb wait-for-device
  for i in $(seq 1 60); do
    boot=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
    [[ "$boot" == "1" ]] && break
    sleep 3
  done
fi

echo "→ Installing $APK"
adb install -r "$APK"
echo ""
echo "✓ Installed. Open 2hotatl on the emulator."
adb shell am start -n com.phonehand.app/.HomeActivity 2>/dev/null || true
echo ""
echo "Devices:"
adb devices
