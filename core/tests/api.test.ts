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
import { RuleStore } from "../src/scheduler/rules.js";
import { CronEngine } from "../src/scheduler/cron.js";
import { VncSupervisor } from "../src/system/vnc.js";
import { StateBus } from "../src/api/stateBus.js";
import type { FrameConfig, Screen } from "../src/config/schema.js";
import { setNowPlaying } from "../src/nowPlaying.js";

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

test("/api/now_playing accepts HA media_player payloads without auth", async () => {
  setNowPlaying(null);
  const deps = await makeDeps();
  const app = await createServer({ ...deps, version: "v0.0.0-test" });
  const payload = {
    state: "playing",
    attributes: {
      media_title: "Soft Light",
      media_artist: "The Frames",
      media_album_name: "Kiosk Sessions",
      media_duration: "245",
      media_position: "42",
      entity_picture: "/api/media_player_proxy/media_player.spotify?token=abc",
    },
    ha_base_url: "https://ha.example",
  };

  const put = await app.inject({
    method: "PUT",
    url: "/api/now_playing",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(payload),
  });
  assert.equal(put.statusCode, 200);

  const get = await app.inject({ method: "GET", url: "/api/now_playing" });
  assert.deepEqual(JSON.parse(get.body), {
    state: "playing",
    title: "Soft Light",
    artist: "The Frames",
    album: "Kiosk Sessions",
    duration: 245,
    position: 42,
    entity_picture: "https://ha.example/api/media_player_proxy/media_player.spotify?token=abc",
  });

  const post = await app.inject({
    method: "POST",
    url: "/api/now_playing",
    headers: { "content-type": "application/json" },
    payload: "null",
  });
  assert.equal(post.statusCode, 200);
  const cleared = await app.inject({ method: "GET", url: "/api/now_playing" });
  assert.equal(cleared.body, "null");

  await app.close();
  setNowPlaying(null);
});

test("/api/photos/google lists and proxies Google Photos album items", async () => {
  const deps = await makeDeps();
  const clientSecretFile = path.join(deps.tmp, "google_client_secret");
  const refreshTokenFile = path.join(deps.tmp, "google_refresh_token");
  await fs.writeFile(clientSecretFile, "client-secret", "utf8");
  await fs.writeFile(refreshTokenFile, "refresh-token", "utf8");
  deps.configStore.current.screens.push({
    id: "photos",
    name: "Photos",
    type: "builtin",
    source: "photos",
    preload: true,
    config: {
      library: "google",
      google_album_id: "album-1",
      google_client_id: "client-id",
      google_client_secret_file: clientSecretFile,
      google_refresh_token_file: refreshTokenFile,
      google_max_items: 10,
      google_image_width: 1200,
      google_image_height: 900,
    },
  });
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") {
      assert.equal(init?.method, "POST");
      assert.ok(String(init?.body).includes("refresh_token=refresh-token"));
      return jsonResponse({ access_token: "access-token", expires_in: 3600 });
    }
    if (url === "https://photoslibrary.googleapis.com/v1/mediaItems:search") {
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer access-token");
      assert.equal(JSON.parse(String(init?.body)).albumId, "album-1");
      return jsonResponse({
        mediaItems: [
          {
            id: "image-1",
            filename: "Kitchen.jpg",
            mimeType: "image/jpeg",
            baseUrl: "https://lh3.googleusercontent.com/image-1",
          },
          {
            id: "video-1",
            filename: "Clip.mp4",
            mimeType: "video/mp4",
            baseUrl: "https://lh3.googleusercontent.com/video-1",
          },
        ],
      });
    }
    if (url === "https://photoslibrary.googleapis.com/v1/mediaItems/image-1") {
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer access-token");
      return jsonResponse({
        id: "image-1",
        filename: "Kitchen.jpg",
        mimeType: "image/jpeg",
        baseUrl: "https://lh3.googleusercontent.com/image-1",
      });
    }
    if (url === "https://lh3.googleusercontent.com/image-1=w1200-h900") {
      return new Response(Buffer.from("jpeg"), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const app = await createServer({ ...deps, version: "v0.0.0-test" });
    const list = await app.inject({ method: "GET", url: "/api/photos/google?screen=photos" });
    assert.equal(list.statusCode, 200);
    assert.deepEqual(JSON.parse(list.body), {
      photos: [
        {
          id: "image-1",
          url: "/api/photos/google/media?screen=photos&id=image-1",
          caption: "Kitchen.jpg",
        },
      ],
    });

    const image = await app.inject({
      method: "GET",
      url: "/api/photos/google/media?screen=photos&id=image-1",
    });
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers["content-type"], "image/jpeg");
    assert.equal(image.body, "jpeg");
    assert.ok(calls.some((call) => call.url === "https://lh3.googleusercontent.com/image-1=w1200-h900"));
    await app.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("POST /api/updates/apply returns accepted after queuing update", async () => {
  const deps = await makeDeps();
  const calls: Array<{ force: boolean }> = [];
  (deps.updater as unknown as {
    beginApplyAvailable: (opts: { force: boolean }) => { ok: true; accepted: true; tag: string };
  }).beginApplyAvailable = (opts) => {
    calls.push(opts);
    return { ok: true, accepted: true, tag: "v9.9.9" };
  };
  const app = await createServer({ ...deps, version: "v0.0.0-test" });
  const r = await app.inject({
    method: "POST",
    url: "/api/updates/apply",
    headers: { authorization: "Bearer " + "x".repeat(24) },
  });

  assert.equal(r.statusCode, 202);
  assert.deepEqual(JSON.parse(r.body), { ok: true, accepted: true, tag: "v9.9.9" });
  assert.deepEqual(calls, [{ force: false }]);
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
