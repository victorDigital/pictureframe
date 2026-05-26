import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { createServer } from "../src/api/server.js";
import { ConfigStore } from "../src/config/state.js";
import { Scheduler } from "../src/scheduler/index.js";
import { ScreenController } from "../src/cdp/screenController.js";
import { ShellBus } from "../src/api/shellBus.js";
import { Updater } from "../src/updater/index.js";
import { Brightness } from "../src/system/brightness.js";
import { CdpManager } from "../src/cdp/manager.js";
import { FamilyMessages } from "../src/api/familyMessage.js";
import { RuleStore } from "../src/scheduler/rules.js";
import { CronEngine } from "../src/scheduler/cron.js";
import { VncSupervisor } from "../src/system/vnc.js";
import { StateBus } from "../src/api/stateBus.js";
import type { FrameConfig, Screen } from "../src/config/schema.js";

async function makeDeps() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "frame-api-"));
  const tokenFile = path.join(tmp, "bearer_token");
  const screensFile = path.join(tmp, "screens.yaml");
  const configFile = path.join(tmp, "frame.yaml");
  await fs.writeFile(tokenFile, "x".repeat(24));
  await fs.writeFile(screensFile, "screens: []");
  const config: FrameConfig = {
    device: { name: "test-frame", bearer_token_file: tokenFile },
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
    builtins: { family_message: { enabled: false } },
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

  const scheduler = new Scheduler({
    screens,
    defaultScreen: "clock",
    pinnedTimeoutHours: 4,
  });
  scheduler.start();

  const shell = new ShellBus();
  const cdp = new CdpManager();
  const screenCtl = new ScreenController(cdp, shell, {
    maxPreloaded: 5,
    shellUrl: "http://127.0.0.1:8080/shell/",
  });
  const brightness = new Brightness(config);
  const updater = new Updater(store, "v0.0.0-test");
  const family = new FamilyMessages(scheduler);
  const engine = new CronEngine(scheduler);
  const rules = new RuleStore(path.join(tmp, "rules.yaml"), engine);
  const vnc = new VncSupervisor();
  const stateBus = new StateBus();

  return {
    configStore: store,
    scheduler,
    screens: screenCtl,
    shell,
    updater,
    brightness,
    cdp,
    family,
    rules,
    vnc,
    stateBus,
    tmp,
  };
}

test("/healthz is reachable without auth", async () => {
  const deps = await makeDeps();
  const app = await createServer({ ...deps, version: "v0.0.0-test" });
  const r = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(r.statusCode, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.ok, true);
  assert.equal(body.version, "v0.0.0-test");
  assert.equal(body.safe_mode, false);
  await app.close();
});

test("/api/state requires bearer token", async () => {
  const deps = await makeDeps();
  const app = await createServer({ ...deps, version: "v0.0.0-test" });
  const noAuth = await app.inject({ method: "GET", url: "/api/state" });
  assert.equal(noAuth.statusCode, 401);

  const withAuth = await app.inject({
    method: "GET",
    url: "/api/state",
    headers: { authorization: "Bearer " + "x".repeat(24) },
  });
  assert.equal(withAuth.statusCode, 200);
  const body = JSON.parse(withAuth.body);
  assert.equal(body.device, "test-frame");
  assert.equal(body.active, "clock");
  await app.close();
});

test("PUT /api/screens rejects invalid bodies", async () => {
  const deps = await makeDeps();
  const app = await createServer({ ...deps, version: "v0.0.0-test" });
  const r = await app.inject({
    method: "PUT",
    url: "/api/screens",
    headers: { authorization: "Bearer " + "x".repeat(24), "content-type": "application/json" },
    payload: JSON.stringify({ screens: [{ id: "bad upper", name: "X", type: "url", source: "" }] }),
  });
  assert.equal(r.statusCode, 400);
  await app.close();
});

test("PUT /api/screens returns friendly message when default_screen would be removed", async () => {
  const deps = await makeDeps();
  const app = await createServer({ ...deps, version: "v0.0.0-test" });
  const r = await app.inject({
    method: "PUT",
    url: "/api/screens",
    headers: { authorization: "Bearer " + "x".repeat(24), "content-type": "application/json" },
    payload: JSON.stringify({
      screens: [{ id: "photos", name: "Photos", type: "builtin", source: "photos", preload: false }],
    }),
  });
  assert.equal(r.statusCode, 400);
  const body = JSON.parse(r.body);
  assert.equal(body.error, "default_screen_missing");
  assert.match(body.message, /default_screen/);
  await app.close();
});

test("POST /family-message returns 403 when disabled in config", async () => {
  const deps = await makeDeps();
  const app = await createServer({ ...deps, version: "v0.0.0-test" });
  const r = await app.inject({
    method: "POST",
    url: "/family-message",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ message: "hello" }),
  });
  assert.equal(r.statusCode, 403);
  await app.close();
});

test("GET /api/settings/config exposes the editable config without secrets", async () => {
  const deps = await makeDeps();
  const app = await createServer({ ...deps, version: "v0.0.0-test" });
  const r = await app.inject({
    method: "GET",
    url: "/api/settings/config",
    headers: { authorization: "Bearer " + "x".repeat(24) },
  });
  assert.equal(r.statusCode, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.device.name, "test-frame");
  assert.equal(body.ha.enabled, false);
  assert.equal(body.updater.repo, "victorDigital/pictureframe");
  assert.equal(body.default_screen, "clock");
  await app.close();
});

test("PUT /api/settings/config rejects invalid host", async () => {
  const deps = await makeDeps();
  const app = await createServer({ ...deps, version: "v0.0.0-test" });
  const r = await app.inject({
    method: "PUT",
    url: "/api/settings/config",
    headers: {
      authorization: "Bearer " + "x".repeat(24),
      "content-type": "application/json",
    },
    payload: JSON.stringify({ ha: { mqtt: { host: "not a host" } } }),
  });
  assert.equal(r.statusCode, 400);
  const body = JSON.parse(r.body);
  assert.equal(body.error, "invalid_patch");
  await app.close();
});

test("PUT /api/settings/config rejects unknown default_screen", async () => {
  const deps = await makeDeps();
  const app = await createServer({ ...deps, version: "v0.0.0-test" });
  const r = await app.inject({
    method: "PUT",
    url: "/api/settings/config",
    headers: {
      authorization: "Bearer " + "x".repeat(24),
      "content-type": "application/json",
    },
    payload: JSON.stringify({ default_screen: "nope" }),
  });
  assert.equal(r.statusCode, 400);
  const body = JSON.parse(r.body);
  assert.equal(body.error, "default_screen_missing");
  await app.close();
});
