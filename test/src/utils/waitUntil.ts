export interface WaitUntilOptions {
  /** Maximum time to poll before throwing. Keep it below the test's own timeout so this error wins. */
  timeoutMs?: number;
  /** Delay between polling attempts. */
  intervalMs?: number;
  /** Named in the timeout error so a failure says what never happened. */
  label?: string;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls `predicate` until it returns (or resolves to) true, or throws after `timeoutMs`.
 *
 * Use it instead of a fixed sleep: it returns as soon as the condition holds and fails with the
 * label and elapsed time when it never does. Elapsed time uses `performance.now()`, so polling
 * still advances while `Date.now()` is frozen by `freezeTime` or `setSystemTime`.
 */
export const waitUntil = async (
  predicate: () => boolean | Promise<boolean>,
  {timeoutMs = 1000, intervalMs = 10, label}: WaitUntilOptions = {}
): Promise<void> => {
  const start = performance.now();
  for (;;) {
    if (await predicate()) {
      return;
    }
    const elapsed = performance.now() - start;
    if (elapsed >= timeoutMs) {
      const labelSuffix = label ? ` waiting for: ${label}` : "";
      throw new Error(`waitUntil timed out after ${Math.round(elapsed)}ms${labelSuffix}`);
    }
    await delay(intervalMs);
  }
};

/** Waits until a Bun `mock()` / `spyOn()` function has been called at least `callCount` times. */
export const waitForCalls = async (
  mockFn: {mock: {calls: unknown[]}},
  callCount: number,
  options: WaitUntilOptions = {}
): Promise<void> => {
  await waitUntil(() => mockFn.mock.calls.length >= callCount, {
    label: `mock to be called ${callCount} time(s) (called ${mockFn.mock.calls.length})`,
    ...options,
  });
};
