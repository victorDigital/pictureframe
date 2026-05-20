import test from "node:test";
import assert from "node:assert/strict";
import { StateBus } from "../src/api/stateBus.js";

test("broadcast fans out to all attached sinks", () => {
  const bus = new StateBus();
  const a: string[] = [];
  const b: string[] = [];
  const sinkA = { send: (m: string) => a.push(m), close: () => undefined };
  const sinkB = { send: (m: string) => b.push(m), close: () => undefined };
  bus.attach(sinkA);
  bus.attach(sinkB);
  bus.broadcast({ type: "state", payload: { active: "clock" } });
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.deepEqual(JSON.parse(a[0]!), { type: "state", payload: { active: "clock" } });
});

test("detach removes the sink from future broadcasts", () => {
  const bus = new StateBus();
  const a: string[] = [];
  const sink = { send: (m: string) => a.push(m), close: () => undefined };
  bus.attach(sink);
  bus.broadcast({ type: "state" });
  bus.detach(sink);
  bus.broadcast({ type: "state" });
  assert.equal(a.length, 1);
});

test("broadcast with no sinks is a noop", () => {
  const bus = new StateBus();
  assert.doesNotThrow(() => bus.broadcast({ type: "state" }));
});

test("sinkCount tracks attach/detach", () => {
  const bus = new StateBus();
  const sink = { send: () => undefined, close: () => undefined };
  assert.equal(bus.sinkCount(), 0);
  bus.attach(sink);
  assert.equal(bus.sinkCount(), 1);
  bus.detach(sink);
  assert.equal(bus.sinkCount(), 0);
});

test("a sink that throws on send doesn't block the others", () => {
  const bus = new StateBus();
  const received: string[] = [];
  bus.attach({
    send: () => {
      throw new Error("boom");
    },
    close: () => undefined,
  });
  bus.attach({ send: (m: string) => received.push(m), close: () => undefined });
  bus.broadcast({ type: "state" });
  assert.equal(received.length, 1);
});
