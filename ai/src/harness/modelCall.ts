import {APICallError, type LanguageModel} from "ai";

import type {HarnessModelRef, HarnessModelResolver, HarnessRetryPolicy} from "../types/harness";
import {HARNESS_MODEL_RETRY_DEFAULTS} from "../types/harness";
import {retryDelayMs} from "./retryBackoff";

/** One try of one model, as recorded on the LLM span. */
export interface ModelCallAttempt {
  attempt: number;
  error?: string;
  modelId: string;
  provider: string;
  /** Whether the failure allowed another try. */
  retryable?: boolean;
  statusCode?: number;
}

export interface ModelCallResult<T> {
  attempts: ModelCallAttempt[];
  /** The model that answered. */
  model: HarnessModelRef;
  result: T;
}

/** Every model (primary, then fallbacks) failed, or a failure was not retryable. */
export class HarnessModelCallError extends Error {
  readonly attempts: ModelCallAttempt[];

  constructor(message: string, attempts: ModelCallAttempt[], cause: unknown) {
    super(message, {cause});
    this.name = "HarnessModelCallError";
    this.attempts = attempts;
  }
}

/** Socket-level failures worth another try; providers wrap most of these in APICallError. */
const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const errorCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as {code?: unknown}).code;
  if (typeof code === "string") {
    return code;
  }
  return errorCode((error as {cause?: unknown}).cause);
};

const isNetworkError = (error: unknown): boolean => {
  const code = errorCode(error);
  if (code && NETWORK_ERROR_CODES.has(code)) {
    return true;
  }
  // fetch() reports a dropped connection as `TypeError: fetch failed`.
  return error instanceof TypeError && /fetch failed|network/i.test(error.message);
};

/**
 * Whether a model call failure may succeed on another try: HTTP 429 and 5xx, and network
 * failures. Every other HTTP status (400, 401, 404, ...) and any non-HTTP error fails at
 * once, because repeating the same request cannot fix it.
 */
export const isRetryableModelError = (error: unknown): boolean => {
  if (APICallError.isInstance(error)) {
    if (error.statusCode !== undefined) {
      return error.statusCode === 429 || error.statusCode >= 500;
    }
    // No status: the request never got a response (the SDK marks these retryable).
    return error.isRetryable;
  }
  return isNetworkError(error);
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const statusCodeOf = (error: unknown): number | undefined =>
  APICallError.isInstance(error) ? error.statusCode : undefined;

/** Resolve after `ms`, or reject with the signal's reason as soon as it aborts. */
const abortableDelay = (ms: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, {once: true});
  });
};

const label = (ref: HarnessModelRef): string => `${ref.provider}/${ref.modelId}`;

/**
 * Call `call` with the primary model, retrying 429 / 5xx / network failures with
 * exponential backoff and equal jitter (`retry`, default 3 tries per model), then each
 * fallback model in order with the same budget. A non-retryable failure, or an aborted
 * `signal`, throws at once. Throws `HarnessModelCallError` (with every attempt) when no
 * model answered.
 */
export const callModelWithFallback = async <T>({
  call,
  models,
  random,
  resolveModel,
  retry,
  signal,
}: {
  call: (model: LanguageModel) => Promise<T>;
  /** Primary first, then fallbacks. */
  models: ReadonlyArray<HarnessModelRef>;
  random?: () => number;
  resolveModel: HarnessModelResolver;
  retry?: HarnessRetryPolicy;
  signal?: AbortSignal;
}): Promise<ModelCallResult<T>> => {
  const policy = {
    backoffMs: retry?.backoffMs ?? HARNESS_MODEL_RETRY_DEFAULTS.backoffMs,
    maxAttempts: retry?.maxAttempts ?? HARNESS_MODEL_RETRY_DEFAULTS.maxAttempts,
    maxBackoffMs: retry?.maxBackoffMs ?? HARNESS_MODEL_RETRY_DEFAULTS.maxBackoffMs,
  };
  const attempts: ModelCallAttempt[] = [];
  let lastError: unknown;

  for (const ref of models) {
    let model: LanguageModel;
    try {
      model = resolveModel(ref);
    } catch (error: unknown) {
      // A model the resolver cannot build will not appear on retry.
      attempts.push({
        attempt: 1,
        error: describeError(error),
        modelId: ref.modelId,
        provider: ref.provider,
        retryable: false,
      });
      throw new HarnessModelCallError(
        `Model ${label(ref)} could not be resolved: ${describeError(error)}`,
        attempts,
        error
      );
    }
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      if (signal?.aborted) {
        throw signal.reason;
      }
      try {
        const result = await call(model);
        attempts.push({attempt, modelId: ref.modelId, provider: ref.provider});
        return {attempts, model: ref, result};
      } catch (error: unknown) {
        if (signal?.aborted) {
          throw signal.reason ?? error;
        }
        lastError = error;
        const retryable = isRetryableModelError(error);
        attempts.push({
          attempt,
          error: describeError(error),
          modelId: ref.modelId,
          provider: ref.provider,
          retryable,
          statusCode: statusCodeOf(error),
        });
        if (!retryable) {
          throw new HarnessModelCallError(
            `Model ${label(ref)} failed with a non-retryable error: ${describeError(error)}`,
            attempts,
            error
          );
        }
        if (attempt < policy.maxAttempts) {
          await abortableDelay(retryDelayMs({failedAttempts: attempt, policy, random}), signal);
        }
      }
    }
  }
  throw new HarnessModelCallError(
    `Model call failed after ${attempts.length} attempts across ${models.map(label).join(", ")}: ${describeError(lastError)}`,
    attempts,
    lastError
  );
};
