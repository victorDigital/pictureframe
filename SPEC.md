# Picture Frame — Technical Spec

A repurposed laptop running a flexible, extensible information display. Boots into a Chromium kiosk controlled by a local TypeScript service, with Home Assistant integration, a web control panel, and a self-updating mechanism driven by tagged GitHub releases.

---

## 1. Goals and non-goals

### Goals

- Single-purpose appliance feel: boot straight into a display, no desktop, no login prompt
- Flexible "screens" abstraction: anything from a built-in clock to an arbitrary URL can be a screen, including sites that refuse to render in iframes
- Multiple trigger sources (default, manual, programmatic, scheduled, Home Assistant) resolved by a priority system
- Smooth crossfade transitions between screens, with background preloading so visible swaps are instant
- Home Assistant as a first-class controller — brightness, screen selection, state observation
- Robust self-update: tagged GitHub releases, atomic deploys, schema/system migrations, automatic rollback of both code and config

### Non-goals

- Multi-device clustering or cloud sync (single device, single config file)
- User accounts (single bearer token; trusted LAN deployment)
- Public internet exposure (Tailscale or equivalent if remote access is wanted)
- Touch input (the screen is a frame, not a tablet)

---

## 2. Hardware and OS baseline

**Target hardware:** laptop, 2020+, 8GB+ RAM, integrated GPU sufficient for hardware-accelerated Chromium.

**OS:** Debian 12 (Bookworm) or Ubuntu Server 24.04 LTS, minimal install.

**Display stack: Wayland.** The device uses cage (Wayland kiosk compositor) and wayvnc for in-browser VNC. X11 is not installed. This is a deliberate single-stack choice — mixing the two was a mistake in earlier drafts.

**Base packages installed by `install.sh`:**

- `cage` — Wayland kiosk compositor
- `wayvnc` — VNC server for Wayland sessions
- `chromium` — the renderer (driven via CDP from frame-core)
- `nodejs` (LTS, 22.x), `npm`
- `git`, `curl`, `jq`
- `ddcutil` — external monitor brightness if applicable
- `websockify` — WebSocket proxy for the in-browser VNC viewer
- `avahi-daemon` — `frame.local` mDNS discovery
- `logrotate`
- `tailscale` (optional, recommended) — remote SSH

On Debian 12, `cage` is in `bookworm-backports`; the install script enables backports and pins cage from there. Ubuntu 24.04 has a current cage in the main archive. `wayvnc` is in both distributions' main archives.

**System user and group:** `frame` user and `frame` primary group, created by the install script.

**Time sync:** `systemd-timesyncd` is enabled by default on both distributions. The install script verifies this is running. The clock screen displays a small warning indicator if the clock is reported unsynchronized.

**Auto-login:** `frame` user via systemd getty override. Then `frame-kiosk.service` starts cage, which launches chromium with CDP enabled over a Unix domain socket (see §3.2 for the security rationale).

---

## 3. Process architecture

Two cooperating services managed by systemd:

```
┌──────────────────────────────────────────────────────────────────┐
│  cage (Wayland compositor)                                       │
│    └── chromium                                                  │
│          ├── Tab 0: http://localhost:8080/shell                  │
│          │           (built-in screens + transition overlay)     │
│          ├── Tab 1: <URL screen A>  (preloaded, hidden)          │
│          ├── Tab 2: <URL screen B>  (preloaded, hidden)          │
│          └── ...                                                 │
│              ▲                                                   │
│              │ CDP via Unix socket /run/frame/cdp.sock           │
│              │ Tab 0 also has a WebSocket to frame-core          │
│              ▼                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ frame-core (Node.js / TypeScript)                        │    │
│  │   • HTTP API + WebSocket on :8080                        │    │
│  │   • CDP client managing Chromium tabs                    │    │
│  │   • Scheduler & claim resolver                           │    │
│  │   • Updater (GitHub poll + migration runner)             │    │
│  │   • MQTT client (HA discovery + commands)                │    │
│  │   • System control (brightness, reboot, VNC lifecycle)   │    │
│  │   • Serves web UI, shell page, built-in screens          │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ wayvnc + websockify (on-demand, started by frame-core)   │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### 3.1 systemd ordering

`frame-kiosk.service` declares `After=frame-core.service` and `Requires=frame-core.service`. The kiosk's pre-start script waits for `http://localhost:8080/healthz` to respond before launching cage+chromium (with a 30s timeout). This guarantees Chromium only attempts to load the shell page after frame-core is listening, preserving the boot-to-display target.

