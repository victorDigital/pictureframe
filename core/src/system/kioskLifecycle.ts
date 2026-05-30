import { sub } from "../util/logger.js";

type DisplayPower = (state: "on" | "off") => Promise<{ ok: true }>;
type LifecycleTimer = { unref?: () => void };
type ScheduleFn = (fn: () => Promise<void>, ms: number) => LifecycleTimer;

const log = sub("kioskLifecycle");

export class KioskLifecycle {
  private bootDisplayCycleScheduled = false;
  private bootDisplayCycleRan = false;
  private timer?: LifecycleTimer;

  constructor(
    private opts: {
      displayPower: DisplayPower;
      env?: NodeJS.ProcessEnv;
      schedule?: ScheduleFn;
      cancel?: (timer: LifecycleTimer) => void;
      delay?: (ms: number) => Promise<void>;
    },
  ) {}

  shellConnected() {
    this.scheduleBootDisplayCycle("shell_connected");
  }

  stop() {
    if (this.timer) {
      if (this.opts.cancel) this.opts.cancel(this.timer);
      else clearTimeout(this.timer as NodeJS.Timeout);
    }
    this.timer = undefined;
  }

  private scheduleBootDisplayCycle(trigger: string) {
    if (this.bootDisplayCycleScheduled || this.bootDisplayCycleRan) return;
    const env = this.opts.env ?? process.env;
    if (env.FRAME_BOOT_DISPLAY_CYCLE === "0") return;
    this.bootDisplayCycleScheduled = true;
    const delayMs = secondsEnv(env.FRAME_BOOT_DISPLAY_CYCLE_DELAY_SEC, 1) * 1000;
    this.timer = this.schedule(
      async () => {
        this.timer = undefined;
        await this.runBootDisplayCycle(trigger);
      },
      delayMs,
    );
    this.timer.unref?.();
    log.info({ trigger, delayMs }, "scheduled boot display cycle");
  }

  private async runBootDisplayCycle(trigger: string) {
    if (this.bootDisplayCycleRan) return;
    this.bootDisplayCycleRan = true;
    const env = this.opts.env ?? process.env;
    const offMs = secondsEnv(env.FRAME_BOOT_DISPLAY_CYCLE_OFF_SEC, 0.5) * 1000;
    try {
      log.warn({ trigger, offMs }, "cycling display after kiosk startup");
      await this.opts.displayPower("off");
      await this.delay(offMs);
      await this.opts.displayPower("on");
    } catch (err) {
      log.warn({ err: String(err), trigger }, "boot display cycle failed");
    }
  }

  private schedule(fn: () => Promise<void>, ms: number): LifecycleTimer {
    if (this.opts.schedule) return this.opts.schedule(fn, ms);
    return setTimeout(() => void fn(), ms);
  }

  private delay(ms: number): Promise<void> {
    if (this.opts.delay) return this.opts.delay(ms);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function secondsEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}
