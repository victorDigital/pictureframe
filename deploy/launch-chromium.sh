#!/usr/bin/env bash
# Launched by cage as its single Wayland client. cage exits when its
# client exits, so this process is the kiosk's lifetime.
#
# We expose CDP on 127.0.0.1:9222 so frame-core can drive separate
# Chromium tabs for URL screens (SPEC §4.1). The port is loopback-only
# and Chromium refuses CDP without --remote-allow-origins; we allow the
# frame-core HTTP origin which is also loopback. Anyone who can reach
# 127.0.0.1 on this device can already control everything, so this does
# not widen the trust surface.
set -euo pipefail

CHROMIUM_BIN="${FRAME_CHROMIUM_BIN:-chromium}"
SHELL_URL="${FRAME_SHELL_URL:-http://127.0.0.1:8080/shell/}"
USER_DATA_DIR="${FRAME_USER_DATA_DIR:-/home/frame/.config/frame-chromium}"
CDP_PORT="${FRAME_CDP_PORT:-9222}"

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
  --remote-debugging-port="$CDP_PORT" \
  --remote-debugging-address=127.0.0.1 \
  --remote-allow-origins=http://127.0.0.1:8080 \
  "$SHELL_URL"
