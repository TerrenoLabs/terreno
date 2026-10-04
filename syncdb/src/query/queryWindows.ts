/**
 * Server-filtered query windows over a shared, deduplicated entity table.
 *
 * A window is one server list query (`where` + `sort` + `pageSize`) against a
 * collection's `modelRouter` list endpoint. Its result is stored as MEMBERSHIP
 * (an ordered id list in the reserved `_queryWindows` table), never as a copy of
 * the rows: every row lands in the collection's single entity table, keyed by id.
 * Two windows that overlap by N documents therefore share N rows — a delta for
 * one of them writes the store once and both views re-render from it — while
 * each view still lists only its own members (plus, when the filter is locally
 * evaluable, cached rows that newly match it within the loaded range).
 */

import {DateTime} from "luxon";

import type {SyncStore} from "../storage/store";
import type {SyncEntity} from "../storage/types";
import {QUERY_WINDOWS_TABLE} from "../storage/types";
import {MAX_REPAIR_FETCH_IDS} from "../sync/entityRepair";
import {type HttpChannel, ListRequestError, QueryFieldNotAllowedError} from "../sync/httpChannel";
import {resolveComparator} from "./localQuery";
import {planRange} from "./rangePlan";
import {type SortSpec, sortSpecToParam} from "./sort";
import {compileWhere, type WhereFilter} from "./where";

/** Default page size for a window when the query omits one. */
export const DEFAULT_WINDOW_PAGE_SIZE = 50;

/** One server list query. Equal queries (by value) share a window. */
export interface WindowQuery {
  collection: string;
  /** Mongo-style filter sent as list query params (fields must be in `queryFields`). */
  where?: WhereFilter;
  /** Server sort; also orders the local view. */
  sort?: SortSpec;
  /** Server `limit` per page (default {@link DEFAULT_WINDOW_PAGE_SIZE}). */
  pageSize?: number;
}

export type WindowFetchStatus = "idle" | "loading" | "error";

/** Default age after which an unretained window's persisted membership is pruned on start. */
const DEFAULT_WINDOW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Persisted membership plus in-memory fetch status for one window. */
export interface QueryWindowState {
  key: string;
  collection: string;
  /** Server-ordered member ids across every loaded page. */
  ids: string[];
  /** Pages loaded so far (0 until the first fetch lands). */
  pages: number;
  hasMore: boolean;
  /** Server-reported total matching documents, when the endpoint returns it. */
  total?: number;
  /** ISO time of the last successful fetch. */
  fetchedAt?: string;
  /**
   * Cached rows (id → seq) that matched `where` locally but that the last full
   * fetch did not return: the server has changed, deleted, or hidden them. They are
   * kept out of `liveMatch` extras until their seq moves or they gain a pending
   * local mutation, so stale cached data cannot resurrect them.
   */
  excludedSeqs: Record<string, number>;
  status: WindowFetchStatus;
  error?: string;
  /** Server error code of the last failure (e.g. `query-param-not-allowed`). */
  errorCode?: string;
}

interface WindowRow {
  collection: string;
  ids: string;
  pages: number;
  hasMore: boolean;
  total: number;
  fetchedAt: string;
  /** JSON-encoded {@link QueryWindowState.excludedSeqs}. */
  excluded: string;
}

export interface QueryWindows {
  /** Stable key for a query (collection + where + sort + pageSize). */
  keyFor: (query: WindowQuery) => string;
  getWindow: (query: WindowQuery) => QueryWindowState | undefined;
  /**
   * Fetch the first page (replacing membership) or, with `nextPage`, append the
   * next page. Concurrent calls for the same window share one request.
   */
  fetchWindow: (args: {query: WindowQuery; nextPage?: boolean}) => Promise<QueryWindowState>;
  /**
   * Mark a window as in use. The first retain of a window in this session
   * fetches it (cached membership renders meanwhile). Returns a release function.
   */
  retain: (query: WindowQuery) => () => void;
  /** Refetch every retained window (reconnect, force resync). */
  refetchRetained: () => Promise<void>;
  /** Drop windows that are not retained (membership only; rows stay). */
  pruneUnretained: () => number;
  /**
   * Drop unretained windows last fetched more than `olderThanMs` ago (default
   * 7 days). Runs on every `start()`.
   */
  pruneStale: (args?: {olderThanMs?: number}) => number;
  /** Subscribe to fetch-status changes for any window. */
  subscribe: (callback: () => void) => () => void;
  /**
   * Forget in-memory status and in-flight bookkeeping (user switch / stop).
   * Persisted membership is untouched; fetches still running are discarded.
   */
  reset: () => void;
}

