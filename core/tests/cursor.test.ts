import test from "node:test";
import assert from "node:assert/strict";
import { cursorAutoHideScript } from "../src/cdp/cursor.js";

test("cursorAutoHideScript hides cursor by default and after pointer idle", () => {
  const script = cursorAutoHideScript(1234);

  assert.match(script, /frame-cursor-active/);
  assert.match(script, /cursor: none !important/);
  assert.match(script, /cursor: auto !important/);
  assert.match(script, /pointermove/);
  assert.match(script, /setTimeout\(hide, delayMs\)/);
  assert.match(script, /1234/);
});
