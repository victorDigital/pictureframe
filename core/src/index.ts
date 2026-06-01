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
import { KioskLifecycle } from "./system/kioskLifecycle.js";
import { HaBridge } from "./mqtt/index.js";
import { VncSupervisor } from "./system/vnc.js";
import { runCommand } from "./updater/exec.js";
import { paths } from "./util/paths.js";
import { sub, logger } from "./util/logger.js";

const log = sub("main");
const rootHelper = "/usr/local/lib/frame/root-helper";

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

function haSignature(cfg: {
  ha: { enabled: boolean; mqtt?: unknown; suggested_area?: string };
  device: { name: string };
}) {
  return JSON.stringify({
    enabled: cfg.ha.enabled,
    mqtt: cfg.ha.mqtt ?? null,
    name: cfg.device.name,
    suggested_area: cfg.ha.suggested_area ?? "",
  });
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
  const kioskLifecycle = new KioskLifecycle({
    displayPower: (state) => brightness.displayPower(state),
    restartKiosk: async () => {
      try {
        await runCommand("sudo", ["-n", rootHelper, "restart-kiosk"], {
          logName: "watchdog-restart-kiosk.log",
        });
      } catch (helperErr) {
        await runCommand("sudo", ["-n", "/usr/bin/systemctl", "restart", "frame-kiosk"], {
          logName: "watchdog-restart-kiosk-legacy.log",
        }).catch(() => {
          throw helperErr;
        });
      }
    },
  });
  const updater = new Updater(store, version);
  const vnc = new VncSupervisor(store.current.config.vnc?.password_file);

  function sendDisplayGeometry() {
    const display = store.current.config.display;
    shell.send({
      type: "set_display_geometry",
      scale: display.scale ?? 1,
      orientation: display.orientation ?? "normal",
    });
  }

  function clearShellDisplayGeometry() {
    shell.send({ type: "set_display_geometry", scale: 1, orientation: "normal" });
  }

  async function applyDisplayGeometry() {
    sendDisplayGeometry();
    const applied = await brightness.applyDisplayConfig();
    if (applied) clearShellDisplayGeometry();
  }

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
    kioskLifecycle.activeScreenChanged({
      id: screen.id,
      type: screen.type,
      renderedByShell: screen.type === "builtin" || !cdp.isConnected(),
    });
    screens.show(screen, screen.transitionMs ?? 600).catch((err) => {
      log.error({ err, screen: screen.id }, "screen show failed");
      kioskLifecycle.screenShowFailed(screen.id);
    });
    void pushState(screen.id);
  });

  let lastDefaultScreen = store.current.config.default_screen;
  let lastHaSig = haSignature(store.current.config);

  store.on("reloaded", (state) => {
    scheduler.setScreens(state.screens);
    screens.registerScreens(state.screens);

    const cfg = state.config;
    if (cfg.default_screen && cfg.default_screen !== lastDefaultScreen) {
      try {
        scheduler.updateDefault(cfg.default_screen);
        lastDefaultScreen = cfg.default_screen;
      } catch (err) {
        log.warn({ err }, "could not apply new default_screen");
      }
    }
    scheduler.setPinnedTimeoutHours(cfg.manual_pinned_timeout_hours);
    screens.setMaxPreloaded(cfg.scheduler.max_preloaded_url_screens);
    brightness.updateConfig(cfg);
    applyDisplayGeometry().catch((err) =>
      log.warn({ err }, "could not apply display geometry"),
    );
    vnc.updatePasswordFile(cfg.vnc?.password_file);

    if (cfg.vnc?.enabled === false) {
      vnc.stop();
    }

    const nextHaSig = haSignature(cfg);
    if (nextHaSig !== lastHaSig && process.env.FRAME_HA_DISABLE !== "1") {
      lastHaSig = nextHaSig;
      ha.updateConfig(cfg);
      ha.restart().catch((err) => log.error({ err }, "ha restart failed"));
    }
  });

  // The shell page connects asynchronously after frame-core boots. Any
  // show_builtin / preload_builtin sent before the WebSocket attached
  // gets dropped by ShellBus (it has no sink yet). When the shell first
  // attaches, replay whatever the scheduler picked as the active screen
  // so the iframe activates.
  shell.on("connect", () => {
    kioskLifecycle.shellConnected();
    applyDisplayGeometry().catch((err) =>
      log.warn({ err }, "could not apply display geometry"),
    );
    const active = screens.currentScreen;
    if (active) {
      kioskLifecycle.activeScreenChanged({
        id: active.id,
        type: active.type,
        renderedByShell: active.type === "builtin" || !cdp.isConnected(),
      });
      screens.show(active, 0).catch((err) => {
        log.error({ err, screen: active.id }, "screen replay failed");
        kioskLifecycle.screenShowFailed(active.id);
      });
    }
  });
  shell.on("disconnect", () => kioskLifecycle.shellDisconnected());
  shell.on("message", (msg) => {
    if (msg.type === "heartbeat") kioskLifecycle.shellHeartbeat(msg.visible);
  });

  let cdpReconnectTimer: NodeJS.Timeout | undefined;
  let cdpConnecting = false;

  function scheduleCdpConnect(delayMs: number) {
    if (process.env.FRAME_DISABLE_CDP === "1" || cdpReconnectTimer || cdpConnecting) return;
    cdpReconnectTimer = setTimeout(() => {
      cdpReconnectTimer = undefined;
      void connectCdp();
    }, delayMs);
    cdpReconnectTimer.unref();
  }

  async function connectCdp() {
    if (process.env.FRAME_DISABLE_CDP === "1" || cdp.isConnected() || cdpConnecting) return;
    cdpConnecting = true;
    let retry = false;
    try {
      await cdp.start({ shellUrl: "http://127.0.0.1:8080/shell/" });
      const shellTab = cdp.shellTab();
      if (shellTab) screens.setShellTab(shellTab);
      screens.registerScreens(store.current.screens);
    } catch (err) {
      log.error({ err }, "CDP failed to start; URL screens limited to iframe mode");
      retry = true;
    } finally {
      cdpConnecting = false;
      if (retry) scheduleCdpConnect(15_000);
    }
  }

  cdp.on("chromium_exit", () => {
    screens.resetTabs();
    kioskLifecycle.chromiumExited();
    scheduleCdpConnect(5000);
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
  applyDisplayGeometry().catch((err) =>
    log.warn({ err }, "could not apply display geometry"),
  );

  // Always start the scheduler so the clock comes up immediately; CDP
  // connects to cage's chromium asynchronously and is required only for
  // URL-screen tab management. If CDP never becomes ready, URL screens
  // fall back to the iframe path (see ScreenController.show).
  scheduler.start();

  if (process.env.FRAME_DISABLE_CDP !== "1") {
    void connectCdp();
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
    kioskLifecycle.stop();
    if (cdpReconnectTimer) clearTimeout(cdpReconnectTimer);
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