### 3.2 CDP security

The CDP interface is the most sensitive control surface on the device. Anyone who can reach it gets arbitrary JavaScript execution in every tab, including any URL screens that may be logged in to dashboards, plus the ability to navigate Chromium anywhere.

Chromium is launched with `--remote-debugging-pipe` (not `--remote-debugging-port`). This routes CDP over file descriptors inherited from the parent process rather than a TCP port, so it cannot be reached from the network at all — even loopback. frame-core launches Chromium as a subprocess and inherits the pipe, then exposes a small command surface internally; no external client can attach.

This is a hard requirement of the design. The earlier alternative (`--remote-debugging-port=9222` bound to 127.0.0.1) is also acceptable but pipe-based is strictly safer and equally well-supported by the Node CDP libraries.

---

## 4. The screen system

### 4.1 Two-path rendering

Built-in screens render as iframes inside the shell page (Tab 0), which is same-origin with frame-core and fully observable. URL screens render as separate Chromium tabs, one per preloaded screen, activated via CDP. This is what makes Grafana, Home Assistant dashboards, and other frame-busting sites usable as screens.

### 4.2 Transitions (screenshot-based)

Because the visible tab during a URL→URL transition is not Tab 0, the shell page can't draw a crossfade overlay that the user will see. The transition is therefore implemented via screenshot composition:

1. Source tab is captured via CDP `Page.captureScreenshot` (~50–150 ms depending on resolution and GPU)
2. The screenshot is delivered to Tab 0 (the shell page) over the WebSocket as a data URL
3. The shell paints the screenshot as a full-screen image with `opacity: 1`
4. frame-core activates the destination tab via `Target.activateTarget`
5. Simultaneously, frame-core tells Tab 0 to fade its overlay screenshot from 1 to 0 over `transitionMs`
6. While the overlay fades, the destination tab is composited underneath it — the user sees a smooth crossfade
7. After the fade completes, the shell clears the overlay; Tab 0 returns to hidden state behind the destination tab

For built-in→built-in transitions, no screenshot is needed; the shell crossfades between its iframe stack as before. Built-in↔URL transitions use a hybrid: the shell can be either the source (no screenshot needed; fade overlay up to opaque, switch, fade down) or the destination (screenshot of the source URL tab, switch to Tab 0, fade down).

Transition latency budget:
- Built-in ↔ built-in: just the configured `transitionMs` (default 600 ms)
- Built-in → URL: ~`transitionMs` + 0 ms screenshot (built-in is source, no capture needed)
- URL → built-in: ~`transitionMs` + 50–150 ms screenshot (URL is source)
- URL → URL: ~`transitionMs` + 50–150 ms screenshot

100–200 ms of additional latency on URL-involved transitions is noticeable as a "stutter before the fade" but acceptable; the alternative compositor-overlay design would require gtk-layer-shell plumbing for marginal gain.

### 4.3 Screen model

```ts
type Screen = {
  id: string;
  name: string;
  type: "url" | "builtin";
  source: string;
  config?: Record<string, unknown>;
  preload: boolean;
  transitionMs?: number;
  reloadIntervalSec?: number;
  tags?: string[];
};
```

Screens are defined in `/etc/frame/screens.yaml`, read/written by frame-core, watched for changes.

### 4.4 Shell ↔ core protocol

The shell page (Tab 0) connects to frame-core over a single WebSocket. The protocol is versioned and renegotiated on every connect:

```ts
// Handshake
{ type: "hello", protocolVersion: 3 }                    // shell → core
{ type: "welcome", protocolVersion: 3 }                  // core → shell
{ type: "reload_required", reason: "protocol_version_mismatch" }
//   — shell does location.reload() on mismatch

// Steady state, core → shell
{ type: "preload_builtin", screen: Screen }
{ type: "show_builtin", id: string, transitionMs: number }
{ type: "unload_builtin", id: string }
{ type: "show_overlay_image", dataUrl: string, transitionMs: number }
{ type: "show_overlay_color", color: string, transitionMs: number }
{ type: "hide_overlay", transitionMs: number }

// Shell → core
{ type: "builtin_ready", id: string }
{ type: "builtin_error", id: string, error: string }
{ type: "heartbeat", visible: string }
```

