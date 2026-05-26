import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../src/updater/exec.js";

test("runCommand streams output larger than the default execFile maxBuffer", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "frame-exec-"));
  process.env.FRAME_STATE_DIR = stateDir;
  try {
    const { logPath } = await runCommand(process.execPath, [
      "-e",
      "process.stdout.write('x'.repeat(2 * 1024 * 1024))",
    ]);
    const log = await fs.readFile(logPath, "utf8");
    assert.ok(log.includes("x".repeat(1024)));
    assert.ok(log.length >= 2 * 1024 * 1024);
  } finally {
    delete process.env.FRAME_STATE_DIR;
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("runCommand rejects non-zero exit with log path", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "frame-exec-"));
  process.env.FRAME_STATE_DIR = stateDir;
  try {
    await assert.rejects(
      () => runCommand(process.execPath, ["-e", "process.stderr.write('nope'); process.exit(3)"]),
      /exited 3[\s\S]*full log:/,
    );
  } finally {
    delete process.env.FRAME_STATE_DIR;
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});
