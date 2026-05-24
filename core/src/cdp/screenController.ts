import { Screen } from "../config/schema.js";
import { CdpManager, TabId } from "./manager.js";
import { ShellBus } from "../api/shellBus.js";
import { sub } from "../util/logger.js";

const log = sub("cdp.screenController");

type PreloadedTab = { tabId: TabId; lastUsed: number };

export class ScreenController {
  private urlTabs = new Map<string, PreloadedTab>();
  private shellTabId?: TabId;
  private current?: Screen;
  private maxPreloaded: number;

  get currentScreen(): Screen | undefined {
    return this.current;
  }

  constructor(
    private cdp: CdpManager,
    private shell: ShellBus,
    opts: { maxPreloaded: number; shellUrl: string },
  ) {
    this.maxPreloaded = opts.maxPreloaded;
  }

  setShellTab(tabId: TabId) {
    this.shellTabId = tabId;
  }

  registerScreens(screens: Screen[]) {
    const preloadable = screens.filter((s) => s.type === "url" && s.preload);
    const first = preloadable.slice(0, this.maxPreloaded);
    for (const s of first) {
      if (!this.urlTabs.has(s.id)) void this.preload(s);
    }
  }

  private async preload(screen: Screen) {
    if (this.urlTabs.size >= this.maxPreloaded) this.evictOldest();
    try {
      const tabId = await this.cdp.newTab(screen.source);
      this.urlTabs.set(screen.id, { tabId, lastUsed: Date.now() });
      log.info({ id: screen.id, tabId }, "preloaded url screen");
    } catch (err) {
      log.error({ err, id: screen.id }, "preload failed");
    }
  }

  private evictOldest() {
    let oldestId: string | undefined;
    let oldestUsed = Infinity;
    for (const [id, info] of this.urlTabs) {
      if (id === this.current?.id) continue;
      if (info.lastUsed < oldestUsed) {
        oldestUsed = info.lastUsed;
        oldestId = id;
      }
    }
    if (oldestId) {
      const t = this.urlTabs.get(oldestId)!;
      this.urlTabs.delete(oldestId);
      void this.cdp.closeTab(t.tabId);
    }
  }

  async show(target: Screen, transitionMs = 600): Promise<void> {
    const previous = this.current;
    log.info({ from: previous?.id, to: target.id }, "show screen");

    if (target.type === "builtin") {
      this.shell.send({ type: "preload_builtin", screen: target });
    }

    // When CDP isn't connected (FRAME_DISABLE_CDP=1 or chromium failed to
    // attach), URL screens render as iframes inside the shell instead of
    // separate chromium tabs. Frame-busting sites will refuse to load
    // this way — that's the SPEC §4.1 tradeoff.
    if (target.type === "url" && !this.cdp.isConnected()) {
      this.shell.send({ type: "preload_url", screen: target });
      this.shell.send({ type: "show_url", id: target.id, transitionMs });
      this.shell.send({ type: "hide_overlay", transitionMs });
      this.current = target;
      return;
    }

    const overlay = await this.captureOverlay(previous);
    if (overlay) {
      this.shell.send({ type: "show_overlay_image", dataUrl: overlay, transitionMs: 0 });
    }

    if (this.shellTabId) await this.cdp.activate(this.shellTabId);

    if (target.type === "url") {
      let tab = this.urlTabs.get(target.id);
      if (!tab) {
        const tabId = await this.cdp.newTab(target.source);
        tab = { tabId, lastUsed: Date.now() };
        this.urlTabs.set(target.id, tab);
        // SPEC §4.5: hold the overlay up to 4 s; if the URL hasn't fired
        // `load` within 1.5 s, show a Loading hint over it so the device
        // doesn't look frozen during a cold start.
        const hintTimer = setTimeout(() => {
          this.shell.send({ type: "show_loading_hint", label: target.name });
        }, 1500);
        const loaded = await this.cdp.waitForLoad(tabId, 4000);
        clearTimeout(hintTimer);
        this.shell.send({ type: "hide_loading_hint" });
        if (!loaded) log.warn({ id: target.id }, "url screen did not fire load in 4s; activating anyway");
      }
      tab.lastUsed = Date.now();
      await this.cdp.activate(tab.tabId);
      this.shell.send({ type: "hide_overlay", transitionMs });
    } else {
      this.shell.send({ type: "show_builtin", id: target.id, transitionMs });
      this.shell.send({ type: "hide_overlay", transitionMs });
    }

    this.current = target;
  }

  private async captureOverlay(previous?: Screen): Promise<string | undefined> {
    if (!previous) return undefined;
    if (previous.type === "builtin") return undefined;
    const tab = this.urlTabs.get(previous.id);
    if (!tab) return undefined;
    try {
      return await this.cdp.screenshot(tab.tabId);
    } catch (err) {
      log.warn({ err }, "screenshot failed; transitioning without overlay");
      return undefined;
    }
  }

  async testUrlScreen(screen: Screen): Promise<{
    ok: boolean;
    httpStatus?: number;
    finalUrl?: string;
    loaded: boolean;
    consoleErrors: string[];
    screenshot?: string;
    error?: string;
  }> {
    if (screen.type !== "url") {
      return { ok: false, loaded: false, consoleErrors: [], error: "not_a_url_screen" };
    }
    let tabId: string | undefined;
    try {
      const headRes = await fetch(screen.source, { method: "HEAD", redirect: "follow" }).catch(
        () => null,
      );
      tabId = await this.cdp.newTab(screen.source);
      const loaded = await this.cdp.waitForLoad(tabId, 10_000);
      const info = await this.cdp.getTargetInfo(tabId);
      let screenshot: string | undefined;
      try {
        screenshot = await this.cdp.screenshot(tabId);
      } catch {
        // ignore
      }
      const consoleErrors = this.cdp
        .consoleSnapshot(tabId)
        .filter((c) => c.level === "error" || c.level === "warning")
        .map((c) => c.text);
      return {
        ok: loaded,
        httpStatus: headRes?.status,
        finalUrl: info?.url ?? screen.source,
        loaded,
        consoleErrors,
        screenshot,
      };
    } catch (err) {
      return { ok: false, loaded: false, consoleErrors: [], error: String(err) };
    } finally {
      if (tabId) await this.cdp.closeTab(tabId).catch(() => undefined);
    }
  }
}