URL tabs are managed entirely by frame-core via CDP; they do not run shell code.

### 4.5 Preloading

Hard cap of **5 preloaded URL screens** plus the shell page (which hosts all built-ins). The cold-start preload set is **the first 5 screens in `screens.yaml` order with `preload: true`**. After startup, the set tracks the most-recently-visible 5 with `preload: true`.

Cold-load behavior (when an unpreloaded URL screen is requested): frame-core creates the tab, holds the overlay for up to 4 seconds while waiting for `Page.loadEventFired`, then activates the tab regardless. The shell shows a "Loading…" hint after 1.5 s.

### 4.6 URL screen verification

The web UI's screen editor includes a "Test screen" button for URL screens. It loads the URL in a temporary tab and reports: HTTP status, final URL after redirects, whether `load` fired within 10 s, console errors, and a screenshot. The point is to catch broken URLs, auth redirects, and pages that render blank — not frame-busting headers (irrelevant under the two-path model).

### 4.7 Trigger sources and priority resolution

```ts
type Claim = {
  screenId: string;
  source: "default" | "manual_pinned" | "manual_next" | "programmatic" | "scheduled" | "ha";
  priority: number;
  expiresAt?: number;
  oneShot?: boolean;
  claimId: string;
};
```

| Source           | Priority | Behavior                                                           |
|------------------|----------|--------------------------------------------------------------------|
| `default`        | 0        | Fallback when stack is empty; always present                       |
| `scheduled`      | 10       | "Grafana 9–5", "weather in the morning"                            |
| `ha`             | 20       | Explicit HA service call                                           |
| `manual_next`    | 25       | "Show this next, then resume schedule" — expires on next event     |
| `programmatic`   | 30       | "Spotify is playing → now-playing"                                 |
| `manual_pinned`  | 100      | "Show this until I dismiss it"                                     |

The web UI's screen tile has two actions: **Show next** (default, `manual_next`) and **Pin** (secondary button, `manual_pinned`). `manual_next` claims expire as soon as any other event would have shown a different screen; `manual_pinned` claims expire only on explicit dismissal or after the configurable pinned timeout (default 4 hours).

---

## 5. Update system

### 5.1 Release model

GitHub repo with tagged releases following SemVer (`v1.2.3`). Two channels: `stable` (any tag without prerelease suffix) and `beta` (`v1.2.3-beta.1`). Channel and apply policy configured in `/etc/frame/frame.yaml`.

### 5.2 Update flow with config snapshotting

```
poll GitHub releases every 15 min
        │
        ▼
new tag on channel?  ── no ──> sleep
        │
       yes
        │
        ▼
apply gate (see §5.6)
        │
       pass
        │
        ▼
 1. Acquire update lock
 2. Snapshot config and state (see §5.3 for layout, §5.5 for secret handling)
 3. Download tag tarball from GitHub API to staging dir
 4. Verify signature if signing key configured (§5.7)
 5. npm ci in staging
 6. Verify migration integrity (§5.4)
 7. Pre-flight health-check staging on port 8081
 8. Run new migrations in order (idempotent, recorded)
 9. Atomic symlink swap: /opt/frame/current
10. systemctl restart frame-core
11. Post-start health check on :8080 every 5s for 60s
        │
        ▼
   success?  ── no ──> rollback (§5.5)
        │
       yes
        │
        ▼
   record success, prune old releases and snapshots (keep last 3)
```

### 5.3 Directory layout

```
/opt/frame/
├── releases/
│   ├── v1.2.0/
│   ├── v1.2.1/
│   └── v1.3.0/
├── current → releases/v1.3.0
├── shared/
│   ├── node_modules/
│   └── data/
├── snapshots/
│   └── v1.2.1--v1.3.0/
│       ├── frame.yaml
│       ├── screens.yaml
│       └── migrations.json
│       (no secrets — see §5.5)
└── state/
    ├── migrations.json
    ├── version.json
    └── update.log
```

### 5.4 Migrations

Three types: shell (`.sh`), config patch (`.yaml`), TypeScript (`.ts`). Numbered, forward-only, idempotent. Each applied migration is recorded in `state/migrations.json` with **its SHA256 file hash** plus timestamp and output.

