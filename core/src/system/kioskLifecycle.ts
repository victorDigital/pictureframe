import { sub } from "../util/logger.js";

type DisplayPower = (state: "on" | "off") => Promise<{ ok: true }>;
type RestartKiosk = (reason: string) => Promise<void>;
type LifecycleTimer = { unref?: () => void };
type ScheduleFn = (fn: () => Promise<void>, ms: number) => LifecycleTimer;
type ActiveScreen = { id: string; type: "builtin" | "url"; renderedByShell: boolean };

const log = sub("kioskLifecycle");

export class KioskLifecycle {
  private bootDisplayCycleScheduled = false;
  private bootDisplayCycleRan = false;
  private bootDisplayTimer?: LifecycleTimer;
  private disconnectTimer?: LifecycleTimer;
  private heartbeatTimer?: LifecycleTimer;
  private restartTimer?: LifecycleTimer;
  private activeScreen?: ActiveScreen;
  private shellOnline = false;
  private shellEverConnected = false;
  private lastHeartbeatAt?: number;
  private lastRestartAt?: number;
  private stopped = false;

  constructor(
    private opts: {
      displayPower: DisplayPower;
      restartKiosk?: RestartKiosk;
      env?: NodeJS.ProcessEnv;
      schedule?: ScheduleFn;
      cancel?: (timer: LifecycleTimer) => void;
      delay?: (ms: number) => Promise<void>;
      now?: () => number;
    },
  ) {}

  shellConnected() {
    this.stopped = false;
    this.shellOnline = true;
    this.shellEverConnected = true;
    this.lastHeartbeatAt = this.now();
    this.clearTimer("disconnectTimer");
    this.clearTimer("restartTimer");
    this.scheduleBootDisplayCycle("shell_connected");
    this.scheduleHeartbeatWatch();
  }

  shellDisconnected() {
    if (!this.shellEverConnected) return;
    this.shellOnline = false;
    this.clearTimer("heartbeatTimer");
    if (this.watchdogDisabled()) return;
    const delayMs = secondsEnv(this.env().FRAME_KIOSK_DISCONNECT_GRACE_SEC, 90) * 1000;
    this.clearTimer("disconnectTimer");
    this.disconnectTimer = this.schedule(async () => {
      this.disconnectTimer = undefined;
      if (!this.shellOnline) this.scheduleKioskRestart("shell_disconnected", 0, () => !this.shellOnline);
    }, delayMs);
    this.disconnectTimer.unref?.();
    log.warn({ delayMs }, "shell detached; scheduled kiosk recovery");
  }

  shellHeartbeat(_visible: string) {
    this.shellOnline = true;
    this.shellEverConnected = true;
    this.lastHeartbeatAt = this.now();
    this.scheduleHeartbeatWatch();
  }

  activeScreenChanged(screen: ActiveScreen) {
    this.activeScreen = screen;
    this.scheduleHeartbeatWatch();
  }

  chromiumExited() {
    if (this.stopped || this.watchdogDisabled()) return;
    this.shellOnline = false;
    this.clearTimer("heartbeatTimer");
    this.scheduleKioskRestart("chromium_exit", 2000);
  }

  screenShowFailed(screenId: string) {
    if (this.stopped || this.watchdogDisabled()) return;
    this.scheduleKioskRestart(`screen_show_failed:${screenId}`, 10_000);
  }

  stop() {
    this.stopped = true;
    this.clearTimer("bootDisplayTimer");
    this.clearTimer("disconnectTimer");
    this.clearTimer("heartbeatTimer");
    this.clearTimer("restartTimer");
  }

  private scheduleBootDisplayCycle(trigger: string) {
    if (this.bootDisplayCycleScheduled || this.bootDisplayCycleRan) return;
    const env = this.opts.env ?? process.env;
    if (env.FRAME_BOOT_DISPLAY_CYCLE === "0") return;
    this.bootDisplayCycleScheduled = true;
    const delayMs = secondsEnv(env.FRAME_BOOT_DISPLAY_CYCLE_DELAY_SEC, 1) * 1000;
    this.bootDisplayTimer = this.schedule(
      async () => {
        this.bootDisplayTimer = undefined;
        await this.runBootDisplayCycle(trigger);
      },
      delayMs,
    );
    this.bootDisplayTimer.unref?.();
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

  private scheduleHeartbeatWatch() {
    this.clearTimer("heartbeatTimer");
    if (!this.shouldWatchHeartbeat()) return;
    const timeoutMs = secondsEnv(this.env().FRAME_KIOSK_HEARTBEAT_TIMEOUT_SEC, 45) * 1000;
    const elapsed = this.now() - (this.lastHeartbeatAt ?? this.now());
    const delayMs = Math.max(0, timeoutMs - elapsed);
    this.heartbeatTimer = this.schedule(async () => {
      this.heartbeatTimer = undefined;
      if (!this.shouldWatchHeartbeat()) return;
      const staleMs = this.now() - (this.lastHeartbeatAt ?? this.now());
      if (staleMs >= timeoutMs) {
        this.scheduleKioskRestart(
          "shell_heartbeat_stale",
          0,
          () => this.shouldWatchHeartbeat() && this.now() - (this.lastHeartbeatAt ?? this.now()) >= timeoutMs,
        );
      } else {
        this.scheduleHeartbeatWatch();
      }
    }, delayMs);
    this.heartbeatTimer.unref?.();
  }

  private shouldWatchHeartbeat() {
    return (
      !this.stopped &&
      !this.watchdogDisabled() &&
      this.shellOnline &&
      this.activeScreen?.renderedByShell === true
    );
  }

  private scheduleKioskRestart(reason: string, delayMs: number, shouldRun: () => boolean = () => true) {
    if (!this.opts.restartKiosk || this.restartTimer || this.stopped) return;
    const cooldownMs = secondsEnv(this.env().FRAME_KIOSK_RESTART_COOLDOWN_SEC, 300) * 1000;
    const remainingCooldown =
      this.lastRestartAt === undefined ? 0 : Math.max(0, cooldownMs - (this.now() - this.lastRestartAt));
    const waitMs = Math.max(delayMs, remainingCooldown);
    this.restartTimer = this.schedule(async () => {
      this.restartTimer = undefined;
      if (this.stopped || !shouldRun()) return;
      await this.runKioskRestart(reason);
    }, waitMs);
    this.restartTimer.unref?.();
    log.warn({ reason, waitMs }, "scheduled kiosk restart");
  }

  private async runKioskRestart(reason: string) {
    if (!this.opts.restartKiosk) return;
    this.lastRestartAt = this.now();
    try {
      log.warn({ reason }, "restarting kiosk service");
      await this.opts.restartKiosk(reason);
    } catch (err) {
      log.error({ err: String(err), reason }, "kiosk restart failed");
    }
  }

  private delay(ms: number): Promise<void> {
    if (this.opts.delay) return this.opts.delay(ms);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private clearTimer(name: "bootDisplayTimer" | "disconnectTimer" | "heartbeatTimer" | "restartTimer") {
    const timer = this[name];
    if (!timer) return;
    if (this.opts.cancel) this.opts.cancel(timer);
    else clearTimeout(timer as NodeJS.Timeout);
    this[name] = undefined;
  }

  private watchdogDisabled() {
    return this.env().FRAME_KIOSK_WATCHDOG === "0";
  }

  private env() {
    return this.opts.env ?? process.env;
  }

  private now() {
    return this.opts.now?.() ?? Date.now();
  }
}

function secondsEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}
