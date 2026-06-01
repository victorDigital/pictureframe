import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import type { ChildProcess, ExecFileOptions, SpawnOptions } from "node:child_process";
import { promisify } from "node:util";
import type { FrameConfig } from "../config/schema.js";
import { sub } from "../util/logger.js";
import { wlSessionEnv } from "./wayland.js";
import { paths } from "../util/paths.js";

export type CommandRunner = (
  file: string,
  args?: string[],
  options?: ExecFileOptions,
) => Promise<{ stdout: string; stderr: string }>;

export const defaultCommandRunner = promisify(execFile) as CommandRunner;
export type ProcessSpawner = (
  file: string,
  args?: string[],
  options?: SpawnOptions,
) => ChildProcess;

export const defaultProcessSpawner: ProcessSpawner = (file, args = [], options = {}) =>
  spawn(file, args, { ...options, detached: true, stdio: "ignore" });

const log = sub("display");
export const MIN_COLOR_TEMPERATURE_KELVIN = 2000;
export const MAX_COLOR_TEMPERATURE_KELVIN = 6535;
export const WLSUNSET_MISSING_ERROR =
  "wlsunset_missing_manual_install_required: sudo apt-get update && sudo apt-get install -y wlsunset";

export class DisplayController {
  constructor(
    private cfg: FrameConfig,
    private run: CommandRunner = defaultCommandRunner,
    private spawnProcess: ProcessSpawner = defaultProcessSpawner,
    private colorTemperaturePidFile = path.join(paths.runtimeDir, "wlsunset.pid"),
    private colorTemperatureStartupMs = 500,
  ) {}

  updateConfig(cfg: FrameConfig) {
    this.cfg = cfg;
  }

  async power(state: "on" | "off"): Promise<{ ok: true }> {
    const env = { ...process.env, ...(await wlSessionEnv()) };
    if (await commandExists("wlopm", this.run)) {
      try {
        await this.run("wlopm", [state === "off" ? "--off" : "--on", "*"], { env });
        if (state === "on") await this.applyConfig();
        return { ok: true };
      } catch (err) {
        log.warn({ err: String(err) }, "wlopm failed; trying wlr-randr");
      }
    }
    if (!(await commandExists("wlr-randr", this.run))) {
      throw new Error(
        "display_power_missing_package: wlr-randr or wlopm is missing; apply the latest update so the updater installs declared OS packages",
      );
    }
    const { stdout } = await this.run("wlr-randr", [], { env });
    const outputs = parseWlrOutputs(stdout);
    await Promise.all(
      outputs.map((output) =>
        this.run("wlr-randr", ["--output", output, state === "off" ? "--off" : "--on"], {
          env,
        }),
      ),
    );
    if (state === "on") await this.applyConfig();
    return { ok: true };
  }

  async applyConfig(): Promise<boolean> {
    const scale = this.cfg.display.scale ?? 1;
    const orientation = this.cfg.display.orientation ?? "normal";
    const isDefault = scale === 1 && orientation === "normal";
    if (!(await commandExists("wlr-randr", this.run))) {
      if (!isDefault) {
        log.warn(
          { scale, orientation },
          "wlr-randr missing; hardware display geometry not applied",
        );
      }
      return false;
    }
    const env = { ...process.env, ...(await wlSessionEnv()) };
    const { stdout } = await this.run("wlr-randr", [], { env });
    const outputs = parseWlrOutputs(stdout);
    if (outputs.length === 0) {
      log.warn("wlr-randr reported no outputs; hardware display geometry not applied");
      return false;
    }
    await Promise.all(
      outputs.map((output) =>
        this.run(
          "wlr-randr",
          ["--output", output, "--scale", String(scale), "--transform", orientation],
          { env },
        ),
      ),
    );
    log.info({ scale, orientation, outputs }, "display geometry applied");
    return true;
  }

