import Fastify, { FastifyInstance, FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ConfigStore } from "../config/state.js";
import { Scheduler } from "../scheduler/index.js";
import { ScreenController } from "../cdp/screenController.js";
import { ShellBus } from "./shellBus.js";
import { sub } from "../util/logger.js";
import { ScreensFileSchema, Screen } from "../config/schema.js";
import { writeScreens } from "../config/load.js";
import { Updater } from "../updater/index.js";
import { Brightness } from "../system/brightness.js";
import { CdpManager } from "../cdp/manager.js";
import { FamilyMessages } from "./familyMessage.js";
import { RuleStore } from "../scheduler/rules.js";
import { VncSupervisor } from "../system/vnc.js";
import { StateBus } from "./stateBus.js";
import { paths } from "../util/paths.js";

const log = sub("api");

export type ApiDeps = {
  configStore: ConfigStore;
  scheduler: Scheduler;
  screens: ScreenController;
  shell: ShellBus;
  updater: Updater;
  brightness: Brightness;
  cdp: CdpManager;
  family: FamilyMessages;
  rules: RuleStore;
  vnc: VncSupervisor;
  stateBus: StateBus;
  version: string;
};

type NowPlaying = {
  state: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  position?: number;
  entity_picture?: string;
};

let nowPlaying: NowPlaying | null = null;
export function setNowPlaying(state: NowPlaying | null) {
  nowPlaying = state;
}

const UNAUTH_PATHS = new Set([
  "/healthz",
  "/api/family_message/current",
  "/api/now_playing",
  "/family-message",
]);
const WS_PATHS = new Set(["/ws", "/api/events"]);

