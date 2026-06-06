import test from "node:test";
import assert from "node:assert/strict";
import { KioskLifecycle } from "../src/system/kioskLifecycle.js";

test("boot display cycle waits for shell connection and runs once", async () => {
  const calls: string[] = [];
  const waits: number[] = [];
  let scheduled: (() => Promise<void>) | undefined;
  let scheduledMs: number | undefined;

  const lifecycle = new KioskLifecycle({
    env: {
      FRAME_BOOT_DISPLAY_CYCLE_DELAY_SEC: "2",
      FRAME_BOOT_DISPLAY_CYCLE_OFF_SEC: "0.25",
    },
    displayPower: async (state) => {
      calls.push(state);
      return { ok: true };
    },
    schedule: (fn, ms) => {
      scheduled = fn;
      scheduledMs = ms;
      return {};
    },
    delay: async (ms) => {
      waits.push(ms);
    },
  });

  lifecycle.shellConnected();
  lifecycle.shellConnected();

  assert.equal(scheduledMs, 2000);
  await scheduled?.();
  assert.deepEqual(calls, ["off", "on"]);
  assert.deepEqual(waits, [250]);

  await scheduled?.();
  assert.deepEqual(calls, ["off", "on"]);
});

test("boot display cycle can be disabled", () => {
  let scheduled = false;
  const lifecycle = new KioskLifecycle({
    env: { FRAME_BOOT_DISPLAY_CYCLE: "0" },
    displayPower: async () => ({ ok: true }),
    schedule: () => {
      scheduled = true;
      return {};
    },
  });

  lifecycle.shellConnected();

  assert.equal(scheduled, false);
});

test("shell disconnect restarts only the kiosk after the grace period", async () => {
  const restarts: string[] = [];
  const scheduled: Array<() => Promise<void>> = [];
  const scheduledMs: number[] = [];
  const lifecycle = new KioskLifecycle({
    env: {
      FRAME_BOOT_DISPLAY_CYCLE: "0",
      FRAME_KIOSK_DISCONNECT_GRACE_SEC: "2",
      FRAME_KIOSK_RESTART_COOLDOWN_SEC: "0",
    },
    displayPower: async () => ({ ok: true }),
    restartKiosk: async (reason) => {
      restarts.push(reason);
    },
    schedule: (fn, ms) => {
      scheduled.push(fn);
      scheduledMs.push(ms);
      return {};
    },
  });

  lifecycle.shellConnected();
  lifecycle.shellDisconnected();

  assert.deepEqual(scheduledMs, [2000]);
  await scheduled[0]?.();
  await scheduled[1]?.();

  assert.deepEqual(restarts, ["shell_disconnected"]);
});

test("shell reconnect cancels pending disconnect recovery", async () => {
  const restarts: string[] = [];
  let scheduled: (() => Promise<void>) | undefined;
  const lifecycle = new KioskLifecycle({
    env: {
      FRAME_BOOT_DISPLAY_CYCLE: "0",
      FRAME_KIOSK_DISCONNECT_GRACE_SEC: "2",
      FRAME_KIOSK_RESTART_COOLDOWN_SEC: "0",
    },
    displayPower: async () => ({ ok: true }),
    restartKiosk: async (reason) => {
      restarts.push(reason);
    },
    schedule: (fn) => {
      scheduled = fn;
      return {};
    },
  });

  lifecycle.shellConnected();
  lifecycle.shellDisconnected();
  lifecycle.shellConnected();

  await scheduled?.();

  assert.deepEqual(restarts, []);
});

test("stale heartbeat restarts shell-rendered screens", async () => {
  const restarts: string[] = [];
  const scheduled: Array<() => Promise<void>> = [];
  const scheduledMs: number[] = [];
  let now = 0;
  const lifecycle = new KioskLifecycle({
    env: {
      FRAME_BOOT_DISPLAY_CYCLE: "0",
      FRAME_KIOSK_HEARTBEAT_TIMEOUT_SEC: "1",
      FRAME_KIOSK_RESTART_COOLDOWN_SEC: "0",
    },
    now: () => now,
    displayPower: async () => ({ ok: true }),
    restartKiosk: async (reason) => {
      restarts.push(reason);
    },
    schedule: (fn, ms) => {
      scheduled.push(fn);
      scheduledMs.push(ms);
      return {};
    },
  });

  lifecycle.shellConnected();
  lifecycle.activeScreenChanged({ id: "clock", type: "builtin", renderedByShell: true });
  now = 1000;

  assert.deepEqual(scheduledMs, [1000]);
  await scheduled[0]?.();
  assert.equal(scheduledMs[1], 0);
  await scheduled[1]?.();

  assert.deepEqual(restarts, ["shell_heartbeat_stale"]);
});

test("heartbeat watchdog ignores screens rendered in a Chromium URL tab", () => {
  let scheduled = false;
  const lifecycle = new KioskLifecycle({
    env: { FRAME_BOOT_DISPLAY_CYCLE: "0" },
    displayPower: async () => ({ ok: true }),
    restartKiosk: async () => undefined,
    schedule: () => {
      scheduled = true;
      return {};
    },
  });

  lifecycle.shellConnected();
  lifecycle.activeScreenChanged({ id: "dashboard", type: "url", renderedByShell: false });

  assert.equal(scheduled, false);
});
