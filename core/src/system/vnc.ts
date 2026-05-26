import { spawn, ChildProcess, execFile } from "node:child_process";
import { promises as fs, createWriteStream, WriteStream } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import { sub } from "../util/logger.js";
import { paths } from "../util/paths.js";
import { wlSessionEnv } from "./wayland.js";

const exec = promisify(execFile);

const log = sub("vnc");

const VNC_HOST = "127.0.0.1";
const VNC_PORT = 5900;
const WS_HOST = "127.0.0.1";
const WS_PORT = 6080;
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export type VncStatus = {
  running: boolean;
  startedAt?: number;
  wsUrl?: string;
  wsPort: number;
  vncPort: number;
  lastError?: string;
};

export class VncSupervisor {
  private wayvnc?: ChildProcess;
  private websockify?: ChildProcess;
  private wayvncLog?: WriteStream;
  private websockifyLog?: WriteStream;
  private startedAt?: number;
  private idleTimer?: NodeJS.Timeout;
  private runtimeDir: string;
  private lastError?: string;
  private wayvncOutput = "";

  constructor(private passwordFile?: string) {
    this.runtimeDir = paths.runtimeDir;
  }

  updatePasswordFile(file: string | undefined) {
    this.passwordFile = file;
  }

  status(): VncStatus {
    return {
      running: Boolean(this.wayvnc),
      startedAt: this.startedAt,
      wsUrl: this.wayvnc ? `/vnc/ws` : undefined,
      wsPort: WS_PORT,
      vncPort: VNC_PORT,
      lastError: this.lastError,
    };
  }

