import {unwrapEnvelope} from "@terreno/syncdb/api";
import {useCallback, useEffect, useRef, useState} from "react";
import {useAdminContext} from "./adminContext";
import {type AdminRequestArgs, adminRequest} from "./adminRequest";
import type {AdminRpc} from "./adminRpc";

const invalidationListeners = new WeakMap<AdminRpc, Map<string, Set<() => void>>>();

const addInvalidationListener = ({
  listener,
  rpc,
  tag,
}: {
  listener: () => void;
  rpc: AdminRpc;
  tag: string;
}): (() => void) => {
  const listenersByTag = invalidationListeners.get(rpc) ?? new Map<string, Set<() => void>>();
  const listeners = listenersByTag.get(tag) ?? new Set<() => void>();
  listeners.add(listener);
  listenersByTag.set(tag, listeners);
  invalidationListeners.set(rpc, listenersByTag);
  return () => {
    listeners.delete(listener);
  };
};

const invalidateTags = (rpc: AdminRpc, tags: readonly string[]): void => {
  const listenersByTag = invalidationListeners.get(rpc);
  for (const tag of tags) {
    for (const listener of listenersByTag?.get(tag) ?? []) {
      listener();
    }
  }
};

/**
 * Unauthenticated, same-origin client used when an admin screen renders outside
 * `AdminProvider`. Hosts that need cookies, Bearer headers, or a cross-origin API
 * render `AdminProvider` instead.
 */
const defaultAdminRpc: AdminRpc = (args: AdminRequestArgs): Promise<unknown> => {
  return adminRequest(args);
};

let warnedMissingProvider = false;

/** @internal Test helper — clears the one-time missing-provider warning. */
export const resetAdminRpcWarningForTests = (): void => {
  warnedMissingProvider = false;
};

/**
 * Host-bound admin fetch client from `AdminProvider`. Outside a provider this
 * returns a plain same-origin client and warns once in development.
 */
export const useAdminRpc = (): AdminRpc => {
  const ctx = useAdminContext();
  if (ctx?.adminRpc) {
    return ctx.adminRpc;
  }
  if (!warnedMissingProvider && typeof __DEV__ !== "undefined" && __DEV__) {
    warnedMissingProvider = true;
    console.warn(
      "[admin] Admin screen rendered outside AdminProvider; requests use same-origin fetch without auth headers."
    );
  }
  return defaultAdminRpc;
};

/**
 * List envelopes (`{data, more, …}`) stay whole, and single-document envelopes
 * (`{data}`) unwrap to the document — the same rule as the syncdb API client.
 * Admin screens read this shape for model CRUD responses.
 */
export const unwrapAdminEnvelope = (result: unknown): unknown => unwrapEnvelope(result);

export interface AdminRpcRefetchResult<T> {
  data?: T;
  error?: unknown;
  isError: boolean;
}

export interface AdminRpcQueryState<T> {
  data: T | undefined;
  error: unknown;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  refetch: () => Promise<AdminRpcRefetchResult<T>>;
}

export interface AdminRpcQueryOptions {
  /** Extra request headers (for example `X-Organization-Id`). */
  headers?: Record<string, string>;
  /**
   * Keep the last body on screen, and `isLoading` false, while a new `url` loads. For paging
   * inside one list, where the table should stay up. Leave it off when the url names another
   * resource (a route change), so a body is never shown under the wrong url.
   */
  keepPreviousData?: boolean;
  pollingInterval?: number;
  providesTags?: readonly string[];
  rpc?: AdminRpc;
  skip?: boolean;
  /** Maps the parsed response before it is stored as `data`. */
  transformResponse?: (result: unknown) => unknown;
  url: string;
}

/**
 * GET-style admin query with tag invalidation, polling, and refetch. Skips when
 * `rpc` is missing or `skip` is true so callers keep a stable hook order.
 */
