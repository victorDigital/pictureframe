# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.18] - 2026-05-30

### Fixed

- The kiosk launcher now performs a delayed one-shot display off/on cycle after
  Cage has started, matching the manual display toggle that clears the visible
  startup cursor on affected hardware.

## [0.0.17] - 2026-05-30

### Fixed

- The kiosk service now installs the transparent cursor theme before Cage
  starts and exports the cursor search path at the service level, so the cursor
  is hidden on cold boot instead of only after a later display toggle.

## [0.0.16] - 2026-05-30

### Fixed

- Kiosk cursor hiding is now permanent across the shell, built-in screens, and
  CDP-managed URL tabs instead of briefly restoring the default pointer during
  mouse movement.
- The kiosk launcher now installs and selects a transparent cursor theme so the
  Wayland/Chromium cursor surface stays invisible during startup and page loads.

## [0.0.15] - 2026-05-30

### Added

- Fresh installs now provision a minimal Plymouth boot splash and quiet kernel
  boot flags.

### Fixed

- Hardware display scale and orientation are now reapplied after the display is
  powered back on, and the shell fallback is cleared once `wlr-randr` applies
  the geometry.
- The kiosk launch script now disables tty blanking and uses `systemd-inhibit`
  when available so laptop power management does not blank or suspend the
  display.

## [0.0.14] - 2026-05-27

### Fixed

- Fresh installs no longer fail when `ydotool` is unavailable from the
  distribution package sources; cursor nudging is now optional.

## [0.0.13] - 2026-05-27

### Fixed

- The previous-version update smoke test now runs staged npm commands with a
  read-only fake home and the updater's writable npm cache environment.
- The kiosk compositor now uses a 1px cursor and best-effort startup pointer
  nudging to push the Wayland cursor toward the bottom-right corner.

## [0.0.12] - 2026-05-26

### Fixed

- Updater npm commands now use a writable state-directory home and cache so
  `npm ci` no longer fails when `/home/frame` is mounted read-only.

## [0.0.11] - 2026-05-26

### Fixed

- Built-in screens now hide the cursor from first paint inside their iframe
  documents and only show it briefly during pointer movement.

## [0.0.10] - 2026-05-26

### Fixed

- Kiosk cursor handling now hides the cursor by default, briefly shows it only
  while pointer movement is active, and re-hides it after idle in both shell
  content and CDP-managed URL tabs.

## [0.0.9] - 2026-05-26

### Changed

- OS package installs now go through a root-owned helper at
  `/usr/local/lib/frame/root-helper` instead of a release-controlled sudo
  script.
- Releases declare required OS packages in `deploy/os-packages.txt`, and the
  updater installs missing allowlisted packages automatically.
- Release pipeline documentation now lives in `docs/RELEASES.md`.

### Removed

- Removed the manual `deploy/update.sh` recovery script; the in-app updater is
  the supported update path.

## [0.0.8] - 2026-05-26

### Fixed

- The OS package helper now detects read-only bind mounts around apt/dpkg
  paths and temporarily remounts them writable, allowing package installs from
  the hardened `frame-core` systemd namespace.

## [0.0.7] - 2026-05-26

### Fixed

- VNC now starts wayvnc with `/run/frame` as its runtime directory while
  preserving the real Wayland socket path, so wayvnc can create its control
  socket even under the hardened `frame-core` systemd sandbox.

## [0.0.6] - 2026-05-26

### Fixed

- Updater subprocesses now stream command output to log files under
  `/opt/frame/state/update-commands/` instead of buffering it in memory,
  eliminating `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` even for very verbose
  npm or apt output.
- The Updates UI now shows an SSH recovery command when an in-app apply fails
  with the buffer-overflow error on an older release.
- `deploy/update.sh` now forces dev dependencies during staging, clears the
  matching quarantine entry on success, and documents the UI follow-up.

## [0.0.5] - 2026-05-26

### Fixed

- The updater now uses a larger bounded command-output buffer for npm,
  migration, sudo, and log commands, preventing
  `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` during verbose package installs.
- Device npm install/prune commands now run with audit, fund, and noisy logs
  disabled; the release tarball includes `.npmrc` so already-installed
  updaters get the quieter behavior while applying this release.