**Migration integrity check.** Before applying any update, the runner re-hashes the migration files in the new release at numbers ≤ the highest previously-applied number. If any hash differs from what's recorded, the update aborts with `migration_history_diverged`. This catches force-pushed tags, tampered tarballs, and renumbering mistakes. Aborts are surfaced in the UI; recovery requires manual SSH.

**Sudoers scope.** Migrations run as the `frame` user. The sudoers file grants only:

```
frame ALL=(root) NOPASSWD: /usr/bin/systemctl restart frame-core, \
                            /usr/bin/systemctl restart frame-kiosk, \
                            /sbin/reboot
```

OS package installs are **not** in the sudoers scope. Migrations that need OS packages mark themselves with a `requires_manual_step` flag in their frontmatter (for `.sh` files) or top-level key (for `.yaml`/`.ts`). The updater stops at such migrations, surfaces "this update needs a manual step" in the UI with the exact command to run, and resumes after the user confirms via the UI or SSH. Releases that contain such migrations are flagged in the release listing.

Brightness control does not go through sudo (see §10).

### 5.5 Rollback and snapshots

Rollback restores both code and config:

1. Symlink `current` flips back to the previous release
2. Config files (`frame.yaml`, `screens.yaml`, `migrations.json`) restored from `/opt/frame/snapshots/<from>--<to>/`
3. `systemctl restart frame-core`
4. The failed release is quarantined; updater won't re-attempt it
5. Last 3 successful releases retained; older pruned with their snapshots

**Secrets are deliberately excluded from snapshots.** They live in `/etc/frame/secrets/` and are referenced from `frame.yaml` by file path (see `bearer_token_file`, `password_file`, etc. in §9.1). This means rolling back does not undo a secret rotation — a deliberate trade-off: keeping historical copies of bearer tokens, MQTT passwords, and VNC passwords on disk for the lifetime of three update cycles is a worse problem than losing the ability to revert a credential rotation by rollback. If a rotation needs to be reverted, that's a manual operation via SSH (rewrite the file).

**Releases with non-reversible system changes** (any migration with `requires_manual_step`, or anything that touched the filesystem outside the config files) are flagged in metadata. The web UI's rollback button still works, but for flagged releases requires typing the version number to confirm.

### 5.6 Apply policy and the staging delay

```yaml
updater:
  channel: stable
  poll_interval_min: 15
  auto_apply: false             # off by default
  staging_delay_hours: 24       # if auto_apply on: wait this long after first seeing the tag
  health_check_window_sec: 60
```

With `auto_apply: false` (default), new versions surface as a badge in the web UI and a `sensor.frame_update_available` HA entity. Apply via UI button or MQTT command.

With `auto_apply: true`, the staging delay means a release first seen at 09:00 Monday isn't auto-applied until 09:00 Tuesday at earliest. A device coming online during the delay window respects the remaining wait time.

**Manual triggers respect or override the staging delay explicitly.** The MQTT command and UI both support two variants:

- `update_now` — applies only releases past their staging delay. Returns an error if the available release is still in its staging window.
- `update_now_force` — applies the available release regardless of staging delay. Marked as an override action; logged distinctly.

This preserves the staging delay's purpose (yanking a broken tag has a window) while making the override path explicit and audited rather than accidental.

### 5.7 Verifying releases

The updater downloads `api.github.com/repos/<repo>/tarball/<tag>` over HTTPS. No `git` on the device.

Optional GPG signing: if `updater.signing_key_file` is set, the updater requires a `release.asc` asset on the GitHub release and verifies the tarball against the configured public key before applying.

**Signing key bootstrap.** The signing key cannot be introduced via an update if updates already require signing (chicken-and-egg). The supported paths are:

- Initial install: install script accepts `--signing-key <path>` to plant the key before updates start
- Web UI: a "Signing key" page in Settings allows uploading or rotating the public key. This bypasses signature verification only for the initial setting (when no key was previously configured); rotation requires the new key to be signed by the old one, or explicit override (typing "I understand this disables verification temporarily").

### 5.8 Health check

```
GET http://localhost:8080/healthz
→ 200 { "ok": true, "version": "v1.3.0", "screens_loaded": 8, "chromium_connected": true }
```

Pre-flight runs against staging on port 8081. Post-start polls :8080 every 5 s for 60 s; rollback on no success.

### 5.9 Behavior during the restart gap

During the post-start window when frame-core is restarting, frame-core's WebSocket connection to the shell page (Tab 0) is dropped. What happens depends on which tab is currently active:

