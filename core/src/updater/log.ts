import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "../util/paths.js";

const file = path.join(paths.stateDir, "update.log");

export type UpdaterEvent = {
  level: "info" | "warn" | "error";
  msg: string;
  tag?: string;
  from?: string;
  details?: unknown;
};

export async function logUpdaterEvent(ev: UpdaterEvent): Promise<void> {
  const line =
    JSON.stringify({
      time: new Date().toISOString(),
      subsystem: "updater",
      ...ev,
    }) + "\n";
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, line);
  } catch {
    // best effort
  }
}
