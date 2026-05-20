import fs from "node:fs/promises";
import path from "node:path";
import { sub } from "../util/logger.js";

const log = sub("updater.snapshot");

const SNAPSHOT_FILES = ["frame.yaml", "screens.yaml", "migrations.json"];

export async function snapshotConfig(opts: {
  fromTag: string;
  toTag: string;
  configDir: string;
  stateDir: string;
  snapshotsDir: string;
}): Promise<string> {
  const dir = path.join(opts.snapshotsDir, `${opts.fromTag}--${opts.toTag}`);
  await fs.mkdir(dir, { recursive: true });
  for (const name of SNAPSHOT_FILES) {
    const candidates = [
      path.join(opts.configDir, name),
      path.join(opts.stateDir, name),
    ];
    for (const c of candidates) {
      try {
        await fs.copyFile(c, path.join(dir, name));
        break;
      } catch {
        // not found at this location; try next
      }
    }
  }
  log.info({ dir }, "config snapshot written");
  return dir;
}

export async function restoreSnapshot(opts: {
  snapshotDir: string;
  configDir: string;
  stateDir: string;
}) {
  for (const name of SNAPSHOT_FILES) {
    const src = path.join(opts.snapshotDir, name);
    try {
      await fs.access(src);
    } catch {
      continue;
    }
    const dest =
      name === "migrations.json"
        ? path.join(opts.stateDir, name)
        : path.join(opts.configDir, name);
    await fs.copyFile(src, dest);
  }
  log.info({ dir: opts.snapshotDir }, "snapshot restored");
}

export async function pruneSnapshots(snapshotsDir: string, keep: number) {
  const entries = await fs.readdir(snapshotsDir).catch(() => [] as string[]);
  const withTimes = await Promise.all(
    entries.map(async (name) => ({
      name,
      mtime: (await fs.stat(path.join(snapshotsDir, name))).mtimeMs,
    })),
  );
  const sorted = withTimes.sort((a, b) => b.mtime - a.mtime);
  for (const ent of sorted.slice(keep)) {
    await fs.rm(path.join(snapshotsDir, ent.name), { recursive: true, force: true });
  }
}
