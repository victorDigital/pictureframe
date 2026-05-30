import test from "node:test";
import assert from "node:assert/strict";
import { Brightness } from "../src/system/brightness.js";
import { parseWlrOutputs } from "../src/system/displayController.js";
import type { FrameConfig } from "../src/config/schema.js";

function config(display: Partial<FrameConfig["display"]>): FrameConfig {
  return {
    device: { name: "test-frame", bearer_token_file: "/tmp/token" },
    display: {
      brightness_backend: "none",
      default_brightness: 60,
      scale: 1,
      orientation: "normal",
      ...display,
    },
    screens_file: "/tmp/screens.yaml",
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
}

test("applyDisplayConfig applies configured geometry to every Wayland output", async () => {
  const calls: string[][] = [];
  const brightness = new Brightness(config({ scale: 1.25, orientation: "90" }), async (file, args = []) => {
    if (file === "sh") return { stdout: "/usr/bin/wlr-randr\n", stderr: "" };
    if (file === "wlr-randr" && args.length === 0) {
      return { stdout: "eDP-1 enabled\n  1920x1080\nHDMI-A-1 enabled\n  1920x1080\n", stderr: "" };
    }
    calls.push([file, ...args]);
    return { stdout: "", stderr: "" };
  });

  assert.equal(await brightness.applyDisplayConfig(), true);
  assert.deepEqual(calls, [
    ["wlr-randr", "--output", "eDP-1", "--scale", "1.25", "--transform", "90"],
    ["wlr-randr", "--output", "HDMI-A-1", "--scale", "1.25", "--transform", "90"],
  ]);
});

test("applyDisplayConfig resets hardware geometry when config returns to normal", async () => {
  const calls: string[][] = [];
  const brightness = new Brightness(config({ scale: 1, orientation: "normal" }), async (file, args = []) => {
    if (file === "sh") return { stdout: "/usr/bin/wlr-randr\n", stderr: "" };
    if (file === "wlr-randr" && args.length === 0) {
      return { stdout: "eDP-1 enabled\n  1920x1080\n", stderr: "" };
    }
    calls.push([file, ...args]);
    return { stdout: "", stderr: "" };
  });

  assert.equal(await brightness.applyDisplayConfig(), true);
  assert.deepEqual(calls, [
    ["wlr-randr", "--output", "eDP-1", "--scale", "1", "--transform", "normal"],
  ]);
});

test("applyDisplayConfig leaves shell fallback active when wlr-randr is unavailable", async () => {
  const brightness = new Brightness(config({ scale: 1.5, orientation: "270" }), async (file) => {
    if (file === "sh") throw new Error("missing");
    throw new Error(`unexpected command: ${file}`);
  });

  assert.equal(await brightness.applyDisplayConfig(), false);
});

test("applyDisplayConfig leaves shell fallback active when no outputs are reported", async () => {
  const brightness = new Brightness(config({ scale: 1.5, orientation: "270" }), async (file, args = []) => {
    if (file === "sh") return { stdout: "/usr/bin/wlr-randr\n", stderr: "" };
    if (file === "wlr-randr" && args.length === 0) return { stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
  });

  assert.equal(await brightness.applyDisplayConfig(), false);
});

test("displayPower reapplies geometry after turning the display on", async () => {
  const calls: string[][] = [];
  const brightness = new Brightness(config({ scale: 1.5, orientation: "180" }), async (file, args = []) => {
    if (file === "sh" && args[1]?.includes("wlopm")) {
      return { stdout: "/usr/bin/wlopm\n", stderr: "" };
    }
    if (file === "sh" && args[1]?.includes("wlr-randr")) {
      return { stdout: "/usr/bin/wlr-randr\n", stderr: "" };
    }
    if (file === "wlr-randr" && args.length === 0) {
      return { stdout: "eDP-1 enabled\n  1920x1080\n", stderr: "" };
    }
    calls.push([file, ...args]);
    return { stdout: "", stderr: "" };
  });

  assert.deepEqual(await brightness.displayPower("on"), { ok: true });
  assert.deepEqual(calls, [
    ["wlopm", "--on", "*"],
    ["wlr-randr", "--output", "eDP-1", "--scale", "1.5", "--transform", "180"],
  ]);
});

test("displayPower falls back to wlr-randr when wlopm fails", async () => {
  const calls: string[][] = [];
  const brightness = new Brightness(config({}), async (file, args = []) => {
    if (file === "sh" && args[1]?.includes("wlopm")) {
      return { stdout: "/usr/bin/wlopm\n", stderr: "" };
    }
    if (file === "sh" && args[1]?.includes("wlr-randr")) {
      return { stdout: "/usr/bin/wlr-randr\n", stderr: "" };
    }
    if (file === "wlopm") {
      throw new Error("no output");
    }
    if (file === "wlr-randr" && args.length === 0) {
      return { stdout: "eDP-1 enabled\n  1920x1080\nHDMI-A-1 enabled\n  1920x1080\n", stderr: "" };
    }
    calls.push([file, ...args]);
    return { stdout: "", stderr: "" };
  });

  assert.deepEqual(await brightness.displayPower("off"), { ok: true });
  assert.deepEqual(calls, [
    ["wlr-randr", "--output", "eDP-1", "--off"],
    ["wlr-randr", "--output", "HDMI-A-1", "--off"],
  ]);
});

test("parseWlrOutputs ignores indented mode lines", () => {
  assert.deepEqual(
    parseWlrOutputs("eDP-1 enabled\n  1920x1080 px\n\nHDMI-A-1 enabled\n  1280x720 px\n"),
    ["eDP-1", "HDMI-A-1"],
  );
});
