/**
 * `@terreno/syncdb/api` — request client for every non-synced `@terreno/api` route
 * (`/auth/me`, modelRouter actions, AI, consents, …). Synced collections use the
 * local-first store instead; this client covers request/response APIs.
 *
 * It shares the {@link AuthProvider} contract with `createSyncDb`, so sync and
 * request traffic authenticate (and refresh on 401) the same way.
 */
import type {AuthProvider} from "../types";
import {API_ERROR_CODES, ApiError} from "./apiError";
import {
  type ApiFetchArgs,
  apiFetch,
  type FetchLike,
  resolveApiUrl,
  unwrapEnvelope,
} from "./apiFetch";

export {API_ERROR_CODES, ApiError, type ApiErrorData, isApiError} from "./apiError";
export {
  type ApiFetchArgs,
  apiFetch,
  DEFAULT_API_TIMEOUT_MS,
  type FetchLike,
  resolveApiUrl,
  serializeParams,
  unwrapEnvelope,
} from "./apiFetch";

/** How long an unsubscribed cache entry survives before it is dropped. */
export const DEFAULT_KEEP_UNUSED_DATA_MS = 60_000;

export interface ApiRequestArgs extends Omit<ApiFetchArgs, "fetchImpl" | "headers"> {
  headers?: Record<string, string>;
  /** Unwrap `{data}` single-document envelopes (default `true`). */
  unwrap?: boolean;
}

export interface ApiClientConfig {
  /** API origin; relative request URLs are prefixed with it. */
  baseUrl?: string;
  /** Same provider passed to `createSyncDb`. Only `getToken` and `refresh` are used. */
  authProvider?: Pick<AuthProvider, "getToken"> & Partial<Pick<AuthProvider, "refresh">>;
  /** `"include"` for cookie sessions across origins, `"same-origin"` for SPAs. */
  credentials?: RequestCredentials;
  /** Extra headers on every request (e.g. `App-Version`, `App-Platform`). */
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Called for every failed request, after any refresh retry (e.g. report to Sentry). */
  onError?: (error: ApiError, args: ApiRequestArgs) => void;
  keepUnusedDataMs?: number;
}

export type ApiQueryStatus = "uninitialized" | "pending" | "fulfilled" | "rejected";

export interface ApiQueryState<T = unknown> {
  status: ApiQueryStatus;
  data: T | undefined;
  error: unknown;
  /** True while any request (first load or refetch) is in flight. */
  isFetching: boolean;
}

export interface ApiQueryOptions {
  providesTags?: readonly string[];
  /** Ignore cached data and in-flight requests and fetch again. */
  force?: boolean;
}

export interface ApiClient {
  readonly baseUrl: string | undefined;
  /** One uncached request with auth, refresh-on-401, and envelope unwrapping. */
  request: <T = unknown>(args: ApiRequestArgs) => Promise<T>;
  /** Cached request: dedupes identical in-flight calls and reuses fulfilled data. */
  fetchQuery: <T = unknown>(args: ApiRequestArgs, options?: ApiQueryOptions) => Promise<T>;
  getQueryState: <T = unknown>(args: ApiRequestArgs) => ApiQueryState<T>;
  /** Listen for state changes on one cache entry. Returns unsubscribe. */
  subscribeQuery: (
    args: ApiRequestArgs,
    listener: () => void,
    options?: Pick<ApiQueryOptions, "providesTags">
  ) => () => void;
  /** Refetch subscribed entries carrying any of `tags`; drop unsubscribed ones. */
  invalidateTags: (tags: readonly string[]) => void;
  /** Drop every cache entry (call on logout / user switch). */
  reset: () => void;
}

interface CacheEntry {
  args: ApiRequestArgs;
  state: ApiQueryState;
  listeners: Set<() => void>;
  tags: Set<string>;
  inFlight: Promise<unknown> | undefined;
  generation: number;
  gcTimer: ReturnType<typeof setTimeout> | undefined;
}

const UNINITIALIZED: ApiQueryState = {
  data: undefined,
  error: undefined,
  isFetching: false,
  status: "uninitialized",
};

