import {afterEach, setSystemTime} from "bun:test";
import {DateTime} from "luxon";

export type FreezeTimeInput = string | DateTime;

export interface FreezeTimeOptions {
  /** Restore the previous clock after the current test. Defaults to true. */
  restoreAfterEach?: boolean;
}

// Instants frozen by calls that have not been restored, oldest first. Restoring re-freezes to the
// newest remaining entry, so nested freezes unwind in any order.
const activeFreezes: Array<{millis: number}> = [];

const toFrozenDateTime = (input: FreezeTimeInput): DateTime => {
  const dateTime = typeof input === "string" ? DateTime.fromISO(input, {setZone: true}) : input;
  if (!dateTime.isValid) {
    const invalidInput = typeof input === "string" ? input : String(input.invalidExplanation);
    throw new Error(`freezeTime: invalid date/time "${invalidInput}" (${dateTime.invalidReason})`);
  }
  return dateTime;
};

/**
 * Freezes the clock at `input` for `Date.now()`, `new Date()`, and Luxon's `DateTime.now()`.
 *
 * Uses Bun's `setSystemTime` and also replaces `Date.now`, so it still wins when a preload has
 * swapped `Date.now` for its own mock. By default it restores the previous clock after the current
 * test (call it in `beforeEach` or inside a test). Returns a restore function for un-freezing
 * earlier; calling it twice is a no-op. Do not mix with direct `setSystemTime` calls in the same
 * test: restoring the last freeze resets the system clock to real time.
 */
export const freezeTime = (
  input: FreezeTimeInput,
  {restoreAfterEach = true}: FreezeTimeOptions = {}
): (() => void) => {
  const millis = toFrozenDateTime(input).toMillis();
  const entry = {millis};
  const previousDateNow = Date.now;

  activeFreezes.push(entry);
  setSystemTime(new Date(millis));
  Date.now = (): number => millis;

  let isRestored = false;
  const restore = (): void => {
    if (isRestored) {
      return;
    }
    isRestored = true;
    Date.now = previousDateNow;
    activeFreezes.splice(activeFreezes.indexOf(entry), 1);
    const newest = activeFreezes.at(-1);
    setSystemTime(newest ? new Date(newest.millis) : undefined);
  };

  if (restoreAfterEach) {
    afterEach(restore);
  }
  return restore;
};
