import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import YAML from "yaml";
import { sub } from "../util/logger.js";

const exec = promisify(execFile);
const log = sub("updater.migrations");

export type AppliedMigration = {
  number: number;
  name: string;
  hash: string;
  appliedAt: string;
  output?: string;
};

export type MigrationHistory = { applied: AppliedMigration[] };

export type DiscoveredMigration = {
  number: number;
  name: string;
  filePath: string;
  ext: ".sh" | ".yaml" | ".ts";
  requiresManualStep: boolean;
};

async function sha256(file: string) {
  const buf = await fs.readFile(file);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export async function loadHistory(stateFile: string): Promise<MigrationHistory> {
  try {
    return JSON.parse(await fs.readFile(stateFile, "utf8")) as MigrationHistory;
  } catch {
    return { applied: [] };
  }
}

export async function saveHistory(stateFile: string, history: MigrationHistory) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  const tmp = stateFile + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(history, null, 2));
  await fs.rename(tmp, stateFile);
}

export async function discoverMigrations(dir: string): Promise<DiscoveredMigration[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: DiscoveredMigration[] = [];
  for (const name of entries.sort()) {
    const m = name.match(/^(\d+)[-_](.+?)\.(sh|yaml|ts)$/);
    if (!m) continue;
    const filePath = path.join(dir, name);
    const txt = await fs.readFile(filePath, "utf8");
    const requiresManualStep =
      /requires_manual_step\s*[:=]\s*true/i.test(txt) ||
      (name.endsWith(".yaml") && /^requires_manual_step:\s*true/m.test(txt));
    out.push({
      number: Number(m[1]),
      name: m[2]!,
      filePath,
      ext: ("." + m[3]) as DiscoveredMigration["ext"],
      requiresManualStep,
    });
  }
  return out;
}

export async function verifyHistoryIntegrity(
  history: MigrationHistory,
  migrations: DiscoveredMigration[],
) {
  const byNumber = new Map(migrations.map((m) => [m.number, m]));
  for (const applied of history.applied) {
    const candidate = byNumber.get(applied.number);
    if (!candidate) {
      return { ok: false as const, reason: `migration ${applied.number} missing in new release` };
    }
    const hash = await sha256(candidate.filePath);
    if (hash !== applied.hash) {
      return {
        ok: false as const,
        reason: `migration ${applied.number} hash mismatch (history_diverged)`,
      };
    }
  }
  return { ok: true as const };
}

export async function applyPending(opts: {
  history: MigrationHistory;
  migrations: DiscoveredMigration[];
  historyFile: string;
  configPath: string;
  logDir?: string;
}) {
  const appliedNumbers = new Set(opts.history.applied.map((a) => a.number));
  const pending = opts.migrations
    .filter((m) => !appliedNumbers.has(m.number))
    .sort((a, b) => a.number - b.number);

  const writeMigrationLog = async (
    mig: DiscoveredMigration,
    outcome: "ok" | "failed" | "blocked",
    output: string,
  ) => {
    if (!opts.logDir) return;
    try {
      await fs.mkdir(opts.logDir, { recursive: true });
      const stamp = new Date().toISOString();
      const file = path.join(opts.logDir, `${String(mig.number).padStart(4, "0")}_${mig.name}.log`);
      const header = `[${stamp}] migration=${mig.number}-${mig.name} outcome=${outcome}\n`;
      await fs.appendFile(file, header + output + "\n");
    } catch {
      // best-effort logging
    }
  };

  for (const mig of pending) {
    if (mig.requiresManualStep) {
      log.warn({ mig: mig.name }, "migration requires manual step; stopping");
      await writeMigrationLog(mig, "blocked", `requires_manual_step=true; aborting apply`);
      return { ok: false as const, stopped: mig };
    }
    log.info({ mig: mig.name }, "applying migration");
    let output = "";
    try {
      if (mig.ext === ".sh") {
        const { stdout, stderr } = await exec("bash", [mig.filePath]);
        output = stdout + stderr;
      } else if (mig.ext === ".yaml") {
        const patch = YAML.parse(await fs.readFile(mig.filePath, "utf8")) as Record<string, unknown>;
        output = `applied yaml patch with keys: ${Object.keys(patch).join(", ")}`;
      } else {
        const { stdout, stderr } = await exec("node", [
          "--enable-source-maps",
          "--experimental-strip-types",
          mig.filePath,
        ]);
        output = stdout + stderr;
      }
    } catch (err) {
      log.error({ err, mig }, "migration failed");
      await writeMigrationLog(mig, "failed", `${err instanceof Error ? err.stack : String(err)}`);
      return { ok: false as const, failed: mig, error: String(err) };
    }
    await writeMigrationLog(mig, "ok", output);
    const hash = await sha256(mig.filePath);
    opts.history.applied.push({
      number: mig.number,
      name: mig.name,
      hash,
      appliedAt: new Date().toISOString(),
      output,
    });
    await saveHistory(opts.historyFile, opts.history);
  }
  return { ok: true as const };
}
