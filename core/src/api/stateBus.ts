import EventEmitter from "node:events";
import { sub } from "../util/logger.js";

const log = sub("stateBus");

interface Sink {
  send(payload: string): void;
  close(): void;
}

// Fan-out bus for live state messages over /api/events. Multiple web-UI
// clients can subscribe simultaneously — unlike ShellBus which models the
// single kiosk shell page (Tab 0).
export class StateBus extends EventEmitter {
  private sinks = new Set<Sink>();

  attach(sink: Sink) {
    this.sinks.add(sink);
    log.debug({ count: this.sinks.size }, "client attached");
  }

  detach(sink: Sink) {
    this.sinks.delete(sink);
    log.debug({ count: this.sinks.size }, "client detached");
  }

  broadcast(message: unknown) {
    if (this.sinks.size === 0) return;
    const payload = JSON.stringify(message);
    for (const s of this.sinks) {
      try {
        s.send(payload);
      } catch {
        // ignore — dead sinks will be removed on close
      }
    }
  }

  sinkCount() {
    return this.sinks.size;
  }
}
