import EventEmitter from "node:events";
import { Claim, ClaimSource, makeClaim, resolveActive } from "./claims.js";
import { Screen } from "../config/schema.js";
import { sub } from "../util/logger.js";

const log = sub("scheduler");

export type SchedulerEvents = {
  activate: (screen: Screen, claim: Claim) => void;
};

export class Scheduler extends EventEmitter {
  private claims = new Map<string, Claim>();
  private screens = new Map<string, Screen>();
  private defaultScreenId: string;
  private active?: Claim;
  private expireTimer?: NodeJS.Timeout;
  private pinnedTimeoutMs: number;

  constructor(opts: {
    screens: Screen[];
    defaultScreen: string;
    pinnedTimeoutHours: number;
  }) {
    super();
    this.setScreens(opts.screens);
    this.defaultScreenId = opts.defaultScreen;
    this.pinnedTimeoutMs = opts.pinnedTimeoutHours * 3_600_000;
    this.installDefault();
  }

  setScreens(screens: Screen[]) {
    this.screens = new Map(screens.map((s) => [s.id, s]));
  }

  updateDefault(screenId: string) {
    this.defaultScreenId = screenId;
    this.installDefault();
    this.recompute();
  }

  private installDefault() {
    for (const [id, c] of this.claims) {
      if (c.source === "default") this.claims.delete(id);
    }
    const claim = makeClaim(this.defaultScreenId, "default", {
      label: "fallback",
    });
    this.claims.set(claim.claimId, claim);
  }

  show(screenId: string, source: ClaimSource, opts: {
    durationMin?: number;
    oneShot?: boolean;
    label?: string;
  } = {}): Claim {
    if (!this.screens.has(screenId)) {
      throw new Error(`unknown screen ${screenId}`);
    }
    let expiresAt: number | undefined;
    if (source === "manual_pinned") {
      const ms = opts.durationMin ? opts.durationMin * 60_000 : this.pinnedTimeoutMs;
      if (ms > 0) expiresAt = Date.now() + ms;
    } else if (opts.durationMin && opts.durationMin > 0) {
      expiresAt = Date.now() + opts.durationMin * 60_000;
    }
    const claim = makeClaim(screenId, source, {
      expiresAt,
      oneShot: opts.oneShot,
      label: opts.label,
    });
    this.claims.set(claim.claimId, claim);
    log.info({ claim }, "claim added");
    this.recompute();
    return claim;
  }

  release(claimId: string) {
    const claim = this.claims.get(claimId);
    if (!claim) return false;
    if (claim.source === "default") return false;
    this.claims.delete(claimId);
    log.info({ claimId }, "claim released");
    this.recompute();
    return true;
  }

  releaseSource(source: ClaimSource) {
    let removed = 0;
    for (const [id, c] of this.claims) {
      if (c.source === source) {
        this.claims.delete(id);
        removed++;
      }
    }
    if (removed > 0) this.recompute();
    return removed;
  }

  list(): Claim[] {
    return Array.from(this.claims.values());
  }

  activeClaim(): Claim | undefined {
    return this.active;
  }

  activeScreen(): Screen | undefined {
    if (!this.active) return undefined;
    return this.screens.get(this.active.screenId);
  }

  private recompute() {
    const now = Date.now();
    for (const [id, c] of this.claims) {
      if (c.expiresAt && c.expiresAt <= now && c.source !== "default") {
        this.claims.delete(id);
      }
    }
    const next = resolveActive(this.claims.values(), now);
    if (!next) return;

    if (this.active && this.active.source === "manual_next" && this.active.claimId !== next.claimId) {
      this.claims.delete(this.active.claimId);
    }

    const screen = this.screens.get(next.screenId) ?? this.screens.get(this.defaultScreenId);
    if (!screen) {
      log.error({ wanted: next.screenId }, "active claim references unknown screen and no default");
      return;
    }
    const changed = !this.active || this.active.claimId !== next.claimId;
    this.active = next;
    if (changed) {
      this.emit("activate", screen, next);
    }

    this.scheduleExpiryRecheck();
  }

  private scheduleExpiryRecheck() {
    clearTimeout(this.expireTimer);
    let soonest = Infinity;
    const now = Date.now();
    for (const c of this.claims.values()) {
      if (c.expiresAt && c.expiresAt > now && c.expiresAt < soonest) {
        soonest = c.expiresAt;
      }
    }
    if (soonest === Infinity) return;
    const delay = Math.max(1000, soonest - now);
    this.expireTimer = setTimeout(() => this.recompute(), delay);
  }

  start() {
    this.recompute();
  }
}
