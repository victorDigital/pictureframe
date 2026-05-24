# AGENTS.md — codebase orientation for AI agents

This file is for agents (Claude Code, Copilot Workspace, etc.) opening this
repo for the first time. Humans should read [SPEC.md](./SPEC.md) and
[README.md](./README.md) first.

## What this repo is

A self-updating Wayland kiosk: a repurposed laptop boots into Chromium
controlled by a local TypeScript service (`frame-core`). Built-in screens
(clock, weather, photos, …) render as iframes inside a shell page in Tab 0;
arbitrary URL screens render as separate Chromium tabs activated via CDP.

The architectural primitives and the entire intended behavior are in
[SPEC.md](./SPEC.md) — when in doubt, the spec is the source of truth.
References below to "§N" point into the spec.

## Where things live

```
core/src/
├── api/             HTTP + WebSocket. ShellBus (single kiosk shell) and
│                    StateBus (fan-out to web UI listeners) are distinct.
├── cdp/             Chromium tab management. Pipe-based CDP transport
│                    (§3.2) — never a TCP port. ScreenController owns the
│                    show/preload/test flow.
├── scheduler/       Claim resolver with priority semantics from §4.7.
│                    manual_next yields on the next non-manual_next claim.
├── config/          Zod schemas, file loader, safe-mode fallback (§8.2).
├── updater/         GitHub poll → snapshot → migration integrity hash →
│                    atomic symlink swap → health check → rollback (§5.2).
├── mqtt/            HA discovery + commands (§6).
└── system/          brightness, vnc, reboot.
core/tests/          node:test driven; runs via tsx.
kiosk/               The shell page Chromium loads in Tab 0. Vanilla TS
                     bundled by Vite.
web/                 React + Vite control UI.
builtin-screens/<id>/  index.html + manifest.json per screen.
deploy/              install.sh, systemd units, udev/sudoers/logrotate.
migrations/          Numbered .sh / .yaml / .ts migrations (§5.4).
```

## Important invariants

These were paid for in bugs and shouldn't be undone:

- **CDP is pipe-only.** `Chromium` is launched with
  `--remote-debugging-pipe`, never `--remote-debugging-port`. fd 3/4 are
  inherited by the Node process and exposed only to `frame-core`.
- **Migration integrity.** Before applying an update, the runner re-hashes
  migration files at numbers ≤ the highest previously-applied number and
  aborts with `migration_history_diverged` on mismatch. Don't loosen this.
- **Sudoers is narrow.** `frame` user can only restart its two services
  and `/sbin/reboot`. Brightness goes through a udev rule, not sudo
  (§10 — the old sudoers-wildcard design was a sandbox escape).
- **manual_next semantics.** A `manual_next` claim is popped on the
  arrival of *any* non-manual-next claim, regardless of resolved
  priority. See `scheduler/index.ts` and `tests/scheduler.test.ts`.
- **Snapshots exclude secrets.** Rolling back undoes code + config but
  not secret rotations — that's a deliberate trade-off in §5.5.
- **Safe mode bypasses the updater.** When `frame.yaml` or
  `screens.yaml` fail validation, `frame-core` boots into safe mode and
  the updater refuses to run until the config is fixed.

## Local development

```sh
nvm use            # Node 22
npm install
npm run dev        # core (8080), web (5181), kiosk (5180) in parallel
npm run typecheck
npm test           # 40+ tests across claims, config, scheduler, family-
                   # message, migrations, snapshot, updater, stateBus,
                   # rules, and HTTP-level API
npm run build
```

`dev:core` sets `FRAME_DISABLE_CDP=1` so frame-core boots without trying
to spawn Chromium. Most code paths can be exercised against the web UI
on `http://localhost:5181`.

`node-pty` is a native dependency used by the Terminal section
(`/api/terminal`). It ships prebuilt binaries for darwin x64/arm64 and
linux x64/arm64/armv7; if no prebuild matches the host npm falls back
to compiling from source, which needs `python3`, `make` and a C++
compiler (`g++`). The Debian-based install path covers this implicitly
because the NodeSource setup script installs `build-essential`, but if
you switch base images keep that in mind.

When you're editing the web UI, the new section likely needs an entry in
`web/src/App.tsx` AND a backend route in `core/src/api/server.ts`. Bearer
auth is enforced by an `onRequest` hook — see `UNAUTH_PATHS` and the
loopback-bypass logic for `/ws` and `/api/events`.

## Adding a built-in screen

1. Make a directory under `builtin-screens/<id>/`.
2. Add `manifest.json` with `id`, `name`, `description`, `config_schema`
   (JSON Schema subset — properties of type `string`, `boolean`,
   `integer`, `number`, plus `enum`/`required`).
3. Add `index.html` that:
   - Reads its config from `new URLSearchParams(location.search).get("config")`.
   - Posts `parent.postMessage({type:"builtin_ready",id:"<id>"},"*")`
     once it's painted.
4. That's it. `GET /api/builtins` will pick the manifest up automatically
   and the web UI's screen editor will render a typed form for it.

If the screen needs to talk to a third-party API (HA, Immich, etc.), be
explicit about CORS in the manifest description.

## Adding a migration

1. Create `migrations/NNNN_short_name.{sh,yaml,ts}`.
2. If it needs `apt install` or other OS-level changes, add a frontmatter
   line `requires_manual_step: true` (or top-level key for yaml/ts) so
   the updater stops and waits for operator confirmation (§5.4).
3. Migrations are forward-only and idempotent. The runner records each
   file's SHA256 in `/opt/frame/state/migrations.json` — once recorded,
   rewriting the file will refuse to apply future updates until the
   history is reconciled manually.

## Adding an MQTT/HA entity

`core/src/mqtt/index.ts`:

1. Add a `publish(component, id, payload)` call inside `publishDiscovery`.
2. Add the matching state publish inside `publishState`.
3. If it has a command topic, handle it inside `handleCommand`.

The `binary_sensor.frame_mqtt_auth_ok` already covers credential drift;
don't reinvent that.

## Trip wires (mistakes I've actually made in this repo)

- **`Target.setDiscoverDiscoveryEnabled` doesn't exist.** Use
  `Target.setDiscoverTargets`. This was a silent bug for a while because
  the dev branch sets `FRAME_DISABLE_CDP=1`.
- **`/ws` and `/api/events` need auth fallbacks.** Browsers can't set
  `Authorization` on a WebSocket upgrade — accept `?token=` query or
  loopback IP. See the `WS_PATHS` set in `server.ts`.
- **Vite dev proxy must include WS paths.** When you add a new WS
  endpoint, add it to `web/vite.config.ts` and set `ws: true`.
- **Don't use `node:events` `listenerCount` as a method name.** That
  collides with `EventEmitter`'s built-in — use a different name.
- **`scheduler.scheduleExpiryRecheck`'s timer must `.unref()`.**
  Otherwise tests hang for 4 hours after a `manual_pinned` claim.
- **Shell `read` for passwords must use `-s`.** `install.sh` echoes
  the prompt and reads silently; CI shellcheck won't catch this for
  you.

## What's intentionally not done

The SPEC is implemented end-to-end. A few items are explicit non-goals
or live in operator hands:

- **CalDAV / Google Photos.** §11 calls these out as best-effort —
  the calendar built-in consumes ICS feeds, photos prefers Immich.
- **Multi-device clustering.** Single device, single config file.
- **Public internet exposure.** Bearer-token + LAN trust. The UI banners
  a warning if the device's IP isn't in RFC1918.

## When the spec and code disagree

The spec wins. If you're tempted to change behavior, change the spec
first and link to that change in the commit message.
