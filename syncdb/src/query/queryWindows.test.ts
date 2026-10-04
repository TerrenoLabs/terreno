import {describe, expect, it} from "bun:test";

import {createSyncDb, type SyncDb} from "../client";
import {memoryPersisterFactory} from "../persisters/memoryPersister";
import {QUERY_WINDOWS_TABLE} from "../storage/types";
import {type HttpChannel, QueryFieldNotAllowedError} from "../sync/httpChannel";
import {createFakeTransport, type FakeTransport} from "../testing/fakeTransport";
import type {AuthProvider, ListResponse, SyncDelta} from "../types";
import {selectWindowView, type WindowQuery} from "./queryWindows";
import {planRange} from "./rangePlan";
import {compileWhere} from "./where";

interface Message {
  _id: string;
  _syncSeq?: number;
  threadId: string;
  pinned: boolean;
  text: string;
  created: string;
}

let nameCounter = 0;

const auth: AuthProvider = {
  getToken: async () => "token",
  getUserId: async () => "u1",
  onAuthChange: () => () => {},
};

const message = (id: string, overrides: Partial<Message> = {}): Message => ({
  _id: id,
  _syncSeq: 1,
  created: `2026-01-0${id.replace(/\D/g, "")}T00:00:00.000Z`,
  pinned: false,
  text: `text ${id}`,
  threadId: "a",
  ...overrides,
});

/** Server rows; list requests are answered by filtering these with the same matcher. */
const DB: Message[] = [
  message("m1", {threadId: "a"}),
  message("m2", {pinned: true, threadId: "a"}),
  message("m3", {pinned: true, threadId: "a"}),
  message("m4", {pinned: true, threadId: "b"}),
  message("m5", {threadId: "b"}),
];

interface ListCall {
  path: string;
  params: Record<string, unknown>;
}

interface Harness {
  client: SyncDb;
  transport: FakeTransport;
  listCalls: ListCall[];
  snapshotStreams: string[];
  entityFetches: string[][];
  rows: Message[];
  /** Hold list responses until released (concurrency tests). */
  gate?: Promise<void>;
  setGate: (gate: Promise<void> | undefined) => void;
}

/** Mirrors modelRouter: clamps limit to maxLimit and echoes the applied limit. */
const respond = (
  rows: Message[],
  params: Record<string, unknown>,
  maxLimit = 500
): ListResponse => {
  const {limit: requested, page, sort, ...where} = params;
  const limit = Math.min(Number(requested), maxLimit);
  const {match} = compileWhere(where);
  let matched = rows.filter((row) => match?.(row));
  if (sort === "-created") {
    matched = [...matched].sort((a, b) => (a.created < b.created ? 1 : -1));
  }
  const size = Number(limit);
  const start = page ? (Number(page) - 1) * size : 0;
  const data = matched.slice(start, start + size);
  return {data, limit: size, more: start + size < matched.length, total: matched.length};
};

const setup = async ({
  rows = DB,
  maxLimit,
}: {
  rows?: Message[];
  maxLimit?: number;
} = {}): Promise<Harness> => {
  nameCounter += 1;
  const transport = createFakeTransport();
  const harness = {
    entityFetches: [] as string[][],
    listCalls: [] as ListCall[],
    rows: rows.map((row) => ({...row})),
    snapshotStreams: [] as string[],
  } as unknown as Harness;
  harness.setGate = (gate): void => {
    harness.gate = gate;
  };
  const channel: HttpChannel = {
    fetchEntities: async ({ids}) => {
      harness.entityFetches.push(ids);
      return {
        entities: harness.rows
          .filter((row) => ids.includes(row._id))
          .map((row) => ({data: row, deleted: false, id: row._id, seq: 7})),
      };
    },
    fetchKeyMaterial: async () => "",
    fetchList: async ({path, params}) => {
      harness.listCalls.push({params, path});
      await (harness.gate ?? Promise.resolve());
      return respond(harness.rows, params, maxLimit);
    },
    fetchSnapshotPage: async ({stream}) => {
      harness.snapshotStreams.push(stream);
      return {
        cursor: 0,
        entities: [],
        frontierSeq: 0,
        hasMore: false,
        oldestRetainedSeq: 0,
        stream,
      };
    },
    fetchStreams: async () => [{collection: "messages", stream: "messages|owner:u1"}],
    sendMutation: async () => {
      throw new Error("not expected");
    },
  };
  const client = createSyncDb({
    authProvider: auth,
    collections: ["messages"],
    httpChannel: channel,
    name: `query-windows-test-${nameCounter}`,
    persisterFactory: memoryPersisterFactory,
    queryCollections: [{collection: "messages", path: "/api/messages"}],
    reconcileIntervalMs: 0,
    transport,
  });
  await client.start();
  await client.reconcile();
  harness.client = client;
  harness.transport = transport;
  return harness;
};

