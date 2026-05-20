import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { Scheduler } from "../src/scheduler/index.js";
import { CronEngine } from "../src/scheduler/cron.js";
import { RuleStore } from "../src/scheduler/rules.js";

function makeScheduler() {
  return new Scheduler({
    screens: [
      { id: "clock", name: "Clock", type: "builtin", source: "clock", preload: true },
      { id: "weather", name: "Weather", type: "builtin", source: "weather", preload: false },
    ],
    defaultScreen: "clock",
    pinnedTimeoutHours: 4,
  });
}

test("RuleStore loads valid rules.yaml and applies them to the engine", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "frame-rules-"));
  const file = path.join(tmp, "rules.yaml");
  await fs.writeFile(
    file,
    YAML.stringify({
      rules: [
        { id: "morning", cron: "0 9 * * 1-5", screenId: "weather", durationMin: 60, enabled: true },
      ],
    }),
  );
  const scheduler = makeScheduler();
  scheduler.start();
  const engine = new CronEngine(scheduler);
  const store = new RuleStore(file, engine);
  await store.load();
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, "morning");
  engine.stop();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("RuleStore.replace rejects bad cron and keeps existing rules", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "frame-rules-"));
  const file = path.join(tmp, "rules.yaml");
  const scheduler = makeScheduler();
  scheduler.start();
  const engine = new CronEngine(scheduler);
  const store = new RuleStore(file, engine);

  await store.replace([
    { id: "ok", cron: "0 9 * * *", screenId: "clock", enabled: true },
  ]);
  assert.equal(store.list().length, 1);

  await assert.rejects(() =>
    store.replace([{ id: "bad", cron: "not a cron", screenId: "clock", enabled: true }]),
  );
  assert.equal(store.list().length, 1, "store retains valid prior state after a bad replace");

  engine.stop();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("RuleStore.replace persists to disk", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "frame-rules-"));
  const file = path.join(tmp, "rules.yaml");
  const scheduler = makeScheduler();
  scheduler.start();
  const engine = new CronEngine(scheduler);
  const store = new RuleStore(file, engine);

  await store.replace([
    { id: "a", cron: "0 7 * * *", screenId: "clock", enabled: true },
  ]);
  const raw = await fs.readFile(file, "utf8");
  const parsed = YAML.parse(raw) as { rules: Array<{ id: string }> };
  assert.equal(parsed.rules.length, 1);
  assert.equal(parsed.rules[0]?.id, "a");

  engine.stop();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("RuleStore.load tolerates a missing file (fresh device)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "frame-rules-"));
  const file = path.join(tmp, "rules.yaml");
  const scheduler = makeScheduler();
  scheduler.start();
  const engine = new CronEngine(scheduler);
  const store = new RuleStore(file, engine);
  await assert.doesNotReject(() => store.load());
  assert.equal(store.list().length, 0);
  engine.stop();
  await fs.rm(tmp, { recursive: true, force: true });
});
