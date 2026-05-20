import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  pruneSnapshots,
  restoreSnapshot,
  snapshotConfig,
} from "../src/updater/snapshot.js";

async function mkdir(p: string) {
  await fs.mkdir(p, { recursive: true });
  return p;
}

test("snapshotConfig copies frame.yaml + screens.yaml + migrations.json", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "frame-snap-"));
  const configDir = await mkdir(path.join(root, "etc"));
  const stateDir = await mkdir(path.join(root, "state"));
  const snapshotsDir = await mkdir(path.join(root, "snapshots"));

  await fs.writeFile(path.join(configDir, "frame.yaml"), "device: { name: t }");
  await fs.writeFile(path.join(configDir, "screens.yaml"), "screens: []");
  await fs.writeFile(path.join(stateDir, "migrations.json"), '{"applied":[]}');

  const dir = await snapshotConfig({
    fromTag: "v1",
    toTag: "v2",
    configDir,
    stateDir,
    snapshotsDir,
  });
  assert.match(dir, /v1--v2$/);
  const inSnap = await fs.readdir(dir);
  assert.deepEqual(
    inSnap.sort(),
    ["frame.yaml", "migrations.json", "screens.yaml"],
  );

  await fs.rm(root, { recursive: true, force: true });
});

test("restoreSnapshot writes back into config and state dirs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "frame-snap-"));
  const configDir = await mkdir(path.join(root, "etc"));
  const stateDir = await mkdir(path.join(root, "state"));
  const snapshotsDir = await mkdir(path.join(root, "snapshots"));
  await fs.writeFile(path.join(configDir, "frame.yaml"), "before");
  await fs.writeFile(path.join(configDir, "screens.yaml"), "before");
  await fs.writeFile(path.join(stateDir, "migrations.json"), '{"applied":[]}');

  const dir = await snapshotConfig({
    fromTag: "v1",
    toTag: "v2",
    configDir,
    stateDir,
    snapshotsDir,
  });

  // simulate a botched update overwriting the originals
  await fs.writeFile(path.join(configDir, "frame.yaml"), "after");
  await fs.writeFile(path.join(configDir, "screens.yaml"), "after");
  await fs.writeFile(path.join(stateDir, "migrations.json"), '{"applied":[{"x":1}]}');

  await restoreSnapshot({ snapshotDir: dir, configDir, stateDir });

  assert.equal(await fs.readFile(path.join(configDir, "frame.yaml"), "utf8"), "before");
  assert.equal(await fs.readFile(path.join(configDir, "screens.yaml"), "utf8"), "before");
  assert.equal(
    await fs.readFile(path.join(stateDir, "migrations.json"), "utf8"),
    '{"applied":[]}',
  );

  await fs.rm(root, { recursive: true, force: true });
});

test("pruneSnapshots keeps the most recent N", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "frame-snap-"));
  const snapshotsDir = await mkdir(root);

  for (const tag of ["a--b", "b--c", "c--d", "d--e"]) {
    await mkdir(path.join(snapshotsDir, tag));
    // bump mtime ordering by waiting a short moment
    await new Promise((r) => setTimeout(r, 5));
  }
  await pruneSnapshots(snapshotsDir, 2);
  const remaining = (await fs.readdir(snapshotsDir)).sort();
  assert.equal(remaining.length, 2);
  // The two newest are c--d and d--e.
  assert.ok(remaining.includes("d--e"));
  assert.ok(remaining.includes("c--d"));

  await fs.rm(root, { recursive: true, force: true });
});
