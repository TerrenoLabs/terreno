/**
 * Code scanning dismissal ledger.
 *
 * `.github/code-scanning/dismissals.json` records every code scanning alert a
 * reviewed PR decided not to fix in code (a false positive, or a won't-fix the
 * PR justifies). The ledger merges with the PR, and
 * `.github/workflows/code-scanning-dismissals.yml` applies it on `master`.
 * That way dismissals land at the same moment as the fixes, which close on
 * their own when CodeQL rescans `master`.
 *
 * An entry is applied only when the live alert is still open and its rule and
 * path still match the entry. A stale or reused alert number is reported as a
 * mismatch and left alone.
 */

export const DISMISSAL_REASONS = ["false positive", "won't fix", "used in tests"] as const;

export type DismissalReason = (typeof DISMISSAL_REASONS)[number];

export interface DismissalEntry {
  alert: number;
  rule: string;
  path: string;
  reason: DismissalReason;
  comment: string;
}

export interface DismissalLedger {
  dismissals: DismissalEntry[];
}

/** The subset of a GitHub code scanning alert the planner reads. */
export interface LiveAlert {
  number: number;
  state: string;
  rule: {id: string};
  most_recent_instance?: {location?: {path?: string}};
}

export interface DismissalPlan {
  dismiss: DismissalEntry[];
  alreadyClosed: DismissalEntry[];
  mismatched: {entry: DismissalEntry; actualRule: string; actualPath: string}[];
  missing: DismissalEntry[];
}

/** GitHub caps the dismissal comment at 280 characters. */
const MAX_COMMENT_LENGTH = 280;

export const validateLedger = (ledger: unknown): {errors: string[]; ledger: DismissalLedger} => {
  const errors: string[] = [];
  const empty: DismissalLedger = {dismissals: []};
  if (typeof ledger !== "object" || ledger === null) {
    return {errors: ["ledger must be an object"], ledger: empty};
  }
  const dismissals = (ledger as {dismissals?: unknown}).dismissals;
  if (!Array.isArray(dismissals)) {
    return {errors: ["ledger.dismissals must be an array"], ledger: empty};
  }
  const seen = new Set<number>();
  dismissals.forEach((raw: unknown, index: number) => {
    const entry = raw as Partial<DismissalEntry>;
    const label = `dismissals[${index}]`;
    if (!Number.isInteger(entry.alert) || (entry.alert as number) <= 0) {
      errors.push(`${label}.alert must be a positive integer`);
    } else if (seen.has(entry.alert as number)) {
      errors.push(`${label}.alert #${entry.alert} is listed twice`);
    } else {
      seen.add(entry.alert as number);
    }
    if (typeof entry.rule !== "string" || entry.rule.length === 0) {
      errors.push(`${label}.rule is required`);
    }
    if (typeof entry.path !== "string" || entry.path.length === 0) {
      errors.push(`${label}.path is required`);
    }
    if (!DISMISSAL_REASONS.includes(entry.reason as DismissalReason)) {
      errors.push(`${label}.reason must be one of: ${DISMISSAL_REASONS.join(", ")}`);
    }
    if (typeof entry.comment !== "string" || entry.comment.trim().length === 0) {
      errors.push(`${label}.comment is required`);
    } else if (entry.comment.length > MAX_COMMENT_LENGTH) {
      errors.push(`${label}.comment is over ${MAX_COMMENT_LENGTH} characters`);
    }
  });
  return {errors, ledger: {dismissals: dismissals as DismissalEntry[]}};
};

export const planDismissals = ({
  ledger,
  alerts,
}: {
  ledger: DismissalLedger;
  alerts: LiveAlert[];
}): DismissalPlan => {
  const byNumber = new Map(alerts.map((alert) => [alert.number, alert]));
  const plan: DismissalPlan = {alreadyClosed: [], dismiss: [], mismatched: [], missing: []};
  for (const entry of ledger.dismissals) {
    const alert = byNumber.get(entry.alert);
    if (!alert) {
      plan.missing.push(entry);
      continue;
    }
    const actualRule = alert.rule.id;
    const actualPath = alert.most_recent_instance?.location?.path ?? "";
    if (actualRule !== entry.rule || actualPath !== entry.path) {
      plan.mismatched.push({actualPath, actualRule, entry});
      continue;
    }
    if (alert.state !== "open") {
      plan.alreadyClosed.push(entry);
      continue;
    }
    plan.dismiss.push(entry);
  }
  return plan;
};
