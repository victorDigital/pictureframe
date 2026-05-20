import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Quarantine } from "../src/updater/quarantine.js";

async function mk() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frame-q-"));
  return { dir, file: path.join(dir, "quarantine.json") };
}

test("a quarantined tag is reported by has() and survives load()", async () => {
  const { dir, file } = await mk();
  const q = new Quarantine(file);
  await q.load();
  await q.add("v1.2.3", "health_check_failed");
  assert.equal(q.has("v1.2.3"), true);

  const q2 = new Quarantine(file);
  await q2.load();
  assert.equal(q2.has("v1.2.3"), true);
  const list = q2.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.reason, "health_check_failed");

  await fs.rm(dir, { recursive: true, force: true });
});

test("clear(tag) removes a single entry; clear() empties the list", async () => {
  const { dir, file } = await mk();
  const q = new Quarantine(file);
  await q.add("v1.0.0", "preflight_timeout");
  await q.add("v1.0.1", "apply_failed");
  assert.equal(q.list().length, 2);

  const removed = await q.clear("v1.0.0");
  assert.equal(removed, 1);
  assert.equal(q.has("v1.0.0"), false);
  assert.equal(q.has("v1.0.1"), true);

  const remaining = await q.clear();
  assert.equal(remaining, 1);
  assert.equal(q.list().length, 0);

  await fs.rm(dir, { recursive: true, force: true });
});

test("load() tolerates a missing or malformed file", async () => {
  const { dir, file } = await mk();
  const q = new Quarantine(file);
  await assert.doesNotReject(() => q.load());

  await fs.writeFile(file, "not json");
  const q2 = new Quarantine(file);
  await assert.doesNotReject(() => q2.load());
  assert.equal(q2.list().length, 0);

  await fs.rm(dir, { recursive: true, force: true });
});