export interface QueryWindowsConfig {
  store: SyncStore;
  getChannel: () => Pick<HttpChannel, "fetchEntities" | "fetchList"> | undefined;
  /** List path for a collection (e.g. "/messages"). */
  getListPath: (collection: string) => string;
  /**
   * Opaque lifecycle token (generation + user). A fetch whose token changed
   * while awaiting is discarded so it never writes into another user's store.
   */
  getEpoch: () => string;
  now?: () => string;
  onError?: (error: unknown) => void;
}

/** Provenance stream for rows written from a window fetch rather than a delta. */
const queryStreamFor = (collection: string): string => `${collection}|query`;

const stableStringify = (value: unknown): string => {
  if (value === undefined) {
    return "";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((element) => stableStringify(element)).join(",")}]`;
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`;
};

export const windowKeyFor = (query: WindowQuery): string =>
  stableStringify({
    collection: query.collection,
    pageSize: query.pageSize ?? DEFAULT_WINDOW_PAGE_SIZE,
    sort: query.sort === undefined ? undefined : sortSpecToParam(query.sort),
    where: query.where,
  });

const parseExcluded = (raw: unknown): Record<string, number> => {
  if (typeof raw !== "string" || raw.length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, number> = {};
    for (const [id, seq] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof seq === "number") {
        result[id] = seq;
      }
    }
    return result;
  } catch {
    return {};
  }
};

/** A top-level `{field: {$in: []}}` can match nothing; qs cannot encode it, so skip the request. */
const hasEmptyTopLevelIn = (where: WhereFilter | undefined): boolean =>
  Object.values(where ?? {}).some(
    (value) =>
      Boolean(value) &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Array.isArray((value as {$in?: unknown}).$in) &&
      (value as {$in: unknown[]}).$in.length === 0
  );

/**
 * `null` cannot cross the wire: qs sends the string "null", which modelRouter
 * does not turn back into null. Fail loudly instead of filtering on "null".
 */
const assertNoNullFilters = (where: unknown, path: string): void => {
  if (where === null) {
    throw new Error(
      `[syncdb] Window filter ${path} is null, which list query params cannot express. ` +
        "Use {$exists: false} (or a sentinel value) instead."
    );
  }
  if (Array.isArray(where)) {
    where.forEach((element, index) => {
      assertNoNullFilters(element, `${path}[${index}]`);
    });
    return;
  }
  if (where && typeof where === "object" && !(where instanceof Date)) {
    for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
      assertNoNullFilters(value, `${path}.${key}`);
    }
  }
};

