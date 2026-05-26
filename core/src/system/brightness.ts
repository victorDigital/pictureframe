import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FrameConfig } from "../config/schema.js";
import { sub } from "../util/logger.js";
import { wlSessionEnv } from "./wayland.js";

const exec = promisify(execFile);
const log = sub("brightness");

export class Brightness {
  constructor(private cfg: FrameConfig) {}

  updateConfig(cfg: FrameConfig) {
    this.cfg = cfg;
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
      await exec("ddcutil", ["setvcp", "10", String(clamped)]);
    }
  }

  async scheduleReboot(): Promise<{ ok: true }> {
    log.warn("reboot requested via API");
    setTimeout(
      () =>
        exec("sudo", ["-n", "/usr/bin/systemctl", "reboot"]).catch((err) => {
          log.error({ err: String(err) }, "reboot command failed");
        }),
      500,
    );
    return { ok: true };
  }

  async displayPower(state: "on" | "off"): Promise<{ ok: true }> {
    const env = { ...process.env, ...(await wlSessionEnv()) };
    if (await commandExists("wlopm")) {
      try {
        await exec("wlopm", [state === "off" ? "--off" : "--on", "*"], { env });
        return { ok: true };
      } catch (err) {
        log.warn({ err: String(err) }, "wlopm failed; trying wlr-randr");
      }
    }
    if (!(await commandExists("wlr-randr"))) {
      throw new Error(
        "display_power_missing_package: install wlr-randr or wlopm; run sudo /opt/frame/current/deploy/install-os-packages.sh on the device",
      );
    }
    const { stdout } = await exec("wlr-randr", [], { env });
    const outputs = parseWlrOutputs(stdout);
    await Promise.all(
      outputs.map((output) =>
        exec("wlr-randr", ["--output", output, state === "off" ? "--off" : "--on"], {
          env,
        }),
      ),
    );
    return { ok: true };
  }

  async applyDisplayConfig(): Promise<void> {
    const scale = this.cfg.display.scale ?? 1;
    const orientation = this.cfg.display.orientation ?? "normal";
    if (scale === 1 && orientation === "normal") return;
    if (!(await commandExists("wlr-randr"))) {
      log.warn(
        { scale, orientation },
        "wlr-randr missing; hardware display geometry not applied",
      );
      return;
    }
    const env = { ...process.env, ...(await wlSessionEnv()) };
    const { stdout } = await exec("wlr-randr", [], { env });
    const outputs = parseWlrOutputs(stdout);
    await Promise.all(
      outputs.map((output) =>
        exec(
          "wlr-randr",
          ["--output", output, "--scale", String(scale), "--transform", orientation],
          { env },
        ),
      ),
    );
    log.info({ scale, orientation, outputs }, "display geometry applied");
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

async function commandExists(command: string): Promise<boolean> {
  try {
    await exec("sh", ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
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

function parseWlrOutputs(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.length > 0 && !line.startsWith(" "))
    .map((line) => line.trim().split(/\s+/, 1)[0])
    .filter((name): name is string => Boolean(name));
}
