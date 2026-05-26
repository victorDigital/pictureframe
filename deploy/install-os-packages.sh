#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PACKAGES=(
  wlr-randr
)

ALLOWLIST=(
  wlr-randr
  wlopm
  wayvnc
  websockify
  novnc
  ddcutil
  cage
  chromium
)

if [[ "${1:-}" == "--print" ]]; then
  printf '%s\n' "${PACKAGES[@]}"
  exit 0
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "install-os-packages.sh must run as root" >&2
  exit 1
fi

REMOUNTED_TARGETS=()

ensure_mount_writable() {
  local path="$1"
  local target options
  target="$(findmnt -no TARGET -T "$path" 2>/dev/null || true)"
  options="$(findmnt -no OPTIONS -T "$path" 2>/dev/null || true)"
  [[ -n "$target" ]] || return 0
  if [[ ",$options," == *,ro,* ]]; then
    echo "Remounting $target read-write for package installation" >&2
    mount -o remount,rw "$target"
    REMOUNTED_TARGETS+=("$target")
  fi
}

restore_remounted_targets() {
  local target
  for target in "${REMOUNTED_TARGETS[@]}"; do
    mount -o remount,ro "$target" 2>/dev/null || true
  done
}

trap restore_remounted_targets EXIT

export DEBIAN_FRONTEND=noninteractive
REQUEST_FILE="/run/frame/os-packages.required"
if [[ -f "$REQUEST_FILE" ]]; then
  mapfile -t PACKAGES < <(grep -E '^[a-z0-9.+-]+$' "$REQUEST_FILE" | sort -u)
fi

for pkg in "${PACKAGES[@]}"; do
  allowed=0
  for candidate in "${ALLOWLIST[@]}"; do
    if [[ "$pkg" == "$candidate" ]]; then
      allowed=1
      break
    fi
  done
  if [[ "$allowed" -ne 1 ]]; then
    echo "Refusing package outside allowlist: $pkg" >&2
    exit 2
  fi
done

ensure_mount_writable /usr/bin
ensure_mount_writable /etc/sudoers.d
ensure_mount_writable /var/cache/apt/archives
ensure_mount_writable /var/lib/apt/lists
ensure_mount_writable /var/lib/dpkg

apt-get update -qq
apt-get install -y -qq "${PACKAGES[@]}"

apt-get install -y -qq wlopm 2>/dev/null || true

if [[ -f "$SCRIPT_DIR/sudoers.d/frame" ]]; then
  install -m 0440 "$SCRIPT_DIR/sudoers.d/frame" /etc/sudoers.d/frame
  visudo -cf /etc/sudoers.d/frame >/dev/null
fi
