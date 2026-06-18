#!/usr/bin/env bash
# Checks 2hotatl.com; starts backup server if Hostinger returns 403.
CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 https://2hotatl.com/api/health 2>/dev/null || echo "000")
if [[ "$CODE" == "200" ]]; then
  exit 0
fi
# Already running backup?
if [[ -f "$HOME/Desktop/2hotatl-BACKUP-URL.txt" ]]; then
  exit 0
fi
osascript -e 'display notification "Starting backup server…" with title "2hotatl (Hostinger down)"'
nohup bash "$HOME/Desktop/phone-hand/scripts/backup-server.sh" >/dev/null 2>&1 &
