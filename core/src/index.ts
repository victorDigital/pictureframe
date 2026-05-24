import fs from "node:fs/promises";
import path from "node:path";
import { ConfigStore } from "./config/state.js";
import { loadAll } from "./config/load.js";
import { Scheduler } from "./scheduler/index.js";
import { CronEngine } from "./scheduler/cron.js";
import { RuleStore } from "./scheduler/rules.js";
import { CdpManager } from "./cdp/manager.js";
import { ScreenController } from "./cdp/screenController.js";
import { ShellBus } from "./api/shellBus.js";
import { StateBus } from "./api/stateBus.js";
import { startServer } from "./api/server.js";
import { FamilyMessages } from "./api/familyMessage.js";
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
      await fs.readFile(path.resolve(process.cwd(), "package.json"), "utf8"),
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
  const stateBus = new StateBus();
  const cdp = new CdpManager();
  const screens = new ScreenController(cdp, shell, {
    maxPreloaded: store.current.config.scheduler.max_preloaded_url_screens,
    shellUrl: "http://127.0.0.1:8080/shell/",
  });

  const cronEngine = new CronEngine(scheduler);
  const rulesFile = path.join(path.dirname(paths.configFile), "rules.yaml");
  const rules = new RuleStore(rulesFile, cronEngine);
  await rules.load();

  const family = new FamilyMessages(scheduler);
  const brightness = new Brightness(store.current.config);
  const updater = new Updater(store, version);
  const vnc = new VncSupervisor(store.current.config.vnc?.password_file);

  async function pushState(activeId: string | null) {
    let brightnessValue: number | null = null;
    try {
      brightnessValue = await brightness.read();
    } catch {
      // brightness readout can fail before udev rules are loaded; that
      // shouldn't suppress the push
    }
    stateBus.broadcast({
      type: "state",
      payload: {
        active: activeId,
        claims: scheduler.list(),
        brightness: brightnessValue,
        update: updater.status(),
      },
    });
  }

  scheduler.on("activate", (screen, claim) => {
    log.info({ screen: screen.id, claim: claim.claimId }, "scheduler activate");
    screens.show(screen, screen.transitionMs ?? 600).catch((err) =>
      log.error({ err, screen: screen.id }, "screen show failed"),
    );
    void pushState(screen.id);
  });

  store.on("reloaded", (state) => {
    scheduler.setScreens(state.screens);
    screens.registerScreens(state.screens);
  });

  // The shell page connects asynchronously after frame-core boots. Any
  // show_builtin / preload_builtin sent before the WebSocket attached
  // gets dropped by ShellBus (it has no sink yet). When the shell first
  // attaches, replay whatever the scheduler picked as the active screen
  // so the iframe activates.
  shell.on("connect", () => {
    const active = screens.currentScreen;
    if (active) {
      screens.show(active, 0).catch((err) =>
        log.error({ err, screen: active.id }, "screen replay failed"),
      );
    }
  });

  const ha = new HaBridge(store.current.config, scheduler, updater, brightness);

  await startServer({
    configStore: store,
    scheduler,
    screens,
    shell,
    updater,
    brightness,
    cdp,
    family,
    rules,
    vnc,
    stateBus,
    version,
  });

  brightness.write(store.current.config.display.default_brightness).catch((err) =>
    log.warn({ err }, "could not apply default brightness"),
  );

  // Always start the scheduler so the clock comes up immediately; CDP
  // connects to cage's chromium asynchronously and is required only for
  // URL-screen tab management. If CDP never becomes ready, URL screens
  // fall back to the iframe path (see ScreenController.show).
  scheduler.start();

  if (process.env.FRAME_DISABLE_CDP !== "1") {
    cdp
      .start({ shellUrl: "http://127.0.0.1:8080/shell/" })
      .then(() => {
        const shellTab = cdp.shellTab();
        if (shellTab) screens.setShellTab(shellTab);
        screens.registerScreens(store.current.screens);
      })
      .catch((err) => log.error({ err }, "CDP failed to start; URL screens limited to iframe mode"));
  }

  updater.start();

  if (store.current.config.ha.enabled && process.env.FRAME_HA_DISABLE !== "1") {
    ha.start().catch((err) => log.error({ err }, "ha start failed"));
  }

  const shutdown = async (signal: string) => {
    log.warn({ signal }, "shutting down");
    ha.stop();
    updater.stop();
    cronEngine.stop();
    vnc.stop();
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
