import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  discoverMigrations,
  verifyHistoryIntegrity,
} from "../src/updater/migrations.js";

async function mkTempDir(prefix: string) {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function sha256(file: string) {
  return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

test("discoverMigrations picks up numbered files and detects requires_manual_step", async () => {
  const dir = await mkTempDir("frame-mig-");
  await fs.writeFile(path.join(dir, "0001_baseline.yaml"), "requires_manual_step: false\n");
  await fs.writeFile(path.join(dir, "0002_apt-deps.sh"), "#!/bin/sh\n# requires_manual_step: true\n");
  await fs.writeFile(path.join(dir, "0003_ts.ts"), "// nothing\n");
  await fs.writeFile(path.join(dir, "README.md"), "ignore me");

  const found = await discoverMigrations(dir);
  assert.equal(found.length, 3);
  assert.deepEqual(
    found.map((m) => m.number),
    [1, 2, 3],
  );
  assert.equal(found[0]?.requiresManualStep, false);
  assert.equal(found[1]?.requiresManualStep, true);
  assert.equal(found[1]?.ext, ".sh");

  await fs.rm(dir, { recursive: true, force: true });
});

test("verifyHistoryIntegrity passes when hashes match", async () => {
  const dir = await mkTempDir("frame-mig-");
  const file = path.join(dir, "0001_init.yaml");
  await fs.writeFile(file, "description: baseline\n");
  const found = await discoverMigrations(dir);
  const hash = await sha256(file);

  const history = {
    applied: [
      { number: 1, name: "init", hash, appliedAt: new Date().toISOString() },
    ],
  };
  const result = await verifyHistoryIntegrity(history, found);
  assert.equal(result.ok, true);

  await fs.rm(dir, { recursive: true, force: true });
});

test("verifyHistoryIntegrity fails when a migration was rewritten under us", async () => {
  const dir = await mkTempDir("frame-mig-");
  const file = path.join(dir, "0001_init.yaml");
  await fs.writeFile(file, "description: baseline\n");
  const found = await discoverMigrations(dir);

  const history = {
    applied: [
      {
        number: 1,
        name: "init",
        hash: "deadbeef".repeat(8),
        appliedAt: new Date().toISOString(),
      },
    ],
  };
  const result = await verifyHistoryIntegrity(history, found);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /hash mismatch/);

  await fs.rm(dir, { recursive: true, force: true });
});

test("verifyHistoryIntegrity fails when a previously-applied migration is missing", async () => {
  const dir = await mkTempDir("frame-mig-");
  // No migrations at all.
  const found = await discoverMigrations(dir);

  const history = {
    applied: [
      {
        number: 1,
        name: "init",
        hash: "x".repeat(64),
        appliedAt: new Date().toISOString(),
      },
    ],
  };
  const result = await verifyHistoryIntegrity(history, found);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /missing/);

  await fs.rm(dir, { recursive: true, force: true });
});
