import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Updater } from "../src/updater/index.js";
import { ConfigStore } from "../src/config/state.js";
import { GitHubClient, ReleaseInfo } from "../src/updater/githubClient.js";
import type { FrameConfig, Screen } from "../src/config/schema.js";

class FakeGitHub extends GitHubClient {
  constructor(private release: ReleaseInfo | null) {
    super("victorDigital/pictureframe");
  }
  override async latestForChannel(): Promise<ReleaseInfo | null> {
    return this.release;
  }
}

async function setup(opts: {
  release: ReleaseInfo | null;
  staging_delay_hours?: number;
  auto_apply?: boolean;
}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "frame-upd-"));
  const tokenFile = path.join(tmp, "bearer_token");
  const screensFile = path.join(tmp, "screens.yaml");
  const configFile = path.join(tmp, "frame.yaml");
  await fs.writeFile(tokenFile, "x".repeat(24));
  await fs.writeFile(screensFile, "screens: []");
  const config: FrameConfig = {
    device: { name: "t", bearer_token_file: tokenFile },
    display: { brightness_backend: "none", default_brightness: 60, scale: 1, orientation: "normal" },
    screens_file: screensFile,
    default_screen: "clock",
    manual_pinned_timeout_hours: 4,
    scheduler: { max_preloaded_url_screens: 5 },
    updater: {
      repo: "victorDigital/pictureframe",
      channel: "stable",
      poll_interval_min: 15,
      auto_apply: opts.auto_apply ?? false,
      staging_delay_hours: opts.staging_delay_hours ?? 24,
      health_check_window_sec: 60,
      retain_releases: 3,
    },
    ha: { enabled: false },
    builtins: {},
  };
  const screens: Screen[] = [
    { id: "clock", name: "Clock", type: "builtin", source: "clock", preload: true },
  ];
  const store = new ConfigStore(configFile, {
    ok: true,
    loaded: {
      config,
      screens,
      bearerToken: "x".repeat(24),
      configPath: configFile,
      screensPath: screensFile,
    },
  });
  const gh = new FakeGitHub(opts.release);
  const updater = new Updater(store, "v1.0.0", gh);
  return { updater, gh, tmp };
}

test("applyAvailable throws no_release_available before a poll has run", async () => {
  const { updater } = await setup({ release: null });
  await assert.rejects(() => updater.applyAvailable({ force: false }), /no_release_available/);
});

test("poll surfaces a new release with appliedAfter set to seen+staging", async () => {
  const release: ReleaseInfo = {
    tag: "v1.0.1",
    publishedAt: new Date().toISOString(),
    prerelease: false,
    tarballUrl: "x",
  };
  const { updater } = await setup({ release, staging_delay_hours: 12 });
  await updater.checkNow();
  const status = updater.status();
  assert.equal(status.available?.tag, "v1.0.1");
  const seen = new Date(status.available!.firstSeenAt).getTime();
  const applied = new Date(status.available!.appliedAfter).getTime();
  assert.ok(applied - seen >= 12 * 3600 * 1000 - 1000);
});

test("applyAvailable refuses inside the staging window without force", async () => {
  const release: ReleaseInfo = {
    tag: "v1.0.1",
    publishedAt: new Date().toISOString(),
    prerelease: false,
    tarballUrl: "x",
  };
  const { updater } = await setup({ release, staging_delay_hours: 24 });
  await updater.checkNow();
  await assert.rejects(
    () => updater.applyAvailable({ force: false }),
    /staging_delay_active/,
  );
});

test("a tag matching the current version clears available", async () => {
  const release: ReleaseInfo = {
    tag: "v1.0.0",
    publishedAt: new Date().toISOString(),
    prerelease: false,
    tarballUrl: "x",
  };
  const { updater } = await setup({ release });
  await updater.checkNow();
  assert.equal(updater.status().available, undefined);
});

test("a v-prefixed tag matching a bare package version clears available", async () => {
  const release: ReleaseInfo = {
    tag: "v1.0.0",
    publishedAt: new Date().toISOString(),
    prerelease: false,
    tarballUrl: "x",
  };
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "frame-upd-"));
  const tokenFile = path.join(tmp, "bearer_token");
  const screensFile = path.join(tmp, "screens.yaml");
  const configFile = path.join(tmp, "frame.yaml");
  await fs.writeFile(tokenFile, "x".repeat(24));
  await fs.writeFile(screensFile, "screens: []");
  const config: FrameConfig = {
    device: { name: "t", bearer_token_file: tokenFile },
    display: { brightness_backend: "none", default_brightness: 60, scale: 1, orientation: "normal" },
    screens_file: screensFile,
    default_screen: "clock",
    manual_pinned_timeout_hours: 4,
    scheduler: { max_preloaded_url_screens: 5 },
    updater: {
      repo: "victorDigital/pictureframe",
      channel: "stable",
      poll_interval_min: 15,
      auto_apply: false,
      staging_delay_hours: 24,
      health_check_window_sec: 60,
      retain_releases: 3,
    },
    ha: { enabled: false },
    builtins: {},
  };
  const screens: Screen[] = [
    { id: "clock", name: "Clock", type: "builtin", source: "clock", preload: true },
  ];
  const store = new ConfigStore(configFile, {
    ok: true,
    loaded: {
      config,
      screens,
      bearerToken: "x".repeat(24),
      configPath: configFile,
      screensPath: screensFile,
    },
  });
  const updater = new Updater(store, "1.0.0", new FakeGitHub(release));
  await updater.checkNow();
  assert.equal(updater.status().available, undefined);
});
