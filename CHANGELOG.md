# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