- If the active tab is a URL tab: the URL tab continues to render its last state. frame-core is not in the loop while it's down, so the URL screen is "frozen" (no programmatic interactions, no schedule changes) but visually intact. When frame-core comes back, it re-attaches via CDP and resumes management.
- If the active tab is Tab 0 (a built-in screen): the shell page detects WebSocket disconnect and shows a small "Reconnecting…" indicator in a corner of the active built-in. It doesn't disrupt the screen otherwise.

The earlier draft claimed Tab 0 could draw a "Reconnecting…" overlay regardless of which tab was active. It can't, since Tab 0 isn't visible during URL-screen activity. The honest behavior is the above.

---

## 6. Home Assistant integration

### 6.1 Transport

MQTT with HA's discovery mechanism. frame-core publishes discovery messages on `homeassistant/...` so the device appears in HA automatically.

### 6.2 Entities exposed to HA

| Entity                              | Type    | Notes                                  |
|-------------------------------------|---------|----------------------------------------|
| `select.frame_current_screen`       | select  | Options populated from screen list     |
| `number.frame_brightness`           | number  | 0–100                                  |
| `switch.frame_display_power`        | switch  | DPMS off/on                            |
| `button.frame_reboot`               | button  | Safe reboot                            |
| `button.frame_update_now`           | button  | Apply if past staging delay            |
| `button.frame_update_now_force`     | button  | Apply regardless of staging delay      |
| `sensor.frame_active_screen`        | sensor  | Read-only state                        |
| `sensor.frame_uptime`               | sensor  | Seconds since boot                     |
| `sensor.frame_version`              | sensor  | Currently deployed git tag             |
| `sensor.frame_update_available`     | sensor  | Pending tag, or "none"                 |
| `sensor.frame_last_update_status`   | sensor  | `success` / `failed` / `rolled_back`   |
| `binary_sensor.frame_mqtt_auth_ok`  | sensor  | False if MQTT auth is failing (see §10)|

### 6.3 Services consumable from HA

MQTT command topics:

- `frame/cmd/show_screen` `{"id": "grafana-home", "claim": "ha", "duration_min": 60}`
- `frame/cmd/release_screen` `{"id": "grafana-home"}`
- `frame/cmd/set_default` `{"id": "clock"}`
- `frame/cmd/brightness` `{"value": 30}`
- `frame/cmd/display_power` `{"state": "off"}`
- `frame/cmd/update_now` — respects staging delay
- `frame/cmd/update_now_force` — overrides staging delay

### 6.4 Example HA automations

```yaml
- alias: "Frame: dim at night"
  trigger: { platform: sun, event: sunset }
  action:
    service: number.set_value
    target: { entity_id: number.frame_brightness }
    data: { value: 15 }

- alias: "Frame: show now playing while music plays"
  trigger:
    platform: state
    entity_id: media_player.spotify
    to: "playing"
  action:
    service: select.select_option
    target: { entity_id: select.frame_current_screen }
    data: { option: "now-playing" }

- alias: "Frame: work-hours Grafana"
  trigger: { platform: time, at: "09:00:00" }
  condition: { condition: time, weekday: [mon, tue, wed, thu, fri] }
  action:
    service: mqtt.publish
    data:
      topic: frame/cmd/show_screen
      payload: '{"id": "grafana-home", "claim": "ha", "duration_min": 480}'
```

---

## 7. Built-in screens

| ID               | Description                                                                       |
|------------------|-----------------------------------------------------------------------------------|
| `clock`          | Large clock + date, configurable face (analog / digital / minimal)                |
| `calendar`       | Agenda from configured CalDAV / Google Calendar source                            |
| `media-viewer`   | Local image/video viewer pointing at a directory                                  |
| `photos`         | Slideshow from a configured photo library backend (see §11)                       |
| `weather`        | Current conditions + forecast via Open-Meteo (no API key)                         |
| `now-playing`    | Album art + track info; driven by HA media_player state pushed via MQTT           |
| `transit`        | Next departures from configured stops                                             |
| `agenda-board`   | Day-at-a-glance: weather + calendar + commute                                     |
| `status-board`   | Grid of HA sensor tiles, configurable layout                                      |
| `ambient`        | Slow generative visuals for late evening (CSS/canvas, self-contained)             |
| `family-message` | LAN-accessible POST endpoint for short messages, displayed for 1 hour             |
| `doorbell`       | Auto-trigger on HA motion/doorbell event; shows snapshot or stream                |

