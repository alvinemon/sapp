#!/usr/bin/env bash
# Render build — must work when NODE_ENV=production (Render default).
set -euo pipefail
export NPM_CONFIG_PRODUCTION=false
export CI=true

echo "→ Node $(node -v) | npm $(npm -v) | NODE_ENV=${NODE_ENV:-unset}"

echo "→ npm install"
npm install

echo "→ vite + server bundle"
npm run build:render

echo "→ verify artifacts"
test -f dist/index.html
test -f server.cjs
node -e "
const fs = require('fs');
const s = fs.readFileSync('server.cjs', 'utf8');
if (!s.includes('free-catalog')) throw new Error('server.cjs missing routes');
if (!s.includes('devices/:deviceId/notes')) throw new Error('server.cjs missing notes route');
if (!s.includes('/api/segments')) throw new Error('server.cjs missing segments route');
if (!s.includes('/api/campaigns')) throw new Error('server.cjs missing campaigns route');
console.log('✓ dist/index.html + server.cjs OK');
"

if [[ -f public/download/2hotatl.apk ]]; then
  mkdir -p dist/download
  cp public/download/2hotatl.apk dist/download/2hotatl.apk
  echo "✓ bundled APK in dist/download/2hotatl.apk ($(du -h dist/download/2hotatl.apk | cut -f1))"
elif [[ -f android/app/build/outputs/apk/release/app-release.apk ]]; then
  mkdir -p public/download dist/download
  cp android/app/build/outputs/apk/release/app-release.apk public/download/2hotatl.apk
  cp public/download/2hotatl.apk dist/download/2hotatl.apk
  echo "✓ copied release APK to public/download and dist/download"
fi

echo "✓ Render build complete"
