import { ChildProcess, spawn } from "node:child_process";
import EventEmitter from "node:events";
import { sub } from "../util/logger.js";

const log = sub("cdp.launcher");

export type LaunchOptions = {
  chromiumBin?: string;
  startUrl: string;
  userDataDir?: string;
  extraFlags?: string[];
};

export class ChromiumProcess extends EventEmitter {
  private child?: ChildProcess;
  private exited = false;

  constructor(private opts: LaunchOptions) {
    super();
  }

  start() {
    const bin = this.opts.chromiumBin ?? process.env.FRAME_CHROMIUM_BIN ?? "chromium";
    const flags = [
      // CDP over pipe FDs 3 and 4 — never bound to a TCP port. See SPEC §3.2.
      "--remote-debugging-pipe",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate,InfinitePrefetch",
      "--password-store=basic",
      "--ozone-platform=wayland",
      "--enable-features=UseOzonePlatform",
      "--kiosk",
      `--user-data-dir=${this.opts.userDataDir ?? "/home/frame/.config/frame-chromium"}`,
      "--disable-pinch",
      "--overscroll-history-navigation=0",
      ...(this.opts.extraFlags ?? []),
      this.opts.startUrl,
    ];

    log.info({ bin, startUrl: this.opts.startUrl }, "spawning chromium");
    const child = spawn(bin, flags, {
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
    });
    this.child = child;

    child.stdout?.on("data", (b) => log.debug({ chunk: b.toString() }, "chromium stdout"));
    child.stderr?.on("data", (b) => log.debug({ chunk: b.toString() }, "chromium stderr"));
    child.on("exit", (code, sig) => {
      this.exited = true;
      log.warn({ code, sig }, "chromium exited");
      this.emit("exit", code, sig);
    });

    return {
      writeFd: child.stdio[3] as NodeJS.WritableStream,
      readFd: child.stdio[4] as NodeJS.ReadableStream,
    };
  }

  async stop() {
    if (!this.child || this.exited) return;
    this.child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        this.child?.kill("SIGKILL");
        resolve();
      }, 3000);
      this.child!.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}
