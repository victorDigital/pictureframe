import EventEmitter from "node:events";
import WebSocket from "ws";
import { sub } from "../util/logger.js";

const log = sub("cdp.transport");

// CDP-over-WebSocket transport. Connects to the chromium spawned by
// cage (--remote-debugging-port=9222 on 127.0.0.1). Same wire protocol
// as PipeTransport (JSON messages with id/method/params), but messages
// are framed by the WS layer rather than NUL-terminated.

export class WsTransport extends EventEmitter {
  private nextId = 1;
  private inflight = new Map<number, { resolve: (msg: unknown) => void; reject: (err: Error) => void }>();
  private closed = false;

  static async connect(host: string, port: number, timeoutMs = 30_000): Promise<WsTransport> {
    const deadline = Date.now() + timeoutMs;
    let lastErr: unknown = null;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://${host}:${port}/json/version`);
        if (res.ok) {
          const info = (await res.json()) as { webSocketDebuggerUrl?: string };
          if (!info.webSocketDebuggerUrl) {
            throw new Error("no webSocketDebuggerUrl in /json/version");
          }
          return await WsTransport.open(info.webSocketDebuggerUrl);
        }
      } catch (err) {
        lastErr = err;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(
      `chromium CDP not reachable at ${host}:${port} within ${timeoutMs}ms: ${String(lastErr)}`,
    );
  }

  private static open(url: string): Promise<WsTransport> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { perMessageDeflate: false });
      const onError = (err: Error) => {
        ws.off("open", onOpen);
        reject(err);
      };
      const onOpen = () => {
        ws.off("error", onError);
        resolve(new WsTransport(ws));
      };
      ws.once("open", onOpen);
      ws.once("error", onError);
    });
  }

  private constructor(private ws: WebSocket) {
    super();
    ws.on("message", (data) => this.onMessage(data.toString()));
    ws.on("close", () => {
      this.closed = true;
      this.rejectInflight(new Error("CDP transport closed"));
      this.emit("close");
    });
    ws.on("error", (err) => this.emit("error", err));
  }

  private onMessage(text: string) {
    let msg: {
      id?: number;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { message?: string };
      sessionId?: string;
    };
    try {
      msg = JSON.parse(text);
    } catch (err) {
      log.error({ err }, "could not parse CDP message");
      return;
    }
    if (typeof msg.id === "number" && this.inflight.has(msg.id)) {
      const resolver = this.inflight.get(msg.id)!;
      this.inflight.delete(msg.id);
      resolver.resolve(msg);
    } else if (msg.method) {
      this.emit("event", msg);
    }
  }

  send<R = unknown>(method: string, params?: unknown, sessionId?: string): Promise<R> {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("CDP transport is not open"));
    }
    const id = this.nextId++;
    const payload: Record<string, unknown> = { id, method };
    if (params !== undefined) payload.params = params;
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.inflight.set(id, {
        resolve: (raw) => {
          const m = raw as { error?: { message?: string }; result?: R };
          if (m.error) reject(new Error(m.error.message ?? "CDP error"));
          else resolve((m.result ?? {}) as R);
        },
        reject,
      });
      this.ws.send(JSON.stringify(payload), (err) => {
        if (!err) return;
        this.inflight.delete(id);
        reject(err);
      });
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }

  private rejectInflight(err: Error) {
    for (const [, pending] of this.inflight) pending.reject(err);
    this.inflight.clear();
  }
}
