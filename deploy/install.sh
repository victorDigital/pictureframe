#!/usr/bin/env bash
# Picture Frame installer.
#
# Provisions a fresh Debian 12 / Ubuntu 24.04 install with the Wayland +
# Chromium kiosk stack, the `frame` user, the /opt/frame layout, systemd
# units, the backlight udev rule, and a sudoers fragment scoped to the
# small set of commands listed in SPEC §5.4.
#
# Usage:
#   sudo bash install.sh [--signing-key /path/to/release.pub]
#                        [--repo OWNER/REPO]
#                        [--non-interactive]

set -euo pipefail

REPO="victorDigital/pictureframe"
SIGNING_KEY=""
NONINTERACTIVE=0
DISABLE_DESKTOP_FLAG=""   # "", "yes", or "no"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --signing-key) SIGNING_KEY="$2"; shift 2 ;;
    --repo)        REPO="$2"; shift 2 ;;
    --non-interactive) NONINTERACTIVE=1; shift ;;
    --disable-desktop) DISABLE_DESKTOP_FLAG="yes"; shift ;;
    --keep-desktop)    DISABLE_DESKTOP_FLAG="no"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "install.sh must be run as root (sudo bash install.sh ...)" >&2
  exit 1
fi

log() { printf '\033[1;34m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[install]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[install]\033[0m %s\n' "$*" >&2; exit 1; }

###############################################################################
# 0. Bootstrap from tarball when invoked via `curl … | bash`
###############################################################################
# In that mode $0 is `bash` and the script has no sibling files (systemd/,
# udev/, logrotate.d/, ../config.example.yaml). Fetch the repo tarball and
# re-exec from the unpacked tree so later steps can find their assets.

if [[ -n "${_FRAME_BOOTSTRAP_DIR:-}" ]]; then
  trap 'rm -rf "${_FRAME_BOOTSTRAP_DIR}"' EXIT
fi

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname -- "$SCRIPT_PATH")" 2>/dev/null && pwd)" || SCRIPT_DIR=""

if [[ -z "$SCRIPT_DIR" \
      || ! -d "$SCRIPT_DIR/systemd" \
      || ! -f "$SCRIPT_DIR/../config.example.yaml" ]]; then
  if ! command -v curl >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq curl tar ca-certificates
  fi

  log "Fetching $REPO tarball to stage installer assets"
  STAGE_DIR="$(mktemp -d -t frame-install.XXXXXX)"
  if ! curl -fsSL "https://api.github.com/repos/$REPO/tarball/main" \
        | tar -xz --strip-components=1 -C "$STAGE_DIR"; then
    rm -rf "$STAGE_DIR"
    die "Failed to fetch installer assets from $REPO."
  fi
  if [[ ! -x "$STAGE_DIR/deploy/install.sh" ]]; then
    chmod +x "$STAGE_DIR/deploy/install.sh" 2>/dev/null || true
  fi

  BOOTSTRAP_ARGS=( --repo "$REPO" )
  [[ -n "$SIGNING_KEY" ]] && BOOTSTRAP_ARGS+=( --signing-key "$SIGNING_KEY" )
  [[ "$NONINTERACTIVE" -eq 1 ]] && BOOTSTRAP_ARGS+=( --non-interactive )
  [[ "$DISABLE_DESKTOP_FLAG" == "yes" ]] && BOOTSTRAP_ARGS+=( --disable-desktop )
  [[ "$DISABLE_DESKTOP_FLAG" == "no" ]]  && BOOTSTRAP_ARGS+=( --keep-desktop )

  exec env _FRAME_BOOTSTRAP_DIR="$STAGE_DIR" \
       bash "$STAGE_DIR/deploy/install.sh" "${BOOTSTRAP_ARGS[@]}"
fi

###############################################################################
# 1. Detect distribution
###############################################################################

