import {NOOP_PROVIDER, OpenFeature, TypedInMemoryProvider} from "@openfeature/web-sdk";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import type {ApiClient} from "../api/client";
import {useApiQuery} from "../react/apiHooks";
import {useOptionalSyncDbClient} from "../react/provider";
import {type SocketEventSource, useSocketEvent} from "../react/useSocketEvent";

/** One flag in `GET {basePath}/flagConfiguration` (OpenFeature static flag map). */
export interface TerrenoFlagDefinition {
  defaultVariant: string;
  disabled: boolean;
  variants: Record<string, boolean | string>;
}

export type TerrenoFlagConfiguration = Record<string, TerrenoFlagDefinition>;

/** Default OpenFeature domain; must match `<OpenFeatureProvider domain>` in the app. */
export const DEFAULT_FEATURE_FLAGS_DOMAIN = "feature-flags";

/** Default route prefix of `@terreno/feature-flags` `FeatureFlagsApp`. */
export const DEFAULT_FEATURE_FLAGS_BASE_PATH = "/feature-flags";

/** Event `FeatureFlagsApp` `liveUpdates` emits when a flag changes. */
export const DEFAULT_FEATURE_FLAGS_EVENT = "featureFlagsChanged";

export interface UseTerrenoFeatureFlagsOptions {
  basePath?: string;
  skip?: boolean;
  /** Current user id. A change refetches and becomes the OpenFeature targeting key. */
  userId?: string | null;
  /** Request client. Defaults to the one from `ApiClientProvider`. */
  client?: ApiClient;
  /**
   * Socket that pushes flag changes. Defaults to the `SyncDbProvider` client when one
   * is mounted; pass the app's `syncDb` when this hook sits above that provider, or
   * `null` to turn live refresh off.
   */
  socket?: SocketEventSource | null;
  /** Server push event. Default `featureFlagsChanged` (matches `FeatureFlagsApp`). */
  socketEventName?: string;
  /** OpenFeature domain — must match `<OpenFeatureProvider domain>` on the client. */
  domain?: string;
}

export interface UseTerrenoFeatureFlagsResult {
  client: ReturnType<typeof OpenFeature.getClient>;
  error: unknown;
  flags: TerrenoFlagConfiguration;
  isLoading: boolean;
  refetch: () => Promise<unknown>;
}

const EMPTY_FLAGS: TerrenoFlagConfiguration = {};

/** Mounted `useTerrenoFeatureFlags` instances per OpenFeature domain (last unmount installs NOOP). */
const domainRefCounts = new Map<string, number>();

/** Last in-flight `setProviderAndWait` per OpenFeature domain (shared across hook instances). */
const domainProviderSwitches = new Map<string, Promise<void>>();

/** Serialize provider switches per domain so a late NOOP never overwrites fresh flags. */
const switchProvider = async (
  domain: string,
  provider: Parameters<typeof OpenFeature.setProviderAndWait>[1]
): Promise<void> => {
  const pending = domainProviderSwitches.get(domain);
  const run = (async (): Promise<void> => {
    if (pending !== undefined) {
      await pending;
    }
    await OpenFeature.setProviderAndWait(domain, provider);
  })();
  domainProviderSwitches.set(domain, run);
  try {
    await run;
  } finally {
    if (domainProviderSwitches.get(domain) === run) {
      domainProviderSwitches.delete(domain);
    }
  }
};

/**
 * Loads `GET {basePath}/flagConfiguration` through the syncdb request client into
 * OpenFeature's {@link TypedInMemoryProvider} for `domain`, and refetches whenever the
 * server pushes `featureFlagsChanged` on the syncdb socket. Read values with OpenFeature
 * React hooks (`useBooleanFlagValue`, …) under `<OpenFeatureProvider domain>`, or use
 * {@link useFeatureFlags} for flat accessors.
 */
export const useTerrenoFeatureFlags = (
  options: UseTerrenoFeatureFlagsOptions = {}
): UseTerrenoFeatureFlagsResult => {
  const basePath = options.basePath ?? DEFAULT_FEATURE_FLAGS_BASE_PATH;
  const domain = options.domain ?? DEFAULT_FEATURE_FLAGS_DOMAIN;
  const userId = options.userId ?? null;
  const skip = options.skip === true;
  const socketEventName = options.socketEventName ?? DEFAULT_FEATURE_FLAGS_EVENT;
  const contextSyncDb = useOptionalSyncDbClient();
  const socket = options.socket === undefined ? contextSyncDb : options.socket;

  const {data, error, isError, isFetching, isSuccess, refetch} =
    useApiQuery<TerrenoFlagConfiguration>(
      {method: "GET", url: `${basePath}/flagConfiguration`},
      {client: options.client, providesTags: ["feature-flags"], skip}
    );

  const [providerReady, setProviderReady] = useState<boolean>(skip);
  const client = useMemo(() => OpenFeature.getClient(domain), [domain]);

  // Count mounted instances per domain; the last one out restores the NOOP provider.
  useEffect((): (() => void) => {
    domainRefCounts.set(domain, (domainRefCounts.get(domain) ?? 0) + 1);
    return (): void => {
      const next = (domainRefCounts.get(domain) ?? 0) - 1;
      if (next > 0) {
        domainRefCounts.set(domain, next);
        return;
      }
      domainRefCounts.delete(domain);
      void switchProvider(domain, NOOP_PROVIDER);
    };
  }, [domain]);

  // Target the current user so OpenFeature context matches the server's evaluation.
  useEffect((): void => {
    if (skip) {
      return;
    }
    void OpenFeature.setContext(domain, {targetingKey: userId ?? ""});
  }, [domain, skip, userId]);

  // Hold loading until the provider for the new user has been installed.
  useEffect((): void => {
    setProviderReady(skip);
  }, [skip, userId]);

  // A different user gets different flag evaluations; fetch theirs instead of reusing the cache.
  const previousUserIdRef = useRef(userId);
  useEffect((): void => {
    if (previousUserIdRef.current === userId) {
      return;
    }
    previousUserIdRef.current = userId;
    if (!skip) {
      void refetch();
    }
  }, [refetch, skip, userId]);

  // Install fetched flags as the domain's provider whenever the configuration changes.
  useEffect((): (() => void) | undefined => {
    if (skip || !isSuccess || !data) {
      return undefined;
    }
    let cancelled = false;
    void switchProvider(domain, new TypedInMemoryProvider(data)).then((): void => {
      if (!cancelled) {
        setProviderReady(true);
      }
    });
    return (): void => {
      cancelled = true;
    };
  }, [data, domain, isSuccess, skip]);

  const handleFlagsChanged = useCallback((): void => {
    void refetch();
  }, [refetch]);
  useSocketEvent(socketEventName, handleFlagsChanged, {client: socket, enabled: !skip});

  const isLoading = useMemo((): boolean => {
    if (skip || isError) {
      return false;
    }
    if (!isSuccess || !data || isFetching) {
      return true;
    }
    return !providerReady;
  }, [data, isError, isFetching, isSuccess, providerReady, skip]);

  return {
    client,
    error,
    flags: data ?? EMPTY_FLAGS,
    isLoading,
    refetch,
  };
};
