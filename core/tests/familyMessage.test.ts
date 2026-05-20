import test from "node:test";
import assert from "node:assert/strict";
import { FamilyMessages } from "../src/api/familyMessage.js";
import { Scheduler } from "../src/scheduler/index.js";

function setup() {
  const scheduler = new Scheduler({
    screens: [
      { id: "clock", name: "Clock", type: "builtin", source: "clock", preload: true },
      { id: "family-message", name: "FM", type: "builtin", source: "family-message", preload: false },
    ],
    defaultScreen: "clock",
    pinnedTimeoutHours: 4,
  });
  scheduler.start();
  const fm = new FamilyMessages(scheduler);
  return { fm, scheduler };
}

test("accepts a valid message and activates the screen", () => {
  const { fm, scheduler } = setup();
  const r = fm.post("10.0.0.1", "Dinner at 7");
  assert.equal(r.ok, true);
  assert.equal(fm.get()?.message, "Dinner at 7");
  assert.equal(scheduler.activeScreen()?.id, "family-message");
});

test("rate-limits a second message from the same IP within 5 minutes", () => {
  const { fm } = setup();
  fm.post("10.0.0.2", "first");
  const second = fm.post("10.0.0.2", "second");
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.status, 429);
});

test("rejects empty, oversize, and HTML messages", () => {
  const { fm } = setup();
  const empty = fm.post("10.0.0.3", "   ");
  assert.equal(empty.ok, false);
  const big = fm.post("10.0.0.4", "x".repeat(281));
  assert.equal(big.ok, false);
  const html = fm.post("10.0.0.5", "<b>hi</b>");
  assert.equal(html.ok, false);
});

test("a different IP can post even if another is rate-limited", () => {
  const { fm } = setup();
  fm.post("10.0.0.6", "a");
  const b = fm.post("10.0.0.7", "b");
  assert.equal(b.ok, true);
});
