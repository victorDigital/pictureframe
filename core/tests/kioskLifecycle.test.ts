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
