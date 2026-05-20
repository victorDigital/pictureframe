import EventEmitter from "node:events";
import chokidar, { FSWatcher } from "chokidar";
import { FrameConfig, Screen } from "./schema.js";
import { LoadedConfig, loadAll } from "./load.js";
import { buildSafeMode, SafeMode } from "./safeMode.js";
import { sub } from "../util/logger.js";

const log = sub("config");

export type ConfigState = {
  config: FrameConfig;
  screens: Screen[];
  bearerToken: string;
  safeMode?: SafeMode;
};

export class ConfigStore extends EventEmitter {
  private state: ConfigState;
  private watcher?: FSWatcher;
  private reloadTimer?: NodeJS.Timeout;
  private configPath: string;
  private screensPath?: string;

  constructor(configPath: string, initial: LoadResultLike) {
    super();
    this.configPath = configPath;
    if (initial.ok) {
      this.state = {
        config: initial.loaded.config,
        screens: initial.loaded.screens,
        bearerToken: initial.loaded.bearerToken,
      };
      this.screensPath = initial.loaded.screensPath;
    } else {
      const sm = buildSafeMode(initial.reason, initial.details);
      this.state = {
        config: sm.config,
        screens: sm.screens,
        bearerToken: sm.bearerToken,
        safeMode: sm,
      };
    }
  }

  get current(): ConfigState {
    return this.state;
  }

  isSafeMode() {
    return Boolean(this.state.safeMode);
  }

  startWatching() {
    if (this.watcher) return;
    const paths = [this.configPath];
    if (this.screensPath) paths.push(this.screensPath);
    this.watcher = chokidar.watch(paths, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });
    this.watcher.on("change", (p) => {
      log.info({ path: p }, "config file changed, scheduling reload");
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => void this.reload(), 250);
    });
  }

  async reload() {
    const result = await loadAll(this.configPath);
    if (!result.ok) {
      log.error({ reason: result.reason, details: result.details }, "reload failed");
      this.emit("reloadFailed", result);
      return;
    }
    this.state = {
      config: result.loaded.config,
      screens: result.loaded.screens,
      bearerToken: result.loaded.bearerToken,
    };
    this.screensPath = result.loaded.screensPath;
    log.info(
      { screens: result.loaded.screens.length },
      "config reloaded successfully",
    );
    this.emit("reloaded", this.state);
  }

  async close() {
    clearTimeout(this.reloadTimer);
    await this.watcher?.close();
  }
}

// Avoid a circular import on the load module type.
type LoadResultLike =
  | { ok: true; loaded: LoadedConfig }
  | { ok: false; reason: string; details?: unknown };