  async start() {
    if (this.wayvnc) {
      this.markActive();
      return this.status();
    }
    this.lastError = undefined;
    this.wayvncOutput = "";

    await fs.mkdir(this.runtimeDir, { recursive: true });
    const configFile = path.join(this.runtimeDir, "wayvnc.conf");
    const wayvncLogPath = path.join(this.runtimeDir, "wayvnc.log");
    const websockifyLogPath = path.join(this.runtimeDir, "websockify.log");

    const password = await readPasswordIfAvailable(this.passwordFile);
    const wayvncVersion = await detectWayvncVersion();
    const useAuth = password !== undefined && supportsPlainAuth(wayvncVersion);

    if (password !== undefined && !useAuth) {
      // Debian 12's wayvnc 0.5 only offers VeNCrypt-X509Plain when auth
      // is on, and noVNC (1.7) doesn't implement X509Plain. A password
      // is configured but cannot be used until wayvnc is upgraded
      // (Ubuntu 24.04 / Debian backports / built from source).
      log.warn(
        { wayvncVersion },
        "vnc password configured but installed wayvnc lacks noVNC-compatible auth; running anonymous on loopback",
      );
    }

    await writeWayvncConfig(configFile, useAuth ? password : undefined);
    await fs.rm(path.join(this.runtimeDir, "wayvncctl"), { force: true });

    const wlEnv = await wlSessionEnv();
    const wayvncEnv = wayvncProcessEnv(wlEnv, this.runtimeDir);
    if (!wlEnv.WAYLAND_DISPLAY) {
      log.warn(
        { runtimeDir: wlEnv.XDG_RUNTIME_DIR },
        "no wayland socket found; wayvnc will likely fail (is cage running?)",
      );
    } else {
      log.info(
        { wlEnv, host: VNC_HOST, port: VNC_PORT, auth: useAuth },
        "starting wayvnc",
      );
    }

    this.wayvncLog = createWriteStream(wayvncLogPath, { flags: "a" });
    this.wayvnc = spawn(
      "wayvnc",
      ["--config", configFile, "--log-level=info", VNC_HOST, String(VNC_PORT)],
      {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: this.runtimeDir,
        env: { ...process.env, ...wayvncEnv },
      },
    );
    this.wayvnc.stdout?.on("data", (chunk) => {
      this.captureWayvncOutput(chunk);
      this.wayvncLog?.write(chunk);
    });
    this.wayvnc.stderr?.on("data", (chunk) => {
      this.captureWayvncOutput(chunk);
      this.wayvncLog?.write(chunk);
    });
    this.wayvnc.on("exit", (code, signal) => {
      this.lastError = `wayvnc exited code=${code ?? "null"} signal=${signal ?? "null"}${this.wayvncOutput ? `: ${this.wayvncOutput}` : ""}`;
      log.warn({ code, signal }, "wayvnc exited");
      this.wayvnc = undefined;
      this.websockify?.kill("SIGTERM");
      this.websockify = undefined;
      this.startedAt = undefined;
      this.wayvncLog?.end();
      this.wayvncLog = undefined;
    });
    this.wayvnc.on("error", (err) => {
      log.error({ err }, "wayvnc spawn error (is the package installed?)");
    });

    log.info({ wsHost: WS_HOST, wsPort: WS_PORT }, "starting websockify");
    this.websockifyLog = createWriteStream(websockifyLogPath, { flags: "a" });
    this.websockify = spawn(
      "websockify",
      [`${WS_HOST}:${WS_PORT}`, `${VNC_HOST}:${VNC_PORT}`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    this.websockify.stdout?.pipe(this.websockifyLog, { end: false });
    this.websockify.stderr?.pipe(this.websockifyLog, { end: false });
    this.websockify.on("exit", (code, signal) => {
      log.warn({ code, signal }, "websockify exited");
      this.websockify = undefined;
      this.websockifyLog?.end();
      this.websockifyLog = undefined;
    });
    this.websockify.on("error", (err) => {
      this.lastError = `websockify spawn error: ${err.message}`;
      log.error({ err }, "websockify spawn error (is the package installed?)");
    });

    this.startedAt = Date.now();
    this.markActive();
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!this.wayvnc) {
      throw new Error(this.lastError ?? "wayvnc exited during startup");
    }
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

  private captureWayvncOutput(chunk: Buffer | string) {
    this.wayvncOutput = `${this.wayvncOutput}${String(chunk)}`.slice(-2000).trim();
  }
}

async function readPasswordIfAvailable(
  passwordFile: string | undefined,
): Promise<string | undefined> {
  if (!passwordFile) return undefined;
  try {
    const pw = (await fs.readFile(passwordFile, "utf8")).trim();
    return pw.length > 0 ? pw : undefined;
  } catch {
    return undefined;
  }
}

async function writeWayvncConfig(
  configFile: string,
  password: string | undefined,
): Promise<void> {
  const lines = [`address=${VNC_HOST}`, `port=${VNC_PORT}`];
  if (password) {
    lines.push(`enable_auth=true`, `username=frame`, `password=${password}`);
  } else {
    lines.push(`enable_auth=false`);
  }
  const tmp = `${configFile}.tmp`;
  await fs.writeFile(tmp, lines.join("\n") + "\n", { mode: 0o600 });
  await fs.rename(tmp, configFile);
}

async function detectWayvncVersion(): Promise<string | undefined> {
  try {
    const { stdout } = await exec("wayvnc", ["--version"]);
    const m = stdout.match(/wayvnc\s+v?(\d+\.\d+\.\d+)/i);
    return m?.[1];
  } catch {
    return undefined;
  }
}

function supportsPlainAuth(version: string | undefined): boolean {
  if (!version) return false;
  const parts = version.split(".").map((s) => Number.parseInt(s, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  return major > 0 || (major === 0 && minor >= 7);
}

export function wayvncProcessEnv(
  wlEnv: Record<string, string>,
  runtimeDir: string,
): Record<string, string> {
  const env: Record<string, string> = { ...wlEnv, XDG_RUNTIME_DIR: runtimeDir };
  if (wlEnv.XDG_RUNTIME_DIR && wlEnv.WAYLAND_DISPLAY && !path.isAbsolute(wlEnv.WAYLAND_DISPLAY)) {
    env.WAYLAND_DISPLAY = path.join(wlEnv.XDG_RUNTIME_DIR, wlEnv.WAYLAND_DISPLAY);
  }
  return env;
}
