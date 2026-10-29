import {useCallback, useEffect, useRef, useState} from "react";
import {useAdminContext} from "./adminContext";
import type {AdminRequestArgs} from "./adminRequest";
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

export const useAdminRpc = (): AdminRpc | undefined => {
  const ctx = useAdminContext();
  return ctx?.adminRpc;
};

export interface AdminRpcQueryState<T> {
  data: T | undefined;
  error: unknown;
  isFetching: boolean;
  isLoading: boolean;
  refetch: () => void;
}

/**
 * GET-style admin RPC. Skips when `rpc` is missing or `skip` is true so RTK
 * dual-run callers can keep a stable hook order.
 */
export const useAdminRpcQuery = <T = unknown>({
  pollingInterval,
  providesTags = [],
  rpc,
  skip = false,
  url,
}: {
  pollingInterval?: number;
  providesTags?: readonly string[];
  rpc?: AdminRpc;
  skip?: boolean;
  url: string;
}): AdminRpcQueryState<T> => {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(Boolean(rpc) && !skip);
  const [isFetching, setIsFetching] = useState(Boolean(rpc) && !skip);
  const [generation, setGeneration] = useState(0);
  const [requestUrl, setRequestUrl] = useState(url);
  const loadedUrlRef = useRef<string | null>(null);
  const tagsKey = providesTags.join("\u0000");

  // Drop the previous URL's body before paint so a route change cannot show it.
  if (url !== requestUrl) {
    setRequestUrl(url);
    setData(undefined);
    setError(null);
    setIsLoading(Boolean(rpc) && !skip);
    setIsFetching(Boolean(rpc) && !skip);
  }

  const refetch = useCallback((): void => {
    setGeneration((current) => current + 1);
  }, []);

  // Fetch whenever the bound client, URL, or skip flag changes.
  useEffect(() => {
    if (!rpc || skip) {
      setIsLoading(false);
      setIsFetching(false);
      return;
    }
    let cancelled = false;
    const isNewUrl = loadedUrlRef.current !== url;
    setIsLoading(isNewUrl);
    setIsFetching(true);
    if (isNewUrl) {
      // The body on screen is gone, so returning to the old URL must load it again.
      loadedUrlRef.current = null;
      setData(undefined);
    }
    setError(null);
    rpc({method: "GET", url})
      .then((result) => {
        if (!cancelled) {
          loadedUrlRef.current = url;
          setData(result as T);
          setIsLoading(false);
          setIsFetching(false);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught);
          setIsLoading(false);
          setIsFetching(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [generation, rpc, skip, url]);

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

  // Re-run the request on the same interval RTK `pollingInterval` uses.
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

  return {data, error, isFetching, isLoading, refetch};
};

export const useAdminRpcMutation = (
  rpc: AdminRpc | undefined,
  options: {invalidatesTags?: readonly string[]} = {}
): [(args: AdminRequestArgs) => {unwrap: () => Promise<unknown>}, {isLoading: boolean}] => {
  const [isLoading, setIsLoading] = useState(false);
  const trigger = useCallback(
    (args: AdminRequestArgs): {unwrap: () => Promise<unknown>} => {
      return {
        unwrap: async (): Promise<unknown> => {
          if (!rpc) {
            throw new Error("Admin RPC client is unavailable");
          }
          setIsLoading(true);
          try {
            const result = await rpc(args);
            invalidateTags(rpc, options.invalidatesTags ?? []);
            return result;
          } finally {
            setIsLoading(false);
          }
        },
      };
    },
    [options.invalidatesTags, rpc]
  );
  return [trigger, {isLoading}] as [
    (args: AdminRequestArgs) => {unwrap: () => Promise<unknown>},
    {isLoading: boolean},
  ];
};
