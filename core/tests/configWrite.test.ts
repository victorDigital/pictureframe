import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { applyConfigPatch } from "../src/config/write.js";

async function fixture(initial: Record<string, unknown>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frame-write-"));
  const file = path.join(dir, "frame.yaml");
  await fs.writeFile(file, YAML.stringify(initial));
  return { dir, file };
}

test("applyConfigPatch updates nested ha.mqtt host without touching other keys", async () => {
  const { dir, file } = await fixture({
    device: { name: "f1", bearer_token_file: "/x" },
    ha: {
      enabled: true,
      mqtt: { host: "old.local", port: 1883, username: "frame", password_file: "/p" },
    },
    updater: { repo: "a/b" },
  });
  await applyConfigPatch(file, { ha: { mqtt: { host: "new.local" } } });
  const round = YAML.parse(await fs.readFile(file, "utf8")) as {
    ha: { mqtt: { host: string; port: number; username: string; password_file: string } };
    device: { name: string };
    updater: { repo: string };
  };
  assert.equal(round.ha.mqtt.host, "new.local");
  assert.equal(round.ha.mqtt.port, 1883);
  assert.equal(round.ha.mqtt.password_file, "/p");
  assert.equal(round.device.name, "f1");
  assert.equal(round.updater.repo, "a/b");
  await fs.rm(dir, { recursive: true, force: true });
});

test("applyConfigPatch creates missing sections (vnc) and toggles builtins", async () => {
  const { dir, file } = await fixture({
    device: { name: "f1" },
  });
  await applyConfigPatch(file, {
    vnc: { enabled: false },
    builtins: { family_message: { enabled: true } },
  });
  const round = YAML.parse(await fs.readFile(file, "utf8")) as {
    vnc: { enabled: boolean };
    builtins: { family_message: { enabled: boolean } };
  };
  assert.equal(round.vnc.enabled, false);
  assert.equal(round.builtins.family_message.enabled, true);
  await fs.rm(dir, { recursive: true, force: true });
});

test("applyConfigPatch updates display geometry settings", async () => {
  const { dir, file } = await fixture({
    display: { brightness_backend: "backlight", default_brightness: 60 },
  });
  await applyConfigPatch(file, {
    display: { scale: 1.25, orientation: "90" },
  });
  const round = YAML.parse(await fs.readFile(file, "utf8")) as {
    display: { scale: number; orientation: string };
  };
  assert.equal(round.display.scale, 1.25);
  assert.equal(round.display.orientation, "90");
  await fs.rm(dir, { recursive: true, force: true });
});

test("applyConfigPatch is atomic (writes via .tmp + rename)", async () => {
  const { dir, file } = await fixture({ device: { name: "f1" } });
  await applyConfigPatch(file, { device: { name: "f2" } });
  const entries = await fs.readdir(dir);
  // no leftover .tmp
  assert.deepEqual(entries.sort(), ["frame.yaml"]);
  await fs.rm(dir, { recursive: true, force: true });
});