const sortedJson = (value: unknown): string =>
  JSON.stringify(value, (_key, nested: unknown) => {
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return Object.fromEntries(
        Object.entries(nested as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      );
    }
    return nested;
  });

const isPlainBody = (body: unknown): boolean =>
  body != null &&
  typeof body === "object" &&
  (Array.isArray(body) || Object.getPrototypeOf(body) === Object.prototype);

/**
 * Stable cache key: method, URL, params, headers, JSON or string body, and unwrap mode.
 * FormData and Blob bodies are not part of the key; send those with `request()`.
 */
export const apiQueryKey = (args: ApiRequestArgs): string =>
  sortedJson([
    (args.method ?? "GET").toUpperCase(),
    args.url,
    args.params ?? null,
    args.headers ?? null,
    isPlainBody(args.body) ? args.body : typeof args.body === "string" ? args.body : null,
    args.unwrap ?? true,
  ]);

/** Create a request client. One per app; pass it to `ApiClientProvider`. */
export const createApiClient = (config: ApiClientConfig = {}): ApiClient => {
  const keepUnusedDataMs = config.keepUnusedDataMs ?? DEFAULT_KEEP_UNUSED_DATA_MS;
  const entries = new Map<string, CacheEntry>();
  let refreshing: Promise<boolean> | undefined;

  // Concurrent 401s share one refresh so a burst of queries refreshes the token once.
  const refreshOnce = (refresh: () => Promise<boolean>): Promise<boolean> => {
    refreshing ??= refresh().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  };

  const buildHeaders = async (args: ApiRequestArgs): Promise<Headers> => {
    const headers = new Headers({Accept: "application/json"});
    const extra = typeof config.headers === "function" ? await config.headers() : config.headers;
    for (const [key, value] of Object.entries(extra ?? {})) {
      headers.set(key, value);
    }
    for (const [key, value] of Object.entries(args.headers ?? {})) {
      headers.set(key, value);
    }
    const token = await config.authProvider?.getToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return headers;
  };

  const send = async (args: ApiRequestArgs): Promise<unknown> => {
    const {headers: _headers, unwrap: _unwrap, ...fetchArgs} = args;
    const {result} = await apiFetch({
      ...fetchArgs,
      credentials: args.credentials ?? config.credentials,
      fetchImpl: config.fetchImpl,
      headers: await buildHeaders(args),
      timeoutMs: args.timeoutMs ?? config.timeoutMs,
      url: resolveApiUrl({baseUrl: config.baseUrl, url: args.url}),
    });
    return result;
  };

  const request = async <T = unknown>(args: ApiRequestArgs): Promise<T> => {
    try {
      let result: unknown;
      try {
        result = await send(args);
      } catch (error) {
        const refresh = config.authProvider?.refresh;
        if (!(error instanceof ApiError) || error.status !== 401 || !refresh) {
          throw error;
        }
        if (!(await refreshOnce(refresh))) {
          throw error;
        }
        result = await send(args);
      }
      return (args.unwrap === false ? result : unwrapEnvelope(result)) as T;
    } catch (error) {
      // A caller-cancelled request is not a failure worth reporting.
      if (error instanceof ApiError && error.data.code !== API_ERROR_CODES.aborted) {
        config.onError?.(error, args);
      }
      throw error;
    }
  };

  const notify = (entry: CacheEntry): void => {
    for (const listener of [...entry.listeners]) {
      listener();
    }
  };

  const setState = (entry: CacheEntry, next: Partial<ApiQueryState>): void => {
    entry.state = {...entry.state, ...next};
    notify(entry);
  };

  const scheduleGc = (key: string, entry: CacheEntry): void => {
    if (entry.listeners.size > 0 || entry.gcTimer) {
      return;
    }
    entry.gcTimer = setTimeout(() => {
      entry.gcTimer = undefined;
      if (entry.listeners.size === 0 && entries.get(key) === entry) {
        entries.delete(key);
      }
    }, keepUnusedDataMs);
  };

  const ensureEntry = (args: ApiRequestArgs): [string, CacheEntry] => {
    const key = apiQueryKey(args);
    let entry = entries.get(key);
    if (!entry) {
      // A shared entry outlives any one caller, so it never keeps a caller's abort signal.
      const {signal: _signal, ...shared} = args;
      entry = {
        args: shared,
        gcTimer: undefined,
        generation: 0,
        inFlight: undefined,
        listeners: new Set(),
        state: UNINITIALIZED,
        tags: new Set(),
      };
      entries.set(key, entry);
    }
    return [key, entry];
  };

  const runQuery = (key: string, entry: CacheEntry): Promise<unknown> => {
    entry.generation += 1;
    const generation = entry.generation;
    setState(entry, {
      isFetching: true,
      status: entry.state.status === "fulfilled" ? "fulfilled" : "pending",
    });
    const promise = request(entry.args).then(
      (data) => {
        if (entry.generation === generation && entries.get(key) === entry) {
          entry.inFlight = undefined;
          setState(entry, {data, error: undefined, isFetching: false, status: "fulfilled"});
          scheduleGc(key, entry);
        }
        return data;
      },
      (error: unknown) => {
        if (entry.generation === generation && entries.get(key) === entry) {
          entry.inFlight = undefined;
          setState(entry, {error, isFetching: false, status: "rejected"});
          scheduleGc(key, entry);
        }
        throw error;
      }
    );
    entry.inFlight = promise;
    return promise;
  };

  const fetchQuery = <T = unknown>(
    args: ApiRequestArgs,
    options: ApiQueryOptions = {}
  ): Promise<T> => {
    const [key, entry] = ensureEntry(args);
    for (const tag of options.providesTags ?? []) {
      entry.tags.add(tag);
    }
    if (!options.force) {
      if (entry.inFlight !== undefined) {
        return entry.inFlight as Promise<T>;
      }
      if (entry.state.status === "fulfilled") {
        return Promise.resolve(entry.state.data as T);
      }
    }
    return runQuery(key, entry) as Promise<T>;
  };

  const getQueryState = <T = unknown>(args: ApiRequestArgs): ApiQueryState<T> =>
    (entries.get(apiQueryKey(args))?.state ?? UNINITIALIZED) as ApiQueryState<T>;

  const subscribeQuery = (
    args: ApiRequestArgs,
    listener: () => void,
    options: Pick<ApiQueryOptions, "providesTags"> = {}
  ): (() => void) => {
    const [key, entry] = ensureEntry(args);
    for (const tag of options.providesTags ?? []) {
      entry.tags.add(tag);
    }
    if (entry.gcTimer) {
      clearTimeout(entry.gcTimer);
      entry.gcTimer = undefined;
    }
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
      scheduleGc(key, entry);
    };
  };

  const invalidateTags = (tags: readonly string[]): void => {
    const wanted = new Set(tags);
    for (const [key, entry] of [...entries]) {
      if (![...entry.tags].some((tag) => wanted.has(tag))) {
        continue;
      }
      if (entry.listeners.size === 0) {
        if (entry.gcTimer) {
          clearTimeout(entry.gcTimer);
        }
        entries.delete(key);
        continue;
      }
      // Refetch errors surface through the entry state; nothing awaits this promise.
      runQuery(key, entry).catch(() => {});
    }
  };

  const reset = (): void => {
    for (const [key, entry] of [...entries]) {
      if (entry.gcTimer) {
        clearTimeout(entry.gcTimer);
        entry.gcTimer = undefined;
      }
      entry.generation += 1;
      entry.inFlight = undefined;
      entry.tags.clear();
      // A fresh object, so a hook that rendered the initial state before a request started and
      // was reset in the same commit still sees a change and fetches again.
      entry.state = {...UNINITIALIZED};
      // Mounted hooks keep their entry so they see the reset and fetch again.
      if (entry.listeners.size === 0) {
        entries.delete(key);
      }
      notify(entry);
    }
  };

  return {
    baseUrl: config.baseUrl,
    fetchQuery,
    getQueryState,
    invalidateTags,
    request,
    reset,
    subscribeQuery,
  };
};
