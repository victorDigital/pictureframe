import fs from "node:fs/promises";
import path from "node:path";
import { execFile, type ExecFileOptions } from "node:child_process";
import * as tar from "tar";
import { ConfigStore } from "../config/state.js";
import { GitHubClient, ReleaseInfo } from "./githubClient.js";
import {
  applyPending,
  discoverMigrations,
  loadHistory,
  verifyHistoryIntegrity,
} from "./migrations.js";
import {
  pruneSnapshots,
  restoreSnapshot,
  snapshotConfig,
} from "./snapshot.js";
import { paths } from "../util/paths.js";
import { sub } from "../util/logger.js";
import { logUpdaterEvent } from "./log.js";
import { Quarantine } from "./quarantine.js";
import { preflightCheck } from "./preflight.js";

const commandMaxBuffer = 64 * 1024 * 1024;
const exec = (file: string, args: string[] = [], options: ExecFileOptions = {}) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      file,
      args,
      { ...options, encoding: "utf8", maxBuffer: commandMaxBuffer },
      (err, stdout, stderr) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
const log = sub("updater");

export type UpdaterStatus = {
  current: string;
  available?: { tag: string; firstSeenAt: string; appliedAfter: string; prerelease: boolean };
  lastResult?: "success" | "failed" | "rolled_back";
  lastError?: string;
  lastWarning?: string;
  busy: boolean;
  phase: string;
  phaseDetail?: string;
  phaseStartedAt?: string;
  events: Array<{ at: string; phase: string; detail?: string; level: "info" | "warn" | "error" }>;
  channel: "stable" | "beta";
  autoApply: boolean;
  safeMode: boolean;
};

export class Updater {
  private gh: GitHubClient;
  private firstSeen: Map<string, string> = new Map();
  private status_: UpdaterStatus;
  private pollTimer?: NodeJS.Timeout;
  private busy = false;
  private quarantine: Quarantine;

  constructor(
    private store: ConfigStore,
    private currentVersion: string,
    gh?: GitHubClient,
  ) {
    this.gh = gh ?? new GitHubClient(store.current.config.updater.repo);
    this.quarantine = new Quarantine(path.join(paths.stateDir, "quarantine.json"));
    this.status_ = {
      current: currentVersion,
      busy: false,
      phase: "idle",
      events: [],
      channel: store.current.config.updater.channel,
      autoApply: store.current.config.updater.auto_apply,
      safeMode: store.isSafeMode(),
    };
  }

  quarantineList(): Array<{ tag: string; at: string; reason: string }> {
    return this.quarantine.list();
  }

  async clearQuarantine(tag?: string): Promise<number> {
    return this.quarantine.clear(tag);
  }

  status(): UpdaterStatus {
    return { ...this.status_, busy: this.busy, events: [...this.status_.events] };
  }

  start() {
    if (this.store.isSafeMode()) {
      log.warn("safe mode: updater disabled");
      return;
    }
    void this.quarantine.load();
    const intervalMs = this.store.current.config.updater.poll_interval_min * 60_000;
    void this.poll();
    this.pollTimer = setInterval(() => void this.poll(), intervalMs);
  }

  stop() {
    clearInterval(this.pollTimer);
  }

  async checkNow() {
    await this.poll();
    return this.status();
  }

  private async poll() {
    if (this.busy) return;
    const cfg = this.store.current.config.updater;
    try {
      this.setPhase("checking", `Checking ${cfg.repo} ${cfg.channel}`);
      const release = await this.gh.latestForChannel(cfg.channel);
      if (!release) {
        this.setPhase("idle", "No release found");
        return;
      }
      if (sameVersion(release.tag, this.currentVersion)) {
        this.status_.available = undefined;
        this.setPhase("idle", `Already on ${release.tag}`);
        return;
      }
      if (this.quarantine.has(release.tag)) {
        // SPEC §5.5 step 4: don't re-attempt a failed release on every poll.
        // The operator can clear it from the UI / API when they've fixed
        // whatever was wrong.
        this.status_.available = undefined;
        this.setPhase("idle", `${release.tag} is quarantined`, "warn");
        return;
      }
      const isFirstSighting = !this.firstSeen.has(release.tag);
      const seenAt = this.firstSeen.get(release.tag) ?? new Date().toISOString();
      this.firstSeen.set(release.tag, seenAt);
      if (isFirstSighting) {
        void logUpdaterEvent({
          level: "info",
          msg: "new release discovered",
          tag: release.tag,
          details: { prerelease: release.prerelease, channel: cfg.channel },
        });
      }
      const appliedAfter = new Date(
        new Date(seenAt).getTime() + cfg.staging_delay_hours * 3_600_000,
      ).toISOString();
      this.status_.available = {
        tag: release.tag,
        firstSeenAt: seenAt,
        appliedAfter,
        prerelease: release.prerelease,
      };
      if (cfg.auto_apply && new Date(appliedAfter) <= new Date()) {
        await this.applyTag(release, { force: false });
      } else {
        this.setPhase("idle", `Found ${release.tag}`);
      }
    } catch (err) {
      this.setPhase("failed", String(err), "error");
      log.error({ err }, "poll failed");
    }
  }

