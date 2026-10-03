import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {DateTime, Settings} from "luxon";
import {harnessErrorMatching} from "../tests/harnessErrors";
import {defineTask} from "./defineTask";
import {nextRetryAt, resolveRetryPolicy} from "./retryBackoff";

const policy = {backoffMs: 1000, maxAttempts: 5, maxBackoffMs: 5000};
const frozen = DateTime.fromISO("2026-10-03T12:00:00.000Z");

/** Retry delay in ms, measured against a frozen Luxon clock. */
const retryDelayMs = ({
  failedAttempts,
  random,
}: {
  failedAttempts: number;
  random?: () => number;
}): number => nextRetryAt({failedAttempts, policy, random}).toMillis() - frozen.toMillis();

describe("retryBackoff", () => {
  beforeEach(() => {
    Settings.now = () => frozen.toMillis();
  });

  afterEach(() => {
    Settings.now = () => Date.now();
  });

  it("fills omitted retry fields with the defaults", () => {
    expect(resolveRetryPolicy(undefined)).toEqual({
      backoffMs: 1000,
      maxAttempts: 3,
      maxBackoffMs: 60_000,
    });
    expect(resolveRetryPolicy({maxAttempts: 7})).toEqual({
      backoffMs: 1000,
      maxAttempts: 7,
      maxBackoffMs: 60_000,
    });
  });

  it("doubles the delay per failure and caps it at maxBackoffMs", () => {
    const fullDelay = (failedAttempts: number): number =>
      retryDelayMs({failedAttempts, random: () => 1});
    expect([1, 2, 3, 4, 5].map(fullDelay)).toEqual([1000, 2000, 4000, 5000, 5000]);
  });

  it("applies equal jitter: between half and all of the capped delay", () => {
    expect(retryDelayMs({failedAttempts: 2, random: () => 0})).toBe(1000);
    expect(retryDelayMs({failedAttempts: 2, random: () => 0.5})).toBe(1500);
    for (let i = 0; i < 50; i++) {
      const delay = retryDelayMs({failedAttempts: 3});
      expect(delay).toBeGreaterThanOrEqual(2000);
      expect(delay).toBeLessThanOrEqual(4000);
    }
  });

  it("measures the retry time from Luxon's clock", () => {
    const runAt = nextRetryAt({failedAttempts: 1, policy, random: () => 0.5});
    expect(runAt.toMillis() - frozen.toMillis()).toBe(750);
  });

  it("rejects retry policies defineTask cannot apply", () => {
    const build = (retry: Record<string, number>): unknown =>
      defineTask({
        initial: () => ({phase: "only"}),
        name: "test.badRetry",
        phases: {only: {run: async (_task, rt) => rt.commit({terminal: {status: "completed"}})}},
        retry,
        version: 1,
      });
    expect(() => build({maxAttempts: 0})).toThrow(
      harnessErrorMatching("definitionInvalid", "retry.maxAttempts must be a positive integer")
    );
    expect(() => build({maxAttempts: 1.5})).toThrow(
      harnessErrorMatching("definitionInvalid", "retry.maxAttempts must be a positive integer")
    );
    expect(() => build({backoffMs: -1})).toThrow(
      harnessErrorMatching("definitionInvalid", "retry.backoffMs must be a non-negative number")
    );
    expect(() => build({backoffMs: 500, maxBackoffMs: 100})).toThrow(
      harnessErrorMatching(
        "definitionInvalid",
        "retry.maxBackoffMs must be at least retry.backoffMs"
      )
    );
    expect(() => build({backoffMs: 0, maxAttempts: 1})).not.toThrow();
  });

  it("rejects a non-function abort handler", () => {
    expect(() =>
      defineTask({
        abort: "nope" as unknown as () => Promise<void>,
        initial: () => ({phase: "only"}),
        name: "test.badAbort",
        phases: {only: {run: async (_task, rt) => rt.commit({terminal: {status: "completed"}})}},
        version: 1,
      })
    ).toThrow(harnessErrorMatching("definitionInvalid", "abort must be a function"));
  });
});