const THREAD_A: WindowQuery = {collection: "messages", where: {threadId: "a"}};
const PINNED: WindowQuery = {collection: "messages", where: {pinned: true}};

const view = (client: SyncDb, query: WindowQuery): string[] =>
  selectWindowView<Message>({
    query,
    store: client.store,
    window: client.queryWindows.getWindow(query),
  }).map((entity) => entity.id);

const delta = (data: Message, seq: number): SyncDelta => ({
  collection: "messages",
  data,
  id: data._id,
  method: "update",
  seq,
  stream: "messages|owner:u1",
});

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 5));
};

describe("query windows", () => {
  it("keeps overlapping windows as separate views over one copy of each row", async () => {
    const {client} = await setup();
    await client.queryWindows.fetchWindow({query: THREAD_A});
    await client.queryWindows.fetchWindow({query: PINNED});

    expect(view(client, THREAD_A)).toEqual(["m1", "m2", "m3"]);
    expect(view(client, PINNED)).toEqual(["m2", "m3", "m4"]);
    // m2 and m3 are in both windows but stored once.
    expect(Object.keys(client.store.raw.getTable("messages")).sort()).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
    await client.stop();
  });

  it("applies a delta for an overlapping row once and both views see it", async () => {
    const {client, transport} = await setup();
    await client.queryWindows.fetchWindow({query: THREAD_A});
    await client.queryWindows.fetchWindow({query: PINNED});

    let writes = 0;
    const listenerId = client.store.raw.addRowListener("messages", "m2", () => {
      writes += 1;
    });
    transport.deliverDelta(delta(message("m2", {pinned: true, text: "edited"}), 2));

    expect(writes).toBe(1);
    const read = (query: WindowQuery): string | undefined =>
      selectWindowView<Message>({
        query,
        store: client.store,
        window: client.queryWindows.getWindow(query),
      }).find((entity) => entity.id === "m2")?.data.text;
    expect(read(THREAD_A)).toBe("edited");
    expect(read(PINNED)).toBe("edited");
    client.store.raw.delListener(listenerId);
    await client.stop();
  });

  it("moves rows between views as their fields change, without leaking across filters", async () => {
    const {client, transport} = await setup();
    await client.queryWindows.fetchWindow({query: THREAD_A});
    await client.queryWindows.fetchWindow({query: PINNED});

    // m3 is unpinned: it leaves PINNED but stays in THREAD_A.
    transport.deliverDelta(delta(message("m3", {pinned: false}), 2));
    expect(view(client, PINNED)).toEqual(["m2", "m4"]);
    expect(view(client, THREAD_A)).toEqual(["m1", "m2", "m3"]);

    // A brand-new thread-a message arrives live: THREAD_A shows it, PINNED does not.
    transport.deliverDelta(delta(message("m6", {threadId: "a"}), 3));
    expect(view(client, THREAD_A)).toEqual(["m1", "m2", "m3", "m6"]);
    expect(view(client, PINNED)).toEqual(["m2", "m4"]);
    await client.stop();
  });

  it("sends where/sort/limit as list params and appends pages", async () => {
    const harness = await setup();
    const query: WindowQuery = {
      collection: "messages",
      pageSize: 2,
      sort: "-created",
      where: {threadId: {$in: ["a", "b"]}},
    };
    const first = await harness.client.queryWindows.fetchWindow({query});
    expect(harness.listCalls[0]).toEqual({
      params: {limit: 2, page: 1, sort: "-created", threadId: {$in: ["a", "b"]}},
      path: "/api/messages",
    });
    expect(first.ids).toEqual(["m5", "m4"]);
    expect(first.hasMore).toBe(true);
    expect(first.total).toBe(5);

    const second = await harness.client.queryWindows.fetchWindow({nextPage: true, query});
    expect(harness.listCalls[1].params.page).toBe(2);
    expect(second.ids).toEqual(["m5", "m4", "m3", "m2"]);
    expect(second.pages).toBe(2);

    // A refetch reloads every loaded page in one request.
    await harness.client.queryWindows.fetchWindow({query});
    expect(harness.listCalls[2].params).toEqual({
      limit: 4,
      page: 1,
      sort: "-created",
      threadId: {$in: ["a", "b"]},
    });
    await harness.client.stop();
  });

  it("only admits live matches that sort inside the loaded range", async () => {
    const {client, transport} = await setup();
    const query: WindowQuery = {
      collection: "messages",
      pageSize: 2,
      sort: "-created",
      where: {threadId: "a"},
    };
    await client.queryWindows.fetchWindow({query});
    expect(view(client, query)).toEqual(["m3", "m2"]);

    // Newer than the loaded range → shown at the top.
    transport.deliverDelta(delta(message("m9", {threadId: "a"}), 2));
    // Older than the last loaded row while more pages exist → left for the next page.
    transport.deliverDelta(delta(message("m0", {threadId: "a"}), 3));
    expect(view(client, query)).toEqual(["m9", "m3", "m2"]);
    await client.stop();
  });

  it("fetches canonical seq from /sync/entities when list rows omit _syncSeq", async () => {
    const harness = await setup({rows: DB.map(({_syncSeq, ...rest}) => rest as Message)});
    await harness.client.queryWindows.fetchWindow({query: THREAD_A});
    expect(harness.entityFetches).toEqual([["m1", "m2", "m3"]]);
    expect(harness.client.store.getEntity({collection: "messages", id: "m1"})?.seq).toBe(7);
    await harness.client.stop();
  });

  it("never overwrites an optimistic row or one a newer delta wrote", async () => {
    const {client, transport} = await setup();
    await client.queryWindows.fetchWindow({query: THREAD_A});
    transport.deliverDelta(delta(message("m1", {text: "newer"}), 5));
    // Keep the mutation queued (unacked) so m2 stays pending-protected.
    client.goOffline();
    client.mutate({collection: "messages", data: {text: "mine"}, id: "m2", operation: "update"});
    await client.queryWindows.fetchWindow({query: THREAD_A});
    const data = (rowId: string): Message | undefined =>
      client.store.getEntity<Message>({collection: "messages", id: rowId})?.data;
    expect(data("m1")?.text).toBe("newer");
    expect(data("m2")?.text).toBe("mine");
    expect(view(client, THREAD_A)).toEqual(["m1", "m2", "m3"]);
    await client.stop();
  });

  it("skips snapshot paging for query collections", async () => {
    const {client, snapshotStreams, transport} = await setup();
    transport.confirmSubscribed({collection: "messages", streams: ["messages|owner:u1"]});
    await client.reconcile();
    await flush();
    expect(snapshotStreams).toEqual([]);
    await client.stop();
  });

  it("shares one request between concurrent retains and fetches once per session", async () => {
    const harness = await setup();
    let release = (): void => {};
    harness.setGate(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const releaseA = harness.client.queryWindows.retain(THREAD_A);
    const releaseB = harness.client.queryWindows.retain({...THREAD_A, where: {threadId: "a"}});
    expect(harness.listCalls).toHaveLength(1);
    expect(harness.client.queryWindows.getWindow(THREAD_A)?.status).toBe("loading");
    release();
    harness.setGate(undefined);
    await flush();
    expect(harness.client.queryWindows.getWindow(THREAD_A)?.status).toBe("idle");

    releaseA();
    releaseB();
    harness.client.queryWindows.retain(THREAD_A)();
    expect(harness.listCalls).toHaveLength(1);
    await harness.client.stop();
  });

  it("refetches retained windows on reconnect", async () => {
    const harness = await setup();
    const release = harness.client.queryWindows.retain(THREAD_A);
    await flush();
    expect(harness.listCalls).toHaveLength(1);
    harness.transport.setConnected(false);
    harness.transport.setConnected(true);
    await flush();
    expect(harness.listCalls).toHaveLength(2);
    release();
    await harness.client.stop();
  });

  it("discards a fetch that resolves after stop()", async () => {
    const harness = await setup();
    let release = (): void => {};
    harness.setGate(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const pending = harness.client.queryWindows.fetchWindow({query: THREAD_A});
    await harness.client.stop();
    release();
    await pending;
    expect(harness.client.store.raw.getTable("messages")).toEqual({});
    expect(harness.client.store.raw.getTable(QUERY_WINDOWS_TABLE)).toEqual({});
  });

  it("records an error status when the list request fails", async () => {
    const harness = await setup();
    const query: WindowQuery = {collection: "messages", where: {threadId: "a"}};
    const failing = harness.client.queryWindows;
    harness.listCalls.length = 0;
    harness.rows = undefined as unknown as Message[];
    await expect(failing.fetchWindow({query})).rejects.toThrow();
    expect(failing.getWindow(query)?.status).toBe("error");
    await harness.client.stop();
  });

  it("pipelines a refetch that exceeds the route's maxLimit and warns", async () => {
    const harness = await setup({maxLimit: 3});
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message: string): void => {
      warnings.push(message);
    };
    try {
      const query: WindowQuery = {collection: "messages", pageSize: 2, sort: "-created"};
      await harness.client.queryWindows.fetchWindow({query});
      await harness.client.queryWindows.fetchWindow({nextPage: true, query});
      const loaded = await harness.client.queryWindows.fetchWindow({nextPage: true, query});
      expect(loaded.ids).toEqual(["m5", "m4", "m3", "m2", "m1"]);
      expect(warnings).toEqual([]);

      harness.listCalls.length = 0;
      const refetched = await harness.client.queryWindows.fetchWindow({query});
      // 3 pages × 2 = 6 rows: the first request learns maxLimit 3, then 2 pipelined pages of 3.
      expect(harness.listCalls.map((call) => [call.params.limit, call.params.page])).toEqual([
        [6, 1],
        [3, 1],
        [3, 2],
      ]);
      expect(refetched.ids).toEqual(["m5", "m4", "m3", "m2", "m1"]);
      expect(refetched.pages).toBe(3);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("pipelining 2 requests of 3");

      // The learned cap is reused: the next refetch pipelines immediately.
      harness.listCalls.length = 0;
      await harness.client.queryWindows.fetchWindow({query});
      expect(harness.listCalls.map((call) => [call.params.limit, call.params.page])).toEqual([
        [3, 1],
        [3, 2],
      ]);
    } finally {
      console.warn = originalWarn;
      await harness.client.stop();
    }
  });

  it("keeps page offsets exact when pageSize exceeds maxLimit", async () => {
    const harness = await setup({maxLimit: 2});
    const originalWarn = console.warn;
    console.warn = (): void => {};
    try {
      const query: WindowQuery = {collection: "messages", pageSize: 4, sort: "-created"};
      const first = await harness.client.queryWindows.fetchWindow({query});
      expect(first.ids).toEqual(["m5", "m4", "m3", "m2"]);
      const second = await harness.client.queryWindows.fetchWindow({nextPage: true, query});
      expect(second.ids).toEqual(["m5", "m4", "m3", "m2", "m1"]);
      expect(second.hasMore).toBe(false);
    } finally {
      console.warn = originalWarn;
      await harness.client.stop();
    }
  });

  it("surfaces a missing queryFields entry loudly with its error code", async () => {
    const harness = await setup();
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (message: string): void => {
      errors.push(message);
    };
    const channelError = new QueryFieldNotAllowedError({
      allowedQueryFields: ["threadId"],
      field: "text",
      model: "Message",
      path: "/api/messages",
    });
    harness.rows = new Proxy([], {
      get: (): never => {
        throw channelError;
      },
    }) as unknown as Message[];
    try {
      const query: WindowQuery = {collection: "messages", where: {text: "x"}};
      await expect(harness.client.queryWindows.fetchWindow({query})).rejects.toBe(channelError);
      const state = harness.client.queryWindows.getWindow(query);
      expect(state?.status).toBe("error");
      expect(state?.errorCode).toBe("query-param-not-allowed");
      expect(state?.error).toContain('Add "text" to queryFields');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("[syncdb]");
    } finally {
      console.error = originalError;
      await harness.client.stop();
    }
  });

  it("keeps snapshot sync for fullSync query collections", async () => {
    nameCounter += 1;
    const snapshotStreams: string[] = [];
    const transport = createFakeTransport();
    const client = createSyncDb({
      authProvider: auth,
      collections: ["messages"],
      httpChannel: {
        fetchEntities: async () => ({entities: []}),
        fetchKeyMaterial: async () => "",
        fetchList: async ({params}) => respond(DB, params),
        fetchSnapshotPage: async ({stream}) => {
          snapshotStreams.push(stream);
          return {
            cursor: 0,
            entities: [],
            frontierSeq: 0,
            hasMore: false,
            oldestRetainedSeq: 0,
            stream,
          };
        },
        fetchStreams: async () => [{collection: "messages", stream: "messages|owner:u1"}],
        sendMutation: async () => {
          throw new Error("not expected");
        },
      },
      name: `query-windows-full-${nameCounter}`,
      persisterFactory: memoryPersisterFactory,
      queryCollections: [{collection: "messages", fullSync: true}],
      reconcileIntervalMs: 0,
      transport,
    });
    await client.start();
    await client.reconcile();
    expect(snapshotStreams).toContain("messages|owner:u1");
    const window = await client.queryWindows.fetchWindow({query: PINNED});
    expect(window.ids).toEqual(["m2", "m3", "m4"]);
    await client.stop();
  });

  it("does not resurrect a cached row the server stopped returning", async () => {
    const harness = await setup();
    const {client, transport} = harness;
    await client.queryWindows.fetchWindow({query: THREAD_A});
    expect(view(client, THREAD_A)).toEqual(["m1", "m2", "m3"]);

    // Deleted on the server while this device missed the delta (offline).
    harness.rows = harness.rows.filter((row) => row._id !== "m1");
    await client.queryWindows.fetchWindow({query: THREAD_A});
    expect(client.store.getEntity({collection: "messages", id: "m1"})).toBeDefined();
    expect(view(client, THREAD_A)).toEqual(["m2", "m3"]);

    // A newer delta for the row proves it changed, so live matching may admit it again.
    transport.deliverDelta(delta(message("m1", {text: "restored"}), 9));
    // Unsorted windows list live matches after the server members.
    expect(view(client, THREAD_A)).toEqual(["m2", "m3", "m1"]);
    await client.stop();
  });

  it("keeps a same-seq row written by sync instead of the list row", async () => {
    const {client, transport} = await setup();
    transport.deliverDelta(delta(message("m1", {text: "sync shape"}), 1));
    await client.queryWindows.fetchWindow({query: THREAD_A});
    expect(client.store.getEntity<Message>({collection: "messages", id: "m1"})?.data.text).toBe(
      "sync shape"
    );
    await client.stop();
  });

  it("runs a refetch and a next-page load for one window one at a time", async () => {
    const harness = await setup();
    const query: WindowQuery = {collection: "messages", pageSize: 2, sort: "-created"};
    await harness.client.queryWindows.fetchWindow({query});
    let release = (): void => {};
    harness.setGate(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const refetch = harness.client.queryWindows.fetchWindow({query});
    const nextPage = harness.client.queryWindows.fetchWindow({nextPage: true, query});
    expect(harness.listCalls).toHaveLength(2);
    release();
    harness.setGate(undefined);
    await Promise.all([refetch, nextPage]);
    const state = harness.client.queryWindows.getWindow(query);
    expect(state?.ids).toEqual(["m5", "m4", "m3", "m2"]);
    expect(state?.pages).toBe(2);
    expect(state?.status).toBe("idle");
    await harness.client.stop();
  });

  it("returns an empty window for an empty top-level $in without a request", async () => {
    const harness = await setup();
    const query: WindowQuery = {collection: "messages", where: {threadId: {$in: []}}};
    const state = await harness.client.queryWindows.fetchWindow({query});
    expect(harness.listCalls).toHaveLength(0);
    expect(state.ids).toEqual([]);
    expect(state.total).toBe(0);
    await harness.client.stop();
  });

  it("rejects null filters that list params cannot express", async () => {
    const harness = await setup();
    const query: WindowQuery = {collection: "messages", where: {threadId: null}};
    await expect(harness.client.queryWindows.fetchWindow({query})).rejects.toThrow(
      /where\.threadId is null/
    );
    expect(harness.listCalls).toHaveLength(0);
    expect(harness.client.queryWindows.getWindow(query)?.status).toBe("error");
    await harness.client.stop();
  });

  it("prunes unretained windows older than the retention window", async () => {
    const {client} = await setup();
    await client.queryWindows.fetchWindow({query: THREAD_A});
    const release = client.queryWindows.retain(PINNED);
    await flush();
    expect(client.queryWindows.pruneStale({olderThanMs: 60_000})).toBe(0);
    expect(client.queryWindows.pruneStale({olderThanMs: -1})).toBe(1);
    expect(client.queryWindows.getWindow(THREAD_A)).toBeUndefined();
    expect(client.queryWindows.getWindow(PINNED)?.pages).toBe(1);
    release();
    await client.stop();
  });

  it("rejects a query collection missing from collections", () => {
    expect(() =>
      createSyncDb({
        authProvider: auth,
        collections: ["todos"],
        name: "bad-config",
        persisterFactory: memoryPersisterFactory,
        queryCollections: ["messages"],
        transport: createFakeTransport(),
      })
    ).toThrow(/must also be listed in collections/);
  });
});

describe("planRange", () => {
  it("uses one exact request when the range fits under the cap", () => {
    expect(planRange({cap: 100, count: 20, start: 40})).toEqual({
      chunk: 20,
      firstPage: 3,
      offset: 0,
      requests: 1,
    });
  });

  it("splits a range larger than the cap into cap-sized pages", () => {
    expect(planRange({cap: 3, count: 6, start: 0})).toEqual({
      chunk: 3,
      firstPage: 1,
      offset: 0,
      requests: 2,
    });
    expect(planRange({cap: 100, count: 101, start: 0}).requests).toBe(2);
  });

  it("aligns unaligned starts to cap-sized pages instead of tiny chunks", () => {
    // pageSize 53 over maxLimit 50: page two starts at row 53.
    expect(planRange({cap: 50, count: 53, start: 53})).toEqual({
      chunk: 50,
      firstPage: 2,
      offset: 3,
      requests: 2,
    });
  });
});