  async colorTemperature(kelvin: number): Promise<number> {
    const clamped = clampColorTemperatureKelvin(kelvin);
    if (clamped === MAX_COLOR_TEMPERATURE_KELVIN) {
      await this.stopColorTemperature();
      return clamped;
    }
    if (!(await commandExists("wlsunset", this.run))) {
      throw new Error(WLSUNSET_MISSING_ERROR);
    }
    await this.stopColorTemperature();
    await fs.mkdir(path.dirname(this.colorTemperaturePidFile), { recursive: true });
    const env = { ...process.env, ...(await wlSessionEnv()) };
    const child = this.spawnProcess(
      "wlsunset",
      ["-l", "0", "-L", "0", "-t", String(clamped), "-T", String(clamped)],
      { env },
    );
    if (!child.pid) throw new Error("color_temperature_start_failed: wlsunset did not report a pid");
    await waitForProcessStartup(child, "wlsunset", this.colorTemperatureStartupMs);
    child.unref();
    await fs.writeFile(
      this.colorTemperaturePidFile,
      JSON.stringify({ pid: child.pid, command: "wlsunset" }) + "\n",
    );
    log.info({ kelvin: clamped, pid: child.pid }, "color temperature set");
    return clamped;
  }

  private async stopColorTemperature() {
    const entry = await this.readColorTemperaturePid();
    if (!entry) return;
    const running = pidRunning(entry.pid);
    if (running && (await pidLooksLikeWlsunset(entry.pid, entry.command))) {
      try {
        process.kill(entry.pid, "SIGTERM");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
      }
      if (!(await waitForPidExit(entry.pid, 1000)) && (await pidLooksLikeWlsunset(entry.pid, entry.command))) {
        try {
          process.kill(entry.pid, "SIGKILL");
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
        }
        await waitForPidExit(entry.pid, 1000);
      }
    }
    await fs.rm(this.colorTemperaturePidFile, { force: true });
  }

  private async readColorTemperaturePid(): Promise<{ pid: number; command?: string } | undefined> {
    let raw: string;
    try {
      raw = await fs.readFile(this.colorTemperaturePidFile, "utf8");
    } catch {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as { pid?: unknown; command?: unknown };
      if (typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0) {
        return {
          pid: parsed.pid,
          command: typeof parsed.command === "string" ? parsed.command : undefined,
        };
      }
    } catch {
      const pid = Number(raw.trim());
      if (Number.isInteger(pid) && pid > 0) return { pid };
    }
    await fs.rm(this.colorTemperaturePidFile, { force: true });
    return undefined;
  }
}

export function clampColorTemperatureKelvin(kelvin: number): number {
  if (!Number.isFinite(kelvin)) return MAX_COLOR_TEMPERATURE_KELVIN;
  return Math.max(
    MIN_COLOR_TEMPERATURE_KELVIN,
    Math.min(MAX_COLOR_TEMPERATURE_KELVIN, Math.round(kelvin)),
  );
}

function pidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !pidRunning(pid);
}

async function waitForProcessStartup(
  child: ChildProcess,
  command: string,
  timeoutMs = 500,
): Promise<void> {
  if (typeof child.once !== "function") return;
  if (child.exitCode !== null) {
    throw new Error(`color_temperature_start_failed: ${command} exited before startup`);
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, timeoutMs);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      done(
        new Error(
          `color_temperature_start_failed: ${command} exited ${code ?? "?"}${signal ? ` (${signal})` : ""}`,
        ),
      );
    const onError = (err: Error) =>
      done(new Error(`color_temperature_start_failed: ${command}: ${err.message}`));
    function done(err?: Error) {
      clearTimeout(timer);
      child.off?.("exit", onExit);
      child.off?.("error", onError);
      if (err) reject(err);
      else resolve();
    }
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function pidLooksLikeWlsunset(pid: number, command?: string): Promise<boolean> {
  if (command && command !== "wlsunset") return false;
  if (process.platform !== "linux") return true;
  try {
    const cmdline = await fs.readFile(`/proc/${pid}/cmdline`, "utf8");
    return cmdline.includes("wlsunset");
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

export async function commandExists(command: string, run: CommandRunner): Promise<boolean> {
  try {
    await run("sh", ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

export function parseWlrOutputs(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.length > 0 && !line.startsWith(" "))
    .map((line) => line.trim().split(/\s+/, 1)[0])
    .filter((name): name is string => Boolean(name));
}
