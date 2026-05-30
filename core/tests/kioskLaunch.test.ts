import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("kiosk launch script keeps the display awake", async () => {
  const scriptPath = path.resolve(import.meta.dirname, "../../deploy/launch-chromium.sh");
  const script = await fs.readFile(scriptPath, "utf8");

  assert.match(script, /setterm --blank=0 --powerdown=0 --powersave=off/);
  assert.match(script, /systemd-inhibit/);
  assert.match(script, /--what=idle:sleep:handle-lid-switch/);
});

test("kiosk launch script power-cycles the display after startup", async () => {
  const scriptPath = path.resolve(import.meta.dirname, "../../deploy/launch-chromium.sh");
  const script = await fs.readFile(scriptPath, "utf8");

  assert.match(script, /FRAME_BOOT_DISPLAY_CYCLE/);
  assert.match(script, /FRAME_BOOT_DISPLAY_CYCLE_DELAY_SEC:-4/);
  assert.match(script, /wlopm --off "\*"/);
  assert.match(script, /wlopm --on "\*"/);
  assert.match(script, /wlr-randr --output "\$output" --off/);
  assert.match(script, /wlr-randr --output "\$output" --on/);
});

test("kiosk launch script installs and selects the transparent cursor theme", async () => {
  const scriptPath = path.resolve(import.meta.dirname, "../../deploy/launch-chromium.sh");
  const cursorAssetPath = path.resolve(
    import.meta.dirname,
    "../../deploy/cursor/transparent.xcursor.b64",
  );
  const script = await fs.readFile(scriptPath, "utf8");
  const cursorAsset = await fs.readFile(cursorAssetPath, "utf8");
  const cursor = Buffer.from(cursorAsset.replace(/\s+/g, ""), "base64");
  const unit = await fs.readFile(
    path.resolve(import.meta.dirname, "../../deploy/systemd/frame-kiosk.service"),
    "utf8",
  );

  assert.equal(cursor.subarray(0, 4).toString("ascii"), "Xcur");
  assert.match(script, /install-transparent-theme\.sh/);
  assert.match(script, /XCURSOR_THEME="\$\{FRAME_XCURSOR_THEME:-frame-transparent\}"/);
  assert.match(unit, /Environment=XCURSOR_THEME=frame-transparent/);
  assert.match(unit, /Environment=XCURSOR_PATH=\/home\/frame\/\.local\/share\/icons:\/usr\/share\/icons/);
  assert.match(
    unit,
    /ExecStartPre=\/opt\/frame\/current\/deploy\/cursor\/install-transparent-theme\.sh \/home\/frame\/\.local\/share\/icons[\s\S]*ExecStart=\/usr\/bin\/cage/,
  );
});

test("kiosk launch script is valid bash", async () => {
  const scriptPath = path.resolve(import.meta.dirname, "../../deploy/launch-chromium.sh");

  await execFileAsync("bash", ["-n", scriptPath]);
});

test("installer bundles valid Plymouth splash assets", async () => {
  const deployDir = path.resolve(import.meta.dirname, "../../deploy");
  const installScript = await fs.readFile(path.join(deployDir, "install.sh"), "utf8");

  assert.match(installScript, /\bplymouth\b/);
  assert.match(installScript, /\bplymouth-themes\b/);

  const theme = await fs.readFile(path.join(deployDir, "plymouth/frame.plymouth"), "utf8");
  assert.match(theme, /ModuleName=script/);
  assert.match(theme, /ScriptFile=\/usr\/share\/plymouth\/themes\/frame\/frame\.script/);

  for (const asset of ["frame-logo", "progress-track", "progress-fill"]) {
    const raw = await fs.readFile(path.join(deployDir, `plymouth/${asset}.png.b64`), "utf8");
    const png = Buffer.from(raw.replace(/\s+/g, ""), "base64");
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
});