  async applyAvailable(opts: { force: boolean }) {
    if (!this.status_.available) throw new Error("no_release_available");
    const cfg = this.store.current.config.updater;
    const wantedTag = this.status_.available.tag;
    if (this.quarantine.has(wantedTag)) {
      throw new Error(`quarantined: ${wantedTag} — clear from /api/updates/quarantine to retry`);
    }
    const appliedAfter = new Date(this.status_.available.appliedAfter);
    if (!opts.force && appliedAfter > new Date()) {
      throw new Error(`staging_delay_active until ${appliedAfter.toISOString()}`);
    }
    const release = await this.gh.latestForChannel(cfg.channel);
    if (!release || release.tag !== wantedTag) {
      throw new Error("release_disappeared");
    }
    return this.applyTag(release, opts);
  }

  private async applyTag(release: ReleaseInfo, opts: { force: boolean }) {
    if (this.busy) throw new Error("already_applying");
    this.busy = true;
    const tag = release.tag;
    const from = this.currentVersion;
    log.info({ tag, force: opts.force }, "applying release");
    void logUpdaterEvent({ level: "info", msg: "applying release", tag, from });

    const staging = path.join(paths.releasesDir, `_staging-${tag}`);
    const finalDest = path.join(paths.releasesDir, tag);
    const tarballPath = path.join(paths.runtimeDir, `${tag}.tar.gz`);
    const historyFile = path.join(paths.stateDir, "migrations.json");

    try {
      this.status_.lastWarning = undefined;
      this.setPhase("download", `Downloading ${tag}`);
      await fs.mkdir(paths.runtimeDir, { recursive: true });
      await this.gh.downloadTarball(release.tarballUrl, tarballPath);

      // Optional GPG signature verification.
      const cfg = this.store.current.config.updater;
      if (cfg.signing_key_file) {
        this.setPhase("verify", "Verifying release signature");
        if (!release.signatureAssetUrl) {
          throw new Error("signing_required_but_asset_missing");
        }
        await this.verifySignature(tarballPath, release.signatureAssetUrl, cfg.signing_key_file);
      }

      this.setPhase("extract", `Extracting ${tag}`);
      await fs.rm(staging, { recursive: true, force: true });
      await fs.mkdir(staging, { recursive: true });
      await tar.x({ file: tarballPath, cwd: staging, strip: 1 });

      this.setPhase("migrations", "Checking migration history");
      const history = await loadHistory(historyFile);
      const migrations = await discoverMigrations(path.join(staging, "migrations"));
      const integrity = await verifyHistoryIntegrity(history, migrations);
      if (!integrity.ok) {
        throw new Error(`migration_history_diverged: ${integrity.reason}`);
      }

      this.setPhase("snapshot", "Snapshotting config");
      const snapshotDir = await snapshotConfig({
        fromTag: from,
        toTag: tag,
        configDir: "/etc/frame",
        stateDir: paths.stateDir,
        snapshotsDir: paths.snapshotsDir,
      });

      await this.ensureOsPackages(staging);

      this.setPhase("dependencies", "Installing npm dependencies");
      const buildEnv = {
        ...process.env,
        NODE_ENV: "development",
        npm_config_production: "false",
      };
      await exec("npm", ["ci", "--include=dev", "--no-audit", "--no-fund", "--loglevel=warn"], {
        cwd: staging,
        env: buildEnv,
      });
      this.setPhase("build", "Building staged release");
      await exec("npm", ["run", "build"], { cwd: staging, env: buildEnv });
      this.setPhase("prune", "Pruning dev dependencies");
      await exec("npm", ["prune", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=warn"], {
        cwd: staging,
      });

      this.setPhase("migrations", "Applying migrations");
      const migResult = await applyPending({
        history,
        migrations,
        historyFile,
        configPath: "/etc/frame/frame.yaml",
        logDir: path.join(paths.stateDir, "migrations"),
      });
      if (!migResult.ok) {
        throw new Error("migration_failed_or_blocked");
      }

      // SPEC §5.2 step 7 / §5.8: pre-flight the staged release on :8081
      // before touching `current`. If it doesn't come up healthy we never
      // restart the live frame-core.
      this.setPhase("preflight", "Starting staged release health check");
      const preflight = await preflightCheck({ stagingDir: staging });
      if (!preflight.ok) {
        throw new Error(`preflight_failed: ${preflight.reason}`);
      }

      this.setPhase("swap", "Switching current symlink");
      await fs.rename(staging, finalDest);
      await fs.symlink(finalDest, paths.current + ".new").catch(async () => {
        await fs.rm(paths.current + ".new", { force: true });
        await fs.symlink(finalDest, paths.current + ".new");
      });
      await fs.rename(paths.current + ".new", paths.current);

      this.setPhase("restart", "Restarting frame-core");
      await exec("sudo", ["/usr/bin/systemctl", "restart", "frame-core"]);
      this.setPhase("health", "Waiting for frame-core health check");
      const healthy = await this.waitHealthy(this.store.current.config.updater.health_check_window_sec);
      if (!healthy) {
        await this.rollbackTo(from, snapshotDir);
        this.status_.lastResult = "rolled_back";
        this.status_.lastError = "health_check_failed";
        await this.quarantine.add(tag, "health_check_failed");
        await logUpdaterEvent({
          level: "warn",
          msg: "post-start health check failed; rolled back and quarantined",
          tag,
          from,
        });
        return { ok: false, rolled_back: true };
      }

      this.currentVersion = tag;
      this.status_.current = tag;
      this.status_.available = undefined;
      this.status_.lastResult = "success";
      this.status_.lastError = undefined;
      this.setPhase("success", `Applied ${tag}`);
      await pruneSnapshots(paths.snapshotsDir, this.store.current.config.updater.retain_releases);
      await logUpdaterEvent({ level: "info", msg: "release applied", tag, from });
      return { ok: true, tag };
    } catch (err) {
      log.error({ err }, "apply failed");
      this.status_.lastResult = "failed";
      this.status_.lastError = String(err);
      this.setPhase("failed", String(err), "error");
      await this.quarantine.add(tag, String(err).slice(0, 200));
      this.status_.available = undefined;
      await logUpdaterEvent({
        level: "error",
        msg: "apply failed; quarantined",
        tag,
        from,
        details: String(err),
      });
      return { ok: false, error: String(err) };
    } finally {
      this.busy = false;
      await fs.rm(tarballPath, { force: true });
    }
  }

