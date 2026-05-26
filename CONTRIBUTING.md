# Contributing

Quick setup:

```sh
nvm use            # Node 22
npm install
npm run typecheck
npm test
```

To work on the kiosk or web UI without touching real hardware, run
`FRAME_DISABLE_CDP=1 npm run dev:core` — frame-core comes up without
trying to spawn Chromium, and `npm run dev:web` / `npm run dev:kiosk`
proxy to it.

Branching: feature branches off `main`, PRs squashed. Tag releases
follow SPEC §5.1 — `v1.2.3` for stable, `v1.2.3-beta.N` for beta. See
[`docs/RELEASES.md`](./docs/RELEASES.md) for the release pipeline.

Migrations live in `migrations/` and are numbered + idempotent. OS packages
that can be installed automatically are declared in `deploy/os-packages.txt`;
operator-only steps still use `requires_manual_step: true` — see SPEC §5.4.