export const useAdminRpcQuery = <T = unknown>({
  headers,
  keepPreviousData = false,
  pollingInterval,
  providesTags = [],
  rpc,
  skip = false,
  transformResponse,
  url,
}: AdminRpcQueryOptions): AdminRpcQueryState<T> => {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(Boolean(rpc) && !skip);
  const [isFetching, setIsFetching] = useState(Boolean(rpc) && !skip);
  const [generation, setGeneration] = useState(0);
  const [requestUrl, setRequestUrl] = useState(url);
  const loadedUrlRef = useRef<string | null>(null);
  const pendingRefetchesRef = useRef<Array<(result: AdminRpcRefetchResult<T>) => void>>([]);
  const transformRef = useRef(transformResponse);
  transformRef.current = transformResponse;
  const tagsKey = providesTags.join("\u0000");
  const headersKey = headers ? JSON.stringify(headers) : "";

  // Drop the previous URL's body before paint so a route change cannot show it, unless the
  // caller pages through one list and wants the rows to stay until the next page arrives.
  if (url !== requestUrl) {
    setRequestUrl(url);
    if (!keepPreviousData) {
      setData(undefined);
      setError(null);
      setIsLoading(Boolean(rpc) && !skip);
    }
    setIsFetching(Boolean(rpc) && !skip);
  }

  const settleRefetches = useCallback((result: AdminRpcRefetchResult<T>): void => {
    const pending = pendingRefetchesRef.current;
    pendingRefetchesRef.current = [];
    for (const resolve of pending) {
      resolve(result);
    }
  }, []);

  const refetch = useCallback((): Promise<AdminRpcRefetchResult<T>> => {
    return new Promise((resolve) => {
      pendingRefetchesRef.current.push(resolve);
      setGeneration((current) => current + 1);
    });
  }, []);

  // Fetch whenever the bound client, URL, headers, or skip flag changes.
  useEffect(() => {
    if (!rpc || skip) {
      setIsLoading(false);
      setIsFetching(false);
      settleRefetches({isError: false});
      return;
    }
    let cancelled = false;
    const isNewUrl = loadedUrlRef.current !== url;
    // With keepPreviousData, only the first load of all shows as loading.
    setIsLoading(keepPreviousData ? loadedUrlRef.current === null : isNewUrl);
    setIsFetching(true);
    if (isNewUrl && !keepPreviousData) {
      // The body on screen is gone, so returning to the old URL must load it again.
      loadedUrlRef.current = null;
      setData(undefined);
    }
    setError(null);
    const requestHeaders = headersKey
      ? (JSON.parse(headersKey) as Record<string, string>)
      : undefined;
    rpc({headers: requestHeaders, method: "GET", url})
      .then((raw) => {
        if (cancelled) {
          return;
        }
        const result = (transformRef.current ? transformRef.current(raw) : raw) as T;
        loadedUrlRef.current = url;
        setData(result);
        setIsLoading(false);
        setIsFetching(false);
        settleRefetches({data: result, isError: false});
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }
        setError(caught);
        setIsLoading(false);
        setIsFetching(false);
        settleRefetches({error: caught, isError: true});
      });
    return () => {
      cancelled = true;
    };
  }, [generation, headersKey, keepPreviousData, rpc, settleRefetches, skip, url]);

  // Refetch mounted queries when a successful RPC mutation invalidates their tags.
  useEffect(() => {
    if (!rpc || skip || tagsKey.length === 0) {
      return;
    }
    const listener = (): void => {
      setGeneration((current) => current + 1);
    };
    const unsubscribe = tagsKey
      .split("\u0000")
      .map((tag) => addInvalidationListener({listener, rpc, tag}));
    return () => {
      for (const removeListener of unsubscribe) {
        removeListener();
      }
    };
  }, [rpc, skip, tagsKey]);

  // Re-run the request every `pollingInterval` milliseconds while mounted.
  useEffect(() => {
    if (!rpc || skip || !pollingInterval) {
      return;
    }
    const timer = setInterval(() => {
      setGeneration((current) => current + 1);
    }, pollingInterval);
    return () => {
      clearInterval(timer);
    };
  }, [pollingInterval, rpc, skip]);

  return {data, error, isError: Boolean(error), isFetching, isLoading, refetch};
};

export interface AdminRpcMutationOptions {
  invalidatesTags?: readonly string[];
  /** Maps the parsed response before `unwrap()` resolves. */
  transformResponse?: (result: unknown) => unknown;
}

export type AdminRpcMutationTrigger = (args: AdminRequestArgs) => {
  unwrap: () => Promise<unknown>;
};

/** Mutation-style admin request: `trigger(args).unwrap()` then invalidate tags. */
export const useAdminRpcMutation = (
  rpc: AdminRpc | undefined,
  options: AdminRpcMutationOptions = {}
): [AdminRpcMutationTrigger, {isLoading: boolean}] => {
  const [isLoading, setIsLoading] = useState(false);
  const {invalidatesTags, transformResponse} = options;
  const trigger = useCallback(
    (args: AdminRequestArgs): {unwrap: () => Promise<unknown>} => {
      return {
        unwrap: async (): Promise<unknown> => {
          if (!rpc) {
            throw new Error("Admin RPC client is unavailable");
          }
          setIsLoading(true);
          try {
            const raw = await rpc(args);
            invalidateTags(rpc, invalidatesTags ?? []);
            return transformResponse ? transformResponse(raw) : raw;
          } finally {
            setIsLoading(false);
          }
        },
      };
    },
    [invalidatesTags, rpc, transformResponse]
  );
  return [trigger, {isLoading}];
};
