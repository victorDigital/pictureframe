#!/usr/bin/env bash
set -euo pipefail
BASE="${FRAME_BASE_URL:-http://127.0.0.1:8080}"
echo "== healthz =="; curl -fsS "$BASE/healthz" | grep -q '"ok":true'
echo "== manifest.json =="; curl -fsS "$BASE/builtin/now-playing/manifest.json" | grep -q '"id": "now-playing"'
html="$(curl -fsS "$BASE/builtin/now-playing/index.html")"
echo "$html" | grep -q '/builtin/_shared/style.css'
echo "$html" | grep -q '/builtin/_shared/runtime.js'
echo "$html" | grep -q 'init("now-playing")'
curl -fsS "$BASE/builtin/now-playing/assets/now-playing.css" | grep -q 'np-bg'
curl -fsS "$BASE/builtin/now-playing/assets/now-playing.js" | grep -q 'startNowPlaying'
manifest="$(curl -fsS "$BASE/builtin/now-playing/manifest.json")"
for field in theme font_scale font_family layout accent_source blur_background blur_amount show_progress; do
  echo "$manifest" | grep -q "\"$field\""
done
curl -fsS -X PUT "$BASE/api/now_playing" -H 'Content-Type: application/json' \
  -d '{"state":"playing","title":"Test Track","artist":"Test Artist","album":"Test Album","duration":180,"position":30}'
curl -fsS "$BASE/api/now_playing" | grep -q '"title":"Test Track"'
curl -fsS -X PUT "$BASE/api/now_playing" -H 'Content-Type: application/json' -d 'null'
echo "OK — now-playing e2e curl checks passed"
