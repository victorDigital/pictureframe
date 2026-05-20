# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial repository scaffolding: workspaces for `core`, `kiosk`, `web`,
  and `builtin-screens/*`.
- `deploy/install.sh` provisions the `frame` user, installs the Wayland +
  Chromium kiosk stack, lays out `/opt/frame`, generates the backlight udev
  rule for the detected device, and installs systemd units.
- frame-core skeleton: HTTP API on :8080, `/healthz`, WebSocket shell
  protocol v3, config loader with safe-mode fallback.
- Pipe-based CDP manager driving Chromium tabs (one shell tab plus up to
  five preloaded URL tabs).
- Updater skeleton: GitHub tag polling, tarball download, migration
  integrity check (SHA256), config snapshotting, atomic symlink swap,
  rollback on health-check failure.
- Built-in screens: `clock`, `emergency` (safe-mode), plus manifests for
  the remaining built-ins listed in SPEC §7.
- Web UI scaffold with bearer-token auth and Now / Screens / System /
  Updates / VNC / Settings sections.
- MQTT client with HA discovery and an `auth_failed` state surfaced as
  `binary_sensor.frame_mqtt_auth_ok`.
