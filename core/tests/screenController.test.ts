import test from "node:test";
import assert from "node:assert/strict";
import { ScreenController } from "../src/cdp/screenController.js";
import { ShellBus } from "../src/api/shellBus.js";
import type { CdpManager } from "../src/cdp/manager.js";
import type { Screen } from "../src/config/schema.js";

test("builtin replay does not block on a stale shell tab after CDP disconnects", async () => {
  const messages: string[] = [];
  let activated = false;
  const cdp = {
    isConnected: () => false,
    activate: async () => {
      activated = true;
      throw new Error("stale cdp tab");
    },
  } as unknown as CdpManager;
  const shell = new ShellBus();
  const controller = new ScreenController(cdp, shell, {
    maxPreloaded: 5,
    shellUrl: "http://127.0.0.1:8080/shell/",
  });
  const screen: Screen = { id: "clock", name: "Clock", type: "builtin", source: "clock" };

  shell.attach({
    send: (payload) => messages.push(payload),
    close: () => undefined,
  });
  controller.setShellTab("old-tab");

  await controller.show(screen, 0);

  assert.equal(activated, false);
  assert.equal(JSON.parse(messages.at(-2) ?? "{}").type, "show_builtin");
  assert.equal(JSON.parse(messages.at(-1) ?? "{}").type, "hide_overlay");
});
