import fs from "node:fs/promises";
import path from "node:path";
import type { FrameConfig } from "../config/schema.js";
import { sub } from "../util/logger.js";
import {
  defaultCommandRunner,
  DisplayController,
  type CommandRunner,
} from "./displayController.js";

const log = sub("brightness");
const rootHelper = "/usr/local/lib/frame/root-helper";

export class Brightness {
  private display: DisplayController;

  constructor(
    private cfg: FrameConfig,
    private run: CommandRunner = defaultCommandRunner,
  ) {
    this.display = new DisplayController(cfg, run);
  }

  updateConfig(cfg: FrameConfig) {
    this.cfg = cfg;
    this.display.updateConfig(cfg);
  }

  async read(): Promise<number> {
    const backend = this.cfg.display.brightness_backend;
    if (backend === "backlight") {
      const dev = await this.backlightDevice();
      if (!dev) return this.cfg.display.default_brightness;
      try {
        const [raw, maxRaw] = await Promise.all([
          fs.readFile(path.join(dev, "brightness"), "utf8"),
          fs.readFile(path.join(dev, "max_brightness"), "utf8"),
        ]);
        const value = parseInt(raw.trim(), 10);
        const max = parseInt(maxRaw.trim(), 10);
        if (!max) return 0;
        return Math.round((value / max) * 100);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          log.warn({ dev }, "backlight device missing; returning default brightness");
          return this.cfg.display.default_brightness;
        }
        throw err;
      }
    }
    if (backend === "ddcutil") {
      const { stdout } = await this.run("ddcutil", ["getvcp", "10", "--terse"]);
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
      const dev = await this.backlightDevice();
      if (!dev) return;
      try {
        const maxRaw = await fs.readFile(path.join(dev, "max_brightness"), "utf8");
        const max = parseInt(maxRaw.trim(), 10);
        const target = Math.round((clamped / 100) * max);
        await fs.writeFile(path.join(dev, "brightness"), String(target));
        log.info({ percent: clamped, raw: target }, "brightness set");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          log.warn({ dev }, "backlight device missing; skipping brightness write");
          return;
        }
        throw err;
      }
    } else if (backend === "ddcutil") {
      await this.run("ddcutil", ["setvcp", "10", String(clamped)]);
    }
  }

  async scheduleReboot(): Promise<{ ok: true }> {
    log.warn("reboot requested via API");
    setTimeout(
      () =>
        this.run("sudo", ["-n", rootHelper, "reboot"]).catch(() =>
          this.run("sudo", ["-n", "/usr/bin/systemctl", "reboot"]).catch((err) => {
            log.error({ err: String(err) }, "reboot command failed");
          }),
        ),
      500,
    );
    return { ok: true };
  }

  async displayPower(state: "on" | "off"): Promise<{ ok: true }> {
    return this.display.power(state);
  }

  async applyDisplayConfig(): Promise<boolean> {
    return this.display.applyConfig();
  }

  private async backlightDevice(): Promise<string | undefined> {
    const configured = this.cfg.display.backlight_device;
    if (configured && (await exists(configured))) return configured;
    const detected = await detectBacklightDevice();
    if (detected && detected !== configured) {
      log.warn({ configured, detected }, "using detected backlight device");
    }
    return detected ?? configured;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

async function detectBacklightDevice(): Promise<string | undefined> {
  try {
    const base = "/sys/class/backlight";
    const entries = await fs.readdir(base);
    const preferred = ["intel_backlight", "amdgpu_bl0", "amdgpu_bl1", "acpi_video0"];
    const picked = preferred.find((name) => entries.includes(name)) ?? entries.sort()[0];
    return picked ? path.join(base, picked) : undefined;
  } catch {
    return undefined;
  }
}