const parseIds = (raw: unknown): string[] => {
  if (typeof raw !== "string" || raw.length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
};

const rowIdOf = (row: unknown): string | undefined => {
  if (!row || typeof row !== "object") {
    return undefined;
  }
  const record = row as {_id?: unknown; id?: unknown};
  const id = record._id ?? record.id;
  if (typeof id === "string" && id.length > 0) {
    return id;
  }
  if (typeof id === "number") {
    return String(id);
  }
  return undefined;
};

/**
 * Upsert list rows into the shared entity table. Rows carrying `_syncSeq` are
 * canonical; rows without it get their seq from `GET /sync/entities` so a later
 * mutation never sends a stale `baseVersion`. Optimistic (pending) rows and rows a
 * newer delta already wrote are never overwritten.
 */
const applyListRows = async ({
  store,
  channel,
  collection,
  rows,
  isCurrent,
}: {
  store: SyncStore;
  channel: Pick<HttpChannel, "fetchEntities">;
  collection: string;
  rows: unknown[];
  isCurrent: () => boolean;
}): Promise<string[]> => {
  const ids: string[] = [];
  const missingSeq: string[] = [];
  const stream = queryStreamFor(collection);
  store.raw.transaction(() => {
    for (const row of rows) {
      const id = rowIdOf(row);
      if (!id) {
        continue;
      }
      if (!ids.includes(id)) {
        ids.push(id);
      }
      const existing = store.getEntity({collection, id});
      if (existing?.pendingMutationId) {
        continue;
      }
      const seq = (row as {_syncSeq?: unknown})._syncSeq;
      if (typeof seq !== "number") {
        missingSeq.push(id);
        if (!existing) {
          store.upsertEntity({collection, data: row, deleted: false, id, seq: 0, stream});
        }
        continue;
      }
      // Equal seq means the row already holds this version, possibly in the sync
      // serializer's shape; a list `responseHandler` (e.g. populated refs) must not replace it.
      if (existing && existing.seq >= seq) {
        continue;
      }
      store.upsertEntity({
        collection,
        data: row,
        deleted: false,
        id,
        pendingMutationId: "",
        seq,
        stream: existing?.stream || stream,
      });
    }
  });

  for (let index = 0; index < missingSeq.length; index += MAX_REPAIR_FETCH_IDS) {
    const chunk = missingSeq.slice(index, index + MAX_REPAIR_FETCH_IDS);
    const response = await channel.fetchEntities({collection, ids: chunk});
    if (!isCurrent()) {
      return ids;
    }
    store.raw.transaction(() => {
      for (const entity of response.entities) {
        const existing = store.getEntity({collection, id: entity.id});
        if (existing?.pendingMutationId || (existing && existing.seq >= entity.seq)) {
          continue;
        }
        store.upsertEntity({
          collection,
          data: entity.data,
          deleted: entity.deleted,
          id: entity.id,
          pendingMutationId: "",
          seq: entity.seq,
          stream: existing?.stream || stream,
        });
      }
    });
  }
  return ids;
};

export const createQueryWindows = ({
  store,
  getChannel,
  getListPath,
  getEpoch,
  now = (): string => DateTime.utc().toISO() ?? "",
  onError,
}: QueryWindowsConfig): QueryWindows => {
  const statuses = new Map<
    string,
    {status: WindowFetchStatus; error?: string; errorCode?: string}
  >();
  /** Effective server page cap per list path, learned when the route's `maxLimit` clamps a request. */
  const serverLimits = new Map<string, number>();
  const inFlight = new Map<string, Promise<QueryWindowState>>();
  /** Per-window tail of the fetch queue: fetches for one window run one at a time. */
  const queues = new Map<string, Promise<unknown>>();
  const pendingCounts = new Map<string, number>();
  /** Bumped by reset() so fetches started before it skip their bookkeeping. */
  let resetGeneration = 0;
  const retained = new Map<string, {query: WindowQuery; count: number}>();
  const fetchedThisSession = new Set<string>();
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const setStatus = (
    key: string,
    status: WindowFetchStatus,
    error?: string,
    errorCode?: string
  ): void => {
    statuses.set(key, {
      status,
      ...(error !== undefined ? {error} : {}),
      ...(errorCode !== undefined ? {errorCode} : {}),
    });
    notify();
  };

  /**
   * Load rows [start, start + count) for a window. modelRouter pages by
   * `skip = (page - 1) * limit` and silently clamps `limit` to the route's
   * `maxLimit` (echoing the clamped value as `limit`). When the range does not
   * fit one request, it is pipelined as sequential page requests whose size
   * divides `start`, so offsets stay exact — with a warning, since it usually
   * means too many pages are loaded or `pageSize` exceeds `maxLimit`.
   */
  const fetchRange = async ({
    channel,
    query,
    start,
    count,
    isCurrent,
  }: {
    channel: Required<Pick<HttpChannel, "fetchList">>;
    query: WindowQuery;
    start: number;
    count: number;
    isCurrent: () => boolean;
  }): Promise<{rows: unknown[]; more: boolean; total?: number} | undefined> => {
    const path = getListPath(query.collection);
    assertNoNullFilters(query.where, "where");
    const baseParams: Record<string, unknown> = {
      ...(query.where ?? {}),
      ...(query.sort !== undefined ? {sort: sortSpecToParam(query.sort)} : {}),
    };
    if (hasEmptyTopLevelIn(query.where)) {
      return {more: false, rows: [], total: 0};
    }
    // At most one restart: after the first clamp the cap is known.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const cap = serverLimits.get(path) ?? Number.POSITIVE_INFINITY;
      const plan = planRange({cap, count, start});
      if (plan.requests > 1) {
        console.warn(
          `[syncdb] Window on ${query.collection} needs ${count} rows but ${path} returns at most ` +
            `${cap} per request (modelRouter maxLimit); pipelining ${plan.requests} requests of ` +
            `${plan.chunk}. Load fewer pages, lower pageSize, or raise maxLimit on the route.`
        );
      }
      const rows: unknown[] = [];
      let more = false;
      let total: number | undefined;
      let clamped = false;
      for (let index = 0; index < plan.requests; index += 1) {
        // Always send `page`: modelRouter warns (and reports to Sentry) when a
        // truncated list is requested without pagination.
        const response = await channel.fetchList({
          params: {...baseParams, limit: plan.chunk, page: plan.firstPage + index},
          path,
        });
        if (!isCurrent()) {
          return undefined;
        }
        if (typeof response.limit === "number" && response.limit < plan.chunk) {
          serverLimits.set(path, response.limit);
          clamped = true;
          break;
        }
        rows.push(...(Array.isArray(response.data) ? response.data : []));
        more = response.more === true;
        if (typeof response.total === "number") {
          total = response.total;
        }
        if (!more) {
          break;
        }
      }
      if (!clamped) {
        const wanted = rows.slice(plan.offset, plan.offset + count);
        // Rows past the range were fetched only to keep offsets aligned: they prove more exist.
        const hasMore = more || rows.length > plan.offset + count;
        return {more: hasMore, rows: wanted, total};
      }
    }
    throw new Error(`List endpoint ${path} kept clamping limit below the learned maxLimit`);
  };

  const readWindow = (key: string, collection: string): QueryWindowState | undefined => {
    const status = statuses.get(key) ?? {status: "idle" as const};
    if (!store.raw.hasRow(QUERY_WINDOWS_TABLE, key)) {
      if (status.status === "idle") {
        return undefined;
      }
      return {collection, excludedSeqs: {}, hasMore: false, ids: [], key, pages: 0, ...status};
    }
    const row = store.raw.getRow(QUERY_WINDOWS_TABLE, key) as Partial<WindowRow>;
    return {
      collection: row.collection ?? collection,
      excludedSeqs: parseExcluded(row.excluded),
      fetchedAt: row.fetchedAt || undefined,
      hasMore: row.hasMore ?? false,
      ids: parseIds(row.ids),
      key,
      pages: row.pages ?? 0,
      total: typeof row.total === "number" && row.total >= 0 ? row.total : undefined,
      ...status,
    };
  };

  const keyFor = (query: WindowQuery): string => windowKeyFor(query);

  const getWindow = (query: WindowQuery): QueryWindowState | undefined =>
    readWindow(keyFor(query), query.collection);

  const runFetch = async (
    query: WindowQuery,
    key: string,
    nextPage: boolean,
    /** Lifecycle token captured when the fetch was requested, not when it ran. */
    epoch: string
  ): Promise<QueryWindowState> => {
    const channel = getChannel();
    if (!channel?.fetchList) {
      throw new Error("Query windows require an HTTP channel (baseUrl or httpChannel)");
    }
    const isCurrent = (): boolean => getEpoch() === epoch;
    const pageSize = query.pageSize ?? DEFAULT_WINDOW_PAGE_SIZE;
    const previous = readWindow(key, query.collection);
    // A refetch reloads every page already shown so the visible range does not
    // shrink back to page one; a next-page fetch loads the range after it.
    const loadedPages = !nextPage && previous && previous.pages > 1 ? previous.pages : 1;
    const start = nextPage ? (previous?.pages ?? 0) * pageSize : 0;
    const count = nextPage ? pageSize : pageSize * loadedPages;
    // Before a full fetch, note cached rows that match locally: any the server does
    // not return (and that do not change meanwhile) are stale for this window.
    const {match} = compileWhere(query.where);
    const candidates = new Map<string, number>();
    if (!nextPage && match) {
      for (const entity of store.listEntities({collection: query.collection})) {
        if (!entity.pendingMutationId && entity.data !== null && match(entity.data)) {
          candidates.set(entity.id, entity.seq);
        }
      }
    }
    try {
      const response = await fetchRange({
        channel: {fetchList: channel.fetchList},
        count,
        isCurrent,
        query,
        start,
      });
      if (!response || !isCurrent()) {
        return readWindow(key, query.collection) ?? emptyState(key, query.collection);
      }
      const rows = response.rows;
      const pageIds = await applyListRows({
        channel,
        collection: query.collection,
        isCurrent,
        rows,
        store,
      });
      if (!isCurrent()) {
        return readWindow(key, query.collection) ?? emptyState(key, query.collection);
      }
      const latest = readWindow(key, query.collection);
      const ids = nextPage
        ? [...(latest?.ids ?? []), ...pageIds.filter((id) => !(latest?.ids ?? []).includes(id))]
        : pageIds;
      let excludedSeqs: Record<string, number> = latest?.excludedSeqs ?? {};
      if (!nextPage) {
        const returned = new Set(pageIds);
        excludedSeqs = {};
        for (const [id, seq] of candidates) {
          const current = store.getEntity({collection: query.collection, id});
          if (!returned.has(id) && current && current.seq === seq && !current.pendingMutationId) {
            excludedSeqs[id] = seq;
          }
        }
      }
      const row: WindowRow = {
        collection: query.collection,
        excluded: JSON.stringify(excludedSeqs),
        fetchedAt: now(),
        hasMore: response.more,
        ids: JSON.stringify(ids),
        pages: nextPage ? (previous?.pages ?? 0) + 1 : loadedPages,
        total: typeof response.total === "number" ? response.total : -1,
      };
      store.raw.setRow(
        QUERY_WINDOWS_TABLE,
        key,
        row as unknown as Record<string, string | number | boolean>
      );
      fetchedThisSession.add(key);
    } catch (error) {
      if (error instanceof QueryFieldNotAllowedError) {
        // A missing `queryFields` entry is a programming error, never transient: say so loudly.
        console.error(`[syncdb] ${error.message}`);
      }
      if (isCurrent()) {
        setStatus(
          key,
          "error",
          error instanceof Error ? error.message : String(error),
          error instanceof ListRequestError ? error.code : undefined
        );
      }
      throw error;
    }
    return readWindow(key, query.collection) ?? emptyState(key, query.collection);
  };

  const fetchWindow = ({
    query,
    nextPage = false,
  }: {
    query: WindowQuery;
    nextPage?: boolean;
  }): Promise<QueryWindowState> => {
    const key = keyFor(query);
    const flightKey = `${key}#${nextPage ? "next" : "first"}`;
    const existing = inFlight.get(flightKey);
    if (existing) {
      return existing;
    }
    const myReset = resetGeneration;
    const epoch = getEpoch();
    const run = (): Promise<QueryWindowState> => {
      if (getEpoch() !== epoch) {
        // Stopped or switched users while queued: never fetch for the old lifecycle.
        return Promise.resolve(
          readWindow(key, query.collection) ?? emptyState(key, query.collection)
        );
      }
      if (nextPage) {
        const current = readWindow(key, query.collection);
        if (current && current.pages > 0 && !current.hasMore) {
          return Promise.resolve(current);
        }
      }
      return runFetch(query, key, nextPage, epoch);
    };
    pendingCounts.set(key, (pendingCounts.get(key) ?? 0) + 1);
    setStatus(key, "loading");
    // Serialize per window: a refetch and a next-page load both read `pages` and
    // write membership, so overlapping them could drop a just-loaded page.
    const prior = queues.get(key);
    const started = prior ? prior.catch(() => undefined).then(run) : run();
    const promise = started.finally(() => {
      if (myReset !== resetGeneration) {
        return;
      }
      inFlight.delete(flightKey);
      const remaining = Math.max(0, (pendingCounts.get(key) ?? 1) - 1);
      pendingCounts.set(key, remaining);
      if (remaining === 0) {
        queues.delete(key);
        // Success and discarded (superseded) fetches both end idle; errors keep their status.
        if (statuses.get(key)?.status === "loading") {
          setStatus(key, "idle");
        }
      }
    });
    inFlight.set(flightKey, promise);
    queues.set(key, promise);
    return promise;
  };

  const retain = (query: WindowQuery): (() => void) => {
    const key = keyFor(query);
    const entry = retained.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      retained.set(key, {count: 1, query});
    }
    if (!fetchedThisSession.has(key) && !inFlight.has(`${key}#first`)) {
      fetchWindow({query}).catch((error: unknown) => onError?.(error));
    }
    let released = false;
    return (): void => {
      if (released) {
        return;
      }
      released = true;
      const current = retained.get(key);
      if (!current) {
        return;
      }
      current.count -= 1;
      if (current.count <= 0) {
        retained.delete(key);
      }
    };
  };

  const refetchRetained = async (): Promise<void> => {
    const queries = [...retained.values()].map((entry) => entry.query);
    await Promise.all(
      queries.map((query) =>
        fetchWindow({query}).catch((error: unknown) => {
          onError?.(error);
        })
      )
    );
  };

  const pruneUnretained = (): number => {
    let pruned = 0;
    store.raw.transaction(() => {
      for (const key of Object.keys(store.raw.getTable(QUERY_WINDOWS_TABLE))) {
        if (!retained.has(key)) {
          store.raw.delRow(QUERY_WINDOWS_TABLE, key);
          pruned += 1;
        }
      }
    });
    return pruned;
  };

  const pruneStale = ({
    olderThanMs = DEFAULT_WINDOW_RETENTION_MS,
  }: {
    olderThanMs?: number;
  } = {}): number => {
    const cutoff = DateTime.fromISO(now()).minus({milliseconds: olderThanMs});
    let pruned = 0;
    store.raw.transaction(() => {
      for (const [key, row] of Object.entries(store.raw.getTable(QUERY_WINDOWS_TABLE))) {
        if (retained.has(key)) {
          continue;
        }
        const fetchedAt = DateTime.fromISO(String((row as Partial<WindowRow>).fetchedAt ?? ""));
        if (!fetchedAt.isValid || fetchedAt < cutoff) {
          store.raw.delRow(QUERY_WINDOWS_TABLE, key);
          pruned += 1;
        }
      }
    });
    return pruned;
  };

  const subscribe = (callback: () => void): (() => void) => {
    listeners.add(callback);
    return (): void => {
      listeners.delete(callback);
    };
  };

  const reset = (): void => {
    resetGeneration += 1;
    statuses.clear();
    fetchedThisSession.clear();
    inFlight.clear();
    queues.clear();
    pendingCounts.clear();
    notify();
  };

  return {
    fetchWindow,
    getWindow,
    keyFor,
    pruneStale,
    pruneUnretained,
    refetchRetained,
    reset,
    retain,
    subscribe,
  };
};

