import EventEmitter from "node:events";
import { sub } from "../util/logger.js";

const log = sub("cdp.transport");

// CDP-over-pipe framing is null-terminated JSON messages.
const NUL = 0;

export class PipeTransport extends EventEmitter {
  private buf = Buffer.alloc(0);
  private nextId = 1;
  private inflight = new Map<number, (msg: unknown) => void>();

  constructor(
    private writable: NodeJS.WritableStream,
    private readable: NodeJS.ReadableStream,
  ) {
    super();
    this.readable.on("data", (chunk: Buffer) => this.onData(chunk));
    this.readable.on("end", () => this.emit("close"));
    this.readable.on("error", (err) => this.emit("error", err));
  }

  private onData(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk]);
    let idx;
    while ((idx = this.buf.indexOf(NUL)) >= 0) {
      const slice = this.buf.subarray(0, idx);
      this.buf = this.buf.subarray(idx + 1);
      this.dispatch(slice);
    }
  }

  private dispatch(slice: Buffer) {
    let msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };
    try {
      msg = JSON.parse(slice.toString("utf8"));
    } catch (err) {
      log.error({ err }, "could not parse CDP message");
      return;
    }
    if (typeof msg.id === "number" && this.inflight.has(msg.id)) {
      const resolver = this.inflight.get(msg.id)!;
      this.inflight.delete(msg.id);
      resolver(msg);
    } else if (msg.method) {
      this.emit("event", msg);
    }
  }

  send<R = unknown>(method: string, params?: unknown, sessionId?: string): Promise<R> {
    const id = this.nextId++;
    const payload: Record<string, unknown> = { id, method };
    if (params !== undefined) payload.params = params;
    if (sessionId) payload.sessionId = sessionId;
    const text = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      this.inflight.set(id, (raw) => {
        const m = raw as { error?: { message?: string }; result?: R };
        if (m.error) reject(new Error(m.error.message ?? "CDP error"));
        else resolve((m.result ?? {}) as R);
      });
      this.writable.write(text + "\0");
    });
  }
}
