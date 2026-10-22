import {useCallback, useEffect, useRef, useState} from "react";

/**
 * One request made through a {@link TerrenoRequestClient}. A narrow subset of the
 * `@terreno/syncdb/api` `ApiRequestArgs` shape, so a syncdb `ApiClient` satisfies
 * {@link TerrenoRequestClient} without `@terreno/ui` depending on syncdb.
 */
export interface TerrenoRequestArgs {
  /** Path or absolute URL. Relative paths are resolved against the client's base URL. */
  url: string;
  /** HTTP method; defaults to `GET`. */
  method?: string;
  /** Query-string parameters. `undefined` values are omitted. */
  params?: Record<string, unknown>;
  /** JSON request body. */
  body?: Record<string, unknown> | null;
  headers?: Record<string, string>;
  /** Unwrap `{data}` response envelopes (default `true`). */
  unwrap?: boolean;
}

/**
 * Minimal request client the consent and announcement components use. Pass the app's
 * `@terreno/syncdb/api` client (`createApiClient(...)`), or any object with a matching
 * `request` method. Failed requests should reject with an error carrying the HTTP
 * `status` so 401/403 responses fall through to the app's auth handling.
 */
export interface TerrenoRequestClient {
  request: <T = unknown>(args: TerrenoRequestArgs) => Promise<T>;
}

type TagListener = () => void;

const tagListenersByClient = new WeakMap<TerrenoRequestClient, Map<string, Set<TagListener>>>();

/** Listen for invalidations of `tag` on `client`. Returns unsubscribe. */
const subscribeClientTag = ({
  client,
  listener,
  tag,
}: {
  client: TerrenoRequestClient;
  listener: TagListener;
  tag: string;
}): (() => void) => {
  let byTag = tagListenersByClient.get(client);
  if (!byTag) {
    byTag = new Map();
    tagListenersByClient.set(client, byTag);
  }
  let listeners = byTag.get(tag);
  if (!listeners) {
    listeners = new Set();
    byTag.set(tag, listeners);
  }
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};

/**
 * Refetch every mounted {@link useClientQuery} on `client` that provides one of `tags`.
 * Mutations call this after success, the way RTK `invalidatesTags` did.
 */
export const invalidateClientTags = ({
  client,
  tags,
}: {
  client: TerrenoRequestClient;
  tags: readonly string[];
}): void => {
  const byTag = tagListenersByClient.get(client);
  if (!byTag) {
    return;
  }
  for (const tag of tags) {
    for (const listener of [...(byTag.get(tag) ?? [])]) {
      listener();
    }
  }
};

export interface ClientQueryResult<T> {
  data: T | undefined;
  error: unknown;
  /** True while a request is in flight and none has succeeded yet. */
  isLoading: boolean;
  /** True while any request is in flight. */
  isFetching: boolean;
  /** Fetch again. Joins a request that is already in flight. */
  refetch: () => Promise<void>;
}

/**
 * Run `fetcher` on mount and whenever its identity changes, keeping loading / error /
 * data in React state. `providesTag` refetches the query when a mutation invalidates it.
 */
export const useClientQuery = <T>({
  client,
  fetcher,
  providesTag,
}: {
  client: TerrenoRequestClient;
  /** Memoize with `useCallback`; a new identity triggers a new request. */
  fetcher: () => Promise<T>;
  providesTag?: string;
}): ClientQueryResult<T> => {
  const [data, setData] = useState<T | undefined>(undefined);
  const [hasData, setHasData] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [isFetching, setIsFetching] = useState(true);
  const generationRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | undefined>(undefined);
  const isMountedRef = useRef(true);

  const run = useCallback((): Promise<void> => {
    generationRef.current += 1;
    const generation = generationRef.current;
    setIsFetching(true);
    setError(undefined);
    const promise = fetcher().then(
      (result) => {
        if (generation !== generationRef.current || !isMountedRef.current) {
          return;
        }
        setData(result);
        setHasData(true);
        setIsFetching(false);
      },
      (fetchError: unknown) => {
        if (generation !== generationRef.current || !isMountedRef.current) {
          return;
        }
        setError(fetchError);
        setIsFetching(false);
      }
    );
    const tracked = promise.finally(() => {
      if (inFlightRef.current === tracked) {
        inFlightRef.current = undefined;
      }
    });
    inFlightRef.current = tracked;
    return tracked;
  }, [fetcher]);

  const refetch = useCallback((): Promise<void> => {
    return inFlightRef.current ?? run();
  }, [run]);

  // Fetch on mount and whenever the fetcher (client, URL, or params) changes.
  useEffect(() => {
    isMountedRef.current = true;
    void run();
    return (): void => {
      isMountedRef.current = false;
      inFlightRef.current = undefined;
    };
  }, [run]);

  // Refetch with a fresh request when a mutation invalidates this query's tag.
  useEffect(() => {
    if (!providesTag) {
      return undefined;
    }
    return subscribeClientTag({
      client,
      listener: () => {
        void run();
      },
      tag: providesTag,
    });
  }, [client, providesTag, run]);

  return {
    data,
    error,
    isFetching,
    isLoading: isFetching && !hasData,
    refetch,
  };
};

export interface ClientMutationResult<A> {
  /** Run the mutation; rejects with the request error. */
  mutate: (args: A) => Promise<void>;
  error: unknown;
  isLoading: boolean;
}

/**
 * Track loading / error state for a request that changes server state. `mutate` keeps a
 * stable identity across renders so it is safe in effect dependency lists.
 */
export const useClientMutation = <A>({
  run,
}: {
  run: (args: A) => Promise<void>;
}): ClientMutationResult<A> => {
  const [error, setError] = useState<unknown>(undefined);
  const [pendingCount, setPendingCount] = useState(0);
  const runRef = useRef(run);
  runRef.current = run;

  const mutate = useCallback(async (args: A): Promise<void> => {
    setPendingCount((count) => count + 1);
    setError(undefined);
    try {
      await runRef.current(args);
    } catch (mutationError) {
      setError(mutationError);
      throw mutationError;
    } finally {
      setPendingCount((count) => count - 1);
    }
  }, []);

  return {error, isLoading: pendingCount > 0, mutate};
};

/** Accept both bare payloads and `{data}` envelopes (when a client does not unwrap). */
export const unwrapDataEnvelope = <T>(value: unknown): T | undefined => {
  if (value && typeof value === "object" && !Array.isArray(value) && "data" in value) {
    return (value as {data?: T}).data;
  }
  return value as T | undefined;
};
