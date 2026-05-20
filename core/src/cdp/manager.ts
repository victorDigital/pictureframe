import EventEmitter from "node:events";
import { ChromiumProcess } from "./launcher.js";
import { PipeTransport } from "./pipeTransport.js";
import { sub } from "../util/logger.js";

const log = sub("cdp.manager");

export type TabId = string;

type TargetInfo = {
  targetId: string;
  url: string;
  type: string;
  attached: boolean;
};

export class CdpManager extends EventEmitter {
  private transport?: PipeTransport;
  private chromium?: ChromiumProcess;
  private targets = new Map<TabId, TargetInfo>();
  private sessions = new Map<TabId, string>();

  async start(opts: {
    chromiumBin?: string;
    shellUrl: string;
    userDataDir?: string;
  }) {
    this.chromium = new ChromiumProcess({
      chromiumBin: opts.chromiumBin,
      startUrl: opts.shellUrl,
      userDataDir: opts.userDataDir,
    });
    const { writeFd, readFd } = this.chromium.start();
    this.transport = new PipeTransport(writeFd, readFd);
    this.transport.on("event", (m) => this.onEvent(m as never));
    this.chromium.on("exit", () => this.emit("chromium_exit"));

    await this.transport.send("Target.setDiscoverDiscoveryEnabled", { discover: true });
    const { targetInfos } = await this.transport.send<{ targetInfos: TargetInfo[] }>(
      "Target.getTargets",
    );
    for (const t of targetInfos) {
      if (t.type === "page") {
        this.targets.set(t.targetId, t);
        await this.attach(t.targetId);
      }
    }
    log.info({ tabs: this.targets.size }, "CDP attached");
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
    }
    this.emit("cdp_event", msg);
  }

  private async attach(targetId: string) {
    const { sessionId } = await this.transport!.send<{ sessionId: string }>(
      "Target.attachToTarget",
      { targetId, flatten: true },
    );
    this.sessions.set(targetId, sessionId);
    await this.send(targetId, "Page.enable");
    await this.send(targetId, "Runtime.enable");
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

  async navigate(tabId: TabId, url: string) {
    await this.send(tabId, "Page.navigate", { url });
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
    await this.chromium?.stop();
  }
}
