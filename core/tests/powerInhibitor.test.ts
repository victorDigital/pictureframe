import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { PowerInhibitor } from "../src/system/powerInhibitor.js";

class FakeChild extends EventEmitter {
  pid = 1234;
  killedWith?: NodeJS.Signals;
  unrefCalled = false;

  unref() {
    this.unrefCalled = true;
  }

  kill(signal?: NodeJS.Signals) {
    this.killedWith = signal;
    return true;
  }
}

test("power inhibitor starts systemd-inhibit with sleep blocking", async () => {
  const children: FakeChild[] = [];
  let command = "";
  let args: string[] = [];
  const inhibitor = new PowerInhibitor({
    run: async () => ({ stdout: "/usr/bin/systemd-inhibit\n", stderr: "" }),
    spawn: (file, a = []) => {
      command = file;
      args = a;
      const child = new FakeChild();
      children.push(child);
      return child as unknown as ChildProcess;
    },
  });

  await inhibitor.start();

  assert.equal(command, "systemd-inhibit");
  assert.deepEqual(args, [
    "--what=idle:sleep:handle-lid-switch",
    "--who=pictureframe",
    "--why=Picture Frame core must stay awake while kiosk recycles",
    "--mode=block",
    "sleep",
    "infinity",
  ]);
  assert.equal(children[0]?.unrefCalled, true);
});

test("power inhibitor can be disabled by environment", async () => {
  let spawned = false;
  const inhibitor = new PowerInhibitor({
    env: { FRAME_POWER_INHIBIT: "0" },
    run: async () => ({ stdout: "/usr/bin/systemd-inhibit\n", stderr: "" }),
    spawn: () => {
      spawned = true;
      return new FakeChild() as unknown as ChildProcess;
    },
  });

  await inhibitor.start();

  assert.equal(spawned, false);
});

test("power inhibitor restarts after unexpected exit", async () => {
  const children: FakeChild[] = [];
  const scheduled: Array<() => void> = [];
  const scheduledMs: number[] = [];
  const inhibitor = new PowerInhibitor({
    run: async () => ({ stdout: "/usr/bin/systemd-inhibit\n", stderr: "" }),
    spawn: () => {
      const child = new FakeChild();
      children.push(child);
      return child as unknown as ChildProcess;
    },
    schedule: (fn, ms) => {
      scheduled.push(fn);
      scheduledMs.push(ms);
      return {};
    },
  });

  await inhibitor.start();
  children[0]?.emit("exit", 1, null);
  scheduled[0]?.();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(scheduledMs, [30_000]);
  assert.equal(children.length, 2);
});

test("power inhibitor stop kills child and cancels pending restart", async () => {
  const child = new FakeChild();
  let canceled = false;
  const inhibitor = new PowerInhibitor({
    run: async () => ({ stdout: "/usr/bin/systemd-inhibit\n", stderr: "" }),
    spawn: () => child as unknown as ChildProcess,
    schedule: () => ({}),
    cancel: () => {
      canceled = true;
    },
  });

  await inhibitor.start();
  child.emit("exit", 1, null);
  inhibitor.stop();

  assert.equal(canceled, true);
  assert.equal(child.killedWith, undefined);
});
