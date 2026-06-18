#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/android"
KS="2hotatl-release.keystore"
if [[ ! -f "$KS" ]]; then
  echo "→ Creating release keystore ($KS)…"
  keytool -genkeypair -v \
    -keystore "$KS" \
    -alias hotatl \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass hotatl2026 -keypass hotatl2026 \
    -dname "CN=2hotatl, OU=Personal, O=2hotatl, L=Atlanta, ST=GA, C=US"
fi
./gradlew assembleRelease
APK="app/build/outputs/apk/release/app-release.apk"
cp "$APK" "$ROOT/../2hotatl.apk"
mkdir -p "$ROOT/public/download"
cp "$APK" "$ROOT/public/download/2hotatl.apk"
echo "✓ Release APK: $(pwd)/$APK"
echo "✓ Desktop: $ROOT/../2hotatl.apk"
echo "✓ Web download: public/download/2hotatl.apk"
if command -v apksigner >/dev/null 2>&1; then
  apksigner verify --verbose "$APK" | head -5
fi