  private async ensureOsPackages(staging: string) {
    if (process.platform !== "linux") return;
    const required = await releaseOsPackages(staging);
    if (required.length === 0) return;
    const missing = await missingPackages(required);
    if (missing.length === 0) {
      this.setPhase("os-packages", "Required OS packages are present");
      return;
    }
    this.setPhase("os-packages", `Installing OS packages: ${missing.join(", ")}`);
    const helper = path.join(paths.current, "deploy", "install-os-packages.sh");
    try {
      await fs.mkdir(paths.runtimeDir, { recursive: true });
      await fs.writeFile(
        path.join(paths.runtimeDir, "os-packages.required"),
        `${missing.join("\n")}\n`,
      );
      await exec("sudo", ["-n", helper]);
      this.setPhase("os-packages", `Installed OS packages: ${missing.join(", ")}`);
      return;
    } catch (err) {
      const command = `sudo ${helper}`;
      const msg = `OS packages missing (${missing.join(", ")}). Run '${command}' once on the device, then retry the update.`;
      this.status_.lastWarning = msg;
      this.setPhase("os-packages", msg, "warn");
      await logUpdaterEvent({
        level: "warn",
        msg: "OS package install needs sudo setup",
        details: { missing, command, error: String(err) },
      });
    }
  }

  private async verifySignature(tarball: string, sigUrl: string, keyFile: string) {
    const sigPath = tarball + ".asc";
    const res = await fetch(sigUrl);
    if (!res.ok) throw new Error("signature_download_failed");
    await fs.writeFile(sigPath, Buffer.from(await res.arrayBuffer()));
    await exec("gpgv", ["--keyring", keyFile, sigPath, tarball]);
  }