# shellcheck source=/dev/null
. /etc/os-release
# ID, VERSION_ID, PRETTY_NAME come from os-release.
# shellcheck disable=SC2153
case "$ID" in
  debian)
    if [[ "${VERSION_ID:-}" != "12" ]]; then
      warn "Tested only on Debian 12; proceeding on Debian $VERSION_ID at your own risk."
    fi
    BACKPORTS_NEEDED=1
    ;;
  ubuntu)
    if [[ "${VERSION_ID:-}" != "24.04" ]]; then
      warn "Tested only on Ubuntu 24.04 LTS; proceeding on Ubuntu $VERSION_ID at your own risk."
    fi
    BACKPORTS_NEEDED=0
    ;;
  *)
    die "Unsupported distribution: $ID. Targets are Debian 12 and Ubuntu 24.04."
    ;;
esac

log "Detected $PRETTY_NAME"

###############################################################################
# 2. Enable backports on Debian (for current `cage`)
###############################################################################

if [[ "$BACKPORTS_NEEDED" -eq 1 ]]; then
  if ! grep -qE 'bookworm-backports' /etc/apt/sources.list /etc/apt/sources.list.d/*.list 2>/dev/null; then
    log "Enabling bookworm-backports for cage"
    echo 'deb http://deb.debian.org/debian bookworm-backports main' > /etc/apt/sources.list.d/backports.list
  fi
fi

###############################################################################
# 3. Install packages
###############################################################################

export DEBIAN_FRONTEND=noninteractive
log "Updating apt indexes"
apt-get update -qq

BASE_PACKAGES=(
  sudo
  wayvnc
  chromium
  curl
  git
  jq
  ddcutil
  websockify
  novnc
  avahi-daemon
  logrotate
  ca-certificates
)

log "Installing base packages: ${BASE_PACKAGES[*]}"
apt-get install -y -qq "${BASE_PACKAGES[@]}"

if [[ "$BACKPORTS_NEEDED" -eq 1 ]]; then
  log "Installing cage from bookworm-backports"
  apt-get install -y -qq -t bookworm-backports cage
else
  apt-get install -y -qq cage
fi

# Node 22.x via NodeSource (both distros ship older versions in main archive).
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null | sed -E 's/v([0-9]+).*/\1/')" -lt 22 ]]; then
  log "Installing Node.js 22.x from NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

###############################################################################
# 4. Disable boot-speed killers (apt-daily; NetworkManager-wait-online)
###############################################################################

log "Disabling apt-daily timers"
systemctl disable --now apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true

# NetworkManager-wait-online has a 90 s default timeout. Boot hangs there
# while NM probes interfaces, even though frame-core only binds to 0.0.0.0
# and doesn't need a fully-online network to start. Mask it so nothing in
# network-online.target keeps boot waiting.
if systemctl cat NetworkManager-wait-online.service >/dev/null 2>&1; then
  log "Masking NetworkManager-wait-online.service (skip 90s boot wait)"
  systemctl mask NetworkManager-wait-online.service >/dev/null 2>&1 || true
fi
if systemctl cat systemd-networkd-wait-online.service >/dev/null 2>&1; then
  systemctl mask systemd-networkd-wait-online.service >/dev/null 2>&1 || true
fi

###############################################################################
# 5. Verify time sync
###############################################################################

log "Verifying systemd-timesyncd"
systemctl enable --now systemd-timesyncd || warn "systemd-timesyncd not present; clock may drift"

###############################################################################
# 6. Create `frame` user and directory layout
###############################################################################

if ! getent group frame >/dev/null; then
  log "Creating frame group"
  groupadd --system frame
fi

if ! id -u frame >/dev/null 2>&1; then
  log "Creating frame user"
  useradd --system --gid frame --create-home --home-dir /home/frame \
          --shell /usr/bin/bash --comment "Picture frame" frame
fi