export async function createServer(deps: ApiDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  await app.register(fastifyWebsocket);

  const repoRoot = process.cwd();
  const webDist = path.join(repoRoot, "web", "dist");
  const kioskDist = path.join(repoRoot, "kiosk", "dist");
  const builtinRoot = path.join(repoRoot, "builtin-screens");

  await app.register(fastifyStatic, { root: webDist, prefix: "/", decorateReply: false });
  await app.register(fastifyStatic, { root: kioskDist, prefix: "/shell/", decorateReply: false });
  await app.register(fastifyStatic, {
    root: builtinRoot,
    prefix: "/builtin/",
    decorateReply: false,
  });

  app.get("/healthz", async () => {
    return {
      ok: true,
      version: deps.version,
      safe_mode: deps.configStore.isSafeMode(),
      screens_loaded: deps.configStore.current.screens.length,
      chromium_connected: deps.cdp.isConnected(),
      public_ip: await detectPublicIp().catch(() => false),
    };
  });

  const requireAuth = async (req: FastifyRequest) => {
    const url = req.url.split("?")[0]!;
    if (UNAUTH_PATHS.has(url)) return;
    if (url.startsWith("/shell/") || url.startsWith("/builtin/")) return;
    if (!url.startsWith("/api") && !url.startsWith("/ws")) return;

    const expected = deps.configStore.current.bearerToken;

    // Browsers can't set Authorization on a WebSocket upgrade. Two
    // fallbacks apply to every /ws and /api/events upgrade:
    //  - a ?token=... query string (the web UI passes its localStorage
    //    token this way)
    //  - any request originating from 127.0.0.1 (the kiosk shell on
    //    the device is always loopback-local, so the shell page can
    //    connect without sending a token)
    if (WS_PATHS.has(url)) {
      const qsToken = new URL(req.url, "http://x").searchParams.get("token");
      if (qsToken === expected) return;
      const ip = req.ip;
      if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return;
    }

    const header = req.headers.authorization;
    if (!header || header !== `Bearer ${expected}`) {
      const err = new Error("unauthorized");
      (err as Error & { statusCode: number }).statusCode = 401;
      throw err;
    }
  };
  app.addHook("onRequest", requireAuth);

  // ---- state ----------------------------------------------------------------

  app.get("/api/state", async () => {
    const cfg = deps.configStore.current;
    return {
      version: deps.version,
      safe_mode: deps.configStore.isSafeMode(),
      safe_mode_info: deps.configStore.safeModeInfo(),
      device: cfg.config.device.name,
      active: deps.scheduler.activeScreen()?.id ?? null,
      claims: deps.scheduler.list(),
      brightness: await deps.brightness.read().catch(() => null),
      update: deps.updater.status(),
    };
  });

  // ---- screens --------------------------------------------------------------

  app.get("/api/screens", async () => ({ screens: deps.configStore.current.screens }));

  app.get("/api/builtins", async (_req, reply) => {
    const dir = path.join(repoRoot, "builtin-screens");
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (err) {
      reply.code(500);
      return { error: "builtins_unreadable", details: String(err) };
    }
    const out: Array<{
      id: string;
      name?: string;
      description?: string;
      stub?: boolean;
      config_schema?: Record<string, unknown>;
    }> = [];
    for (const name of entries.sort()) {
      const manifestPath = path.join(dir, name, "manifest.json");
      try {
        const raw = await fs.readFile(manifestPath, "utf8");
        const parsed = JSON.parse(raw) as { id?: string };
        out.push({ id: parsed.id ?? name, ...parsed });
      } catch {
        // skip directories without a manifest.json
      }
    }
    return { builtins: out };
  });

  app.put<{ Body: { screens: Screen[] } }>("/api/screens", async (req, reply) => {
    const result = ScreensFileSchema.safeParse({ screens: req.body?.screens });
    if (!result.success) {
      reply.code(400);
      return {
        error: "invalid_screens",
        message: "Screen list did not match the expected shape.",
        details: result.error.flatten(),
      };
    }
    const cfg = deps.configStore.current.config;
    if (!cfg.screens_file) {
      reply.code(409);
      return {
        error: "safe_mode_no_screens_file",
        message: "Cannot save screens in safe mode (no screens_file configured).",
      };
    }
    if (!result.data.screens.some((s) => s.id === cfg.default_screen)) {
      reply.code(400);
      return {
        error: "default_screen_missing",
        message: `Cannot remove "${cfg.default_screen}" — it is set as default_screen in frame.yaml. Change default_screen first.`,
        details: { default_screen: cfg.default_screen },
      };
    }
    await writeScreens(cfg.screens_file, result.data.screens);
    await deps.configStore.reload();
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { mode?: "next" | "pin"; durationMin?: number } }>(
    "/api/screens/:id/show",
    async (req, reply) => {
      const mode = req.body?.mode ?? "next";
      const source = mode === "pin" ? "manual_pinned" : "manual_next";
      try {
        const claim = deps.scheduler.show(req.params.id, source, {
          durationMin: req.body?.durationMin,
        });
        return { ok: true, claim };
      } catch (err) {
        reply.code(404);
        return { error: String(err) };
      }
    },
  );

  app.post<{ Params: { id: string } }>("/api/screens/:id/test", async (req, reply) => {
    const screen = deps.configStore.current.screens.find((s) => s.id === req.params.id);
    if (!screen) {
      reply.code(404);
      return { error: "screen_not_found" };
    }
    if (screen.type !== "url") {
      reply.code(400);
      return { error: "test_only_for_url_screens" };
    }
    return deps.screens.testUrlScreen(screen);
  });

  app.delete<{ Params: { claimId: string } }>("/api/claims/:claimId", async (req, reply) => {
    const released = deps.scheduler.release(req.params.claimId);
    if (!released) {
      reply.code(404);
      return { error: "not_found" };
    }
    return { ok: true };
  });

  // ---- system ---------------------------------------------------------------

  app.get("/api/system/brightness", async () => ({ value: await deps.brightness.read() }));
  app.put<{ Body: { value: number } }>("/api/system/brightness", async (req) => {
    await deps.brightness.write(req.body.value);
    return { ok: true };
  });
  app.post("/api/system/reboot", async () => deps.brightness.scheduleReboot());
  app.post<{ Params: { state: "on" | "off" } }>(
    "/api/system/display/:state",
    async (req) => deps.brightness.displayPower(req.params.state),
  );

  // ---- updates --------------------------------------------------------------

  app.get("/api/updates", async () => deps.updater.status());
  app.post("/api/updates/check", async () => deps.updater.checkNow());
  app.post("/api/updates/apply", async (_req, reply) => {
    try {
      return await deps.updater.applyAvailable({ force: false });
    } catch (err) {
      reply.code(409);
      return { error: String(err) };
    }
  });
  app.post("/api/updates/apply_force", async () =>
    deps.updater.applyAvailable({ force: true }),
  );
  app.post("/api/updates/rollback", async () => deps.updater.rollback());

  app.get("/api/updates/quarantine", async () => ({
    quarantined: deps.updater.quarantineList(),
  }));
  app.delete<{ Params: { tag: string } }>(
    "/api/updates/quarantine/:tag",
    async (req) => ({
      cleared: await deps.updater.clearQuarantine(req.params.tag),
    }),
  );
  app.delete("/api/updates/quarantine", async () => ({
    cleared: await deps.updater.clearQuarantine(),
  }));

  app.get("/api/updates/snapshots", async () => {
    const dir = paths.snapshotsDir;
    try {
      const entries = await fs.readdir(dir);
      const out = await Promise.all(
        entries.map(async (name) => {
          const m = name.match(/^(.+?)--(.+)$/);
          if (!m) return null;
          const stat = await fs.stat(path.join(dir, name));
          return {
            from: m[1],
            to: m[2],
            at: stat.mtime.toISOString(),
            name,
          };
        }),
      );
      return { snapshots: out.filter(Boolean) };
    } catch {
      return { snapshots: [] };
    }
  });

  app.get<{ Querystring: { lines?: number; subsystem?: string } }>("/api/logs", async (req) => {
    return deps.updater.tailLog(req.query.lines ?? 200, req.query.subsystem);
  });

  // ---- rules ----------------------------------------------------------------

  app.get("/api/rules", async () => ({ rules: deps.rules.list() }));
  app.put<{ Body: { rules: unknown } }>("/api/rules", async (req, reply) => {
    try {
      await deps.rules.replace(req.body?.rules);
      return { ok: true, rules: deps.rules.list() };
    } catch (err) {
      reply.code(400);
      return { error: String(err) };
    }
  });

  // ---- family message -------------------------------------------------------

  app.get("/api/family_message/current", async () => deps.family.get());

  app.post<{ Body: { message?: string } }>("/family-message", async (req, reply) => {
    const cfg = deps.configStore.current.config;
    const fm = (cfg.builtins as Record<string, { enabled?: boolean }>).family_message;
    if (!fm?.enabled) {
      reply.code(403);
      return { error: "family_message_disabled" };
    }
    const ip = req.ip;
    const result = deps.family.post(ip, req.body?.message);
    if (!result.ok) {
      reply.code(result.status);
      return { error: result.error };
    }
    return { ok: true };
  });

  // ---- now playing (proxy for HA pushed media_player state) -----------------

  app.get("/api/now_playing", async () => nowPlaying);
  app.put<{ Body: NowPlaying | null }>("/api/now_playing", async (req) => {
    setNowPlaying(req.body ?? null);
    return { ok: true };
  });

  // ---- vnc ------------------------------------------------------------------

  app.get("/api/vnc/status", async () => deps.vnc.status());
  app.post("/api/vnc/start", async (_req, reply) => {
    try {
      return await deps.vnc.start();
    } catch (err) {
      reply.code(409);
      return { error: String(err) };
    }
  });
  app.post("/api/vnc/stop", async () => {
    deps.vnc.stop();
    return { ok: true };
  });

  // ---- settings -------------------------------------------------------------

  app.get("/api/settings/updater", async () => {
    const u = deps.configStore.current.config.updater;
    return {
      channel: u.channel,
      auto_apply: u.auto_apply,
      staging_delay_hours: u.staging_delay_hours,
      poll_interval_min: u.poll_interval_min,
      retain_releases: u.retain_releases,
      repo: u.repo,
      signing_key_file: u.signing_key_file ?? null,
    };
  });

  app.put<{
    Body: {
      channel?: "stable" | "beta";
      auto_apply?: boolean;
      staging_delay_hours?: number;
    };
  }>("/api/settings/updater", async (req, reply) => {
    const cfgPath = deps.configStore.current.config;
    if (!cfgPath.device.bearer_token_file) {
      reply.code(409);
      return { error: "safe_mode_cannot_edit_config" };
    }
    const { default: YAML } = await import("yaml");
    const raw = await fs.readFile(paths.configFile, "utf8");
    const doc = YAML.parseDocument(raw);
    const u = doc.get("updater") as { set?: (k: string, v: unknown) => void } | undefined;
    if (!u) {
      reply.code(500);
      return { error: "updater_section_missing" };
    }
    if (req.body.channel) (u as { set: (k: string, v: unknown) => void }).set("channel", req.body.channel);
    if (typeof req.body.auto_apply === "boolean")
      (u as { set: (k: string, v: unknown) => void }).set("auto_apply", req.body.auto_apply);
    if (typeof req.body.staging_delay_hours === "number")
      (u as { set: (k: string, v: unknown) => void }).set("staging_delay_hours", req.body.staging_delay_hours);
    const tmp = paths.configFile + ".tmp";
    await fs.writeFile(tmp, doc.toString());
    await fs.rename(tmp, paths.configFile);
    await deps.configStore.reload();
    return { ok: true };
  });

  app.get("/api/settings/signing_key", async () => {
    const u = deps.configStore.current.config.updater;
    if (!u.signing_key_file) return { configured: false, fingerprint: null };
    try {
      const data = await fs.readFile(u.signing_key_file, "utf8");
      const fp = await gpgFingerprint(data).catch(() => null);
      return { configured: true, path: u.signing_key_file, fingerprint: fp };
    } catch {
      return { configured: false, fingerprint: null };
    }
  });

  app.post<{
    Body: { key: string; signature?: string; override?: string };
  }>("/api/settings/signing_key", async (req, reply) => {
    if (!req.body?.key || !req.body.key.includes("BEGIN PGP PUBLIC KEY BLOCK")) {
      reply.code(400);
      return { error: "missing_public_key_block" };
    }
    const cfg = deps.configStore.current.config;
    const targetPath =
      cfg.updater.signing_key_file ?? "/etc/frame/secrets/release.pub";
    const currentPath = cfg.updater.signing_key_file;

    let currentExists = false;
    if (currentPath) {
      try {
        await fs.access(currentPath);
        currentExists = true;
      } catch {
        // not present — treat as bootstrap
      }
    }

    if (!currentExists) {
      // Bootstrap: any caller authorized by bearer token can install the
      // first key (SPEC §5.7).
    } else {
      // Rotation. Two acceptable paths:
      //   1. signature: the new key is signed by the old one (operator
      //      uploaded a detached signature over the new key bytes)
      //   2. override: operator typed the explicit consent string
      const expectedConsent = "I understand this disables verification temporarily";
      const consentOk = req.body.override === expectedConsent;
      if (req.body.signature) {
        try {
          await verifyDetachedSignature(req.body.key, req.body.signature, currentPath!);
        } catch (err) {
          reply.code(400);
          return { error: "signature_check_failed", details: String(err) };
        }
      } else if (!consentOk) {
        reply.code(409);
        return {
          error: "rotation_requires_signature_or_override",
          required_override_phrase: expectedConsent,
        };
      }
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const tmp = targetPath + ".tmp";
    await fs.writeFile(tmp, req.body.key, { mode: 0o640 });
    await fs.rename(tmp, targetPath);
    log.warn({ targetPath }, "release signing key updated");
    return { ok: true, path: targetPath };
  });

  app.post("/api/settings/rotate_bearer", async (_req, reply) => {
    const cfg = deps.configStore.current.config;
    const file = cfg.device.bearer_token_file;
    if (!file) {
      reply.code(409);
      return { error: "safe_mode_cannot_rotate" };
    }
    const token = crypto
      .randomBytes(32)
      .toString("base64")
      .replace(/[+/=]/g, "")
      .slice(0, 32);
    const tmp = file + ".tmp";
    await fs.writeFile(tmp, token + "\n", { mode: 0o640 });
    await fs.rename(tmp, file);
    await deps.configStore.reload();
    log.warn("bearer token rotated");
    return { ok: true, token };
  });

  // ---- websocket ------------------------------------------------------------

  app.get("/ws", { websocket: true }, (socket) => {
    const sink = {
      send: (msg: string) => socket.send(msg),
      close: () => socket.close(),
    };
    deps.shell.attach(sink);
    socket.on("message", (data: Buffer) => deps.shell.ingest(data.toString()));
    socket.on("close", () => deps.shell.detach(sink));
  });

  app.get("/api/events", { websocket: true }, (socket) => {
    const sink = {
      send: (msg: string) => socket.send(msg),
      close: () => socket.close(),
    };
    deps.stateBus.attach(sink);
    socket.on("close", () => deps.stateBus.detach(sink));
  });

  app.setErrorHandler((err: unknown, _req, reply) => {
    const e = err as Error & { statusCode?: number };
    const code = e?.statusCode ?? 500;
    reply.code(code).send({ error: e?.message ?? "internal_error" });
  });

  return app;
}

async function gpgFingerprint(armoredKey: string): Promise<string | null> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  const tmpDir = await fs.mkdtemp(path.join("/tmp", "fp-"));
  try {
    const keyFile = path.join(tmpDir, "key.asc");
    await fs.writeFile(keyFile, armoredKey);
    const { stdout } = await exec("gpg", [
      "--homedir",
      tmpDir,
      "--with-colons",
      "--import-options",
      "show-only",
      "--import",
      keyFile,
    ]);
    const fpLine = stdout.split("\n").find((l) => l.startsWith("fpr:"));
    return fpLine?.split(":")[9] ?? null;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function verifyDetachedSignature(
  newKeyArmored: string,
  signatureArmored: string,
  currentKeyFile: string,
): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  const tmpDir = await fs.mkdtemp(path.join("/tmp", "verify-"));
  try {
    const keyFile = path.join(tmpDir, "new.asc");
    const sigFile = path.join(tmpDir, "sig.asc");
    await fs.writeFile(keyFile, newKeyArmored);
    await fs.writeFile(sigFile, signatureArmored);
    // gpgv exits non-zero on verification failure — let it throw.
    await exec("gpgv", ["--keyring", currentKeyFile, sigFile, keyFile]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function detectPublicIp(): Promise<boolean> {
  const os = await import("node:os");
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const addr of list ?? []) {
      if (addr.internal || addr.family !== "IPv4") continue;
      const a = addr.address;
      const first = parseInt(a.split(".")[0]!, 10);
      const second = parseInt(a.split(".")[1]!, 10);
      const isRfc1918 =
        first === 10 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        first === 127 ||
        (first === 169 && second === 254) ||
        a.startsWith("100.");
      if (!isRfc1918) return true;
    }
  }
  return false;
}

export async function startServer(deps: ApiDeps, port?: number) {
  const app = await createServer(deps);
  const effectivePort = port ?? Number(process.env.FRAME_PORT ?? 8080);
  await app.listen({ host: "0.0.0.0", port: effectivePort });
  log.info({ port: effectivePort }, "api listening");
  void paths;
  return app;
}
