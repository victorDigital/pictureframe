import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

const exec = promisify(execFile);
const log = sub("updater");

export type UpdaterStatus = {
  current: string;
  available?: { tag: string; firstSeenAt: string; appliedAfter: string; prerelease: boolean };
  lastResult?: "success" | "failed" | "rolled_back";
  lastError?: string;
  busy: boolean;
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

  constructor(
    private store: ConfigStore,
    private currentVersion: string,
  ) {
    this.gh = new GitHubClient(store.current.config.updater.repo);
    this.status_ = {
      current: currentVersion,
      busy: false,
      channel: store.current.config.updater.channel,
      autoApply: store.current.config.updater.auto_apply,
      safeMode: store.isSafeMode(),
    };
  }

  status(): UpdaterStatus {
    return { ...this.status_, busy: this.busy };
  }

  start() {
    if (this.store.isSafeMode()) {
      log.warn("safe mode: updater disabled");
      return;
    }
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
      const release = await this.gh.latestForChannel(cfg.channel);
      if (!release) return;
      if (release.tag === this.currentVersion) {
        this.status_.available = undefined;
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
      }
    } catch (err) {
      log.error({ err }, "poll failed");
    }
  }

  async applyAvailable(opts: { force: boolean }) {
    if (!this.status_.available) throw new Error("no_release_available");
    const cfg = this.store.current.config.updater;
    const appliedAfter = new Date(this.status_.available.appliedAfter);
    if (!opts.force && appliedAfter > new Date()) {
      throw new Error(`staging_delay_active until ${appliedAfter.toISOString()}`);
    }
    const release = await this.gh.latestForChannel(cfg.channel);
    if (!release || release.tag !== this.status_.available.tag) {
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
      await fs.mkdir(paths.runtimeDir, { recursive: true });
      await this.gh.downloadTarball(release.tarballUrl, tarballPath);

      // Optional GPG signature verification.
      const cfg = this.store.current.config.updater;
      if (cfg.signing_key_file) {
        if (!release.signatureAssetUrl) {
          throw new Error("signing_required_but_asset_missing");
        }
        await this.verifySignature(tarballPath, release.signatureAssetUrl, cfg.signing_key_file);
      }

      await fs.rm(staging, { recursive: true, force: true });
      await fs.mkdir(staging, { recursive: true });
      await tar.x({ file: tarballPath, cwd: staging, strip: 1 });

      const history = await loadHistory(historyFile);
      const migrations = await discoverMigrations(path.join(staging, "migrations"));
      const integrity = await verifyHistoryIntegrity(history, migrations);
      if (!integrity.ok) {
        throw new Error(`migration_history_diverged: ${integrity.reason}`);
      }

      const snapshotDir = await snapshotConfig({
        fromTag: from,
        toTag: tag,
        configDir: "/etc/frame",
        stateDir: paths.stateDir,
        snapshotsDir: paths.snapshotsDir,
      });

      await exec("npm", ["ci", "--omit=dev"], { cwd: staging });
      await exec("npm", ["run", "build"], { cwd: staging });

      const migResult = await applyPending({
        history,
        migrations,
        historyFile,
        configPath: "/etc/frame/frame.yaml",
      });
      if (!migResult.ok) {
        throw new Error("migration_failed_or_blocked");
      }

      await fs.rename(staging, finalDest);
      await fs.symlink(finalDest, paths.current + ".new").catch(async () => {
        await fs.rm(paths.current + ".new", { force: true });
        await fs.symlink(finalDest, paths.current + ".new");
      });
      await fs.rename(paths.current + ".new", paths.current);

      await exec("sudo", ["/usr/bin/systemctl", "restart", "frame-core"]);
      const healthy = await this.waitHealthy(this.store.current.config.updater.health_check_window_sec);
      if (!healthy) {
        await this.rollbackTo(from, snapshotDir);
        this.status_.lastResult = "rolled_back";
        this.status_.lastError = "health_check_failed";
        await logUpdaterEvent({
          level: "warn",
          msg: "post-start health check failed; rolled back",
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
      await pruneSnapshots(paths.snapshotsDir, this.store.current.config.updater.retain_releases);
      await logUpdaterEvent({ level: "info", msg: "release applied", tag, from });
      return { ok: true, tag };
    } catch (err) {
      log.error({ err }, "apply failed");
      this.status_.lastResult = "failed";
      this.status_.lastError = String(err);
      await logUpdaterEvent({
        level: "error",
        msg: "apply failed",
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

  async tailLog(lines: number, subsystem?: string) {
    if (process.platform === "linux") {
      try {
        const args = ["-u", "frame-core", "-n", String(lines), "--no-pager", "--output=short"];
        const { stdout } = await exec("journalctl", args);
        let out = stdout.trimEnd().split("\n");
        if (subsystem) {
          out = out.filter((l) => l.includes(`"subsystem":"${subsystem}"`) || l.includes(subsystem));
        }
        return { lines: out };
      } catch {
        // fall through to update.log
      }
    }
    const file = path.join(paths.stateDir, "update.log");
    try {
      const data = await fs.readFile(file, "utf8");
      const all = data.trimEnd().split("\n").slice(-lines);
      if (subsystem) return { lines: all.filter((l) => l.includes(subsystem)) };
      return { lines: all };
    } catch {
      return { lines: [] as string[] };
    }
  }
}
