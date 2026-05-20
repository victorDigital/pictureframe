# Picture Frame

A repurposed laptop turned into a flexible information display: clock, calendar,
photos, weather, Grafana, Home Assistant dashboards — anything that can render
in a browser, plus a small set of first-class built-in screens.

See [SPEC.md](./SPEC.md) for the full design.

## Quickstart (target device)

```sh
ssh frame@frame.local
curl -fsSL https://raw.githubusercontent.com/victorDigital/pictureframe/main/deploy/install.sh | sudo bash
```

The installer creates the `frame` user/group, installs Cage, Chromium, Node 22,
lays out `/opt/frame`, drops the systemd units, and prompts for a bearer token
and MQTT credentials.

## Development

```sh
npm install
npm run dev:core        # frame-core on http://localhost:8080
npm run dev:web         # web control UI (proxies to core)
npm run dev:kiosk       # kiosk shell page
```

## Layout

See [SPEC.md §12](./SPEC.md#12-repository-layout).

```
core/             Node.js / TypeScript service
kiosk/            Shell page Chromium loads in Tab 0
web/              React control UI
builtin-screens/  One directory per built-in screen
migrations/       Numbered, idempotent migrations
deploy/           install.sh, systemd units, udev, sudoers, logrotate
```

## Releases

Tagged GitHub releases. Stable = any non-prerelease tag (`v1.2.3`); beta =
`v1.2.3-beta.N`. The on-device updater polls every 15 min and applies per
configured channel and policy. See SPEC §5 for the update flow, snapshots,
migrations, and rollback semantics.

## License

MIT
