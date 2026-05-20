import { spawn, ChildProcess } from "node:child_process";
import { sub } from "../util/logger.js";

const log = sub("vnc");

export class VncSupervisor {
  private wayvnc?: ChildProcess;
  private websockify?: ChildProcess;

  start(opts: { passwordFile: string; wsPort: number; vncPort: number }) {
    if (this.wayvnc) return;
    log.info("starting wayvnc");
    this.wayvnc = spawn("wayvnc", ["127.0.0.1", String(opts.vncPort)], {
      stdio: "ignore",
      env: { ...process.env, WAYVNC_PASSWORD_FILE: opts.passwordFile },
    });
    this.websockify = spawn(
      "websockify",
      [String(opts.wsPort), `127.0.0.1:${opts.vncPort}`],
      { stdio: "ignore" },
    );
  }

  stop() {
    this.wayvnc?.kill("SIGTERM");
    this.websockify?.kill("SIGTERM");
    this.wayvnc = undefined;
    this.websockify = undefined;
    log.info("vnc stopped");
  }

  isRunning() {
    return Boolean(this.wayvnc);
  }
}
