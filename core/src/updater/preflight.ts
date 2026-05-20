import { spawn } from "node:child_process";
import path from "node:path";
import { sub } from "../util/logger.js";

const log = sub("updater.preflight");

// SPEC §5.2 step 7 / §5.8: boot the staged release on port 8081 with CDP
// disabled, poll /healthz, then kill it. If we can't get a healthy response
// inside the window, the apply aborts before the symlink swap so the live
// installation is never touched.
export async function preflightCheck(opts: {
  stagingDir: string;
  port?: number;
  windowSec?: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const port = opts.port ?? 8081;
  const windowMs = (opts.windowSec ?? 30) * 1000;
  const entry = path.join(opts.stagingDir, "core", "dist", "index.js");

  log.info({ entry, port }, "starting staged release for pre-flight");
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      FRAME_PORT: String(port),
      FRAME_DISABLE_CDP: "1",
      // Keep the staged process from poking real /etc/frame state. The
      // staged migrations have run by this point, but we don't want this
      // throwaway process attaching to the live MQTT broker or competing
      // for the runtime dir.
      FRAME_HA_DISABLE: "1",
      FRAME_RUNTIME_DIR: path.join(opts.stagingDir, ".preflight"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderrChunks: Buffer[] = [];
  child.stderr?.on("data", (b: Buffer) => stderrChunks.push(b));

  const cleanup = () => {
    if (child.exitCode == null && !child.killed) {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode == null) child.kill("SIGKILL");
      }, 2000);
    }
  };

  try {
    const deadline = Date.now() + windowMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/healthz`, {
          signal: AbortSignal.timeout(1500),
        });
        if (res.ok) {
          const body = (await res.json()) as { ok?: boolean; safe_mode?: boolean };
          if (body.ok && !body.safe_mode) {
            log.info("pre-flight healthy");
            return { ok: true };
          }
          // Staging running in safe mode means the new release's config
          // schema rejects the existing on-disk config — that's a
          // forwards-incompat we should fail closed on.
          if (body.safe_mode) {
            return { ok: false, reason: "preflight_safe_mode" };
          }
        }
      } catch {
        // not up yet
      }
      if (child.exitCode != null) {
        const err = Buffer.concat(stderrChunks).toString("utf8").slice(-400);
        return { ok: false, reason: `preflight_exited_early: ${err.trim()}` };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return { ok: false, reason: "preflight_timeout" };
  } finally {
    cleanup();
  }
}
