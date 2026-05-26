import test from "node:test";
import assert from "node:assert/strict";
import { FrameConfigSchema, ScreensFileSchema } from "../src/config/schema.js";

test("frame config validates the example", () => {
  const ok = FrameConfigSchema.safeParse({
    device: { name: "lab", bearer_token_file: "/etc/frame/secrets/bearer_token" },
    display: { brightness_backend: "backlight", default_brightness: 60, scale: 1, orientation: "normal" },
    screens_file: "/etc/frame/screens.yaml",
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
  });
  assert.ok(ok.success);
});

test("screens require at least one entry", () => {
  const bad = ScreensFileSchema.safeParse({ screens: [] });
  assert.equal(bad.success, false);
});

test("repo must be owner/repo", () => {
  const bad = FrameConfigSchema.safeParse({
    device: { name: "lab", bearer_token_file: "/x" },
    display: { brightness_backend: "backlight", default_brightness: 60, scale: 1, orientation: "normal" },
    screens_file: "/x",
    default_screen: "clock",
    manual_pinned_timeout_hours: 4,
    scheduler: { max_preloaded_url_screens: 5 },
    updater: {
      repo: "no-slash",
      channel: "stable",
      poll_interval_min: 15,
      auto_apply: false,
      staging_delay_hours: 24,
      health_check_window_sec: 60,
      retain_releases: 3,
    },
    ha: { enabled: false },
  });
  assert.equal(bad.success, false);
});