const emptyState = (key: string, collection: string): QueryWindowState => ({
  collection,
  excludedSeqs: {},
  hasMore: false,
  ids: [],
  key,
  pages: 0,
  status: "idle",
});

export interface SelectWindowViewArgs {
  store: SyncStore;
  query: WindowQuery;
  window: QueryWindowState | undefined;
  /**
   * Include cached rows that match `where` but were not in the server response
   * (new local creates, live deltas) when they fall inside the loaded range.
   * Default true; ignored when `where` cannot be evaluated locally.
   */
  liveMatch?: boolean;
}

/**
 * The entities a window shows, in order: server members that still exist (and
 * still match `where` when it is locally evaluable), plus — with `liveMatch` —
 * cached rows that newly match and sort inside the loaded range. Rows matching
 * another window's filter but not this one never appear here.
 */
export const selectWindowView = <TData>({
  store,
  query,
  window,
  liveMatch = true,
}: SelectWindowViewArgs): SyncEntity<TData>[] => {
  const {match} = compileWhere(query.where);
  const comparator = resolveComparator<TData>(query.sort);
  const memberIds = window?.ids ?? [];
  const memberIndex = new Map<string, number>();
  memberIds.forEach((id, index) => {
    memberIndex.set(id, index);
  });

  const isVisible = (entity: SyncEntity<TData> | undefined): entity is SyncEntity<TData> =>
    Boolean(entity) && !entity?.deleted && entity?.data !== null && entity?.data !== undefined;

  const members: SyncEntity<TData>[] = [];
  let lastMember: SyncEntity<TData> | undefined;
  for (const id of memberIds) {
    const entity = store.getEntity<TData>({collection: query.collection, id});
    if (entity && entity.data !== null && entity.data !== undefined) {
      lastMember = entity;
    }
    if (!isVisible(entity)) {
      continue;
    }
    if (match && !match(entity.data)) {
      continue;
    }
    members.push(entity);
  }

  const extras: SyncEntity<TData>[] = [];
  if (liveMatch && match && window && window.pages > 0) {
    for (const entity of store.listEntities<TData>({collection: query.collection})) {
      if (memberIndex.has(entity.id) || !isVisible(entity) || !match(entity.data)) {
        continue;
      }
      const excludedSeq = window.excludedSeqs[entity.id];
      if (excludedSeq !== undefined && entity.seq <= excludedSeq && !entity.pendingMutationId) {
        // The last full fetch proved the server does not list this row; only a newer
        // delta or a local edit can bring it back before the next refetch.
        continue;
      }
      if (window.hasMore) {
        // Unloaded pages may hold rows sorted before this one; only admit rows that
        // sort inside the loaded range, or local creates when there is no order.
        if (comparator && lastMember) {
          if (comparator(entity.data, lastMember.data) > 0) {
            continue;
          }
        } else if (!entity.pendingMutationId) {
          continue;
        }
      }
      extras.push(entity);
    }
  }

  if (extras.length === 0) {
    return members;
  }
  const combined = [...members, ...extras];
  if (!comparator) {
    return combined;
  }
  return combined.sort((a, b) => {
    const result = comparator(a.data, b.data);
    if (result !== 0) {
      return result;
    }
    const indexA = memberIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const indexB = memberIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return indexA - indexB;
  });
};
