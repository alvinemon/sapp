#!/usr/bin/env bash
# Puts deploy files on Desktop in ~/Desktop/2hotatl-deploy/ (wiped each run).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="$HOME/Desktop/2hotatl-deploy"
ZIP="$DEPLOY/2hotatl-upload.zip"
APK="$DEPLOY/2hotatl.apk"
STAGE="$(mktemp -d)"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

echo "→ Clearing $DEPLOY …"
rm -rf "$DEPLOY"
mkdir -p "$DEPLOY"

echo "→ Building frontend + server bundle…"
cd "$ROOT"
npm run build
node scripts/build-cjs.mjs

echo "→ Packaging web zip (no node_modules — Hostinger installs deps)…"
mkdir -p "$STAGE/dist" "$STAGE/scripts"
cp "$ROOT/server.cjs" "$STAGE/"

# Hostinger framework always uses index.js as entry — load the bundled server from there.
cat > "$STAGE/index.js" <<'ENTRY'
// Hostinger entry (framework default) — bundled server, no npm install needed
require("./server.cjs");
ENTRY

cp "$STAGE/index.js" "$STAGE/app.js"

cp -R "$ROOT/dist/index.html" "$ROOT/dist/assets" "$STAGE/dist/"
[[ -f "$ROOT/dist/install.html" ]] && cp "$ROOT/dist/install.html" "$STAGE/dist/"
[[ -d "$ROOT/dist/download" ]] && cp -R "$ROOT/dist/download" "$STAGE/dist/"
cp "$ROOT/scripts/verify-deploy.mjs" "$STAGE/scripts/verify-deploy.mjs"
[[ -f "$ROOT/scripts/SECONDARY.txt" ]] && cp "$ROOT/scripts/SECONDARY.txt" "$STAGE/SECONDARY.txt"

cat > "$STAGE/package.json" <<'PKG'
{
  "name": "2hotatl",
  "version": "1.0.0",
  "private": true,
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

cd "$STAGE"
node scripts/verify-deploy.mjs

cat > "$STAGE/READ_ME_FIRST.txt" <<'NOTE'
CRITICAL — wrong framework = 403 Forbidden
============================================
Hostinger often auto-detects this zip as "Vite" (static site).
That sets Output directory = dist → only HTML is served, Node never runs → 403.

In hPanel → Node.js → Settings, set:
  Framework:        Express.js  (or "Other" — NOT Vite)
  Output directory: (EMPTY — delete "dist" if shown)
  Entry file:       index.js
  Node version:     20
  Build command:    npm run build
  Start command:    npm start -- -p $PORT

Then Deploy → Restart → test /api/health

If still 403: upload public-html-fix.zip to File Manager → public_html
NOTE

cat > "$STAGE/HOSTINGER.txt" <<'H'
2hotatl — Hostinger redeploy (fixes 403 Forbidden)
==================================================

403 means the Node app is NOT running. Hostinger CDN (hcdn) shows
that page when the app is down, crashed, or misconfigured.

UPLOAD: 2hotatl-upload.zip (this folder on Desktop)

hPanel → Websites → 2hotatl.com → Node.js → Deploy

Settings — copy exactly:
  Framework:        Express.js         (NOT Vite — Vite causes 403)
  Entry file:       index.js
  Node version:     20
  Root directory:   (empty)
  Output directory: (EMPTY — must not be "dist")
  Install command:  (empty)
  Build command:    npm run build
  Start command:    npm start -- -p $PORT

After deploy → click Restart → wait 30s → open:
  https://2hotatl.com/api/health   (must show {"ok":true})
  https://2hotatl.com              (must load UI, not 403)

Still 403?
  1. hPanel → Performance → CDN → Disable (test again)
  2. File Manager → app root → read stderr.log for crash reason
  3. Keep data/ folder (device secrets) — do not delete
  4. Use https://2hotatl.com only (no www)
  5. Set up api.2hotatl.com subdomain WITHOUT CDN (app auto-falls back)
     → curl https://api.2hotatl.com/api/health must return {"ok":true}

Env (optional): DEEPSEEK_API_KEY for AI panel
H

zip -rq "$ZIP" . -x "*.DS_Store" -x "node_modules/*"

PUBLIC_FIX="$DEPLOY/public-html-fix.zip"
if [[ -f "$ROOT/scripts/public_html/.htaccess" ]]; then
  (cd "$ROOT/scripts/public_html" && zip -rq "$PUBLIC_FIX" .htaccess)
fi

echo "→ Building APK…"
APK_SRC=""
if [[ -x "$ROOT/android/gradlew" ]]; then
  ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  if (cd "$ROOT/android" && ANDROID_HOME="$ANDROID_HOME" ./gradlew assembleRelease -q); then
    APK_SRC="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
  fi
fi
if [[ -z "$APK_SRC" || ! -f "$APK_SRC" ]]; then
  APK_SRC="$ROOT/dist/download/2hotatl.apk"
fi
if [[ -f "$APK_SRC" ]]; then
  cp "$APK_SRC" "$APK"
  mkdir -p "$ROOT/public/download" "$ROOT/dist/download"
  cp "$APK_SRC" "$ROOT/public/download/2hotatl.apk"
  if [[ "$APK_SRC" != "$ROOT/dist/download/2hotatl.apk" ]]; then
    cp "$APK_SRC" "$ROOT/dist/download/2hotatl.apk"
  fi
fi

cat > "$DEPLOY/README.txt" <<README
2hotatl deploy — $(date '+%Y-%m-%d %H:%M')

2hotatl-upload.zip   upload to Hostinger Node.js
2hotatl.apk          install on Android phones

HOSTINGER SETTINGS (exact):
  Framework:        Express.js
  Node.js version:  20
  Root directory:   (empty)
  Output directory: (empty — NOT dist)
  Entry file:       index.js (Hostinger default)
  Install command:  (empty)
  Build command:    npm run build
  Start command:    npm start -- -p \$PORT

Keep server data/ folder between deploys (device secrets).

If you see 403 Forbidden:
  1. hPanel → Performance → CDN → Disable (temporarily)
  2. hPanel → Node.js → Deployments → Restart
  3. Check stderr.log in File Manager for crash errors
  4. Use https://2hotatl.com (no www)

FALLBACK HOSTS (app + website auto-retry when CDN blocks API):
  • api.2hotatl.com — set up subdomain without CDN (see SECONDARY.txt / HOSTINGER.txt)
  • Optional Render backup — see SECONDARY.txt in this folder

Set up api.2hotatl.com:
  1. hPanel → Domains → Subdomains → add api
  2. hPanel → Performance → CDN → exclude api.2hotatl.com
  3. Test: curl https://api.2hotatl.com/api/health  →  {"ok":true}

Rebuild: cd phone-hand && npm run deploy
README

cp "$ROOT/scripts/SECONDARY.txt" "$DEPLOY/SECONDARY.txt" 2>/dev/null || true

# deploy/ held ephemeral copies only — templates live in scripts/
rm -rf "$ROOT/deploy" 2>/dev/null || true

echo ""
echo "✓ Desktop/2hotatl-deploy/"
ls -lh "$ZIP" "$APK" 2>/dev/null || true
