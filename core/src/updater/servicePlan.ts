import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const kioskRestartPaths = [
  "builtin-screens",
  "deploy/cursor",
  "deploy/launch-chromium.sh",
  "deploy/systemd/frame-kiosk.service",
  "kiosk",
];

export type ReleaseServicePlan = {
  restartCore: true;
  restartKiosk: boolean;
  changedKioskPaths: string[];
};

export async function planReleaseServices(
  currentRelease: string,
  nextRelease: string,
): Promise<ReleaseServicePlan> {
  const changedKioskPaths: string[] = [];
  for (const rel of kioskRestartPaths) {
    const [currentHash, nextHash] = await Promise.all([
      hashPath(path.join(currentRelease, rel)),
      hashPath(path.join(nextRelease, rel)),
    ]);
    if (currentHash !== nextHash) changedKioskPaths.push(rel);
  }
  return {
    restartCore: true,
    restartKiosk: changedKioskPaths.length > 0,
    changedKioskPaths,
  };
}

async function hashPath(target: string): Promise<string> {
  const stat = await fs.stat(target).catch(() => undefined);
  if (!stat) return "missing";
  if (stat.isFile()) {
    return hashBuffer(await fs.readFile(target));
  }
  if (!stat.isDirectory()) return `${stat.mode}:${stat.size}`;
  const entries = await collectFiles(target, target);
  const hash = crypto.createHash("sha256");
  for (const entry of entries) {
    hash.update(entry.rel);
    hash.update("\0");
    hash.update(await fs.readFile(entry.abs));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function collectFiles(root: string, dir: string): Promise<Array<{ rel: string; abs: string }>> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: Array<{ rel: string; abs: string }> = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, abs)));
    } else if (entry.isFile()) {
      files.push({ rel: path.relative(root, abs), abs });
    }
  }
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

function hashBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