# Wayland session prerequisites
usermod -a -G video,render,input,tty,i2c frame 2>/dev/null || true
# Read access to the system journal so `/api/logs` can tail frame-core and
# frame-kiosk. systemd-journal exists on Debian/Ubuntu; adm is the legacy
# fallback some distros still honour.
usermod -a -G systemd-journal frame 2>/dev/null || true
usermod -a -G adm frame 2>/dev/null || true

install -d -o frame -g frame -m 0755 /opt/frame
install -d -o frame -g frame -m 0755 /opt/frame/releases
install -d -o frame -g frame -m 0755 /opt/frame/shared
install -d -o frame -g frame -m 0755 /opt/frame/shared/data
install -d -o frame -g frame -m 0755 /opt/frame/snapshots
install -d -o frame -g frame -m 0755 /opt/frame/state
install -d -o frame -g frame -m 0755 /opt/frame/staging
# Group-writable so frame-core can atomically update its yaml files
# (screens.yaml / rules.yaml / frame.yaml) via tempfile-and-rename.
install -d -o root  -g frame -m 2770 /etc/frame
install -d -o root  -g frame -m 0750 /etc/frame/secrets

# Runtime dir for CDP socket + pid files.
install -d -o frame -g frame -m 0755 /run/frame

###############################################################################
# 7. Detect backlight device and render udev rule
###############################################################################

BACKLIGHT=""
for candidate in intel_backlight amdgpu_bl0 amdgpu_bl1 acpi_video0; do
  if [[ -e "/sys/class/backlight/$candidate" ]]; then
    BACKLIGHT="$candidate"
    break
  fi
done

if [[ -z "$BACKLIGHT" ]]; then
  warn "No /sys/class/backlight/* device found. Brightness control will be unavailable."
  warn "If this device uses ddcutil for an external monitor, set display.brightness_backend: ddcutil"
else
  log "Backlight device: $BACKLIGHT"
  TEMPLATE_PATH="$(dirname "$0")/udev/50-frame-backlight.rules.template"
  if [[ -f "$TEMPLATE_PATH" ]]; then
    sed "s|@BACKLIGHT@|$BACKLIGHT|g" "$TEMPLATE_PATH" \
        > /etc/udev/rules.d/50-frame-backlight.rules
  else
    cat > /etc/udev/rules.d/50-frame-backlight.rules <<EOF
# Generated by frame install.sh
SUBSYSTEM=="backlight", KERNEL=="$BACKLIGHT", \\
  RUN+="/bin/chgrp frame /sys/class/backlight/%k/brightness", \\
  RUN+="/bin/chmod g+w /sys/class/backlight/%k/brightness"
EOF
  fi
  udevadm control --reload
  udevadm trigger --subsystem-match=backlight --action=add
fi

###############################################################################
# 8. Sudoers fragment (narrow scope — see SPEC §5.4 and §10)
###############################################################################

cat > /etc/sudoers.d/frame <<'EOF'
# Picture Frame sudoers
# Brightness does NOT go through sudo (udev rule grants direct access).
frame ALL=(root) NOPASSWD: /usr/bin/systemctl restart frame-core, \
                            /usr/bin/systemctl restart frame-kiosk, \
                            /usr/bin/systemctl reboot
EOF
chmod 0440 /etc/sudoers.d/frame
visudo -cf /etc/sudoers.d/frame >/dev/null

###############################################################################
# 9. Systemd units and timers
###############################################################################

