import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type SpawnOptions } from "node:child_process";

export type RunCommandOptions = Pick<SpawnOptions, "cwd" | "env"> & {
  logName?: string;
};

const memoryTailBytes = 32 * 1024;

function commandLogDir() {
  return path.join(process.env.FRAME_STATE_DIR ?? "/opt/frame/state", "update-commands");
}

export async function runCommand(
  file: string,
  args: string[] = [],
  options: RunCommandOptions = {},
): Promise<{ stdout: string; stderr: string; logPath: string }> {
  const logDir = commandLogDir();
  await fs.mkdir(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.basename(file).replace(/[^a-z0-9.-]+/gi, "-") || "cmd";
  const logName = options.logName ?? `${base}-${stamp}.log`;
  const logPath = path.join(logDir, logName);
  const handle = await fs.open(logPath, "w");
  await handle.write(`$ ${file} ${args.join(" ")}\n`);

  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutTail = "";
    let stderrTail = "";

    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      void handle.write(chunk);
      const text = chunk.toString("utf8");
      if (target === "stdout") {
        stdoutTail = (stdoutTail + text).slice(-memoryTailBytes);
      } else {
        stderrTail = (stderrTail + text).slice(-memoryTailBytes);
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.on("error", async (err) => {
      await handle.close().catch(() => {});
      reject(err);
    });
    child.on("close", async (code, signal) => {
      await handle.close().catch(() => {});
      if (code === 0) {
        resolve({ stdout: stdoutTail, stderr: stderrTail, logPath });
        return;
      }
      const detail = stderrTail || stdoutTail;
      reject(
        new Error(
          `${file} exited ${code ?? "?"}${signal ? ` (${signal})` : ""}` +
            (detail ? `: ${detail.trim()}` : "") +
            `\nfull log: ${logPath}`,
        ),
      );
    });
  });
}
