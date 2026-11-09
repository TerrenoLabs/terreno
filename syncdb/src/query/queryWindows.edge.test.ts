import {describe, expect, it} from "bun:test";

import {createSyncStore} from "../storage/store";
import {QUERY_WINDOWS_TABLE} from "../storage/types";
import type {ListResponse, SyncEntitiesResponse} from "../types";
import {
  createQueryWindows,
  type QueryWindows,
  selectWindowView,
  type WindowQuery,
  windowKeyFor,
} from "./queryWindows";

interface Row {
  _id?: string | number;
  id?: string;
  _syncSeq?: number;
  rank?: number;
  group?: string;
}

const COLLECTION = "items";

const makeWindows = ({
  respond,
  entities = async (): Promise<SyncEntitiesResponse> => ({entities: []}),
  hasFetchList = true,
  onError,
  epoch = (): string => "e1",
}: {
  respond?: (params: Record<string, unknown>) => ListResponse | Promise<ListResponse>;
  entities?: (ids: string[]) => Promise<SyncEntitiesResponse>;
  hasFetchList?: boolean;
  onError?: (error: unknown) => void;
  epoch?: () => string;
} = {}): {
  windows: QueryWindows;
  store: ReturnType<typeof createSyncStore>;
  calls: Array<Record<string, unknown>>;
} => {
  const store = createSyncStore({collections: [COLLECTION]});
  const calls: Array<Record<string, unknown>> = [];
  const windows = createQueryWindows({
    getChannel: () => ({
      fetchEntities: ({ids}) => entities(ids),
      ...(hasFetchList
        ? {
            fetchList: async ({params}): Promise<ListResponse> => {
              calls.push(params);
              return (await respond?.(params)) ?? {data: [], more: false};
            },
          }
        : {}),
    }),
    getEpoch: epoch,
    getListPath: () => "/items",
    now: () => "2026-10-04T00:00:00.000Z",
    onError,
    store,
  });
  return {calls, store, windows};
};

