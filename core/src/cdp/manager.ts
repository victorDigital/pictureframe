import EventEmitter from "node:events";
import { WsTransport } from "./wsTransport.js";
import { sub } from "../util/logger.js";
import { cursorHideScript } from "./cursor.js";

const log = sub("cdp.manager");

export type TabId = string;

type TargetInfo = {
  targetId: string;
  url: string;
  type: string;
  attached: boolean;
};

export class CdpManager extends EventEmitter {
  private transport?: WsTransport;
  private targets = new Map<TabId, TargetInfo>();
  private sessions = new Map<TabId, string>();
  private loadResolvers = new Map<TabId, Array<() => void>>();
  private consoleByTab = new Map<TabId, Array<{ level: string; text: string }>>();
  private shellTabId?: TabId;

  isConnected(): boolean {
    return Boolean(this.transport);
  }

  shellTab(): TabId | undefined {
    return this.shellTabId;
  }

  async start(opts: {
    shellUrl: string;
    cdpHost?: string;
    cdpPort?: number;
  }) {
    const host = opts.cdpHost ?? process.env.FRAME_CDP_HOST ?? "127.0.0.1";
    const port = Number(opts.cdpPort ?? process.env.FRAME_CDP_PORT ?? 9222);

    log.info({ host, port }, "connecting to chromium CDP");
    this.transport = await WsTransport.connect(host, port);
    this.transport.on("event", (m) => this.onEvent(m as never));
    this.transport.on("error", (err) => log.warn({ err }, "cdp transport error"));
    this.transport.on("close", () => this.emit("chromium_exit"));

    await this.transport.send("Target.setDiscoverTargets", { discover: true });
    const { targetInfos } = await this.transport.send<{ targetInfos: TargetInfo[] }>(
      "Target.getTargets",
    );
    for (const t of targetInfos) {
      if (t.type === "page") {
        this.targets.set(t.targetId, t);
        await this.attach(t.targetId);
        if (!this.shellTabId && t.url.startsWith(opts.shellUrl)) {
          this.shellTabId = t.targetId;
        }
      }
    }
    log.info({ tabs: this.targets.size, shellTab: this.shellTabId }, "CDP attached");
  }

  private onEvent(msg: { method: string; params?: any; sessionId?: string }) {
    switch (msg.method) {
      case "Target.targetCreated": {
        const info = msg.params.targetInfo as TargetInfo;
        if (info.type === "page") this.targets.set(info.targetId, info);
        break;
      }
      case "Target.targetDestroyed": {
        this.targets.delete(msg.params.targetId);
        this.sessions.delete(msg.params.targetId);
        break;
      }
      case "Target.attachedToTarget": {
        const { sessionId, targetInfo } = msg.params;
        this.sessions.set(targetInfo.targetId, sessionId);
        break;
      }
      case "Page.loadEventFired": {
        const tabId = this.tabIdForSession(msg.sessionId);
        if (tabId) {
          const list = this.loadResolvers.get(tabId);
          if (list) {
            this.loadResolvers.delete(tabId);
            for (const r of list) r();
          }
        }
        break;
      }
      case "Runtime.consoleAPICalled": {
        const tabId = this.tabIdForSession(msg.sessionId);
        if (tabId) {
          const buf = this.consoleByTab.get(tabId) ?? [];
          buf.push({
            level: msg.params.type,
            text: (msg.params.args ?? [])
              .map((a: { value?: unknown; description?: unknown }) => a.value ?? a.description ?? "")
              .join(" "),
          });
          if (buf.length > 50) buf.shift();
          this.consoleByTab.set(tabId, buf);
        }
        break;
      }
    }
    this.emit("cdp_event", msg);
  }

  private tabIdForSession(sessionId?: string): TabId | undefined {
    if (!sessionId) return undefined;
    for (const [tabId, sid] of this.sessions) {
      if (sid === sessionId) return tabId;
    }
    return undefined;
  }

  async waitForLoad(tabId: TabId, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        const list = this.loadResolvers.get(tabId);
        if (list) {
          this.loadResolvers.set(
            tabId,
            list.filter((r) => r !== resolver),
          );
        }
        resolve(false);
      }, timeoutMs);
      const resolver = () => {
        clearTimeout(t);
        resolve(true);
      };
      const list = this.loadResolvers.get(tabId) ?? [];
      list.push(resolver);
      this.loadResolvers.set(tabId, list);
    });
  }

  consoleSnapshot(tabId: TabId): Array<{ level: string; text: string }> {
    return [...(this.consoleByTab.get(tabId) ?? [])];
  }

  private async attach(targetId: string) {
    const { sessionId } = await this.transport!.send<{ sessionId: string }>(
      "Target.attachToTarget",
      { targetId, flatten: true },
    );
    this.sessions.set(targetId, sessionId);
    await this.send(targetId, "Page.enable");
    await this.send(targetId, "Runtime.enable");
    await this.installCursorHider(targetId);
  }

  private async installCursorHider(tabId: TabId) {
    const source = cursorHideScript();
    await this.send(tabId, "Page.addScriptToEvaluateOnNewDocument", { source }).catch((err) =>
      log.warn({ err, tabId }, "cursor hide preload failed"),
    );
    await this.send(tabId, "Runtime.evaluate", { expression: source }).catch((err) =>
      log.warn({ err, tabId }, "cursor hide injection failed"),
    );
  }

  async newTab(url: string): Promise<TabId> {
    const result = await this.transport!.send<{ targetId: string }>("Target.createTarget", {
      url,
      background: true,
    });
    this.targets.set(result.targetId, {
      targetId: result.targetId,
      url,
      type: "page",
      attached: false,
    });
    await this.attach(result.targetId);
    return result.targetId;
  }

  async closeTab(tabId: TabId) {
    await this.transport!.send("Target.closeTarget", { targetId: tabId });
  }

  async activate(tabId: TabId) {
    await this.transport!.send("Target.activateTarget", { targetId: tabId });
  }

  async navigate(tabId: TabId, url: string): Promise<{ frameId?: string; loaderId?: string; errorText?: string }> {
    return this.send(tabId, "Page.navigate", { url });
  }

  async getTargetInfo(tabId: TabId): Promise<TargetInfo | undefined> {
    return this.targets.get(tabId);
  }

  async reload(tabId: TabId) {
    await this.send(tabId, "Page.reload", { ignoreCache: true });
  }

  async screenshot(tabId: TabId): Promise<string> {
    const r = await this.send<{ data: string }>(tabId, "Page.captureScreenshot", {
      format: "jpeg",
      quality: 80,
      captureBeyondViewport: false,
    });
    return `data:image/jpeg;base64,${r.data}`;
  }

  private async send<R = unknown>(tabId: TabId, method: string, params?: unknown): Promise<R> {
    const sessionId = this.sessions.get(tabId);
    if (!sessionId) throw new Error(`no session for tab ${tabId}`);
    return this.transport!.send<R>(method, params, sessionId);
  }

  async stop() {
    this.transport?.close();
    this.transport = undefined;
  }
}
