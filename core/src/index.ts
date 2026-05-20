import fs from "node:fs/promises";
import path from "node:path";
import { ConfigStore } from "./config/state.js";
import { loadAll } from "./config/load.js";
import { Scheduler } from "./scheduler/index.js";
import { CdpManager } from "./cdp/manager.js";
import { ScreenController } from "./cdp/screenController.js";
import { ShellBus } from "./api/shellBus.js";
import { startServer } from "./api/server.js";
import { Updater } from "./updater/index.js";
import { Brightness } from "./system/brightness.js";
import { HaBridge } from "./mqtt/index.js";
import { VncSupervisor } from "./system/vnc.js";
import { paths } from "./util/paths.js";
import { sub, logger } from "./util/logger.js";

const log = sub("main");

async function readVersion(): Promise<string> {
  try {
    const pkg = JSON.parse(
      await fs.readFile(path.resolve(process.cwd(), "..", "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function main() {
  const version = await readVersion();
  log.info({ version, paths }, "frame-core starting");

  const loadResult = await loadAll(paths.configFile);
  const store = new ConfigStore(paths.configFile, loadResult);
  if (loadResult.ok) store.startWatching();

  const scheduler = new Scheduler({
    screens: store.current.screens,
    defaultScreen: store.current.config.default_screen,
    pinnedTimeoutHours: store.current.config.manual_pinned_timeout_hours,
  });

  const shell = new ShellBus();
  const cdp = new CdpManager();
  const screens = new ScreenController(cdp, shell, {
    maxPreloaded: store.current.config.scheduler.max_preloaded_url_screens,
    shellUrl: "http://127.0.0.1:8080/shell/",
  });

  scheduler.on("activate", (screen, claim) => {
    log.info({ screen: screen.id, claim: claim.claimId }, "scheduler activate");
    void screens.show(screen, screen.transitionMs ?? 600);
  });

  store.on("reloaded", (state) => {
    scheduler.setScreens(state.screens);
    screens.registerScreens(state.screens);
  });

  const brightness = new Brightness(store.current.config);
  const updater = new Updater(store, version);
  const vnc = new VncSupervisor();

  const ha = new HaBridge(store.current.config, scheduler, updater, brightness);

  await startServer({
    configStore: store,
    scheduler,
    screens,
    shell,
    updater,
    brightness,
    version,
  });

  // Apply initial brightness.
  brightness.write(store.current.config.display.default_brightness).catch((err) =>
    log.warn({ err }, "could not apply default brightness"),
  );

  // CDP is only meaningful when chromium is reachable. Failing to spawn
  // (e.g. local development on macOS) must not bring the API down.
  if (process.env.FRAME_DISABLE_CDP !== "1") {
    cdp
      .start({ shellUrl: "http://127.0.0.1:8080/shell/" })
      .then(() => {
        screens.registerScreens(store.current.screens);
        scheduler.start();
      })
      .catch((err) => log.error({ err }, "CDP failed to start; running in headless mode"));
  } else {
    scheduler.start();
  }

  updater.start();

  if (store.current.config.ha.enabled) {
    ha.start().catch((err) => log.error({ err }, "ha start failed"));
  }

  // Optional VNC on demand: HTTP `/vnc` triggers; the supervisor remains idle until then.
  void vnc;

  const shutdown = async (signal: string) => {
    log.warn({ signal }, "shutting down");
    ha.stop();
    updater.stop();
    await cdp.stop().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err }, "fatal");
  process.exit(1);
});
