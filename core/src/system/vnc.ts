import { spawn, ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import { sub } from "../util/logger.js";

const log = sub("vnc");

const VNC_PORT = 5900;
const WS_PORT = 6080;
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export type VncStatus = {
  running: boolean;
  startedAt?: number;
  wsUrl?: string;
  wsPort: number;
  vncPort: number;
};

export class VncSupervisor {
  private wayvnc?: ChildProcess;
  private websockify?: ChildProcess;
  private startedAt?: number;
  private idleTimer?: NodeJS.Timeout;

  constructor(private passwordFile?: string) {}

  status(): VncStatus {
    return {
      running: Boolean(this.wayvnc),
      startedAt: this.startedAt,
      wsUrl: this.wayvnc ? `/vnc/ws` : undefined,
      wsPort: WS_PORT,
      vncPort: VNC_PORT,
    };
  }

  async start() {
    if (this.wayvnc) {
      this.markActive();
      return this.status();
    }
    if (!this.passwordFile) {
      throw new Error("vnc_password_file_not_configured");
    }
    try {
      await fs.access(this.passwordFile);
    } catch {
      throw new Error(`vnc_password_file_missing: ${this.passwordFile}`);
    }

    log.info("starting wayvnc + websockify");
    this.wayvnc = spawn(
      "wayvnc",
      ["--config", "/dev/null", "127.0.0.1", String(VNC_PORT)],
      {
        stdio: "ignore",
        env: { ...process.env, WAYVNC_PASSWORD_FILE: this.passwordFile },
      },
    );
    this.wayvnc.on("exit", (code) => {
      log.warn({ code }, "wayvnc exited");
      this.wayvnc = undefined;
      this.websockify?.kill("SIGTERM");
      this.websockify = undefined;
      this.startedAt = undefined;
    });

    this.websockify = spawn(
      "websockify",
      [String(WS_PORT), `127.0.0.1:${VNC_PORT}`],
      { stdio: "ignore" },
    );
    this.websockify.on("exit", (code) => {
      log.warn({ code }, "websockify exited");
      this.websockify = undefined;
    });

    this.startedAt = Date.now();
    this.markActive();
    return this.status();
  }

  stop() {
    this.wayvnc?.kill("SIGTERM");
    this.websockify?.kill("SIGTERM");
    this.wayvnc = undefined;
    this.websockify = undefined;
    this.startedAt = undefined;
    clearTimeout(this.idleTimer);
    log.info("vnc stopped");
  }

  markActive() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      log.info("vnc idle timeout reached; stopping");
      this.stop();
    }, IDLE_TIMEOUT_MS);
  }
}
