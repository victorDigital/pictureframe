#!/usr/bin/env bash
set -euo pipefail

if ! command -v wlsunset >/dev/null 2>&1; then
  echo "wlsunset_missing_manual_install_required: sudo apt-get update && sudo apt-get install -y wlsunset" >&2
  exit 1
fi
