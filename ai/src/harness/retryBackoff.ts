import {DateTime} from "luxon";

import type {HarnessRetryPolicy} from "../types/harness";
import {HARNESS_RETRY_DEFAULTS} from "../types/harness";
import {HarnessDefinitionError} from "./definitionError";

export interface ResolvedRetryPolicy {
  backoffMs: number;
  maxAttempts: number;
  maxBackoffMs: number;
}

/** Fill the fields a definition left out with `HARNESS_RETRY_DEFAULTS`. */
export const resolveRetryPolicy = (policy: HarnessRetryPolicy | undefined): ResolvedRetryPolicy => {
  return {
    backoffMs: policy?.backoffMs ?? HARNESS_RETRY_DEFAULTS.backoffMs,
    maxAttempts: policy?.maxAttempts ?? HARNESS_RETRY_DEFAULTS.maxAttempts,
    maxBackoffMs: policy?.maxBackoffMs ?? HARNESS_RETRY_DEFAULTS.maxBackoffMs,
  };
};

/**
 * Throw when a retry policy cannot be applied. `scope` prefixes the message (for example
 * `defineTask(name)`); `field` names the option (`retry`, `modelRetry`).
 */
export const assertValidRetryPolicy = (
  scope: string,
  policy: HarnessRetryPolicy,
  field = "retry"
): void => {
  const {backoffMs, maxAttempts, maxBackoffMs} = resolveRetryPolicy(policy);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new HarnessDefinitionError(`${scope}: ${field}.maxAttempts must be a positive integer`);
  }
  if (!Number.isFinite(backoffMs) || backoffMs < 0) {
    throw new HarnessDefinitionError(`${scope}: ${field}.backoffMs must be a non-negative number`);
  }
  if (!Number.isFinite(maxBackoffMs) || maxBackoffMs < backoffMs) {
    throw new HarnessDefinitionError(
      `${scope}: ${field}.maxBackoffMs must be at least ${field}.backoffMs`
    );
  }
};

/**
 * Delay before the next run after `failedAttempts` failures: exponential
 * (`backoffMs * 2^(failedAttempts - 1)`, capped at `maxBackoffMs`) with equal jitter, so
 * the result lies in `[delay / 2, delay]`. Spreading retries keeps a shared outage from
 * waking every failed task at the same instant.
 */
export const retryDelayMs = ({
  failedAttempts,
  policy,
  random = Math.random,
}: {
  failedAttempts: number;
  policy: ResolvedRetryPolicy;
  random?: () => number;
}): number => {
  const exponent = Math.max(0, failedAttempts - 1);
  const capped = Math.min(policy.maxBackoffMs, policy.backoffMs * 2 ** exponent);
  const half = capped / 2;
  return Math.round(half + random() * half);
};

/** When the next run may start, measured from Luxon's clock (`DateTime.now()`). */
export const nextRetryAt = ({
  failedAttempts,
  policy,
  random,
}: {
  failedAttempts: number;
  policy: ResolvedRetryPolicy;
  random?: () => number;
}): DateTime => {
  return DateTime.now().plus({milliseconds: retryDelayMs({failedAttempts, policy, random})});
};
