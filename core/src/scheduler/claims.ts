import { randomUUID } from "node:crypto";

export type ClaimSource =
  | "default"
  | "manual_pinned"
  | "manual_next"
  | "programmatic"
  | "scheduled"
  | "ha";

export const SOURCE_PRIORITY: Record<ClaimSource, number> = {
  default: 0,
  scheduled: 10,
  ha: 20,
  manual_next: 25,
  programmatic: 30,
  manual_pinned: 100,
};

export type Claim = {
  claimId: string;
  screenId: string;
  source: ClaimSource;
  priority: number;
  expiresAt?: number;
  oneShot?: boolean;
  createdAt: number;
  label?: string;
};

export function makeClaim(
  screenId: string,
  source: ClaimSource,
  opts: { expiresAt?: number; oneShot?: boolean; label?: string } = {},
): Claim {
  return {
    claimId: randomUUID(),
    screenId,
    source,
    priority: SOURCE_PRIORITY[source],
    createdAt: Date.now(),
    ...opts,
  };
}

export function resolveActive(claims: Iterable<Claim>, now = Date.now()): Claim | undefined {
  let best: Claim | undefined;
  for (const claim of claims) {
    if (claim.expiresAt && claim.expiresAt <= now) continue;
    if (
      !best ||
      claim.priority > best.priority ||
      (claim.priority === best.priority && claim.createdAt > best.createdAt)
    ) {
      best = claim;
    }
  }
  return best;
}
