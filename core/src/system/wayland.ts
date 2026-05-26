import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import { promisify } from "node:util";

const exec = promisify(execFile);

export async function wlSessionEnv(): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  const runtimeDir = await findFrameRuntimeDir();
  if (runtimeDir) {
    env.XDG_RUNTIME_DIR = runtimeDir;
    const socket = await findWaylandSocket(runtimeDir);
    if (socket) env.WAYLAND_DISPLAY = socket;
  }
  return env;
}

async function findFrameRuntimeDir(): Promise<string | undefined> {
  if (process.env.XDG_RUNTIME_DIR) {
    try {
      const st = await fs.stat(process.env.XDG_RUNTIME_DIR);
      if (st.isDirectory()) return process.env.XDG_RUNTIME_DIR;
    } catch {
    }
  }
  try {
    const userInfo = os.userInfo();
    if (userInfo.uid >= 0) {
      const dir = `/run/user/${userInfo.uid}`;
      const st = await fs.stat(dir);
      if (st.isDirectory()) return dir;
    }
  } catch {
  }
  try {
    const { stdout } = await exec("id", ["-u", "frame"]);
    const uid = stdout.trim();
    if (uid) {
      const dir = `/run/user/${uid}`;
      const st = await fs.stat(dir);
      if (st.isDirectory()) return dir;
    }
  } catch {
  }
  return undefined;
}

async function findWaylandSocket(runtimeDir: string): Promise<string | undefined> {
  try {
    const entries = await fs.readdir(runtimeDir);
    const candidates = entries.filter(
      (n) => /^wayland-\d+$/.test(n) && !n.endsWith(".lock"),
    );
    candidates.sort();
    return candidates[0];
  } catch {
    return undefined;
  }
}
