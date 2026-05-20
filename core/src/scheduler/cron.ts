import cronParser from "cron-parser";
import { Scheduler } from "./index.js";
import { sub } from "../util/logger.js";

const log = sub("cron");

export type CronRule = {
  id: string;
  cron: string;
  screenId: string;
  durationMin?: number;
  enabled: boolean;
};

export class CronEngine {
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private scheduler: Scheduler) {}

  setRules(rules: CronRule[]) {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const rule of rules) {
      if (!rule.enabled) continue;
      this.scheduleNext(rule);
    }
  }

  private scheduleNext(rule: CronRule) {
    let iter;
    try {
      iter = cronParser.parseExpression(rule.cron);
    } catch (err) {
      log.error({ err, rule }, "invalid cron expression; skipping");
      return;
    }
    const next = iter.next().toDate();
    const delay = Math.max(0, next.getTime() - Date.now());
    const t = setTimeout(() => {
      try {
        this.scheduler.show(rule.screenId, "scheduled", {
          durationMin: rule.durationMin,
          label: `cron:${rule.id}`,
        });
      } catch (err) {
        log.error({ err, rule }, "scheduled claim failed");
      }
      this.scheduleNext(rule);
    }, delay);
    this.timers.set(rule.id, t);
    log.debug({ id: rule.id, at: next }, "scheduled next fire");
  }

  stop() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
