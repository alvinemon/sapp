#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source scripts/android-env.sh
echo "JAVA_HOME=$JAVA_HOME"
java -version
echo ""
echo "→ Building release APK…"
cd android
./gradlew assembleRelease
APK="app/build/outputs/apk/release/app-release.apk"
mkdir -p "$HOME/Desktop/2hotatl-deploy"
cp "$APK" "$HOME/Desktop/2hotatl-deploy/2hotatl.apk"
cp "$APK" "../dist/download/2hotatl.apk" 2>/dev/null || true
echo ""
echo "✓ APK: $HOME/Desktop/2hotatl-deploy/2hotatl.apk"
ls -lh "$HOME/Desktop/2hotatl-deploy/2hotatl.apk"
