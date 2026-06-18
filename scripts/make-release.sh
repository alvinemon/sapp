#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/release"
DEPLOY="$OUT/app"

rm -rf "$OUT"
mkdir -p "$DEPLOY/dist" "$DEPLOY/scripts"

echo "→ Building release APK…"
bash "$ROOT/scripts/build-release-apk.sh"

echo "→ Building frontend + server…"
cd "$ROOT"
npm run build

cp "$ROOT/app.js" "$DEPLOY/app.js"
cp "$ROOT/index.js" "$DEPLOY/index.js"
cp -R "$ROOT/dist/index.html" "$ROOT/dist/assets" "$DEPLOY/dist/"
[[ -f "$ROOT/dist/install.html" ]] && cp "$ROOT/dist/install.html" "$DEPLOY/dist/"
[[ -d "$ROOT/dist/download" ]] && cp -R "$ROOT/dist/download" "$DEPLOY/dist/"
cp -R "$ROOT/dist/server" "$DEPLOY/dist/server"
cp "$ROOT/scripts/verify-deploy.mjs" "$DEPLOY/scripts/verify-deploy.mjs"

cat > "$DEPLOY/package.json" <<'PKG'
{
  "name": "2hotatl",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20.0.0" },
  "main": "index.js",
  "scripts": {
    "build": "node scripts/verify-deploy.mjs",
    "start": "node index.js"
  },
  "dependencies": {
    "express": "^4.21.2",
    "ws": "^8.18.0"
  }
}
PKG

echo "→ Installing production dependencies (for package-lock.json)…"
cd "$DEPLOY"
npm install --omit=dev

cat > "$DEPLOY/README-HOSTINGER.txt" <<'README'
2hotatl — Hostinger Express.js deploy
=====================================

Upload this zip at the ROOT level (package.json must be at zip root, not in a subfolder).

hPanel → Websites → 2hotatl.com → Node.js → drag & drop zip

Settings (Deployments → Settings):
  Framework:        Express.js
  Node.js version:  20
  Root directory:   (empty)
  Output directory: (empty — do NOT use "dist")
  Entry file:       index.js
  Install command:  npm install
  Build command:    npm run build
  Start command:    npm start -- -p $PORT

  Optional env var (if start command above fails): PORT=3000

Layout:
  index.js            → starts Express + WebSocket server
  app.js              → same as index.js (alias)
  package.json        → express + ws dependencies
  dist/index.html     → React UI
  dist/assets/        → static JS/CSS
  dist/server/        → compiled backend (index.js, relay.js)

Do NOT include node_modules in the zip — Hostinger installs them.

Test:
  https://2hotatl.com/api/health
  https://2hotatl.com/api/status
  https://2hotatl.com
README

zip -rq "$OUT/2hotatl-upload.zip" . -x "*.DS_Store" -x "node_modules/*"
tar -czf "$OUT/2hotatl-upload.tar.gz" --exclude=node_modules .

cp "$OUT/2hotatl-upload.zip" "$OUT/2hotatl-upload.tar.gz" /Users/alvin/Desktop/

SIZE=$(du -h "$OUT/2hotatl-upload.zip" | cut -f1)
LOCK_PKGS=$(node -e "const l=require('./package-lock.json'); console.log(Object.keys(l.packages||{}).length)")
echo ""
echo "✓ 2hotatl-upload.zip ($SIZE) — $LOCK_PKGS packages in lockfile"
ls -lh "$OUT/2hotatl-upload.zip"
echo ""
unzip -l "$OUT/2hotatl-upload.zip" | head -25

echo "→ Local deploy test (npm install + start)…"
TEST=/tmp/2hotatl-test
rm -rf "$TEST" && mkdir "$TEST"
unzip -q "$OUT/2hotatl-upload.zip" -d "$TEST"
cd "$TEST"
npm install --omit=dev
npm run build
npm start -- -p 3777 &
PID=$!
sleep 2
curl -sf "http://localhost:3777/api/health" && echo " ✓ health OK" || echo " ✗ health FAILED"
curl -sf "http://localhost:3777/api/status" && echo " ✓ status OK" || echo " ✗ status FAILED"
kill $PID 2>/dev/null || true

APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK" ]; then
  mkdir -p "$OUT/2hotatl-android"
  cp "$APK" "$OUT/2hotatl-android/2hotatl.apk"
  (cd "$OUT/2hotatl-android" && zip -q "$OUT/2hotatl-android.zip" 2hotatl.apk)
  cp "$OUT/2hotatl-android.zip" /Users/alvin/Desktop/ 2>/dev/null || true
fi
