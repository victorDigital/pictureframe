import test from "node:test";
import assert from "node:assert/strict";
import { makeClaim, resolveActive, SOURCE_PRIORITY } from "../src/scheduler/claims.js";

test("higher-priority claim wins", () => {
  const a = makeClaim("clock", "default");
  const b = makeClaim("weather", "manual_pinned");
  const winner = resolveActive([a, b]);
  assert.equal(winner?.screenId, "weather");
});

test("expired claims are ignored", () => {
  const expired = makeClaim("weather", "manual_pinned");
  expired.expiresAt = Date.now() - 1000;
  const fallback = makeClaim("clock", "default");
  const winner = resolveActive([expired, fallback]);
  assert.equal(winner?.screenId, "clock");
});

test("tie on priority resolves to most recent", () => {
  const a = makeClaim("a", "manual_next");
  a.createdAt = 1;
  const b = makeClaim("b", "manual_next");
  b.createdAt = 2;
  const winner = resolveActive([a, b]);
  assert.equal(winner?.screenId, "b");
});

test("priority matrix matches spec §4.7", () => {
  assert.equal(SOURCE_PRIORITY.default, 0);
  assert.equal(SOURCE_PRIORITY.scheduled, 10);
  assert.equal(SOURCE_PRIORITY.ha, 20);
  assert.equal(SOURCE_PRIORITY.manual_next, 25);
  assert.equal(SOURCE_PRIORITY.programmatic, 30);
  assert.equal(SOURCE_PRIORITY.manual_pinned, 100);
});
