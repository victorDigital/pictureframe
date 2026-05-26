#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REQUEST_FILE="/run/frame/os-packages.required"
ROOT_HELPER="/usr/local/lib/frame/root-helper"

print_manifest() {
  sed -E 's/#.*$//' "$SCRIPT_DIR/os-packages.txt" 2>/dev/null | awk 'NF { print $1 }'
}

install_helper() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "install-os-packages.sh must run as root" >&2
    exit 1
  fi
  install -d -o root -g root -m 0755 "$(dirname "$ROOT_HELPER")"
  install -o root -g root -m 0755 "$SCRIPT_DIR/root-helper" "$ROOT_HELPER"
  if [[ -f "$SCRIPT_DIR/sudoers.d/frame" ]]; then
    install -m 0440 "$SCRIPT_DIR/sudoers.d/frame" /etc/sudoers.d/frame
    visudo -cf /etc/sudoers.d/frame >/dev/null
  fi
}

case "${1:-}" in
  --print)
    print_manifest
    ;;
  --install-helper)
    install_helper
    ;;
  "")
    install_helper
    install -d -o frame -g frame -m 0755 "$(dirname "$REQUEST_FILE")" 2>/dev/null || true
    if [[ ! -f "$REQUEST_FILE" ]]; then
      print_manifest > "$REQUEST_FILE"
    fi
    "$ROOT_HELPER" install-packages "$REQUEST_FILE"
    ;;
  *)
    echo "usage: install-os-packages.sh [--print|--install-helper]" >&2
    exit 2
    ;;
esac
