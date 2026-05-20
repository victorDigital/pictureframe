import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  FrameConfig,
  FrameConfigSchema,
  Screen,
  ScreensFile,
  ScreensFileSchema,
} from "./schema.js";
import { sub } from "../util/logger.js";

const log = sub("config");

export type LoadedConfig = {
  config: FrameConfig;
  screens: Screen[];
  bearerToken: string;
  configPath: string;
  screensPath: string;
};

export type LoadResult =
  | { ok: true; loaded: LoadedConfig }
  | { ok: false; reason: string; details?: unknown };

async function readYaml<T>(file: string): Promise<unknown> {
  const raw = await fs.readFile(file, "utf8");
  return YAML.parse(raw) as T;
}

async function readSecret(file: string): Promise<string> {
  const data = await fs.readFile(file, "utf8");
  return data.trim();
}

export async function loadAll(configPath: string): Promise<LoadResult> {
  let configRaw: unknown;
  try {
    configRaw = await readYaml<unknown>(configPath);
  } catch (err) {
    return { ok: false, reason: "frame_yaml_unreadable", details: String(err) };
  }

  const parsed = FrameConfigSchema.safeParse(configRaw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "frame_yaml_invalid",
      details: parsed.error.flatten(),
    };
  }

  const config = parsed.data;
  const screensPath = config.screens_file;

  let screensRaw: unknown;
  try {
    screensRaw = await readYaml<unknown>(screensPath);
  } catch (err) {
    return { ok: false, reason: "screens_yaml_unreadable", details: String(err) };
  }

  const screensParsed = ScreensFileSchema.safeParse(screensRaw);
  if (!screensParsed.success) {
    return {
      ok: false,
      reason: "screens_yaml_invalid",
      details: screensParsed.error.flatten(),
    };
  }
  const screensFile: ScreensFile = screensParsed.data;

  if (!screensFile.screens.some((s) => s.id === config.default_screen)) {
    return {
      ok: false,
      reason: "default_screen_missing",
      details: `default_screen "${config.default_screen}" is not in screens.yaml`,
    };
  }

  let token: string;
  try {
    token = await readSecret(config.device.bearer_token_file);
  } catch (err) {
    return { ok: false, reason: "bearer_token_unreadable", details: String(err) };
  }
  if (token.length < 16) {
    return { ok: false, reason: "bearer_token_too_short" };
  }

  return {
    ok: true,
    loaded: {
      config,
      screens: screensFile.screens,
      bearerToken: token,
      configPath: path.resolve(configPath),
      screensPath: path.resolve(screensPath),
    },
  };
}

export async function validateScreens(yaml: string): Promise<
  { ok: true; screens: Screen[] } | { ok: false; details: unknown }
> {
  try {
    const parsed = YAML.parse(yaml);
    const result = ScreensFileSchema.safeParse(parsed);
    if (!result.success) {
      return { ok: false, details: result.error.flatten() };
    }
    return { ok: true, screens: result.data.screens };
  } catch (err) {
    return { ok: false, details: String(err) };
  }
}

export async function writeScreens(
  screensPath: string,
  screens: Screen[],
): Promise<void> {
  const yaml = YAML.stringify({ screens });
  const tmp = `${screensPath}.tmp`;
  await fs.writeFile(tmp, yaml, "utf8");
  await fs.rename(tmp, screensPath);
  log.info({ count: screens.length }, "screens.yaml written");
}