Each built-in lives under `builtin-screens/<id>/` with `index.html`, `manifest.json`, and assets. The manifest declares config schema; the web UI auto-generates a form for it.

**`family-message` is intentionally unauthenticated** within the LAN — anyone on the network can POST a short message. Enforced limits: 280-char message, 1 message per IP per 5 minutes, no HTML rendering. **Disabled by default** in `frame.yaml`; enable only if you trust your LAN.

---

## 8. Web control interface

### 8.1 Tech and auth

React + Vite, static assets served by frame-core. Auth via single bearer token in `/etc/frame/secrets/bearer_token`, stored in `localStorage` after login.

**Token rotation:** rotating the token in the UI is preceded by a confirmation dialog: "All other browser sessions will be signed out, including any mobile app or HA integration using this token." On confirm, the new token is generated and the user's current session updates.

Local-only by default (bind to `0.0.0.0:8080` so LAN works, document that exposure beyond LAN requires a reverse proxy with proper auth). The UI surfaces a banner if it detects the device has a public IP.

### 8.2 Invalid config handling

frame-core validates `frame.yaml` and `screens.yaml` against schemas on every load (via JSON Schema). Writes from the API are validated before being committed to disk — a write that doesn't validate returns 400 with the error, no file changes.

If frame-core starts and discovers an existing on-disk config that doesn't validate (hand-edited, corrupted, or invalidated by an update gone wrong), it boots into **safe mode**:

- Loads a minimal hardcoded config: clock as the only screen, default brightness, no MQTT
- Web UI is reachable on the bearer token from `/etc/frame/secrets/bearer_token` (or a printed-to-console one-time token if even that file is unreadable)
- The active screen is a built-in `emergency` screen showing "Configuration error" plus the validation failure
- Updater is disabled in safe mode until config is fixed

This prevents a bad edit from bricking the device. The web UI's screen editor includes a "Validate" preview that shows the result of a write before committing.

### 8.3 Sections

- **Now** — live preview thumbnail, current screen, active claims, "Show next" and "Pin" buttons per screen
- **Screens** — list, add, edit, delete, reorder; per-screen form generated from manifest; "Test screen" button for URL screens
- **Rules** — schedules and programmatic triggers
- **System**
  - Brightness slider
  - Display on/off
  - Reboot, restart-core buttons
  - Update: current version, available, staging-delay countdown, "Update now" and "Force update now" buttons, history
  - Logs: tail of frame-core, filtered by subsystem (api, updater, scheduler, mqtt, cdp)
- **VNC** — embedded noVNC over `ws://frame.local:8080/vnc`, started on demand
- **Settings** — bearer token rotation, channel selection, auto-apply policy, MQTT credentials, signing key

### 8.4 API surface (selected)

```
GET    /api/screens
PUT    /api/screens                  (validated before commit)
POST   /api/screens/:id/show         { mode: "next" | "pin", durationMin? }
POST   /api/screens/:id/test
DELETE /api/claims/:claimId
GET    /api/state

GET    /api/system/brightness
PUT    /api/system/brightness
POST   /api/system/reboot
POST   /api/system/display/{on,off}

GET    /api/updates
POST   /api/updates/check
POST   /api/updates/apply            (respects staging delay)
POST   /api/updates/apply_force      (overrides staging delay)
POST   /api/updates/rollback
GET    /api/updates/snapshots

GET    /api/logs?service=core&lines=200&subsystem=updater

WS     /ws
WS     /vnc
```

---

## 9. Configuration files

### 9.1 `/etc/frame/frame.yaml`

```yaml
device:
  name: living-room-frame
  bearer_token_file: /etc/frame/secrets/bearer_token

display:
  brightness_backend: backlight       # or "ddcutil"
  backlight_device: /sys/class/backlight/intel_backlight
  default_brightness: 60

screens_file: /etc/frame/screens.yaml
default_screen: clock
manual_pinned_timeout_hours: 4

scheduler:
  max_preloaded_url_screens: 5

updater:
  repo: yourname/picture-frame
  channel: stable
  poll_interval_min: 15
  auto_apply: false
  staging_delay_hours: 24
  health_check_window_sec: 60
  retain_releases: 3
  signing_key_file: /etc/frame/secrets/release.pub   # optional

ha:
  enabled: true
  mqtt:
    host: homeassistant.local
    port: 1883
    username: frame
    password_file: /etc/frame/secrets/mqtt
    keepalive: 60

vnc:
  enabled: true
  password_file: /etc/frame/secrets/vnc

builtins:
  family_message:
    enabled: false
```

