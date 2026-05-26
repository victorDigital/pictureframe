import test from "node:test";
import assert from "node:assert/strict";
import { wayvncProcessEnv } from "../src/system/vnc.js";

test("wayvnc uses frame runtime dir while keeping absolute wayland socket", () => {
  const env = wayvncProcessEnv(
    {
      XDG_RUNTIME_DIR: "/run/user/997",
      WAYLAND_DISPLAY: "wayland-0",
    },
    "/run/frame",
  );

  assert.equal(env.XDG_RUNTIME_DIR, "/run/frame");
  assert.equal(env.WAYLAND_DISPLAY, "/run/user/997/wayland-0");
});

test("wayvnc keeps absolute wayland display paths unchanged", () => {
  const env = wayvncProcessEnv(
    {
      XDG_RUNTIME_DIR: "/run/user/997",
      WAYLAND_DISPLAY: "/run/user/997/wayland-1",
    },
    "/run/frame",
  );

  assert.equal(env.XDG_RUNTIME_DIR, "/run/frame");
  assert.equal(env.WAYLAND_DISPLAY, "/run/user/997/wayland-1");
});
