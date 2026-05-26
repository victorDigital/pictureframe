# Release Pipeline

Picture Frame releases are Git tags built by GitHub Actions and applied by the
on-device updater.

## Versioning

- Stable releases use `vX.Y.Z` and are picked up by devices on
  `updater.channel: stable`.
- Beta releases use `vX.Y.Z-beta.N` and are picked up by devices on
  `updater.channel: beta`.
- Bump the root, core, kiosk, web, and lockfile versions together.
- Add a dated entry to `CHANGELOG.md` before tagging.

## Local Checks

Run these before pushing a release tag:

```sh
npm run typecheck
npm test
npm run build
```

If deploy shell scripts changed, also run:

```sh
bash -n deploy/*.sh deploy/root-helper
```

## GitHub Workflow

`.github/workflows/release.yml` runs on `v*` tags. It:

1. Installs dependencies with Node 22.
2. Runs typecheck, tests, and build.
3. Runs `scripts/test-update-from-previous.sh`, which stages the current
   release tarball against the previous version tag and verifies the updater's
   package/build compatibility path.
4. Packs a built tarball named `frame-<tag>.tar.gz`.
5. Generates `SHA256SUMS`.
6. Optionally signs the tarball and checksum file when
   `RELEASE_GPG_PRIVATE_KEY` is configured.
7. Publishes a GitHub Release with the tarball, checksums, and signatures.

The updater prefers the built release tarball asset over GitHub's generated
source tarball.

## OS Packages

Declare required Debian/Ubuntu packages in `deploy/os-packages.txt`, one
package per line. Blank lines and `#` comments are ignored.

During apply, the updater reads that file from the staged release, checks which
packages are missing, writes `/run/frame/os-packages.required`, and invokes:

```sh
sudo -n /usr/local/lib/frame/root-helper install-packages /run/frame/os-packages.required
```

The root helper validates every requested package against its own allowlist
before running apt. Add new package names to `deploy/root-helper`'s allowlist
when they are legitimately required by a release.

`deploy/install-os-packages.sh` is retained only as a compatibility bridge for
devices whose sudoers file still points at the old release-controlled helper.
New updater code calls `root-helper` directly.

## Privileged Helper

`deploy/install.sh` installs `deploy/root-helper` to:

```sh
/usr/local/lib/frame/root-helper
```

The sudoers fragment allows only these commands:

```sh
/usr/local/lib/frame/root-helper install-packages /run/frame/os-packages.required
/usr/local/lib/frame/root-helper restart-core
/usr/local/lib/frame/root-helper restart-kiosk
/usr/local/lib/frame/root-helper reboot
```

Do not add wildcards or broad shell access to sudoers. If a new privileged
operation is needed, add a narrow helper subcommand and document why.

## Device Apply Flow

Devices poll the configured GitHub repo, observe staging delay, then apply by:

1. Downloading and optionally verifying the release tarball.
2. Extracting into a staging release directory.
3. Verifying migration integrity.
4. Snapshotting config and state.
5. Installing declared OS packages through the root helper.
6. Installing/building/pruning npm dependencies.
7. Running migrations.
8. Preflighting the staged core on port 8081.
9. Swapping `/opt/frame/current`.
10. Restarting `frame-core` through the root helper.
11. Rolling back and quarantining the tag if health checks fail.

Updater command logs are written under `/opt/frame/state/update-commands/`.
