#!/usr/bin/env bash
# Manual one-shot update from a tag. The normal update path is the
# in-process updater in core/src/updater; this script is for the
# operator who SSH'd in and wants to force an update or recover from
# a stuck state.
set -euo pipefail

TAG="${1:?usage: update.sh vX.Y.Z}"
REPO="$(awk '/^  repo:/ {print $2}' /etc/frame/frame.yaml)"
if [[ -z "$REPO" ]]; then
  echo "Could not read updater.repo from /etc/frame/frame.yaml" >&2
  exit 1
fi

STAGING="/opt/frame/staging/$TAG"
RELEASE="/opt/frame/releases/$TAG"

install -d -o frame -g frame -m 0755 "$STAGING"
curl -fsSL "https://api.github.com/repos/$REPO/tarball/$TAG" \
  | tar -xz --strip-components=1 -C "$STAGING"

cd "$STAGING"
npm ci
npm run build
npm prune --omit=dev

mv "$STAGING" "$RELEASE"
ln -snf "$RELEASE" /opt/frame/current
sudo systemctl restart frame-core.service
sudo systemctl restart frame-kiosk.service
echo "Switched /opt/frame/current → $RELEASE"
