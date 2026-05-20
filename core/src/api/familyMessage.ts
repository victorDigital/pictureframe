import { Scheduler } from "../scheduler/index.js";
import { sub } from "../util/logger.js";

const log = sub("family-message");

const MAX_LEN = 280;
const RATE_WINDOW_MS = 5 * 60 * 1000;
const DISPLAY_MS = 60 * 60 * 1000;

export type StoredMessage = {
  message: string;
  posted_at: number;
  expires_at: number;
  from_ip: string;
};

export class FamilyMessages {
  private current?: StoredMessage;
  private rate = new Map<string, number>();
  private claimId?: string;

  constructor(
    private scheduler: Scheduler,
    private screenId: string = "family-message",
  ) {}

  get(): StoredMessage | null {
    if (this.current && this.current.expires_at <= Date.now()) {
      this.current = undefined;
    }
    return this.current ?? null;
  }

  post(ip: string, raw: unknown): { ok: true } | { ok: false; status: number; error: string } {
    const last = this.rate.get(ip) ?? 0;
    if (Date.now() - last < RATE_WINDOW_MS) {
      return { ok: false, status: 429, error: "rate_limited" };
    }
    if (typeof raw !== "string") {
      return { ok: false, status: 400, error: "message_must_be_string" };
    }
    const message = raw.trim();
    if (!message) return { ok: false, status: 400, error: "message_empty" };
    if (message.length > MAX_LEN) {
      return { ok: false, status: 400, error: "message_too_long" };
    }
    if (/<[^>]+>/.test(message)) {
      return { ok: false, status: 400, error: "html_not_allowed" };
    }

    const now = Date.now();
    this.rate.set(ip, now);
    this.current = {
      message,
      posted_at: now,
      expires_at: now + DISPLAY_MS,
      from_ip: ip,
    };

    try {
      const claim = this.scheduler.show(this.screenId, "programmatic", {
        durationMin: DISPLAY_MS / 60_000,
        label: "family-message",
      });
      this.claimId = claim.claimId;
    } catch (err) {
      log.error({ err }, "could not show family-message screen");
    }

    log.info({ ip, length: message.length }, "family message accepted");
    return { ok: true };
  }
}