  private async waitHealthy(windowSec: number): Promise<boolean> {
    const deadline = Date.now() + windowSec * 1000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch("http://127.0.0.1:8080/healthz", { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const body = (await res.json()) as { ok?: boolean };
          if (body.ok) return true;
        }
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    return false;
  }

  async rollback() {
    const snaps = await fs.readdir(paths.snapshotsDir).catch(() => [] as string[]);
    const target = snaps
      .map((n) => ({ n, m: n.match(/^(.+?)--(.+)$/) }))
      .filter((x) => x.m)
      .sort()
      .pop();
    if (!target) throw new Error("no_snapshot_available");
    const fromTag = target.m![1]!;
    await this.rollbackTo(fromTag, path.join(paths.snapshotsDir, target.n));
    this.status_.lastResult = "rolled_back";
    return { ok: true, restored: fromTag };
  }

  private async rollbackTo(fromTag: string, snapshotDir: string) {
    log.warn({ fromTag }, "rolling back");
    void logUpdaterEvent({ level: "warn", msg: "rolling back", tag: fromTag });
    const dest = path.join(paths.releasesDir, fromTag);
    await fs.rm(paths.current + ".new", { force: true });
    await fs.symlink(dest, paths.current + ".new");
    await fs.rename(paths.current + ".new", paths.current);
    await restoreSnapshot({
      snapshotDir,
      configDir: "/etc/frame",
      stateDir: paths.stateDir,
    });
    await exec("sudo", ["/usr/bin/systemctl", "restart", "frame-core"]).catch(() => {});
  }

  async tailLog(lines: number, subsystem?: string, unit?: string) {
    const safeUnit = unit && /^frame-[a-z0-9-]+$/.test(unit) ? unit : "frame-core";
    const safeLines = Math.max(1, Math.min(2000, Math.floor(Number(lines) || 200)));
    if (process.platform === "linux") {
      try {
        const args = ["-u", safeUnit, "-n", String(safeLines), "--no-pager", "--output=short-iso"];
        const { stdout } = await exec("journalctl", args);
        let out = stdout.trimEnd().split("\n").filter((l) => l.length > 0);
        if (subsystem) {
          out = out.filter(
            (l) => l.includes(`"subsystem":"${subsystem}"`) || l.includes(subsystem),
          );
        }
        return { unit: safeUnit, lines: out };
      } catch {
        // fall through to update.log
      }
    }
    const file = path.join(paths.stateDir, "update.log");
    try {
      const data = await fs.readFile(file, "utf8");
      const all = data.trimEnd().split("\n").slice(-safeLines);
      if (subsystem) return { unit: safeUnit, lines: all.filter((l) => l.includes(subsystem)) };
      return { unit: safeUnit, lines: all };
    } catch {
      return { unit: safeUnit, lines: [] as string[] };
    }
  }

  private setPhase(
    phase: string,
    detail?: string,
    level: "info" | "warn" | "error" = "info",
  ) {
    const at = new Date().toISOString();
    this.status_.phase = phase;
    this.status_.phaseDetail = detail;
    this.status_.phaseStartedAt = at;
    this.status_.events = [
      ...this.status_.events.slice(-19),
      { at, phase, detail, level },
    ];
    void logUpdaterEvent({ level, msg: `phase:${phase}`, details: detail });
  }
}

async function releaseOsPackages(staging: string): Promise<string[]> {
  const helper = path.join(staging, "deploy", "install-os-packages.sh");
  try {
    const { stdout } = await exec("bash", [helper, "--print"]);
    return stdout.split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

async function missingPackages(packages: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const pkg of packages) {
    try {
      await exec("dpkg-query", ["-W", "-f=${db:Status-Abbrev}", pkg]);
    } catch {
      missing.push(pkg);
    }
  }
  return missing;
}

function sameVersion(a: string, b: string): boolean {
  return normalizeVersion(a) === normalizeVersion(b);
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}