## [0.0.4] - 2026-05-26

### Added

- The updater now has an explicit OS-package phase. Releases can declare
  required Debian/Ubuntu packages through `deploy/install-os-packages.sh`; the
  updater installs them through a narrow sudo helper when the device has been
  provisioned with the current sudoers fragment.
- The Updates UI now shows the current phase, recent in-memory phase events,
  warnings, and recent updater logs instead of only the final result.
- The kiosk shell applies display scale/orientation itself and reloads through
  shell protocol v5, so these settings are visible even before `wlr-randr` is
  installed.

### Fixed

- Current version comparison now treats `0.0.x` and `v0.0.x` as the same
  release.
- Display on/off now reports a clear missing-package error instead of raw
  `spawn wlr-randr ENOENT`.
- VNC startup failures now surface the `wayvnc` exit output in the VNC panel
  instead of only showing a later proxy connection refusal.
- Built-in screens no longer receive pointer events from the kiosk shell, which
  keeps the parent shell cursor-hiding style active.

## [0.0.3] - 2026-05-26

### Fixed

- Release updates can now build on devices whose `frame-core` service runs with
  `NODE_ENV=production`; the updater forces dev dependencies during the staging
  build before pruning them again.
- The Vite/TypeScript build tools required by the already-deployed updater are
  available from production installs, so devices that failed on `v0.0.2` can
  apply this release without manual SSH repair.

## [0.0.2] - 2026-05-26

### Added

- Display scale and orientation settings in `frame.yaml` and the Settings UI,
  applied through `wlr-randr` on the kiosk Wayland session.

### Changed

- VNC now connects through the authenticated app server at `/vnc/ws`; the
  websockify listener is loopback-only instead of exposed directly on the LAN.
- MQTT connects with an explicit MQTT 3.1.1 client id and uses QoS 0 for HA
  availability/state publishes to avoid broker PUBACK compatibility failures.
- The installer writes the detected backlight device into `frame.yaml` and
  installs `wlr-randr`; `wlopm` is installed when available.

### Fixed

- Brightness read/write falls back to the detected `/sys/class/backlight/*`
  device when an existing config still points at `intel_backlight` on other
  hardware.
- Display on/off now runs `wlopm`/`wlr-randr` with the kiosk Wayland
  environment, so calls from the system `frame-core` service reach Cage.
- Kiosk cursor hiding is applied to all shell elements, and Chromium launches
  with hidden scrollbars.
- The bundled noVNC page no longer fails with "Connection lost" because it no
  longer tries to connect to an unproxied `:6080` WebSocket from the browser.

### Tests

- 61 core tests pass, including coverage for writing display scale and
  orientation settings.

### Added

- `deploy/install.sh` provisions Debian 12 / Ubuntu 24.04: creates the
  `frame` user/group, installs cage + chromium + wayvnc + Node 22 +
  helpers, lays out `/opt/frame`, generates a backlight-specific udev
  rule, drops the systemd units + daily Chromium restart timer, and
  prompts for bearer/MQTT/VNC secrets.
- frame-core service: Fastify API on `:8080`, versioned shell-page
  WebSocket protocol v3, pipe-based Chromium CDP transport, screenshot-
  overlay transitions between URL screens, on-disk safe-mode fallback
  with `/api/state.safe_mode_info`.
- Claim-based scheduler matching SPEC §4.7 priority semantics
  (`default` 0, `scheduled` 10, `ha` 20, `manual_next` 25,
  `programmatic` 30, `manual_pinned` 100); manual_next yields on the
  arrival of any non-manual-next claim.
- Cron-rules engine persisted to `/etc/frame/rules.yaml`, validated via
  `cron-parser`, edited from the web UI.
- Updater: GitHub release polling, optional GPG signature verification,
  config snapshotting under `/opt/frame/snapshots/<from>--<to>/`,
  SHA-hashed migration integrity check (refuses divergent histories),
  atomic symlink swap, post-start health-check window with full
  rollback restoring code + config, structured `update.log` events.
