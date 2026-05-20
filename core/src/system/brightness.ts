import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FrameConfig } from "../config/schema.js";
import { sub } from "../util/logger.js";

const exec = promisify(execFile);
const log = sub("brightness");

export class Brightness {
  constructor(private cfg: FrameConfig) {}

  async read(): Promise<number> {
    const backend = this.cfg.display.brightness_backend;
    if (backend === "backlight") {
      const dev = this.cfg.display.backlight_device;
      if (!dev) return this.cfg.display.default_brightness;
      const [raw, maxRaw] = await Promise.all([
        fs.readFile(path.join(dev, "brightness"), "utf8"),
        fs.readFile(path.join(dev, "max_brightness"), "utf8"),
      ]);
      const value = parseInt(raw.trim(), 10);
      const max = parseInt(maxRaw.trim(), 10);
      if (!max) return 0;
      return Math.round((value / max) * 100);
    }
    if (backend === "ddcutil") {
      const { stdout } = await exec("ddcutil", ["getvcp", "10", "--terse"]);
      const m = stdout.match(/VCP 10 C (\d+) (\d+)/);
      if (!m) return this.cfg.display.default_brightness;
      const [, cur, max] = m;
      return Math.round((Number(cur) / Number(max)) * 100);
    }
    return this.cfg.display.default_brightness;
  }

  async write(percent: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    const backend = this.cfg.display.brightness_backend;
    if (backend === "backlight") {
      const dev = this.cfg.display.backlight_device;
      if (!dev) return;
      const maxRaw = await fs.readFile(path.join(dev, "max_brightness"), "utf8");
      const max = parseInt(maxRaw.trim(), 10);
      const target = Math.round((clamped / 100) * max);
      await fs.writeFile(path.join(dev, "brightness"), String(target));
      log.info({ percent: clamped, raw: target }, "brightness set");
    } else if (backend === "ddcutil") {
      await exec("ddcutil", ["setvcp", "10", String(clamped)]);
    }
  }

  async scheduleReboot(): Promise<{ ok: true }> {
    log.warn("reboot requested via API");
    setTimeout(() => exec("sudo", ["/sbin/reboot"]).catch(() => {}), 500);
    return { ok: true };
  }

  async displayPower(state: "on" | "off"): Promise<{ ok: true }> {
    if (state === "off") {
      await exec("sh", ["-c", "wlopm --off '*'"]).catch(() => {});
    } else {
      await exec("sh", ["-c", "wlopm --on '*'"]).catch(() => {});
    }
    return { ok: true };
  }
}