### 9.2 `/etc/frame/screens.yaml`

```yaml
screens:
  - id: clock
    name: Clock
    type: builtin
    source: clock
    config: { face: minimal, show_seconds: false }
    preload: true

  - id: photos
    name: Family photos
    type: builtin
    source: photos
    config: { library: immich, interval_sec: 30, transition: kenburns }
    preload: true

  - id: grafana-home
    name: Home dashboard
    type: url
    source: https://grafana.local/d/abc/home?kiosk
    preload: true
    reloadIntervalSec: 60

  - id: now-playing
    name: Now playing
    type: builtin
    source: now-playing
    preload: true
```

---

## 10. Operational concerns

**Brightness control without sudo.** A udev rule (`/etc/udev/rules.d/50-frame-backlight.rules`) grants the `frame` group write permission on `/sys/class/backlight/<device>/brightness`. The install script detects the backlight device (typically `intel_backlight` or `amdgpu_bl0`) and renders the rule for that exact path. frame-core writes brightness directly, no sudo. For DDC-capable external displays, `ddcutil` runs unprivileged with appropriate group membership on `/dev/i2c-*`.

The earlier draft had sudoers wildcards on backlight paths. Wildcards in sudoers commands match the command string, not the resolved path, which would have allowed `sudo tee /sys/class/backlight/../../etc/passwd` to match. The udev approach removes the wildcard problem entirely.

**Chromium memory growth.** A systemd timer (`frame-chromium-restart.timer`) restarts the kiosk service at 04:00 daily. The shell page reconnects on the new session; URL tabs are recreated and reload their pages.

**Time sync.** `systemd-timesyncd` enabled and verified. The clock screen displays a small warning if the system reports the clock unsynchronized — important on a device that may be powered off for long periods.

**Log rotation.** Service logs go through systemd-journald (size-capped). The updater's `update.log` and per-migration logs in `/opt/frame/state/` rotate via a logrotate config: 7-day retention, 10 MB max per file, gzip old. Installed by the deploy step.

