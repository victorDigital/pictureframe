#!/usr/bin/env bash
# Launched by cage as the Wayland client. frame-core launches Chromium
# itself via CDP-over-pipe in §3.2, so this script is what frame-core
# spawns when it needs a fresh Chromium process. Cage is configured to
# run frame-core's launcher, which in turn execs Chromium with inherited
# pipe FDs 3 and 4 attached to CDP. See core/src/cdp/launcher.ts.
set -euo pipefail
exec /opt/frame/current/core/dist/cdp/spawn-chromium.js "$@"
