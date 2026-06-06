import test from "node:test";
import assert from "node:assert/strict";
import { HaBridge } from "../src/mqtt/index.js";
import type { FrameConfig, Screen } from "../src/config/schema.js";
import type { Scheduler } from "../src/scheduler/index.js";
import type { Updater } from "../src/updater/index.js";
import type { Brightness } from "../src/system/brightness.js";
import { getNowPlaying, setNowPlaying } from "../src/nowPlaying.js";

function config(): FrameConfig {
  return {
    device: { name: "living-room-frame", bearer_token_file: "/token" },
    display: {
      brightness_backend: "none",
      default_brightness: 60,
      scale: 1,
      orientation: "normal",
    },
    screens_file: "/screens.yaml",
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
    ha: {
      enabled: true,
      suggested_area: "Living Room",
      mqtt: {
        host: "homeassistant.local",
        port: 1883,
        username: "frame",
        password_file: "/mqtt",
        keepalive: 60,
        discovery_prefix: "homeassistant",
      },
    },
    builtins: {},
  };
}

function bridge() {
  const screens = new Map<string, Screen>([
    [
      "clock",
      { id: "clock", name: "Clock", type: "builtin", source: "clock", preload: true },
    ],
  ]);
  const scheduler = {
    screens,
    on: () => undefined,
    activeScreen: () => screens.get("clock"),
    list: () => [],
  } as unknown as Scheduler;
  const updater = {
    status: () => ({ current: "v0.0.22-test", busy: false, phase: "idle", events: [] }),
    applyAvailable: async () => undefined,
  } as unknown as Updater;
  const writes: number[] = [];
  const power: Array<"on" | "off"> = [];
  const temperatures: number[] = [];
  const brightness = {
    writes,
    power,
    temperatures,
    read: async () => 42,
    write: async (value: number) => {
      writes.push(value);
    },
    displayPower: async (state: "on" | "off") => {
      power.push(state);
      return { ok: true };
    },
    colorTemperature: async (kelvin: number) => {
      temperatures.push(kelvin);
      return Math.max(2000, Math.min(6535, Math.round(kelvin)));
    },
    scheduleReboot: async () => ({ ok: true }),
  } as unknown as Brightness & {
    writes: number[];
    power: Array<"on" | "off">;
    temperatures: number[];
  };
  const ha = new HaBridge(config(), scheduler, updater, brightness);
  const published: Array<{ topic: string; payload: string; opts?: unknown }> = [];
  const client = {
    publish: (topic: string, payload: string, opts?: unknown) => {
      published.push({ topic, payload, opts });
    },
  };
  (ha as unknown as { client: typeof client }).client = client;
  return { ha, published, brightness };
}

test("HA discovery exposes backlight as a light with suggested area", async () => {
  const { ha, published } = bridge();
  await (ha as unknown as { publishDiscovery: () => Promise<void> }).publishDiscovery();

  const discovery = published.find(
    (p) => p.topic === "homeassistant/light/frame_living_room_frame/backlight/config",
  );
  assert.ok(discovery);
  const payload = JSON.parse(discovery.payload);
  assert.equal(payload.name, "Backlight");
  assert.equal(payload.command_topic, "frame/cmd/display_power");
  assert.equal(payload.state_topic, "frame/living-room-frame/display_power");
  assert.equal(payload.brightness_command_topic, "frame/cmd/brightness");
  assert.equal(payload.brightness_state_topic, "frame/living-room-frame/brightness");
  assert.equal(payload.brightness_scale, 100);
  assert.equal(payload.color_temp_kelvin, true);
  assert.equal(payload.min_kelvin, 2000);
  assert.equal(payload.max_kelvin, 6535);
  assert.equal(payload.color_temp_command_topic, "frame/cmd/color_temperature");
  assert.equal(payload.color_temp_command_template, '{"kelvin": {{ value }}}');
  assert.equal(payload.color_temp_state_topic, "frame/living-room-frame/color_temperature");
  assert.equal(payload.color_mode_state_topic, "frame/living-room-frame/color_mode");
  assert.equal(payload.payload_on, "on");
  assert.equal(payload.payload_off, "off");
  assert.equal(payload.device.suggested_area, "Living Room");
});

test("HA light commands set display power and brightness", async () => {
  const { ha, published, brightness } = bridge();
  const handleCommand = (ha as unknown as {
    handleCommand: (topic: string, raw: string) => Promise<void>;
  }).handleCommand.bind(ha);
  await handleCommand("frame/cmd/brightness", "55");
  await handleCommand("frame/cmd/display_power", "off");

  assert.deepEqual(brightness.writes, [55]);
  assert.deepEqual(brightness.power, ["off"]);
  assert.equal(
    published.filter((p) => p.topic === "frame/living-room-frame/display_power").at(-1)?.payload,
    "off",
  );
});

test("HA color temperature commands publish clamped Kelvin state", async () => {
  const { ha, published, brightness } = bridge();
  const handleCommand = (ha as unknown as {
    handleCommand: (topic: string, raw: string) => Promise<void>;
  }).handleCommand.bind(ha);
  await handleCommand("frame/cmd/color_temperature", '{"kelvin": 1800}');
  await handleCommand("frame/cmd/color_temperature", "7000");

  assert.deepEqual(brightness.temperatures, [1800, 7000]);
  assert.equal(
    published.filter((p) => p.topic === "frame/living-room-frame/color_temperature").at(-1)
      ?.payload,
    "6535",
  );
  assert.equal(
    published.filter((p) => p.topic === "frame/living-room-frame/color_mode").at(-1)?.payload,
    "color_temp",
  );
  assert.equal(
    published.filter((p) => p.topic === "frame/living-room-frame/brightness").at(-1)?.payload,
    "42",
  );
  assert.equal(
    published.filter((p) => p.topic === "frame/living-room-frame/display_power").at(-1)?.payload,
    "on",
  );
});

test("HA now-playing command stores media_player attributes", async () => {
  setNowPlaying(null);
  const { ha } = bridge();
  const handleCommand = (ha as unknown as {
    handleCommand: (topic: string, raw: string) => Promise<void>;
  }).handleCommand.bind(ha);

  await handleCommand(
    "frame/cmd/now_playing",
    JSON.stringify({
      state: "playing",
      attributes: {
        media_title: "Soft Light",
        media_artist: "The Frames",
        media_album_name: "Kiosk Sessions",
        media_duration: 245,
        media_position: 42,
        entity_picture: "/api/media_player_proxy/media_player.spotify?token=abc",
      },
    }),
  );

  assert.deepEqual(getNowPlaying(), {
    state: "playing",
    title: "Soft Light",
    artist: "The Frames",
    album: "Kiosk Sessions",
    duration: 245,
    position: 42,
    entity_picture: "http://homeassistant.local:8123/api/media_player_proxy/media_player.spotify?token=abc",
  });

  await handleCommand("frame/cmd/now_playing", "null");
  assert.equal(getNowPlaying(), null);
});
