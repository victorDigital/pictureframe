#!/usr/bin/env bash
set -euo pipefail

current_tag="${GITHUB_REF_NAME:-}"
if [[ -z "$current_tag" ]]; then
  current_tag="v$(node -p "require('./package.json').version")"
fi

previous_tag="$(
  git tag --list 'v[0-9]*' --sort=-v:refname \
    | grep -v -- "$current_tag" \
    | head -n 1 || true
)"

if [[ -z "$previous_tag" ]]; then
  echo "No previous version tag found; skipping update compatibility test."
  exit 0
fi

echo "Testing update compatibility: $previous_tag -> $current_tag"

tmp="$(mktemp -d)"
cleanup() {
  git worktree remove --force "$tmp/previous" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

git worktree add --detach "$tmp/previous" "$previous_tag" >/dev/null

tarball="$tmp/frame-${current_tag}.tar.gz"
archive_root="$tmp/archive/picture-frame-${current_tag}"
mkdir -p "$archive_root"
cp -R core kiosk web builtin-screens migrations deploy "$archive_root/"
cp package.json package-lock.json tsconfig.base.json .npmrc "$archive_root/"
cp SPEC.md README.md CHANGELOG.md LICENSE "$archive_root/"
cp config.example.yaml screens.example.yaml "$archive_root/"
find "$archive_root" -name node_modules -prune -exec rm -rf {} +
find "$archive_root" -name '*.log' -delete
tar -czf "$tarball" -C "$tmp/archive" "picture-frame-${current_tag}"

mkdir "$tmp/staging"
tar -xzf "$tarball" --strip-components=1 -C "$tmp/staging"

if [[ -x "$tmp/staging/deploy/install-os-packages.sh" ]]; then
  "$tmp/staging/deploy/install-os-packages.sh" --print >"$tmp/os-packages.txt"
fi

if [[ -f "$tmp/staging/deploy/os-packages.txt" ]]; then
  grep -Eq '^[a-z0-9.+-]+' "$tmp/staging/deploy/os-packages.txt"
fi

bash -n "$tmp/staging/deploy/root-helper"
bash -n "$tmp/staging/deploy/install-os-packages.sh"
if sudo -n true 2>/dev/null; then
  sudo visudo -cf "$tmp/staging/deploy/sudoers.d/frame" >/dev/null
else
  echo "sudo unavailable without a password; skipping visudo syntax check."
fi

(
  cd "$tmp/staging"
  NODE_ENV=production npm ci --include=dev --no-audit --no-fund --loglevel=warn
  NODE_ENV=production npm run build
  NODE_ENV=production npm prune --omit=dev --no-audit --no-fund --loglevel=warn
)

echo "Update compatibility smoke passed: $previous_tag -> $current_tag"
