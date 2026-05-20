#!/usr/bin/env bash
# Block until frame-core's /healthz responds. Used by frame-kiosk's
# ExecStartPre so Chromium doesn't race the shell page coming up.
set -euo pipefail
DEADLINE=$(( $(date +%s) + 30 ))
while (( $(date +%s) < DEADLINE )); do
  if curl -fsS --max-time 1 http://127.0.0.1:8080/healthz >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done
echo "frame-core did not become healthy within 30s" >&2
exit 1
