/**
 * `@terreno/syncdb/flags` — feature flags for `@terreno/feature-flags` backends.
 *
 * Flags load through the syncdb request client and refresh when the server pushes
 * `featureFlagsChanged` on the syncdb socket, so an app keeps one socket.
 */
import {DateTime} from "luxon";
import {useCallback, useEffect, useMemo, useRef} from "react";

import {
  DEFAULT_FEATURE_FLAGS_BASE_PATH,
  type UseTerrenoFeatureFlagsOptions,
  useTerrenoFeatureFlags,
} from "./useTerrenoFeatureFlags";

export {
  DEFAULT_FEATURE_FLAGS_BASE_PATH,
  DEFAULT_FEATURE_FLAGS_DOMAIN,
  DEFAULT_FEATURE_FLAGS_EVENT,
  type TerrenoFlagConfiguration,
  type TerrenoFlagDefinition,
  type UseTerrenoFeatureFlagsOptions,
  type UseTerrenoFeatureFlagsResult,
  useTerrenoFeatureFlags,
} from "./useTerrenoFeatureFlags";

export interface FlagValues {
  [key: string]: boolean | string | null;
}

export type UseFeatureFlagsOptions = UseTerrenoFeatureFlagsOptions;

export interface UseFeatureFlagsResult {
  error: unknown;
  /** Each flag's value for the current user (its default variant's value). */
  flags: FlagValues;
  /** Boolean flag value; `false` for unknown, disabled, or non-boolean flags. */
  getFlag: (key: string) => boolean;
  /** String variant value; `null` for unknown or non-string flags. */
  getVariant: (key: string) => string | null;
  isLoading: boolean;
  refetch: () => void;
}

/**
 * Flat accessors over {@link useTerrenoFeatureFlags}.
 *
 * @example
 * ```typescript
 * const {getFlag, getVariant} = useFeatureFlags({skip: !userId, userId});
 *
 * const showNewCheckout = getFlag("new-checkout-flow");   // true | false
 * const variant = getVariant("checkout-experiment");       // "control" | "variant-a" | null
 * ```
 */
export const useFeatureFlags = (options: UseFeatureFlagsOptions = {}): UseFeatureFlagsResult => {
  const {client, error, flags: rawFlags, isLoading, refetch} = useTerrenoFeatureFlags(options);
  const basePath = options.basePath ?? DEFAULT_FEATURE_FLAGS_BASE_PATH;
  const fetchStartedAtRef = useRef<number | null>(null);

  // Record when a flagConfiguration load starts so completion can log its duration.
  useEffect((): void => {
    if (!isLoading || fetchStartedAtRef.current !== null) {
      return;
    }
    fetchStartedAtRef.current = DateTime.now().toMillis();
    console.debug("[feature-flags] flagConfiguration request started", {basePath});
  }, [basePath, isLoading]);

  // Log a failed load with its duration.
  useEffect((): void => {
    if (!error || fetchStartedAtRef.current === null) {
      return;
    }
    const durationMs = DateTime.now().toMillis() - fetchStartedAtRef.current;
    fetchStartedAtRef.current = null;
    console.debug("[feature-flags] flagConfiguration request failed", {
      basePath,
      durationMs,
      error,
    });
  }, [basePath, error]);

  const flatFlags = useMemo((): FlagValues => {
    const out: FlagValues = {};
    for (const [key, def] of Object.entries(rawFlags)) {
      out[key] = def.variants[def.defaultVariant] ?? null;
    }
    return out;
  }, [rawFlags]);

  // Log a completed load with its duration and the evaluated flags.
  useEffect((): void => {
    if (isLoading || fetchStartedAtRef.current === null || Object.keys(flatFlags).length === 0) {
      return;
    }
    const durationMs = DateTime.now().toMillis() - fetchStartedAtRef.current;
    fetchStartedAtRef.current = null;
    console.debug("[feature-flags] flagConfiguration request completed", {
      basePath,
      durationMs,
      evaluatedFlagCount: Object.keys(flatFlags).length,
      evaluatedFlags: flatFlags,
    });
  }, [basePath, flatFlags, isLoading]);

  const getFlag = useCallback(
    (key: string): boolean => {
      return client.getBooleanValue(key, false);
    },
    [client]
  );

  const getVariant = useCallback(
    (key: string): string | null => {
      if (!rawFlags[key]) {
        return null;
      }
      const value = client.getStringValue(key, "");
      return value === "" ? null : value;
    },
    [client, rawFlags]
  );

  const stableRefetch = useCallback((): void => {
    void refetch();
  }, [refetch]);

  return {error, flags: flatFlags, getFlag, getVariant, isLoading, refetch: stableRefetch};
};
