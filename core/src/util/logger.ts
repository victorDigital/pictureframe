import pino from "pino";

export const logger = pino({
  level: process.env.FRAME_LOG_LEVEL ?? "info",
  base: { service: "frame-core" },
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : {
          target: "pino/file",
          options: { destination: 1, mkdir: true },
        },
});

export type Logger = typeof logger;
export const sub = (subsystem: string) => logger.child({ subsystem });
