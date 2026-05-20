import test from "node:test";
import assert from "node:assert/strict";
import { Scheduler } from "../src/scheduler/index.js";
import type { Screen } from "../src/config/schema.js";

const screens: Screen[] = [
  { id: "clock", name: "Clock", type: "builtin", source: "clock", preload: true },
  { id: "weather", name: "Weather", type: "builtin", source: "weather", preload: false },
  { id: "grafana", name: "Grafana", type: "url", source: "https://g.local", preload: true },
];

function newScheduler() {
  return new Scheduler({
    screens,
    defaultScreen: "clock",
    pinnedTimeoutHours: 4,
  });
}

test("default claim resolves to default screen", () => {
  const s = newScheduler();
  let activated: string | undefined;
  s.on("activate", (screen) => {
    activated = screen.id;
  });
  s.start();
  assert.equal(activated, "clock");
});

test("manual_pinned overrides default", () => {
  const s = newScheduler();
  const ids: string[] = [];
  s.on("activate", (screen) => ids.push(screen.id));
  s.start();
  s.show("weather", "manual_pinned");
  assert.deepEqual(ids, ["clock", "weather"]);
});

test("manual_next yields to a subsequent ha claim", () => {
  const s = newScheduler();
  const ids: string[] = [];
  s.on("activate", (screen) => ids.push(screen.id));
  s.start();
  s.show("weather", "manual_next");
  assert.equal(ids[ids.length - 1], "weather");

  // A scheduled event would normally yield to manual_next since manual_next
  // has higher priority (25 vs 10). But the spec says manual_next "expires
  // as soon as any other event would have shown a different screen" — i.e.
  // pop manual_next on the next claim arrival.
  s.show("grafana", "ha");
  assert.equal(ids[ids.length - 1], "grafana");

  // Releasing the ha claim should fall back to default (manual_next was
  // popped when ha arrived).
  const haClaim = s.list().find((c) => c.source === "ha")!;
  s.release(haClaim.claimId);
  assert.equal(ids[ids.length - 1], "clock");
});

test("releasing an unknown claim returns false and does not change active", () => {
  const s = newScheduler();
  let count = 0;
  s.on("activate", () => count++);
  s.start();
  assert.equal(count, 1);
  assert.equal(s.release("not-a-real-id"), false);
  assert.equal(count, 1);
});

test("show throws for an unknown screen", () => {
  const s = newScheduler();
  s.start();
  assert.throws(() => s.show("nope", "ha"));
});

test("oneShot claims are removed after activation, falling back to default", () => {
  const s = newScheduler();
  const ids: string[] = [];
  s.on("activate", (screen) => ids.push(screen.id));
  s.start();
  // Higher-priority oneShot claim wins exactly once.
  s.show("weather", "ha", { oneShot: true });
  assert.equal(ids[ids.length - 1], "weather");
  // It should have been removed from the claim set.
  assert.equal(
    s.list().some((c) => c.screenId === "weather" && c.source === "ha"),
    false,
  );
  // A subsequent low-priority claim arrives and replaces the active screen.
  s.show("grafana", "scheduled");
  assert.equal(ids[ids.length - 1], "grafana");
});
