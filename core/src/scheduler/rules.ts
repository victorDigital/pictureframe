import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import cronParser from "cron-parser";
import { CronEngine, CronRule } from "./cron.js";
import { sub } from "../util/logger.js";

const log = sub("rules");

const RuleSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/),
  cron: z
    .string()
    .min(1)
    .refine((s) => {
      try {
        cronParser.parseExpression(s);
        return true;
      } catch {
        return false;
      }
    }, "invalid cron expression"),
  screenId: z.string().min(1),
  durationMin: z.number().int().min(1).optional(),
  enabled: z.boolean().default(true),
});

const RulesFileSchema = z.object({ rules: z.array(RuleSchema) });

export class RuleStore {
  private rules: CronRule[] = [];

  constructor(
    private file: string,
    private engine: CronEngine,
  ) {}

  async load() {
    try {
      const txt = await fs.readFile(this.file, "utf8");
      const parsed = RulesFileSchema.safeParse(YAML.parse(txt));
      if (!parsed.success) {
        log.error({ details: parsed.error.flatten() }, "rules file invalid; starting empty");
        return;
      }
      this.rules = parsed.data.rules;
      this.engine.setRules(this.rules);
      log.info({ count: this.rules.length }, "rules loaded");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      log.error({ err }, "could not read rules file");
    }
  }

  list(): CronRule[] {
    return [...this.rules];
  }

  async replace(raw: unknown) {
    const parsed = RulesFileSchema.safeParse({ rules: raw });
    if (!parsed.success) {
      throw new Error(`invalid_rules: ${JSON.stringify(parsed.error.flatten())}`);
    }
    this.rules = parsed.data.rules;
    this.engine.setRules(this.rules);
    await this.persist();
  }

  private async persist() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    await fs.writeFile(tmp, YAML.stringify({ rules: this.rules }));
    await fs.rename(tmp, this.file);
  }
}
