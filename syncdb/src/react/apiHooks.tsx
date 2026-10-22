/**
 * React bindings for the `@terreno/syncdb/api` request client. Call shapes follow
 * RTK Query (`{data, isLoading, refetch}`, `[trigger, state]`, `.unwrap()`) so
 * generated hooks and migrated screens read the same way.
 */
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {type ApiClient, type ApiQueryState, type ApiRequestArgs, apiQueryKey} from "../api/client";

const ApiClientContext = createContext<ApiClient | null>(null);

export interface ApiClientProviderProps {
  client: ApiClient;
  children?: React.ReactNode;
}

/** Makes an {@link ApiClient} available to `useApiQuery` / `useApiMutation`. */
export const ApiClientProvider: React.FC<ApiClientProviderProps> = ({client, children}) => (
  <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>
);

/** The client from the nearest `ApiClientProvider`, or `override` when given. */
export const useApiClient = (override?: ApiClient): ApiClient => {
  const fromContext = useContext(ApiClientContext);
  const client = override ?? fromContext;
  if (!client) {
    throw new Error(
      "useApiClient: wrap the tree in <ApiClientProvider client={...}> or pass `client`."
    );
  }
  return client;
};

/** Result promise for triggers: resolves `{data}` / `{error}`; `unwrap()` rejects on error. */
export type ApiTriggerResult<T> = Promise<
  {data: T; error?: undefined} | {data?: undefined; error: unknown}
> & {
  unwrap: () => Promise<T>;
};

const toTriggerResult = <T,>(promise: Promise<T>): ApiTriggerResult<T> => {
  const settled = promise.then(
    (data) => ({data}),
    (error: unknown) => ({error})
  );
  // unwrap() is optional for callers, so keep its rejection from being unhandled.
  promise.catch(() => {});
  return Object.assign(settled, {unwrap: () => promise});
};

export interface UseApiQueryOptions<TRaw, TData> {
  skip?: boolean;
  providesTags?: readonly string[];
  /** Re-request on this interval (ms) while mounted. */
  pollingInterval?: number;
  transformResponse?: (raw: TRaw) => TData;
  client?: ApiClient;
}

export interface ApiRefetchResult<T> {
  data?: T;
  error?: unknown;
  isError: boolean;
}

export interface UseApiQueryResult<T> {
  data: T | undefined;
  error: unknown;
  isUninitialized: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  isError: boolean;
  refetch: () => Promise<ApiRefetchResult<T>>;
}

const IDLE: ApiQueryState = {
  data: undefined,
  error: undefined,
  isFetching: false,
  status: "uninitialized",
};

const noopUnsubscribe = (): void => {};

/**
 * Cached GET-style request. Identical args share one cache entry across the app.
 * Pass `null` args or `skip: true` to hold off (hook order stays stable).
 */
export const useApiQuery = <TRaw = unknown, TData = TRaw>(
  args: ApiRequestArgs | null,
  options: UseApiQueryOptions<TRaw, TData> = {}
): UseApiQueryResult<TData> => {
  const client = useApiClient(options.client);
  const active = args !== null && !options.skip;
  const key = active ? apiQueryKey(args) : null;
  const argsRef = useRef(args);
  argsRef.current = args;
  const tagsKey = (options.providesTags ?? []).join("\u0000");
  const providesTags = useMemo(() => (tagsKey ? tagsKey.split("\u0000") : []), [tagsKey]);

  const subscribe = useCallback(
    (listener: () => void): (() => void) => {
      if (!key || !argsRef.current) {
        return noopUnsubscribe;
      }
      return client.subscribeQuery(argsRef.current, listener, {providesTags});
    },
    [client, key, providesTags]
  );
  const getSnapshot = useCallback(
    (): ApiQueryState => (key && argsRef.current ? client.getQueryState(argsRef.current) : IDLE),
    [client, key]
  );
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Load on mount, on arg change, and again after a reset or tag drop empties the entry. Keyed on
  // the state object, not its status: a reset in the same commit as the first request turns
  // `uninitialized` → `pending` → `uninitialized` before the next render sees it.
  useEffect(() => {
    if (!key || !argsRef.current || state.status !== "uninitialized") {
      return;
    }
    client.fetchQuery(argsRef.current, {providesTags}).catch(() => {});
  }, [client, key, providesTags, state]);

  // A new subscriber retries a previously failed request once, like RTK Query does.
  const retriedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!key || !argsRef.current || retriedKey.current === key) {
      return;
    }
    retriedKey.current = key;
    if (client.getQueryState(argsRef.current).status === "rejected") {
      client.fetchQuery(argsRef.current, {force: true, providesTags}).catch(() => {});
    }
  }, [client, key, providesTags]);

  // Poll while mounted, matching RTK's `pollingInterval`.
  useEffect(() => {
    if (!key || !options.pollingInterval) {
      return;
    }
    const timer = setInterval(() => {
      if (argsRef.current) {
        client.fetchQuery(argsRef.current, {force: true, providesTags}).catch(() => {});
      }
    }, options.pollingInterval);
    return () => {
      clearInterval(timer);
    };
  }, [client, key, options.pollingInterval, providesTags]);

  const transformRef = useRef(options.transformResponse);
  transformRef.current = options.transformResponse;
  const rawData = state.data as TRaw | undefined;
  const data = useMemo(
    (): TData | undefined =>
      rawData === undefined || !transformRef.current
        ? (rawData as unknown as TData | undefined)
        : transformRef.current(rawData),
    [rawData]
  );

  const refetch = useCallback(async (): Promise<ApiRefetchResult<TData>> => {
    if (!key || !argsRef.current) {
      return {isError: false};
    }
    try {
      const raw = (await client.fetchQuery(argsRef.current, {force: true, providesTags})) as TRaw;
      const transformed = transformRef.current
        ? transformRef.current(raw)
        : (raw as unknown as TData);
      return {data: transformed, isError: false};
    } catch (error) {
      return {error, isError: true};
    }
  }, [client, key, providesTags]);

  return {
    data,
    error: state.error,
    isError: state.status === "rejected",
    isFetching: state.isFetching,
    isLoading: active && state.data === undefined && state.status !== "rejected",
    isSuccess: state.status === "fulfilled",
    isUninitialized: !active,
    refetch,
  };
};

