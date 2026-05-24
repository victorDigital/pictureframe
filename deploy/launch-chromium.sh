#!/usr/bin/env bash
# Launched by cage as its single Wayland client. cage exits when its
# client exits, so this process is the kiosk's lifetime. We exec Chromium
# directly, pointed at the shell page that frame-core serves. The shell
# page talks to frame-core over HTTP/WS for state, screen selection, etc.
#
# CDP-based features (URL-screen tab management, screenshot transitions)
# would require a second mechanism to hand a CDP endpoint from this
# chromium back to frame-core; not wired yet.
set -euo pipefail

CHROMIUM_BIN="${FRAME_CHROMIUM_BIN:-chromium}"
SHELL_URL="${FRAME_SHELL_URL:-http://127.0.0.1:8080/shell/}"
USER_DATA_DIR="${FRAME_USER_DATA_DIR:-/home/frame/.config/frame-chromium}"

mkdir -p "$USER_DATA_DIR"

exec "$CHROMIUM_BIN" \
  --kiosk \
  --no-first-run \
  --no-default-browser-check \
  --disable-features=Translate,InfinitePrefetch \
  --password-store=basic \
  --ozone-platform=wayland \
  --enable-features=UseOzonePlatform \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --user-data-dir="$USER_DATA_DIR" \
  "$SHELL_URL"