SYSTEMD_SRC="$(dirname "$0")/systemd"
if [[ -d "$SYSTEMD_SRC" ]]; then
  log "Installing systemd units"
  install -m 0644 "$SYSTEMD_SRC"/*.service /etc/systemd/system/
  install -m 0644 "$SYSTEMD_SRC"/*.timer   /etc/systemd/system/ 2>/dev/null || true

  # Clean up legacy autologin override from earlier installs — frame-kiosk
  # claims tty1 directly via PAMName=login + Conflicts=getty@tty1.service.
  if [[ -f /etc/systemd/system/getty@tty1.service.d/override.conf ]]; then
    log "Removing legacy getty@tty1 autologin override"
    rm -f /etc/systemd/system/getty@tty1.service.d/override.conf
    rmdir /etc/systemd/system/getty@tty1.service.d 2>/dev/null || true
  fi

  systemctl daemon-reload
  systemctl enable frame-core.service
  systemctl enable frame-kiosk.service
  systemctl enable frame-chromium-restart.timer 2>/dev/null || true
fi

###############################################################################
# 10. logrotate
###############################################################################

LOGROTATE_SRC="$(dirname "$0")/logrotate.d/frame"
if [[ -f "$LOGROTATE_SRC" ]]; then
  install -m 0644 "$LOGROTATE_SRC" /etc/logrotate.d/frame
fi

###############################################################################
# 11. Initial config and secrets
###############################################################################

if [[ ! -f /etc/frame/frame.yaml ]]; then
  log "Installing example frame.yaml"
  install -m 0660 -o root -g frame "$(dirname "$0")/../config.example.yaml" /etc/frame/frame.yaml
fi
if [[ ! -f /etc/frame/screens.yaml ]]; then
  log "Installing example screens.yaml"
  install -m 0660 -o root -g frame "$(dirname "$0")/../screens.example.yaml" /etc/frame/screens.yaml
fi

# Repair perms on an existing install in case earlier versions wrote them
# read-only for the group (frame-core couldn't atomically update them).
chmod 2770 /etc/frame 2>/dev/null || true
[[ -f /etc/frame/frame.yaml   ]] && chmod 0660 /etc/frame/frame.yaml   || true
[[ -f /etc/frame/screens.yaml ]] && chmod 0660 /etc/frame/screens.yaml || true
[[ -f /etc/frame/rules.yaml   ]] && chmod 0660 /etc/frame/rules.yaml   || true
chgrp -R frame /etc/frame 2>/dev/null || true
chmod 0750 /etc/frame/secrets 2>/dev/null || true

generate_secret() { head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32; }

if [[ ! -f /etc/frame/secrets/bearer_token ]]; then
  if [[ "$NONINTERACTIVE" -eq 1 ]]; then
    TOKEN="$(generate_secret)"
  else
    read -r -s -p "Bearer token for the web UI (blank to autogenerate): " TOKEN
    echo
    if [[ -z "$TOKEN" ]]; then TOKEN="$(generate_secret)"; fi
  fi
  install -m 0640 -o root -g frame /dev/null /etc/frame/secrets/bearer_token
  printf '%s\n' "$TOKEN" > /etc/frame/secrets/bearer_token
  log "Wrote /etc/frame/secrets/bearer_token (mode 0640, root:frame)"
  echo "Bearer token: $TOKEN"
fi

if [[ ! -f /etc/frame/secrets/vnc ]]; then
  if [[ "$NONINTERACTIVE" -eq 1 ]]; then
    VNCPW="$(generate_secret)"
  else
    read -r -s -p "VNC password (blank to autogenerate): " VNCPW
    echo
    if [[ -z "$VNCPW" ]]; then VNCPW="$(generate_secret)"; fi
  fi
  install -m 0640 -o root -g frame /dev/null /etc/frame/secrets/vnc
  printf '%s\n' "$VNCPW" > /etc/frame/secrets/vnc
  echo "VNC password: $VNCPW"
fi

if [[ ! -f /etc/frame/secrets/mqtt ]]; then
  if [[ "$NONINTERACTIVE" -eq 1 ]]; then
    MQTTPW=""
  else
    read -r -s -p "MQTT password (blank to skip HA integration for now): " MQTTPW
    echo
  fi
  install -m 0640 -o root -g frame /dev/null /etc/frame/secrets/mqtt
  printf '%s\n' "$MQTTPW" > /etc/frame/secrets/mqtt
fi

if [[ -n "$SIGNING_KEY" ]]; then
  log "Installing release signing key"
  install -m 0640 -o root -g frame "$SIGNING_KEY" /etc/frame/secrets/release.pub
fi

# Set the configured updater repo from CLI flag.
if grep -q '^  repo:' /etc/frame/frame.yaml; then
  sed -i -E "s|^  repo:.*|  repo: ${REPO}|" /etc/frame/frame.yaml
fi

###############################################################################
# 12. Bootstrap first release
###############################################################################

if [[ ! -e /opt/frame/current ]]; then
  log "Fetching first release of $REPO"
  BOOTSTRAP_DIR="/opt/frame/releases/v0.0.1"
  install -d -o frame -g frame -m 0755 "$BOOTSTRAP_DIR"

  TARBALL="/tmp/frame-bootstrap-$$.tar.gz"
  if curl -fsSL "https://api.github.com/repos/$REPO/tarball/main" -o "$TARBALL"; then
    tar -xzf "$TARBALL" --strip-components=1 -C "$BOOTSTRAP_DIR"
    rm -f "$TARBALL"
    chown -R frame:frame "$BOOTSTRAP_DIR"
    su -s /bin/bash -c "cd '$BOOTSTRAP_DIR' && npm ci || npm install" frame
    if su -s /bin/bash -c "cd '$BOOTSTRAP_DIR' && npm run build" frame; then
      su -s /bin/bash -c "cd '$BOOTSTRAP_DIR' && npm prune --omit=dev" frame || true
    else
      warn "Build step failed; you may need to ship a pre-built release tarball."
    fi
    ln -snf "$BOOTSTRAP_DIR" /opt/frame/current
  else
    warn "Could not fetch initial release. You can deploy manually into /opt/frame/releases/<tag>/"
  fi
fi

###############################################################################
# 12b. Detect and (optionally) disable a conflicting desktop session
###############################################################################
# Ubuntu Desktop ships a display manager (gdm3) on tty1 and boots into
# graphical.target. frame-kiosk wants exclusive use of tty1 and won't start
# until the DM is gone and the default target is multi-user.

DETECTED_DM=""
for dm in gdm3 gdm lightdm sddm kdm xdm lxdm slim; do
  if systemctl cat "${dm}.service" >/dev/null 2>&1; then
    if systemctl is-enabled --quiet "${dm}.service" 2>/dev/null \
       || systemctl is-active  --quiet "${dm}.service" 2>/dev/null; then
      DETECTED_DM="$dm"
      break
    fi
  fi
done

DEFAULT_TARGET="$(systemctl get-default 2>/dev/null || true)"
DESKTOP_PRESENT=0
[[ -n "$DETECTED_DM" ]] && DESKTOP_PRESENT=1
[[ "$DEFAULT_TARGET" == "graphical.target" ]] && DESKTOP_PRESENT=1

DESKTOP_DISABLED=0

if [[ "$DESKTOP_PRESENT" -eq 1 ]]; then
  warn "Conflicting desktop environment detected:"
  [[ -n "$DETECTED_DM" ]] && warn "  - display manager '$DETECTED_DM' is enabled/active (holds tty1)"
  [[ "$DEFAULT_TARGET" == "graphical.target" ]] && warn "  - systemd default target is $DEFAULT_TARGET"
  warn "frame-kiosk needs exclusive tty1; it won't start until the desktop is disabled."

  CHOICE="$DISABLE_DESKTOP_FLAG"
  if [[ -z "$CHOICE" && "$NONINTERACTIVE" -eq 0 ]]; then
    read -r -p "Disable the desktop session now (takes effect after reboot)? [y/N] " ans </dev/tty || ans=""
    [[ "$ans" =~ ^[Yy] ]] && CHOICE="yes" || CHOICE="no"
  fi

  case "$CHOICE" in
    yes)
      if [[ -n "$DETECTED_DM" ]]; then
        log "Disabling $DETECTED_DM (will not stop it now — reboot to apply)"
        systemctl disable "${DETECTED_DM}.service" >/dev/null 2>&1 || \
          warn "  could not disable ${DETECTED_DM}.service"
      fi
      log "Setting default systemd target to multi-user.target"
      systemctl set-default multi-user.target >/dev/null 2>&1 || \
        warn "  could not change default target"
      DESKTOP_DISABLED=1
      ;;
    *)
      warn "Leaving the desktop in place. To disable it manually later:"
      [[ -n "$DETECTED_DM" ]] && warn "  sudo systemctl disable --now ${DETECTED_DM}.service"
      warn "  sudo systemctl set-default multi-user.target"
      warn "  sudo reboot"
      ;;
  esac
fi

###############################################################################
# 13. Start services
###############################################################################

if systemctl list-unit-files | grep -q frame-core.service; then
  log "Starting frame-core"
  systemctl restart frame-core.service || warn "frame-core failed to start; check 'journalctl -u frame-core'"
  if [[ "$DESKTOP_PRESENT" -eq 1 && "$DESKTOP_DISABLED" -eq 0 ]]; then
    warn "Skipping frame-kiosk start — desktop still owns tty1. Reboot after disabling to switch in."
  elif [[ "$DESKTOP_DISABLED" -eq 1 ]]; then
    warn "Skipping frame-kiosk start — reboot to switch from the desktop to the kiosk."
  else
    log "Starting frame-kiosk"
    systemctl restart frame-kiosk.service || warn "frame-kiosk failed to start; check 'journalctl -u frame-kiosk'"
  fi
fi

###############################################################################
# 14. Final status — service health, reachable URLs
###############################################################################

# Give services a moment to come up before reading their status.
sleep 2

CORE_STATE="$(systemctl is-active frame-core.service 2>/dev/null || true)"
KIOSK_STATE="$(systemctl is-active frame-kiosk.service 2>/dev/null || true)"

log "Service status:"
log "  frame-core:  $CORE_STATE"
log "  frame-kiosk: $KIOSK_STATE"

log "Reach the UI from another machine on the LAN at:"
IP_FOUND=0
if command -v ip >/dev/null 2>&1; then
  while IFS= read -r ip; do
    [[ -z "$ip" ]] && continue
    log "  http://$ip:8080"
    IP_FOUND=1
  done < <(ip -o -4 addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1)
fi
if [[ "$IP_FOUND" -eq 0 ]]; then
  warn "  (no global IPv4 addresses found — check 'ip addr')"
fi

HOST_SHORT="$(hostname -s 2>/dev/null || hostname || true)"
if [[ -n "$HOST_SHORT" ]] && systemctl is-active --quiet avahi-daemon 2>/dev/null; then
  log "  http://${HOST_SHORT}.local:8080  (mDNS — requires Bonjour/Avahi on client)"
  if [[ "$HOST_SHORT" != "frame" ]]; then
    log "  To make this 'frame.local', run: hostnamectl set-hostname frame"
  fi
fi

if [[ "$DESKTOP_DISABLED" -eq 1 ]]; then
  warn "Desktop disabled. Reboot to switch into the kiosk:  sudo reboot"
elif [[ "$DESKTOP_PRESENT" -eq 1 ]]; then
  warn "Desktop still active. frame-kiosk will not start until it's disabled."
elif [[ "$KIOSK_STATE" != "active" ]]; then
  warn "frame-kiosk is not active. Recent journal entries:"
  journalctl -u frame-kiosk -n 25 --no-pager --output=cat 2>/dev/null \
    | sed 's/^/    /' >&2 || true
  if ! compgen -G '/dev/dri/card*' >/dev/null; then
    warn "No /dev/dri/card* device — cage cannot initialize a display."
    warn "  This VM/host has no KMS-capable GPU. On QEMU, boot with -device virtio-gpu-gl"
    warn "  (or virtio-gpu-pci) and a guest kernel that loads the virtio_gpu module."
  fi
  warn "  Full log: journalctl -u frame-kiosk -n 200 --no-pager"
fi

log "Done."
