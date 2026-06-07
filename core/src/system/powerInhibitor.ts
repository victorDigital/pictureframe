import type { ChildProcess } from "node:child_process";
import {
  commandExists,
  defaultCommandRunner,
  defaultProcessSpawner,
  type CommandRunner,
  type ProcessSpawner,
} from "./displayController.js";
import { sub } from "../util/logger.js";

const log = sub("powerInhibitor");

type LifecycleTimer = { unref?: () => void };
type ScheduleFn = (fn: () => void, ms: number) => LifecycleTimer;

export class PowerInhibitor {
  private child?: ChildProcess;
  private restartTimer?: LifecycleTimer;
  private stopped = true;

  constructor(
    private opts: {
      env?: NodeJS.ProcessEnv;
      run?: CommandRunner;
      spawn?: ProcessSpawner;
      schedule?: ScheduleFn;
      cancel?: (timer: LifecycleTimer) => void;
    } = {},
  ) {}

  async start() {
    this.stopped = false;
    if (this.env().FRAME_POWER_INHIBIT === "0" || this.child) return;
    const run = this.opts.run ?? defaultCommandRunner;
    if (!(await commandExists("systemd-inhibit", run))) {
      log.warn("systemd-inhibit missing; system sleep cannot be blocked by frame-core");
      return;
    }
    const spawn = this.opts.spawn ?? defaultProcessSpawner;
    this.child = spawn("systemd-inhibit", [
      "--what=idle:sleep:handle-lid-switch",
      "--who=pictureframe",
      "--why=Picture Frame core must stay awake while kiosk recycles",
      "--mode=block",
      "sleep",
      "infinity",
    ]);
    this.child.unref?.();
    this.child.once?.("exit", (code, signal) => {
      this.child = undefined;
      if (this.stopped) return;
      log.warn({ code, signal }, "power inhibitor exited; scheduling restart");
      this.restartTimer = this.schedule(() => {
        this.restartTimer = undefined;
        void this.start();
      }, 30_000);
      this.restartTimer.unref?.();
    });
    this.child.once?.("error", (err) => {
      this.child = undefined;
      if (this.stopped) return;
      log.warn({ err }, "power inhibitor failed");
    });
    log.info("system sleep inhibitor started");
  }

  stop() {
    this.stopped = true;
    if (this.restartTimer) {
      if (this.opts.cancel) this.opts.cancel(this.restartTimer);
      else clearTimeout(this.restartTimer as NodeJS.Timeout);
      this.restartTimer = undefined;
    }
    const child = this.child;
    this.child = undefined;
    if (child?.pid) child.kill("SIGTERM");
  }

  private schedule(fn: () => void, ms: number): LifecycleTimer {
    if (this.opts.schedule) return this.opts.schedule(fn, ms);
    return setTimeout(fn, ms);
  }

  private env() {
    return this.opts.env ?? process.env;
  }
}