export type UseLazyApiQueryResult<T, TArg = ApiRequestArgs> = [
  (arg: TArg) => ApiTriggerResult<T>,
  UseApiQueryResult<T> & {lastArgs: ApiRequestArgs | null},
];

export interface UseLazyApiQueryOptions<T, TArg>
  extends Omit<UseApiQueryOptions<T, T>, "skip" | "transformResponse"> {
  /** Map a typed trigger argument to request args (generated hooks pass this). */
  toRequest?: (arg: TArg) => ApiRequestArgs;
}

/** Query that runs only when triggered; each trigger fetches fresh data. */
export const useLazyApiQuery = <T = unknown, TArg = ApiRequestArgs>(
  options: UseLazyApiQueryOptions<T, TArg> = {}
): UseLazyApiQueryResult<T, TArg> => {
  const {toRequest, ...queryOptions} = options;
  const client = useApiClient(queryOptions.client);
  const [lastArgs, setLastArgs] = useState<ApiRequestArgs | null>(null);
  const state = useApiQuery<T>(lastArgs, {...queryOptions, client});
  const tagsKey = (queryOptions.providesTags ?? []).join("\u0000");
  const toRequestRef = useRef(toRequest);
  toRequestRef.current = toRequest;
  const trigger = useCallback(
    (arg: TArg): ApiTriggerResult<T> => {
      const args = toRequestRef.current ? toRequestRef.current(arg) : (arg as ApiRequestArgs);
      setLastArgs(args);
      const providesTags = tagsKey ? tagsKey.split("\u0000") : [];
      return toTriggerResult(client.fetchQuery<T>(args, {force: true, providesTags}));
    },
    [client, tagsKey]
  );
  return [trigger, {...state, lastArgs}];
};

export interface UseApiMutationOptions<TArg, TResult> {
  invalidatesTags?: readonly string[] | ((result: TResult, arg: TArg) => readonly string[]);
  client?: ApiClient;
}

export interface ApiMutationState<T> {
  data: T | undefined;
  error: unknown;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  reset: () => void;
}

interface MutationSnapshot<T> {
  data: T | undefined;
  error: unknown;
  status: "idle" | "pending" | "fulfilled" | "rejected";
}

export type UseApiMutationResult<TArg, TResult> = [
  (arg: TArg) => ApiTriggerResult<TResult>,
  ApiMutationState<TResult>,
];

/**
 * Write-style request. `trigger(arg)` resolves `{data}` or `{error}`;
 * `trigger(arg).unwrap()` resolves the data or throws the `ApiError`.
 */
export const useApiMutation = <TArg = void, TResult = unknown>(
  toRequest: (arg: TArg) => ApiRequestArgs,
  options: UseApiMutationOptions<TArg, TResult> = {}
): UseApiMutationResult<TArg, TResult> => {
  const client = useApiClient(options.client);
  const [snapshot, setSnapshot] = useState<MutationSnapshot<TResult>>({
    data: undefined,
    error: undefined,
    status: "idle",
  });
  const toRequestRef = useRef(toRequest);
  toRequestRef.current = toRequest;
  const invalidatesRef = useRef(options.invalidatesTags);
  invalidatesRef.current = options.invalidatesTags;
  const latestCall = useRef(0);
  const mounted = useRef(true);

  // Ignore results that settle after unmount.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const trigger = useCallback(
    (arg: TArg): ApiTriggerResult<TResult> => {
      latestCall.current += 1;
      const call = latestCall.current;
      const update = (next: MutationSnapshot<TResult>): void => {
        if (mounted.current && call === latestCall.current) {
          setSnapshot(next);
        }
      };
      update({data: undefined, error: undefined, status: "pending"});
      const promise = client.request<TResult>(toRequestRef.current(arg)).then(
        (data) => {
          const invalidates = invalidatesRef.current;
          const tags = typeof invalidates === "function" ? invalidates(data, arg) : invalidates;
          if (tags?.length) {
            client.invalidateTags(tags);
          }
          update({data, error: undefined, status: "fulfilled"});
          return data;
        },
        (error: unknown) => {
          update({data: undefined, error, status: "rejected"});
          throw error;
        }
      );
      return toTriggerResult(promise);
    },
    [client]
  );

  const reset = useCallback((): void => {
    latestCall.current += 1;
    setSnapshot({data: undefined, error: undefined, status: "idle"});
  }, []);

  return [
    trigger,
    {
      data: snapshot.data,
      error: snapshot.error,
      isError: snapshot.status === "rejected",
      isLoading: snapshot.status === "pending",
      isSuccess: snapshot.status === "fulfilled",
      reset,
    },
  ];
};
