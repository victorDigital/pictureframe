import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { ConfigStore } from "../src/config/state.js";
import { loadAll } from "../src/config/load.js";

async function workspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frame-cs-"));
  const tokenFile = path.join(dir, "bearer_token");
  const screensFile = path.join(dir, "screens.yaml");
  const configFile = path.join(dir, "frame.yaml");
  await fs.writeFile(tokenFile, "x".repeat(24));
  await fs.writeFile(
    screensFile,
    YAML.stringify({
      screens: [
        { id: "clock", name: "Clock", type: "builtin", source: "clock", preload: true },
      ],
    }),
  );
  await fs.writeFile(
    configFile,
    YAML.stringify({
      device: { name: "t", bearer_token_file: tokenFile },
      display: { brightness_backend: "none", default_brightness: 60 },
      screens_file: screensFile,
      default_screen: "clock",
      manual_pinned_timeout_hours: 4,
      scheduler: { max_preloaded_url_screens: 5 },
      updater: {
        repo: "x/y",
        channel: "stable",
        poll_interval_min: 15,
        auto_apply: false,
        staging_delay_hours: 24,
        health_check_window_sec: 60,
        retain_releases: 3,
      },
      ha: { enabled: false },
    }),
  );
  return { dir, tokenFile, screensFile, configFile };
}

test("ConfigStore boots into safe mode when frame.yaml is missing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frame-cs-"));
  const load = await loadAll(path.join(dir, "does-not-exist.yaml"));
  const store = new ConfigStore(path.join(dir, "does-not-exist.yaml"), load);
  assert.equal(store.isSafeMode(), true);
  assert.equal(store.safeModeInfo()?.reason, "frame_yaml_unreadable");
  await fs.rm(dir, { recursive: true, force: true });
});

test("ConfigStore.reload picks up edits made on disk", async () => {
  const ws = await workspace();
  const initial = await loadAll(ws.configFile);
  const store = new ConfigStore(ws.configFile, initial);
  assert.equal(store.isSafeMode(), false);
  assert.equal(store.current.screens.length, 1);

  // Add a second screen and reload.
  await fs.writeFile(
    ws.screensFile,
    YAML.stringify({
      screens: [
        { id: "clock", name: "Clock", type: "builtin", source: "clock", preload: true },
        { id: "weather", name: "Weather", type: "builtin", source: "weather", preload: false },
      ],
    }),
  );

  const reloaded = new Promise<void>((resolve) => store.once("reloaded", () => resolve()));
  await store.reload();
  await reloaded;
  assert.equal(store.current.screens.length, 2);

  await fs.rm(ws.dir, { recursive: true, force: true });
});

test("ConfigStore.reload emits reloadFailed when a write breaks validation", async () => {
  const ws = await workspace();
  const initial = await loadAll(ws.configFile);
  const store = new ConfigStore(ws.configFile, initial);

  // Corrupt screens.yaml — empty screens array fails the schema (min(1)).
  await fs.writeFile(ws.screensFile, "screens: []");
  const failed = new Promise<{ reason: string }>((resolve) =>
    store.once("reloadFailed", (r) => resolve(r as { reason: string })),
  );
  await store.reload();
  const detail = await failed;
  assert.equal(detail.reason, "screens_yaml_invalid");
  // The in-memory state remains the previous good config.
  assert.equal(store.current.screens.length, 1);

  await fs.rm(ws.dir, { recursive: true, force: true });
});
