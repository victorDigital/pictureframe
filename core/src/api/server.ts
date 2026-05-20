import Fastify, { FastifyInstance, FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import path from "node:path";
import { ConfigStore } from "../config/state.js";
import { Scheduler } from "../scheduler/index.js";
import { ScreenController } from "../cdp/screenController.js";
import { ShellBus } from "./shellBus.js";
import { sub } from "../util/logger.js";
import { Screen } from "../config/schema.js";
import { validateScreens, writeScreens } from "../config/load.js";
import { Updater } from "../updater/index.js";
import { Brightness } from "../system/brightness.js";
import { paths } from "../util/paths.js";

const log = sub("api");

export type ApiDeps = {
  configStore: ConfigStore;
  scheduler: Scheduler;
  screens: ScreenController;
  shell: ShellBus;
  updater: Updater;
  brightness: Brightness;
  version: string;
};

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

  app.get("/healthz", async () => ({
    ok: true,
    version: deps.version,
    safe_mode: deps.configStore.isSafeMode(),
    screens_loaded: deps.configStore.current.screens.length,
  }));

  const requireAuth = async (req: FastifyRequest) => {
    if (req.url === "/healthz" || req.url.startsWith("/shell/") || req.url.startsWith("/builtin/")) return;
    if (!req.url.startsWith("/api") && !req.url.startsWith("/ws")) return;
    const header = req.headers.authorization;
    const expected = deps.configStore.current.bearerToken;
    if (!header || header !== `Bearer ${expected}`) {
      const err = new Error("unauthorized");
      (err as Error & { statusCode: number }).statusCode = 401;
      throw err;
    }
  };
  app.addHook("onRequest", requireAuth);

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

  app.get("/api/screens", async () => ({ screens: deps.configStore.current.screens }));

  app.put<{ Body: { screens: Screen[] } }>("/api/screens", async (req, reply) => {
    const yaml = JSON.stringify(req.body);
    const result = await validateScreens(`screens: ${yaml}`);
    if (!result.ok) {
      reply.code(400);
      return { error: "invalid_screens", details: result.details };
    }
    const screensPath = deps.configStore.current.config.screens_file;
    if (!screensPath) {
      reply.code(409);
      return { error: "safe_mode_no_screens_file" };
    }
    await writeScreens(screensPath, result.screens);
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

  app.delete<{ Params: { claimId: string } }>("/api/claims/:claimId", async (req, reply) => {
    const released = deps.scheduler.release(req.params.claimId);
    if (!released) {
      reply.code(404);
      return { error: "not_found" };
    }
    return { ok: true };
  });

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

export async function startServer(deps: ApiDeps, port = 8080) {
  const app = await createServer(deps);
  await app.listen({ host: "0.0.0.0", port });
  log.info({ port }, "api listening");
  // Avoid unused variable lint:
  void paths;
  return app;
}
