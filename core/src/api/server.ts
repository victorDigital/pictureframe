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

export async function createServer(deps: ApiDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  await app.register(fastifyWebsocket);

  const repoRoot = path.resolve(process.cwd(), "..");
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
    const header = req.headers.authorization;
    const expected = deps.configStore.current.bearerToken;
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
      device: cfg.config.device.name,
      active: deps.scheduler.activeScreen()?.id ?? null,
      claims: deps.scheduler.list(),
      brightness: await deps.brightness.read().catch(() => null),
      update: deps.updater.status(),
    };
  });

  // ---- screens --------------------------------------------------------------

  app.get("/api/screens", async () => ({ screens: deps.configStore.current.screens }));

  app.put<{ Body: { screens: Screen[] } }>("/api/screens", async (req, reply) => {
    const result = ScreensFileSchema.safeParse({ screens: req.body?.screens });
    if (!result.success) {
      reply.code(400);
      return { error: "invalid_screens", details: result.error.flatten() };
    }
    const cfg = deps.configStore.current.config;
    if (!cfg.screens_file) {
      reply.code(409);
      return { error: "safe_mode_no_screens_file" };
    }
    if (!result.data.screens.some((s) => s.id === cfg.default_screen)) {
      reply.code(400);
      return { error: "default_screen_missing", details: { default_screen: cfg.default_screen } };
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

  // ---- settings -------------------------------------------------------------

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

  app.setErrorHandler((err: unknown, _req, reply) => {
    const e = err as Error & { statusCode?: number };
    const code = e?.statusCode ?? 500;
    reply.code(code).send({ error: e?.message ?? "internal_error" });
  });

  return app;
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

export async function startServer(deps: ApiDeps, port = 8080) {
  const app = await createServer(deps);
  await app.listen({ host: "0.0.0.0", port });
  log.info({ port }, "api listening");
  void paths;
  return app;
}
