import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { releaseOsPackages } from "../src/updater/osPackages.js";

test("releaseOsPackages reads comments and unique package names", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "frame-pkgs-"));
  try {
    const deploy = path.join(tmp, "deploy");
    await fs.mkdir(deploy);
    await fs.writeFile(
      path.join(deploy, "os-packages.txt"),
      "\n# display controls\nwlr-randr\nwlr-randr # duplicate\nwayvnc\n",
    );

    assert.deepEqual(await releaseOsPackages(tmp), ["wlr-randr", "wayvnc"]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("releaseOsPackages rejects invalid package names", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "frame-pkgs-"));
  try {
    const deploy = path.join(tmp, "deploy");
    await fs.mkdir(deploy);
    await fs.writeFile(path.join(deploy, "os-packages.txt"), "wlr-randr\nbad/pkg\n");

    await assert.rejects(() => releaseOsPackages(tmp), /invalid_os_package_name/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