describe("query windows edge cases", () => {
  it("skips rows without an id and stringifies numeric ids", async () => {
    const {windows} = makeWindows({
      respond: () => ({
        data: [{rank: 1}, {_id: 7, _syncSeq: 1}, {_syncSeq: 1, id: "x"}],
        more: false,
      }),
    });
    const state = await windows.fetchWindow({query: {collection: COLLECTION}});
    expect(state.ids).toEqual(["7", "x"]);
  });

  it("does not request a next page when the window has no more", async () => {
    const {calls, windows} = makeWindows({
      respond: () => ({data: [{_id: "a", _syncSeq: 1}], more: false}),
    });
    const query: WindowQuery = {collection: COLLECTION};
    await windows.fetchWindow({query});
    const state = await windows.fetchWindow({nextPage: true, query});
    expect(calls).toHaveLength(1);
    expect(state.ids).toEqual(["a"]);
  });

  it("rejects when the channel cannot fetch lists", async () => {
    const {windows} = makeWindows({hasFetchList: false});
    await expect(windows.fetchWindow({query: {collection: COLLECTION}})).rejects.toThrow(
      /require an HTTP channel/
    );
  });

  it("keeps optimistic rows while canonical seqs load", async () => {
    const {store, windows} = makeWindows({
      entities: async () => ({
        entities: [{data: {_id: "a", rank: 9}, deleted: false, id: "a", seq: 4}],
      }),
      respond: () => ({data: [{_id: "a", rank: 1}], more: false}),
    });
    store.upsertEntity({
      collection: COLLECTION,
      data: {_id: "a", rank: 5},
      id: "a",
      pendingMutationId: "m1",
    });
    await windows.fetchWindow({query: {collection: COLLECTION}});
    expect(store.getEntity<Row>({collection: COLLECTION, id: "a"})?.data.rank).toBe(5);
  });

  it("stops applying canonical seqs once the lifecycle moves on", async () => {
    let epoch = "e1";
    const {store, windows} = makeWindows({
      entities: async () => {
        epoch = "e2";
        return {entities: [{data: {_id: "a"}, deleted: false, id: "a", seq: 4}]};
      },
      epoch: () => epoch,
      respond: () => ({data: [{_id: "a"}], more: false}),
    });
    await windows.fetchWindow({query: {collection: COLLECTION}});
    expect(store.getEntity({collection: COLLECTION, id: "a"})?.seq).toBe(0);
    expect(store.raw.getTable(QUERY_WINDOWS_TABLE)).toEqual({});
  });

  it("reports refetch failures through onError and keeps going", async () => {
    const errors: unknown[] = [];
    const {windows} = makeWindows({
      onError: (error) => errors.push(error),
      respond: () => {
        throw new Error("boom");
      },
    });
    const release = windows.retain({collection: COLLECTION});
    await new Promise((resolve) => setTimeout(resolve, 5));
    await windows.refetchRetained();
    expect(errors.length).toBeGreaterThanOrEqual(2);
    release();
    release();
  });

  it("notifies subscribers until they unsubscribe", async () => {
    const {windows} = makeWindows({respond: () => ({data: [], more: false})});
    let calls = 0;
    const unsubscribe = windows.subscribe(() => {
      calls += 1;
    });
    await windows.fetchWindow({query: {collection: COLLECTION}});
    const seen = calls;
    expect(seen).toBeGreaterThan(0);
    unsubscribe();
    await windows.fetchWindow({query: {collection: COLLECTION, pageSize: 5}});
    expect(calls).toBe(seen);
  });

  it("prunes every unretained window on demand", async () => {
    const {windows} = makeWindows({respond: () => ({data: [], more: false})});
    await windows.fetchWindow({query: {collection: COLLECTION}});
    const release = windows.retain({collection: COLLECTION, pageSize: 3});
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(windows.pruneUnretained()).toBe(1);
    expect(windows.getWindow({collection: COLLECTION, pageSize: 3})).toBeDefined();
    release();
  });

  it("treats corrupt persisted membership as empty", () => {
    const {store, windows} = makeWindows();
    const query: WindowQuery = {collection: COLLECTION};
    store.raw.setRow(QUERY_WINDOWS_TABLE, windows.keyFor(query), {
      collection: COLLECTION,
      excluded: "[1]",
      fetchedAt: "",
      hasMore: false,
      ids: "{not json",
      pages: 1,
      total: -1,
    });
    expect(windows.getWindow(query)).toMatchObject({excludedSeqs: {}, ids: [], total: undefined});
    store.raw.setCell(QUERY_WINDOWS_TABLE, windows.keyFor(query), "excluded", "{not json");
    store.raw.setCell(QUERY_WINDOWS_TABLE, windows.keyFor(query), "ids", "");
    expect(windows.getWindow(query)).toMatchObject({excludedSeqs: {}, ids: []});
    store.raw.setCell(QUERY_WINDOWS_TABLE, windows.keyFor(query), "excluded", '{"a":1,"b":"x"}');
    expect(windows.getWindow(query)?.excludedSeqs).toEqual({a: 1});
  });

  it("keys windows by value, including dates", () => {
    const base = {collection: COLLECTION, where: {created: {$gte: new Date(0)}}};
    expect(windowKeyFor(base)).toBe(
      windowKeyFor({...base, sort: undefined, where: {created: {$gte: new Date(0)}}})
    );
    expect(windowKeyFor(base)).toContain("1970-01-01T00:00:00.000Z");
  });
});

describe("selectWindowView edge cases", () => {
  const seed = (
    store: ReturnType<typeof createSyncStore>,
    rows: Array<{id: string; rank: number; group: string; pending?: string}>
  ): void => {
    for (const row of rows) {
      store.upsertEntity({
        collection: COLLECTION,
        data: {group: row.group, rank: row.rank},
        id: row.id,
        pendingMutationId: row.pending ?? "",
        seq: 1,
      });
    }
  };

  const windowState = (ids: string[], hasMore: boolean) => ({
    collection: COLLECTION,
    excludedSeqs: {},
    hasMore,
    ids,
    key: "k",
    pages: 1,
    status: "idle" as const,
  });

  it("admits only local creates when more pages exist and there is no sort", () => {
    const store = createSyncStore({collections: [COLLECTION]});
    seed(store, [
      {group: "g", id: "a", rank: 1},
      {group: "g", id: "b", rank: 2},
      {group: "g", id: "c", pending: "m1", rank: 3},
    ]);
    const view = selectWindowView<Row>({
      query: {collection: COLLECTION, where: {group: "g"}},
      store,
      window: windowState(["a"], true),
    });
    expect(view.map((entity) => entity.id)).toEqual(["a", "c"]);
  });

  it("orders equal sort keys by server membership", () => {
    const store = createSyncStore({collections: [COLLECTION]});
    seed(store, [
      {group: "g", id: "b", rank: 1},
      {group: "g", id: "a", rank: 1},
      {group: "g", id: "z", rank: 1},
    ]);
    const view = selectWindowView<Row>({
      query: {collection: COLLECTION, sort: "rank", where: {group: "g"}},
      store,
      window: windowState(["b", "a"], false),
    });
    expect(view.map((entity) => entity.id)).toEqual(["b", "a", "z"]);
  });
});
