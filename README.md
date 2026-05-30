# Picture Frame

A repurposed laptop turned into a flexible information display: clock, calendar,
photos, weather, Grafana, Home Assistant dashboards — anything that can render
in a browser, plus a set of first-class built-in screens.

See [SPEC.md](./SPEC.md) for the full design.

---

## Provisioning a new device

On a fresh Debian 12 or Ubuntu 24.04 install (minimal, with SSH):

```sh
ssh frame@frame.local
curl -fsSL https://raw.githubusercontent.com/victorDigital/pictureframe/main/deploy/install.sh \
  | sudo bash
```

The installer:

- Creates the `frame` user/group and joins the `video`, `render`, `input`,
  `tty`, `i2c` groups
- Installs `cage`, `chromium`, `wayvnc`, `websockify`, `avahi-daemon`,
  `ddcutil`, `plymouth`, Node 22, and a few small CLIs
- Lays out `/opt/frame` with `releases/`, `snapshots/`, `state/`, `shared/`
- Detects the backlight device (`intel_backlight`, `amdgpu_bl0`, …) and
  installs a udev rule granting the `frame` group write access — no sudo
  wildcards (see SPEC §10)
- Drops `frame-core.service`, `frame-kiosk.service`, and a daily Chromium
  restart timer
- Installs a root-owned helper with a narrow sudoers allowlist for package
  installs, service restarts, and reboot
- Installs a minimal Plymouth boot splash with a Picture Frame icon and
  progress bar, and applies quiet kernel boot flags
- Runs the `frame` kiosk session on tty1, then cage launches Chromium against
  `http://localhost:8080/shell/`
- Prompts for a bearer token, VNC password, and MQTT password (or auto-
  generates them with `--non-interactive`)
- Optionally accepts `--signing-key <path>` to plant a GPG public key for
  release signature verification (SPEC §5.7)

Reboot. Boot-to-display target is under 60 s; the installer disables both
`apt-daily` timers to keep that target predictable.

The web UI lives at `http://frame.local:8080` — sign in with the bearer
token the installer printed. Everything else is configured from there.

---

## Local development

```sh
nvm use            # Node 22
npm install
npm run dev        # core (8080), web (5181), kiosk (5180) in parallel
```

`dev:core` sets `FRAME_DISABLE_CDP=1` so frame-core comes up without trying
to spawn Chromium — useful on macOS or anywhere you don't have the Wayland
stack. Point a normal browser at `http://localhost:5181` for the control
UI; the web bundle proxies `/api` and `/ws` to core.

To exercise the kiosk shell page itself: open `http://localhost:8080/shell/`
(served by core) and use the screen-edit UI on :5181 to drive it.

The kiosk URL screens render in iframes (`/builtin/<id>/index.html`) and
take their config via `?config=<json-encoded>` in the URL. That's the
contract documented in SPEC §4.3 and §4.4.

```sh
npm run typecheck
npm test
npm run build
```

20+ tests cover claim priority resolution, manual_next yield semantics,
config validation, family-message rate limiting, and migration integrity.

---

## Configuration

Everything lives under `/etc/frame/`:

- `frame.yaml` — device, updater, MQTT, VNC, brightness backend
- `screens.yaml` — the screen list
- `rules.yaml` — cron-based scheduled claims (the web UI's Rules section
  writes this for you)
- `secrets/bearer_token`, `secrets/vnc`, `secrets/mqtt`, optional
  `secrets/release.pub` — mode `0640`, owned by `root:frame`

Examples ship in this repo as [`config.example.yaml`](./config.example.yaml)
and [`screens.example.yaml`](./screens.example.yaml).

Bad configs put frame-core into **safe mode** (SPEC §8.2): the API is still
reachable, the only screen is `emergency`, the validation reason is
returned in `/api/state.safe_mode_info` and surfaced in the Now tab. The
updater is disabled until the config is fixed.

---

## Wiring Home Assistant

Auto-discovery is published when `ha.enabled: true`. Without any further
config you get:

- `select.frame_current_screen` — bound to the screen list
- `number.frame_brightness`, `switch.frame_display_power`
- `button.frame_reboot`, `button.frame_update_now`, `button.frame_update_now_force`
- `sensor.frame_active_screen`, `sensor.frame_uptime`, `sensor.frame_version`,
  `sensor.frame_update_available`, `sensor.frame_last_update_status`
- `binary_sensor.frame_mqtt_auth_ok` — flips to `off` if the broker
  rejects credentials five times in a row (SPEC §10)

Command topics for automations are listed in SPEC §6.3.

See [docs/HOMEASSISTANT.md](./docs/HOMEASSISTANT.md) for ready-to-paste
automations covering doorbell triggers, push-on-play for now-playing, and
sunset dimming.

---

## Releases

Tagged GitHub releases. `v1.2.3` ships on the stable channel; `v1.2.3-beta.N`
on the beta channel. The on-device updater polls every 15 min and applies
according to the configured channel + staging delay. See SPEC §5 for the
full update flow, including atomic symlink swap, config snapshotting, and
rollback semantics. The migration runner refuses to apply an update whose
recorded migration hashes diverge from what the device already applied
(SPEC §5.4).

Release authoring and the GitHub Actions pipeline are documented in
[docs/RELEASES.md](./docs/RELEASES.md).

---

## License

MIT