- MQTT/HA discovery: `select.frame_current_screen`,
  `number.frame_brightness`, `switch.frame_display_power`,
  `sensor.frame_active_screen / uptime / version / update_available /
  last_update_status`, `binary_sensor.frame_mqtt_auth_ok` (off when
  the broker rejects credentials five times in a row),
  `button.frame_reboot / update_now / update_now_force`.
- VNC supervisor wraps wayvnc + websockify with on-demand start,
  15 min idle auto-stop, and crash propagation.
- LAN family-message endpoint: `POST /family-message`, 280-char limit,
  one message per IP per 5 minutes, no HTML, off by default in
  `builtins.family_message.enabled`. Activates a one-hour programmatic
  claim on the `family-message` screen.
- Bearer-token rotation endpoint with confirmation flow in the UI.
- Web UI (React + Vite): Now / Screens / Rules / System / Updates /
  VNC / Settings, full screen editor with `POST /api/screens/:id/test`
  that returns HTTP status, final URL, load timing, console errors
  and a screenshot, JSON cron-rule editor, live-tailing logs viewer
  with subsystem filter, updater channel / auto-apply / staging-delay
  controls, public-IP banner.
- 12 built-in screens with real implementations: clock, calendar
  (iCal/ICS), photos (Immich + local + ken-burns), weather
  (Open-Meteo), now-playing (HA media_player pushes), transit
  (generic JSON departures feed), agenda-board (composite morning
  view), status-board (HA REST sensor grid), ambient (canvas radial
  blobs, three palettes), family-message, doorbell (snapshot or
  MJPEG with pulsing banner), media-viewer (local images + video),
  plus the emergency safe-mode screen.
- GitHub Actions: typecheck / build / test / shellcheck on PRs,
  release workflow on tag push.
- 24 tests covering claim resolution, manual_next semantics,
  frame.yaml validation, family-message rate limiting, migration
  integrity hash diverge / missing detection, and HTTP-level
  coverage of `/healthz`, `/api/state` auth, `PUT /api/screens`
  validation, and `POST /family-message` gating.
- Documentation: provisioning + local dev walkthroughs in
  `README.md`, Home Assistant automation cookbook in
  `docs/HOMEASSISTANT.md` covering doorbell triggering,
  `media_player → /api/now_playing` push, sunset dimming, and a
  `binary_sensor.frame_mqtt_auth_ok` alert pattern.

### Changed

- `ScreenController.show` waits on `Page.loadEventFired` instead of
  a fixed 4 s sleep when activating a cold URL screen.
- `/api/logs` reads `journalctl -u frame-core` on Linux and falls
  back to the on-disk `update.log` elsewhere; supports per-subsystem
  filtering.
- `Scheduler.scheduleExpiryRecheck` `unref()`s its timer so the
  process can exit cleanly.
- Screen editor renders a typed form (select / checkbox / numeric
  input) from each built-in's `manifest.json` `config_schema`
  rather than a raw JSON textarea; a JSON-edit fallback toggle
  remains for advanced cases. Backed by `GET /api/builtins`.
- `/api/state` carries `safe_mode_info { reason, details? }` so
  validation failures surface in the Now tab without SSH.
- Now tab subscribes to `/api/events` for live state push and
  falls back to polling at 30 s instead of 5 s. The push message
  carries the full payload — one round trip per scheduler event.
- `/ws` and `/api/events` accept either a `?token=...` query
  string (web UI) or a loopback source (kiosk shell on the
  device), since browsers can't set `Authorization` on a WS
  upgrade.

### Fixed

- `CdpManager.start` called a non-existent CDP method
  `Target.setDiscoverDiscoveryEnabled`. Replaced with the actual
  `Target.setDiscoverTargets` — without this, frame-core never
  saw the initial tab list on real hardware.
- `web/vite.config.ts` now proxies `/api/events` in dev so the
  live-state subscription works against `dev:core`.

### Tests

- 36 tests pass: claims, config, scheduler (manual_next semantics
  + default fallback), family-message rate limiting, migration
  integrity (SHA mismatch, missing migration), snapshot
  round-trip, updater (staging delay, applyAvailable preconditions)
  with an injectable mock GitHubClient, StateBus fan-out and
  exception safety, plus HTTP-level coverage of `/healthz`,
  `/api/state`, `PUT /api/screens`, `POST /family-message`.
