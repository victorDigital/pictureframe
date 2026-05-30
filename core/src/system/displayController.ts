import { execFile } from "node:child_process";
import type { ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";
import type { FrameConfig } from "../config/schema.js";
import { sub } from "../util/logger.js";
import { wlSessionEnv } from "./wayland.js";

export type CommandRunner = (
  file: string,
  args?: string[],
  options?: ExecFileOptions,
) => Promise<{ stdout: string; stderr: string }>;

export const defaultCommandRunner = promisify(execFile) as CommandRunner;
const log = sub("display");

export class DisplayController {
  constructor(
    private cfg: FrameConfig,
    private run: CommandRunner = defaultCommandRunner,
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