**Boot speed.** Target boot-to-display under 60 s. `apt-daily.timer` and `apt-daily-upgrade.timer` are disabled (OS updates are manual via SSH; the frame's GitHub updater is the application update path).

**MQTT failure surfacing.** The MQTT client distinguishes three states: connected, retrying (transient failure or network), and `auth_failed` (broker rejected credentials). The latter surfaces as a distinct badge in the UI and the `binary_sensor.frame_mqtt_auth_ok` HA entity, so a fat-fingered password rotation doesn't silently break HA integration. Retries use exponential backoff; auth failures stop retrying after 5 attempts and require manual fix-and-retry.

**Other failure modes.**
- GitHub unreachable → updater skips this poll, retries next interval. Device functions normally (the GitHub updater is not in the critical path of display)
- MQTT broker unreachable → HA features degraded. Schedules, built-in screens, and URL screens continue to work; only HA-driven commands are unavailable
- Chromium crashes → systemd restarts the kiosk service; URL tabs are recreated and reload
- frame-core crashes → systemd restarts; behavior during the gap is per §5.9

---

## 11. Known caveats and recommendations

**Photo library backend.** Google Photos Library API access has tightened repeatedly through 2024–25 and `gphotos-sync` is effectively unmaintained. The `photos` built-in supports three backends in recommended order:

1. **Immich** (self-hosted photo library) — fully featured, actively developed, recommended primary
2. **Local directory** (rclone or manual sync) — simplest, no service to run
3. **Google Photos direct API** — listed for completeness; expect breakage; not the default

Configure via the screen's `library` config field.

**LAN trust assumption.** Bearer-token auth assumes the LAN is trusted. Family-message is unauthenticated when enabled. Both reasonable for a home network; neither appropriate for shared spaces. The UI banners a warning if the device's IP is publicly reachable.

**Initial provisioning.** First install: SSH into a fresh OS, run `curl -fsSL https://raw.githubusercontent.com/<repo>/main/deploy/install.sh | sudo bash`. The script creates the `frame` user and group, installs packages, lays down the directory structure, generates the backlight udev rule for the detected device, and prompts for bearer token and MQTT credentials. Optional `--signing-key <path>` flag to install a release signing key.

---

## 12. Repository layout

```
picture-frame/
├── README.md
├── CHANGELOG.md
├── SPEC.md
├── package.json
├── tsconfig.json
├── core/
│   ├── src/
│   │   ├── index.ts
│   │   ├── api/             (HTTP + WebSocket)
│   │   ├── cdp/             (Chromium tab management via pipe-based CDP)
│   │   ├── scheduler/       (claims, priority resolution)
│   │   ├── screens/         (registry, config IO, validation)
│   │   ├── updater/         (GitHub poll, snapshot, migration runner)
│   │   ├── mqtt/            (HA discovery + commands)
│   │   └── system/          (brightness, reboot, VNC lifecycle)
│   └── tests/
├── kiosk/                   (shell page Chromium loads in Tab 0)
│   ├── index.html
│   ├── shell.ts             (iframe stack for built-ins, overlay layer)
│   └── styles.css
├── web/                     (React control UI)
├── builtin-screens/
│   ├── clock/
│   ├── calendar/
│   ├── photos/
│   ├── weather/
│   ├── now-playing/
│   ├── transit/
│   ├── agenda-board/
│   ├── status-board/
│   ├── ambient/
│   ├── family-message/
│   ├── doorbell/
│   ├── media-viewer/
│   └── emergency/           (safe-mode error display)
├── migrations/
├── deploy/
│   ├── install.sh
│   ├── update.sh
│   ├── systemd/
│   │   ├── frame-core.service
│   │   ├── frame-kiosk.service
│   │   └── frame-chromium-restart.timer
│   ├── udev/
│   │   └── 50-frame-backlight.rules.template
│   ├── sudoers.d/
│   │   └── frame
│   └── logrotate.d/
│       └── frame
└── config.example.yaml
```

---

## 13. Build order

### Phase 1 — Bare kiosk (1 weekend)
Fresh OS, `frame` user and group, autologin, cage + chromium pointing at a stub page served by a stub Node server. SSH and mDNS verified. Boot under 60 s.

### Phase 2 — CDP-driven rendering with screenshot transitions (1 weekend)
This is the riskiest piece — prove it early. frame-core skeleton with pipe-based CDP, shell page in Tab 0 with overlay-image mechanism, screenshot capture + composition for URL→URL transitions. Two screens working: built-in `clock` and one URL screen. Validate the transition latency on real hardware.

### Phase 3 — Updater, snapshots, migrations (1 weekend, critical)
Tag polling, tarball download, optional signature verification, config snapshotting, atomic swap, full rollback restoring code + config. Migration runner with integrity check (§5.4). Web UI's Updates page even before the rest of the UI. This unlocks remote iteration; do not skip ahead.

### Phase 4 — Scheduler and claim system (1 weekend)
Claim types, priority resolution, manual pinned vs next-up. Cron-style scheduled rules. Default-screen fallback. Safe mode and config validation.

### Phase 5 — Web UI (1 weekend)
All sections, bearer auth, brightness/reboot/logs, screen editor with Test button.

### Phase 6 — HA / MQTT (1 weekend)
MQTT discovery, all entities, command topics. Auth-failure handling. End-to-end with a real automation.

### Phase 7 — Built-ins (ongoing)
Clock, photos, weather, now-playing first. Rest as time allows. VNC in web UI. Polish.

---

## 14. Glossary

- **Screen** — a renderable view (URL or built-in) that can be shown on the device
- **Claim** — a request to show a specific screen, with priority and optional expiry
- **Shell page** — the single HTML page in Chromium's Tab 0; hosts built-in screens and the transition overlay layer
- **URL tab** — a Chromium tab managed via CDP, holding one URL screen
- **Default screen** — the always-present claim at priority 0
- **Channel** — release stream (`stable` or `beta`) the updater follows
- **Migration** — a versioned, idempotent change applied during an update
- **Release** — a tagged version pulled as a tarball from GitHub
- **Snapshot** — pre-update copy of config files, used for rollback (excludes secrets)
- **Pin / Next-up** — manual claim modes; pin holds until dismissed, next-up yields to the next event
- **Safe mode** — boot mode when config is invalid; minimal hardcoded screen set, UI still reachable
