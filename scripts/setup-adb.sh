#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$ROOT/platform-tools"
ZIP="$ROOT/platform-tools.zip"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS-$ARCH" in
  Darwin-arm64)  PLATFORM="darwin" ;;
  Darwin-x86_64) PLATFORM="darwin" ;;
  Linux-x86_64)  PLATFORM="linux" ;;
  Linux-aarch64) PLATFORM="linux" ;;
  *)
    echo "Unsupported platform: $OS $ARCH"
    echo "Install Android platform-tools manually: https://developer.android.com/tools/releases/platform-tools"
    exit 1
    ;;
esac

if [ -x "$TOOLS/adb" ]; then
  echo "✓ ADB already installed at $TOOLS/adb"
  "$TOOLS/adb" version
  exit 0
fi

URL="https://dl.google.com/android/repository/platform-tools-latest-${PLATFORM}.zip"
echo "Downloading Android platform-tools for $PLATFORM..."
curl -fsSL "$URL" -o "$ZIP"

echo "Extracting..."
rm -rf "$TOOLS"
unzip -q "$ZIP" -d "$ROOT"
rm "$ZIP"

chmod +x "$TOOLS/adb"
echo "✓ ADB installed at $TOOLS/adb"
"$TOOLS/adb" version

echo ""
echo "Next steps:"
echo "  1. Enable Developer Options + USB debugging on your Android"
echo "  2. Connect via USB, or wireless: adb tcpip 5555 && adb connect <phone-ip>:5555"
echo "  3. Run: npm run dev"
