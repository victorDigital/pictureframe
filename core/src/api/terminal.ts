import os from "node:os";
import type { IPty } from "node-pty";
import { sub } from "../util/logger.js";

const log = sub("terminal");

export interface TerminalSocket {
  send(data: Buffer | string): void;
  close(): void;
  on(event: "message", cb: (data: Buffer, isBinary: boolean) => void): void;
  on(event: "close", cb: () => void): void;
}

export type TerminalOptions = {
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
};

// Anyone with the bearer token can open /api/terminal and gets an
// interactive shell as the uid frame-core is running under (typically
// "frame"). The frame user has a narrow sudoers fragment
// (see deploy/sudoers.d/frame) — calls to those commands succeed without
// a password, everything else requires a password the operator never set.
// systemd's NoNewPrivileges + ProtectSystem hardening on the unit also
// constrain what the spawned shell can do. There is intentionally no
// extra authentication beyond the bearer token; rotating the token via
// /api/settings/rotate_bearer revokes existing terminals on next message.
export class TerminalSession {
  private pty?: IPty;
  private closed = false;

  constructor(
    private socket: TerminalSocket,
    private opts: TerminalOptions = {},
  ) {}

  async start() {
    const pty = await import("node-pty");
    const shell = this.opts.shell ?? process.env.SHELL ?? "/bin/bash";
    const cwd = this.opts.cwd ?? process.env.HOME ?? os.homedir() ?? "/";
    const cols = clampDim(this.opts.cols, 80);
    const rows = clampDim(this.opts.rows, 24);

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") env[k] = v;
    }
    env.TERM = "xterm-256color";
    env.COLORTERM = "truecolor";
    env.LANG = env.LANG ?? "C.UTF-8";
    delete env.NODE_OPTIONS;

    log.info({ shell, cwd, cols, rows, uid: process.getuid?.() }, "spawn pty");

    this.pty = pty.spawn(shell, ["-l"], {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env,
    });

    this.pty.onData((chunk: string) => {
      if (this.closed) return;
      try {
        this.socket.send(Buffer.from(chunk, "utf8"));
      } catch (err) {
        log.warn({ err }, "send failed");
      }
    });

    this.pty.onExit(({ exitCode, signal }) => {
      if (this.closed) return;
      log.info({ exitCode, signal }, "pty exited");
      try {
        this.socket.send(
          Buffer.from(`\r\n[terminal exited: code=${exitCode} signal=${signal ?? "none"}]\r\n`, "utf8"),
        );
      } catch {
        // socket may already be gone
      }
      this.closed = true;
      try {
        this.socket.close();
      } catch {
        // socket may already be gone
      }
    });

    this.socket.on("message", (data, isBinary) => this.handleMessage(data, isBinary));
    this.socket.on("close", () => this.dispose());
  }

  // Wire protocol: text frames are JSON control messages
  //   {"type":"resize","cols":N,"rows":N}
  //   {"type":"ping"}
  // Binary frames are raw stdin bytes piped straight into the pty.
  // Keeping these on separate frame types means a stray JSON-looking
  // string the user types ("{}" at a prompt) never gets reinterpreted
  // as control.
  private handleMessage(data: Buffer, isBinary: boolean) {
    if (this.closed || !this.pty) return;
    if (isBinary) {
      this.pty.write(data.toString("utf8"));
      return;
    }
    let msg: { type?: string; cols?: number; rows?: number } | null = null;
    try {
      msg = JSON.parse(data.toString("utf8"));
    } catch {
      // Some browsers send keystrokes as text frames; treat anything
      // that doesn't parse as JSON as stdin too.
      this.pty.write(data.toString("utf8"));
      return;
    }
    if (msg && msg.type === "resize") {
      const cols = clampDim(msg.cols, 80);
      const rows = clampDim(msg.rows, 24);
      try {
        this.pty.resize(cols, rows);
      } catch (err) {
        log.warn({ err, cols, rows }, "resize failed");
      }
    }
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.pty?.kill();
    } catch (err) {
      log.warn({ err }, "pty kill failed");
    }
    this.pty = undefined;
  }
}

function clampDim(v: unknown, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
  if (n < 1) return 1;
  if (n > 1000) return 1000;
  return n;
}
