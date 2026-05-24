import EventEmitter from "node:events";
import { CoreToShell, ShellToCore, SHELL_PROTOCOL_VERSION } from "./protocol.js";
import { sub } from "../util/logger.js";

const log = sub("shellBus");

interface Sink {
  send(payload: string): void;
  close(): void;
}

export class ShellBus extends EventEmitter {
  private sink?: Sink;

  attach(sink: Sink) {
    if (this.sink) this.sink.close();
    this.sink = sink;
    this.send({ type: "welcome", protocolVersion: SHELL_PROTOCOL_VERSION });
    log.info("shell attached");
    // Tell main() to replay the current screen — otherwise any
    // show_builtin / activate that fired before the shell connected was
    // dropped (see this.send() guard above), and the page sits blank.
    this.emit("connect");
  }

  detach(sink: Sink) {
    if (this.sink === sink) {
      this.sink = undefined;
      log.info("shell detached");
    }
  }

  send(message: CoreToShell) {
    if (!this.sink) {
      log.debug({ type: message.type }, "no shell attached, dropping message");
      return;
    }
    this.sink.send(JSON.stringify(message));
  }

  ingest(raw: string) {
    let msg: ShellToCore;
    try {
      msg = JSON.parse(raw) as ShellToCore;
    } catch (err) {
      log.warn({ err, raw }, "could not parse shell message");
      return;
    }
    if (msg.type === "hello") {
      if (msg.protocolVersion !== SHELL_PROTOCOL_VERSION) {
        this.send({ type: "reload_required", reason: "protocol_version_mismatch" });
        return;
      }
    }
    this.emit("message", msg);
  }

  isConnected() {
    return Boolean(this.sink);
  }
}
