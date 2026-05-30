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

if [[ "${FRAME_XCURSOR_THEME:-frame-transparent}" == "frame-transparent" ]]; then
  CURSOR_INSTALLER="$(dirname "$0")/cursor/install-transparent-theme.sh"
  [[ ! -x "$CURSOR_INSTALLER" ]] || "$CURSOR_INSTALLER" "${XDG_DATA_HOME:-${HOME:-/home/frame}/.local/share}/icons" || true
fi
export XCURSOR_THEME="${FRAME_XCURSOR_THEME:-frame-transparent}"
export XCURSOR_PATH="${XDG_DATA_HOME:-${HOME:-/home/frame}/.local/share}/icons${XCURSOR_PATH:+:$XCURSOR_PATH}:/usr/share/icons"

if command -v setterm >/dev/null 2>&1 && [[ -r /dev/tty1 && -w /dev/tty1 ]]; then
  TERM=linux setterm --blank=0 --powerdown=0 --powersave=off </dev/tty1 >/dev/tty1 2>/dev/null || true
fi

if command -v ydotool >/dev/null 2>&1; then
  (sleep "${FRAME_CURSOR_NUDGE_DELAY_SEC:-3}"; ydotool mousemove --absolute -x 99999 -y 99999 >/dev/null 2>&1 || true) &
fi

INHIBIT=()
if command -v systemd-inhibit >/dev/null 2>&1; then
  INHIBIT=(
    systemd-inhibit
    --what=idle:sleep:handle-lid-switch
    --who=pictureframe
    --why="Picture Frame kiosk display must stay on"
    --mode=block
  )
fi

exec "${INHIBIT[@]}" "$CHROMIUM_BIN" \
  --kiosk \
  --no-first-run \
  --no-default-browser-check \
  --disable-features=Translate,InfinitePrefetch \
  --password-store=basic \
  --ozone-platform=wayland \
  --enable-features=UseOzonePlatform \
  --disable-pinch \
  --hide-scrollbars \
  --overscroll-history-navigation=0 \
  --user-data-dir="$USER_DATA_DIR" \
  --remote-debugging-port="$CDP_PORT" \
  --remote-debugging-address=127.0.0.1 \
  --remote-allow-origins=http://127.0.0.1:8080 \
  "$SHELL_URL"
