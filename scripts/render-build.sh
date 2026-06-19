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
console.log('✓ dist/index.html + server.cjs OK');
"

echo "✓ Render build complete"
