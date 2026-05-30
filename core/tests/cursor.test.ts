import test from "node:test";
import assert from "node:assert/strict";
import { cursorHideScript } from "../src/cdp/cursor.js";

test("cursorHideScript forces pages to stay cursorless", () => {
  const script = cursorHideScript();

  assert.match(script, /frame-cursor-hidden-style/);
  assert.match(script, /cursor: none !important/);
  assert.doesNotMatch(script, /cursor: auto/);
  assert.doesNotMatch(script, /pointermove/);
});
