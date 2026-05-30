import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { planReleaseServices } from "../src/updater/servicePlan.js";

async function writeRelease(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(root, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
}

test("service plan restarts kiosk when launch assets changed", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "frame-service-plan-"));
  const current = path.join(tmp, "current");
  const next = path.join(tmp, "next");
  await writeRelease(current, {
    "deploy/launch-chromium.sh": "old",
    "kiosk/index.html": "same",
  });
  await writeRelease(next, {
    "deploy/launch-chromium.sh": "new",
    "kiosk/index.html": "same",
  });

  const plan = await planReleaseServices(current, next);

  assert.equal(plan.restartCore, true);
  assert.equal(plan.restartKiosk, true);
  assert.deepEqual(plan.changedKioskPaths, ["deploy/launch-chromium.sh"]);
});

test("service plan only restarts core when kiosk assets are unchanged", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "frame-service-plan-"));
  const current = path.join(tmp, "current");
  const next = path.join(tmp, "next");
  await writeRelease(current, {
    "core/src/index.ts": "old",
    "deploy/launch-chromium.sh": "same",
    "kiosk/index.html": "same",
  });
  await writeRelease(next, {
    "core/src/index.ts": "new",
    "deploy/launch-chromium.sh": "same",
    "kiosk/index.html": "same",
  });

  const plan = await planReleaseServices(current, next);

  assert.equal(plan.restartCore, true);
  assert.equal(plan.restartKiosk, false);
  assert.deepEqual(plan.changedKioskPaths, []);
});
