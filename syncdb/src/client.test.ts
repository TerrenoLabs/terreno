import "fake-indexeddb/auto";

import {describe, expect, it} from "bun:test";
import {assert} from "chai";

import {betterAuthAdapter} from "./auth/betterAuthAdapter";
import {createSyncDb, type SyncDbConfig} from "./client";
import {createLocalKeyProvider, DEFAULT_KEY_CACHE_DB_NAME} from "./crypto/keyProviders";
import {getConflict} from "./mutations/conflicts";
import {createDefaultPersisterFactory as createWebPersisterFactory} from "./persisters/defaultPersisterFactory.web";
import {memoryPersisterFactory} from "./persisters/memoryPersister";
import type {PersisterFactory} from "./persisters/types";
import {idbGet} from "./storage/idb";
import {SYNC_SCHEMA_VERSION} from "./storage/schema";
import {CURSORS_TABLE} from "./storage/types";
import {AuthRequiredError, type HttpChannel} from "./sync/httpChannel";
import type {SyncTransport} from "./sync/transport";
import {createFakeTransport, type FakeTransport} from "./testing/fakeTransport";
import type {
  AuthProvider,
  SyncDelta,
  SyncSnapshotBatchRequest,
  SyncSnapshotResponse,
  SyncStreamInfo,
} from "./types";

let nameCounter = 0;
const uniqueName = (): string => {
  nameCounter += 1;
  return `client-test-${nameCounter}`;
};

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 5));
};

const waitUntil = async (predicate: () => boolean, maxAttempts = 20): Promise<void> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (predicate()) {
      return;
    }
    await flush();
  }
  throw new Error("waitUntil timed out");
};

interface FakeAuth {
  provider: AuthProvider;
  setUserId: (userId: string | null) => void;
  emitAuthChange: () => void;
}

const makeAuthProvider = (initialUserId: string | null = "u1"): FakeAuth => {
  const listeners = new Set<() => void>();
  const state = {userId: initialUserId};
  return {
    emitAuthChange: (): void => {
      for (const listener of listeners) {
        listener();
      }
    },
    provider: {
      getToken: async () => "token",
      getUserId: async () => state.userId,
      onAuthChange: (callback: () => void): (() => void) => {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      },
    },
    setUserId: (userId: string | null): void => {
      state.userId = userId;
    },
  };
};

/** The single stream the default harness advertises via GET /sync/streams. */
const DEFAULT_STREAM = "todos|owner:u1";

interface FakeChannel {
  channel: HttpChannel;
  state: {
    fetchCount: number;
    streamsCount: number;
    /** Snapshot pages keyed by stream key. */
    pages: Record<string, SyncSnapshotResponse>;
    /** The membership set GET /sync/streams returns; mutate in a test to model join/leave. */
    streams: SyncStreamInfo[];
    /** When set, fetchStreams throws this instead of returning (401/transport tests). */
    streamsError?: Error;
  };
}

/** An empty snapshot page carrying the C1/C7 fields (no more data, no retention gap). */
const emptyPage = (stream: string, cursor = 0): SyncSnapshotResponse => ({
  cursor,
  entities: [],
  frontierSeq: cursor,
  hasMore: false,
  oldestRetainedSeq: 0,
  stream,
});

const makeChannel = (): FakeChannel => {
  const state: FakeChannel["state"] = {
    fetchCount: 0,
    pages: {},
    streams: [{collection: "todos", stream: DEFAULT_STREAM}],
    streamsCount: 0,
  };
  return {
    channel: {
      fetchEntities: async () => ({entities: []}),
      fetchKeyMaterial: async () => {
        throw new Error("key material not expected in this test");
      },
      fetchSnapshotPage: async ({stream}) => {
        state.fetchCount += 1;
        return state.pages[stream] ?? emptyPage(stream);
      },
      fetchStreams: async () => {
        state.streamsCount += 1;
        if (state.streamsError) {
          throw state.streamsError;
        }
        return state.streams;
      },
      sendMutation: async () => {
        throw new Error("HTTP mutate not expected in this test");
      },
    },
    state,
  };
};

interface Harness {
  auth: FakeAuth;
  transport: FakeTransport;
  http: FakeChannel;
  clock: {value: number};
  config: SyncDbConfig;
}

const makeHarness = (overrides: Partial<SyncDbConfig> = {}): Harness => {
  const auth = makeAuthProvider();
  const transport = createFakeTransport();
  const http = makeChannel();
  const clock = {value: 1_000_000};
  return {
    auth,
    clock,
    config: {
      authProvider: auth.provider,
      collections: ["todos"],
      httpChannel: http.channel,
      name: uniqueName(),
      now: () => clock.value,
      persisterFactory: memoryPersisterFactory,
      reconcileIntervalMs: 0,
      transport,
      ...overrides,
    },
    http,
    transport,
  };
};

const makeDelta = (overrides: Partial<SyncDelta> = {}): SyncDelta => ({
  collection: "todos",
  data: {title: "from server"},
  id: "t1",
  method: "create",
  seq: 1,
  stream: "todos|owner:u1",
  ...overrides,
});

interface ObservableTransport {
  transport: FakeTransport;
  /** connect/disconnect/subscribe calls in the order the client made them. */
  events: string[];
  /**
   * Hold the NEXT connect() open until the returned resolver runs, so a test
   * can act while a reconnect (e.g. a user-switch bounce) is still in flight.
   */
  gateNextConnect: () => () => void;
}

/** Wrap a fake transport to record its lifecycle calls and gate one connect(). */
const makeObservableTransport = (base: FakeTransport): ObservableTransport => {
  const events: string[] = [];
  let gate: Promise<void> | undefined;
  return {
    events,
    gateNextConnect: (): (() => void) => {
      let release = (): void => {};
      gate = new Promise<void>((resolve) => {
        release = (): void => resolve();
      });
      return release;
    },
    transport: {
      ...base,
      connect: async (): Promise<void> => {
        events.push("connect");
        const pending = gate;
        gate = undefined;
        if (pending !== undefined) {
          await pending;
        }
        await base.connect();
      },
      disconnect: (): void => {
        events.push("disconnect");
        base.disconnect();
      },
      subscribe: (collections: string[], options?: {mode?: "window"}): void => {
        events.push("subscribe");
        base.subscribe(collections, options);
      },
    },
  };
};

describe("createSyncDb", () => {
  it("requires a transport or a baseUrl", () => {
    const auth = makeAuthProvider();
    expect(() =>
      createSyncDb({authProvider: auth.provider, collections: ["todos"], name: uniqueName()})
    ).toThrow("requires a transport or a baseUrl");
  });

  it("constructs default socket transport and http channel from baseUrl", () => {
    const auth = makeAuthProvider();
    const client = createSyncDb({
      authProvider: auth.provider,
      baseUrl: "http://127.0.0.1:9",
      collections: ["todos"],
      name: uniqueName(),
    });
    expect(client.getSyncStatus()).toEqual({
      blockedEntities: 0,
      collections: {},
      conflictCount: 0,
      draining: false,
      failedCount: 0,
      isOnline: false,
      isSyncing: false,
      persistence: "durable",
      queuedCount: 0,
      sentThisDrain: 0,
      streams: {},
      totalThisDrain: 0,
    });
  });

  it("start() rejects without an authenticated user", async () => {
    // startAuthRetryAttempts: 1 disables retrying so this stays instant — the
    // no-retry-attempts contract is tested here; retry behavior is tested below.
    const harness = makeHarness({startAuthRetryAttempts: 1});
    harness.auth.setUserId(null);
    const client = createSyncDb(harness.config);
    await expect(client.start()).rejects.toThrow("requires an authenticated user");
  });

  it("start() retries auth resolution before giving up", async () => {
    const harness = makeHarness({startAuthRetryAttempts: 3, startAuthRetryDelayMs: 1});
    harness.auth.setUserId(null);
    const client = createSyncDb(harness.config);

    // Transient failure: getUserId() only resolves on the 2nd attempt — start()
    // should not throw on the first null, matching a host app that calls start()
    // right after its own login flow resolved (see client.ts start() doc).
    let calls = 0;
    const originalGetUserId = harness.config.authProvider.getUserId;
    harness.config.authProvider.getUserId = async () => {
      calls += 1;
      if (calls === 1) {
        return null;
      }
      return originalGetUserId();
    };
    harness.auth.setUserId("retry-user");

    await client.start();
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("start() rejects when auth never resolves after exhausting retries", async () => {
    const harness = makeHarness({startAuthRetryAttempts: 2, startAuthRetryDelayMs: 1});
    harness.auth.setUserId(null);
    const client = createSyncDb(harness.config);
    await expect(client.start()).rejects.toThrow("requires an authenticated user");
  });

  it("start() connects, subscribes the collections, and records the user", async () => {
    const harness = makeHarness();
    const client = createSyncDb(harness.config);
    await client.start();
    expect(harness.transport.subscribedCollections).toEqual(["todos"]);
    expect(client.store.getLastUserId()).toBe("u1");
    expect(client.getSyncStatus().isOnline).toBe(true);
    await client.stop();
  });

  it("start() succeeds when the transport cannot connect (offline start)", async () => {
    const harness = makeHarness();
    const offlineTransport: FakeTransport = {
      ...harness.transport,
      connect: async () => {
        throw new Error("no network");
      },
    };
    const client = createSyncDb({...harness.config, transport: offlineTransport});
    await client.start();
    expect(client.getSyncStatus().isOnline).toBe(false);
    await client.stop();
  });

  describe("mutate", () => {
    it("throws before start() and for updates/deletes without an id", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      expect(() => client.mutate({collection: "todos", operation: "create"})).toThrow(
        "requires start()"
      );
      await client.start();
      expect(() => client.mutate({collection: "todos", operation: "update"})).toThrow(
        "requires an id"
      );
      expect(() => client.mutate({collection: "todos", operation: "delete"})).toThrow(
        "requires an id"
      );
      await client.stop();
    });

    it("applies creates optimistically and immediately", async () => {
      const harness = makeHarness();
      // Hold replies so the pre-ack state is observable.
      harness.transport.setDefaultResponder(async () => {
        await flush();
        throw new Error("offline");
      });
      const client = createSyncDb(harness.config);
      await client.start();

      const {id, mutationId} = client.mutate({
        collection: "todos",
        data: {title: "buy milk"},
        operation: "create",
      });
      const entity = client.store.getEntity({collection: "todos", id});
      expect(entity?.data).toEqual({title: "buy milk"});
      expect(entity?.pendingMutationId).toBe(mutationId);
      expect(entity?.seq).toBe(0);
      expect(["inFlight", "queued"]).toContain(
        client.outbox.getMutation({mutationId})?.status ?? "missing"
      );
      await client.stop();
    });

    it("acked mutations clear pendingMutationId and stamp the server seq", async () => {
      const harness = makeHarness();
      harness.transport.respondWithAck({seq: 11});
      const client = createSyncDb(harness.config);
      await client.start();

      const {id} = client.mutate({collection: "todos", data: {title: "x"}, operation: "create"});
      await flush();
      const entity = client.store.getEntity({collection: "todos", id});
      expect(entity?.pendingMutationId).toBeUndefined();
      expect(entity?.seq).toBe(11);
      expect(client.getSyncStatus().queuedCount).toBe(0);
      await client.stop();
    });

    it("updates merge into the existing entity data", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({
        collection: "todos",
        data: {completed: false, title: "old"},
        id: "t1",
        seq: 3,
      });

      const {mutationId} = client.mutate({
        collection: "todos",
        data: {title: "new"},
        id: "t1",
        operation: "update",
      });
      expect(client.store.getEntity({collection: "todos", id: "t1"})?.data).toEqual({
        completed: false,
        title: "new",
      });
      // baseVersion carries the entity's last known seq.
      expect(client.outbox.getMutation({mutationId})?.baseVersion).toBe(3);
      await client.stop();
    });

    it("deletes tombstone locally while keeping the last data", async () => {
      const harness = makeHarness();
      harness.transport.setDefaultResponder(() => {
        throw new Error("offline");
      });
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({collection: "todos", data: {title: "bye"}, id: "t1", seq: 2});

      const {mutationId} = client.mutate({collection: "todos", id: "t1", operation: "delete"});
      const tombstone = client.store.getEntity({collection: "todos", id: "t1"});
      expect(tombstone?.deleted).toBe(true);
      expect(tombstone?.data).toEqual({title: "bye"});
      expect(tombstone?.pendingMutationId).toBe(mutationId);
      // Deleted entities disappear from default list reads.
      expect(client.store.listEntities({collection: "todos"})).toEqual([]);
      await client.stop();
    });
  });

  it("applies transport deltas to the local store", async () => {
    const harness = makeHarness();
    const client = createSyncDb(harness.config);
    await client.start();

    harness.transport.deliverDelta(makeDelta());
    expect(client.store.getEntity({collection: "todos", id: "t1"})?.data).toEqual({
      title: "from server",
    });
    expect(client.getSyncStatus().streams["todos|owner:u1"]).toBe(1);
    await client.stop();
  });

  it("batches an inbound delta burst into one store notification while retaining per-delta debug and reconcile behavior", async () => {
    const harness = makeHarness({debug: true});
    const batchTransport: SyncTransport = {
      ...harness.transport,
      onDeltaBatch: (callback: (deltas: SyncDelta[]) => void): (() => void) => {
        const pending: SyncDelta[] = [];
        let isScheduled = false;
        return harness.transport.onDelta((delta: SyncDelta): void => {
          pending.push(delta);
          if (isScheduled) {
            return;
          }
          isScheduled = true;
          queueMicrotask(() => {
            isScheduled = false;
            callback(pending.splice(0));
          });
        });
      },
    };
    const client = createSyncDb({...harness.config, transport: batchTransport});
    await client.start();
    await flush();
    const baselineFetchCount = harness.http.state.fetchCount;
    let tableListenerCount = 0;
    const listenerId = client.store.raw.addTableListener("todos", () => {
      tableListenerCount += 1;
    });

    harness.transport.deliverDelta(makeDelta({id: "t1", seq: 1}));
    harness.transport.deliverDelta(makeDelta({id: "t2", seq: 2}));
    // This jump must retain the existing reconcile hint behavior.
    harness.transport.deliverDelta(makeDelta({id: "t3", seq: 4}));
    await flush();

    client.store.raw.delListener(listenerId);
    expect(tableListenerCount).toBe(1);
    expect(client.store.listEntities({collection: "todos"}).map((entity) => entity.id)).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
    expect(
      client.debug
        ?.getEvents()
        .filter((event) => event.type === "delta")
        .map((event) => ({entityId: event.entityId, seq: event.seq}))
    ).toEqual([
      {entityId: "t1", seq: 1},
      {entityId: "t2", seq: 2},
      {entityId: "t3", seq: 4},
    ]);
    expect(harness.http.state.fetchCount).toBe(baselineFetchCount + 1);
    await client.stop();
  });

  describe("reconcile triggers", () => {
    it("reconciles and replays when the transport (re)connects", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      const baseline = harness.http.state.fetchCount;
      expect(baseline).toBeGreaterThanOrEqual(1);

      harness.transport.setConnected(false);
      harness.transport.setConnected(true);
      await flush();
      expect(harness.http.state.fetchCount).toBe(baseline + 1);
      await client.stop();
    });

    it("rate-limits seq-jump reconciles per stream", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      const baseline = harness.http.state.fetchCount;

      // First jump (seq 10 with cursor 0) triggers a reconcile.
      harness.transport.deliverDelta(makeDelta({id: "a", seq: 10}));
      await flush();
      expect(harness.http.state.fetchCount).toBe(baseline + 1);

      // A second jump on the same stream inside the window is suppressed.
      harness.transport.deliverDelta(makeDelta({id: "b", seq: 20}));
      await flush();
      expect(harness.http.state.fetchCount).toBe(baseline + 1);

      // A jump on a different stream is rate-limited independently.
      harness.transport.deliverDelta(makeDelta({id: "c", seq: 10, stream: "todos|owner:other"}));
      await flush();
      expect(harness.http.state.fetchCount).toBe(baseline + 2);

      // After the per-stream window elapses the same stream may reconcile again.
      harness.clock.value += 30_000;
      harness.transport.deliverDelta(makeDelta({id: "d", seq: 40}));
      await flush();
      expect(harness.http.state.fetchCount).toBe(baseline + 3);
      await client.stop();
    });

    it("non-jump deltas never trigger a reconcile", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      const baseline = harness.http.state.fetchCount;
      harness.transport.deliverDelta(makeDelta({seq: 1}));
      await flush();
      expect(harness.http.state.fetchCount).toBe(baseline);
      await client.stop();
    });

    it("runs the periodic reconcile timer and stops it on stop()", async () => {
      const harness = makeHarness({reconcileIntervalMs: 20});
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      const baseline = harness.http.state.fetchCount;
      await new Promise((resolve) => setTimeout(resolve, 70));
      const afterTimer = harness.http.state.fetchCount;
      expect(afterTimer).toBeGreaterThan(baseline);

      await client.stop();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(harness.http.state.fetchCount).toBe(afterTimer);
    });

    it("reconcile() is a no-op without an http channel", async () => {
      const harness = makeHarness({httpChannel: undefined});
      const client = createSyncDb({...harness.config, httpChannel: undefined});
      await client.start();
      await expect(client.reconcile()).resolves.toBeUndefined();
      await client.stop();
    });

    it("window collection reconcile interval does not GET /sync/snapshot", async () => {
      const snapshotStreams: string[] = [];
      const harness = makeHarness({reconcileIntervalMs: 20, windowCollections: ["todos"]});
      const fetchSnapshotPage = harness.http.channel.fetchSnapshotPage;
      harness.http.channel.fetchSnapshotPage = async (args) => {
        snapshotStreams.push(args.stream);
        return fetchSnapshotPage(args);
      };
      const client = createSyncDb(harness.config);
      await client.start();
      await new Promise((resolve) => setTimeout(resolve, 70));
      assert.deepEqual(snapshotStreams, []);
      await client.stop();
    });
  });

  describe("snapshot batch", () => {
    const NOTES_STREAM = "notes|owner:u1";

    /** Harness whose channel also serves `POST /sync/snapshot/batch` from `state.pages`. */
    const makeBatchHarness = (): Harness & {
      batchRequests: SyncSnapshotBatchRequest[];
      setBatchUnsupported: (unsupported: boolean) => void;
      gateNextBatch: () => () => void;
    } => {
      const harness = makeHarness({collections: ["todos", "notes"]});
      harness.http.state.streams = [
        {collection: "todos", stream: DEFAULT_STREAM},
        {collection: "notes", stream: NOTES_STREAM},
      ];
      const batchRequests: SyncSnapshotBatchRequest[] = [];
      let isUnsupported = false;
      let gate: Promise<void> | undefined;
      harness.http.channel.fetchSnapshotBatch = async (request) => {
        batchRequests.push(request);
        const pending = gate;
        gate = undefined;
        await pending;
        if (isUnsupported) {
          return {type: "unsupported"};
        }
        return {
          pages: request.streams.map(
            ({stream}) => harness.http.state.pages[stream] ?? emptyPage(stream)
          ),
          type: "pages",
        };
      };
      return {
        ...harness,
        batchRequests,
        gateNextBatch: (): (() => void) => {
          let release = (): void => {};
          gate = new Promise<void>((resolve) => {
            release = (): void => resolve();
          });
          return release;
        },
        setBatchUnsupported: (unsupported: boolean): void => {
          isUnsupported = unsupported;
        },
      };
    };

    it("bootstraps every stream with one batch request instead of one request per stream", async () => {
      const harness = makeBatchHarness();
      harness.http.state.pages[NOTES_STREAM] = {
        ...emptyPage(NOTES_STREAM, 3),
        entities: [{data: {body: "hello"}, deleted: false, id: "n1", seq: 3}],
      };
      const client = createSyncDb(harness.config);
      await client.start();
      await waitUntil(() => client.store.getEntity({collection: "notes", id: "n1"}) !== undefined);

      expect(harness.batchRequests).toHaveLength(1);
      expect(harness.batchRequests[0]?.streams.map(({stream}) => stream)).toEqual([
        DEFAULT_STREAM,
        NOTES_STREAM,
      ]);
      expect(harness.batchRequests[0]?.limit).toBe(5000);
      expect(harness.http.state.fetchCount).toBe(0);
      await client.stop();
    });

    it("falls back to per-stream paging when the server has no batch route, and remembers", async () => {
      const harness = makeBatchHarness();
      harness.setBatchUnsupported(true);
      const client = createSyncDb(harness.config);
      await client.start();
      await waitUntil(() => harness.http.state.fetchCount === 2);

      await client.reconcile();

      expect(harness.batchRequests).toHaveLength(1);
      expect(harness.http.state.fetchCount).toBe(4);
      await client.stop();
    });

    it("pages confirmations that arrive during a catch-up together in the next request", async () => {
      const harness = makeBatchHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      harness.batchRequests.length = 0;

      const release = harness.gateNextBatch();
      harness.transport.confirmSubscribed({collection: "todos", streams: [DEFAULT_STREAM]});
      harness.transport.confirmSubscribed({collection: "notes", streams: [NOTES_STREAM]});
      harness.transport.confirmSubscribed({collection: "notes", streams: ["notes|owner:shared"]});
      release();
      await waitUntil(() => harness.batchRequests.length === 2);
      await flush();

      expect(
        harness.batchRequests.map((request) => request.streams.map(({stream}) => stream))
      ).toEqual([[DEFAULT_STREAM], [NOTES_STREAM, "notes|owner:shared"]]);
      await client.stop();
    });
  });

  describe("subscribe confirmation catch-up", () => {
    it("pages a confirmed stream, catching a write the startup snapshot missed", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      // The startup reconcile paged the stream to an empty head; the server accepted the
      // room join only afterwards, and a write landed in between.
      expect(client.store.getEntity({collection: "todos", id: "late"})).toBeUndefined();
      harness.http.state.pages[DEFAULT_STREAM] = {
        cursor: 7,
        entities: [{data: {title: "written during the join"}, deleted: false, id: "late", seq: 7}],
        frontierSeq: 7,
        hasMore: false,
        oldestRetainedSeq: 0,
        stream: DEFAULT_STREAM,
      };

      harness.transport.confirmSubscribed({collection: "todos", streams: [DEFAULT_STREAM]});
      await flush();

      expect(client.store.getEntity({collection: "todos", id: "late"})?.data).toEqual({
        title: "written during the join",
      });
      await client.stop();
    });

    it("records a confirmed stream the client has not seen before", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();

      harness.transport.confirmSubscribed({collection: "todos", streams: ["todos|owner:new"]});
      await flush();

      expect(client.store.getKnownStreams()).toContain("todos|owner:new");
      await client.stop();
    });

    it("ignores confirmations for unconfigured collections and empty stream lists", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      const baseline = harness.http.state.fetchCount;

      harness.transport.confirmSubscribed({collection: "projects", streams: ["projects|all"]});
      harness.transport.confirmSubscribed({collection: "todos", streams: []});
      await flush();

      expect(harness.http.state.fetchCount).toBe(baseline);
      expect(client.store.getKnownStreams()).not.toContain("projects|all");
      await client.stop();
    });

    it("window subscribe confirmation does not GET /sync/snapshot", async () => {
      const harness = makeHarness({windowCollections: ["todos"]});
      const snapshotStreams: string[] = [];
      const fetchSnapshotPage = harness.http.channel.fetchSnapshotPage;
      harness.http.channel.fetchSnapshotPage = async (args) => {
        snapshotStreams.push(args.stream);
        return fetchSnapshotPage(args);
      };
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      snapshotStreams.length = 0;

      harness.transport.confirmSubscribed({
        collection: "todos",
        mode: "window",
        streams: ["todos|admin"],
      });
      await flush();

      assert.deepEqual(snapshotStreams, []);
      await client.stop();
    });

    it("does not page while simulated-offline", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      client.goOffline();
      const baseline = harness.http.state.fetchCount;

      harness.transport.confirmSubscribed({collection: "todos", streams: [DEFAULT_STREAM]});
      await flush();

      expect(harness.http.state.fetchCount).toBe(baseline);
      await client.stop();
    });

    it("stops listening for confirmations after stop()", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      await client.stop();
      const baseline = harness.http.state.fetchCount;

      harness.transport.confirmSubscribed({collection: "todos", streams: [DEFAULT_STREAM]});
      await flush();

      expect(harness.http.state.fetchCount).toBe(baseline);
    });
  });

  describe("stream discovery, join & leave (C2)", () => {
    it("join: a newly-returned stream is bootstrapped from 0 and recorded as known", async () => {
      const harness = makeHarness();
      const joined = "todos|tenant:org1";
      // Server advertises the default owner stream plus a new tenant stream, and serves a
      // one-entity page for the joined stream.
      harness.http.state.streams = [
        {collection: "todos", stream: DEFAULT_STREAM},
        {collection: "todos", stream: joined},
      ];
      harness.http.state.pages[joined] = {
        cursor: 4,
        entities: [{data: {title: "tenant doc"}, deleted: false, id: "tj", seq: 4}],
        frontierSeq: 4,
        hasMore: false,
        oldestRetainedSeq: 0,
        stream: joined,
      };
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();

      expect(client.store.getKnownStreams().sort()).toEqual([DEFAULT_STREAM, joined].sort());
      expect(client.store.getEntity({collection: "todos", id: "tj"})?.data).toEqual({
        title: "tenant doc",
      });
      await client.stop();
    });

    it("ignores streams for collections the client is not configured to sync", async () => {
      // A backend can host more collections than this client subscribes to (e.g. a
      // tenant-scoped `projects` stream exposed to org members while this app only
      // syncs `todos`). Discovery must skip the unconfigured stream instead of trying
      // to bootstrap it into a store with no `projects` table (which previously threw
      // "Unknown collection projects" and failed the whole reconcile).
      const harness = makeHarness();
      const unconfigured = "projects|tenant:org1";
      harness.http.state.streams = [
        {collection: "todos", stream: DEFAULT_STREAM},
        {collection: "projects", stream: unconfigured},
      ];
      harness.http.state.pages[unconfigured] = {
        cursor: 1,
        entities: [{data: {title: "a project"}, deleted: false, id: "p1", seq: 1}],
        frontierSeq: 1,
        hasMore: false,
        oldestRetainedSeq: 0,
        stream: unconfigured,
      };
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();

      // The configured todos stream is bootstrapped and known; the projects stream is
      // neither known nor bootstrapped, and reconcile did not throw.
      expect(client.store.getKnownStreams()).toContain(DEFAULT_STREAM);
      expect(client.store.getKnownStreams()).not.toContain(unconfigured);
      expect(client.getSyncStatus().paused).toBeUndefined();
      await client.stop();
    });

    it("leave (HTTP 200): a stream absent from the server set is purged locally", async () => {
      const harness = makeHarness();
      const leaving = "todos|tenant:org1";
      // First discovery advertises both streams so org1 becomes known and its entity lands.
      harness.http.state.streams = [
        {collection: "todos", stream: DEFAULT_STREAM},
        {collection: "todos", stream: leaving},
      ];
      harness.http.state.pages[leaving] = {
        cursor: 2,
        entities: [{data: {title: "org doc"}, deleted: false, id: "og", seq: 2}],
        frontierSeq: 2,
        hasMore: false,
        oldestRetainedSeq: 0,
        stream: leaving,
      };
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      expect(client.store.getEntity({collection: "todos", id: "og"})?.data).toEqual({
        title: "org doc",
      });
      expect(client.store.getKnownStreams()).toContain(leaving);

      // Membership changes: org1 is gone. A successful (HTTP 200) discovery purges it.
      harness.http.state.streams = [{collection: "todos", stream: DEFAULT_STREAM}];
      await client.reconcile();
      await flush();

      expect(client.store.getEntity({collection: "todos", id: "og"})).toBeUndefined();
      expect(client.store.getKnownStreams()).not.toContain(leaving);
      await client.stop();
    });

    it("leave under 401 (INV-2): NO purge, auth-pause, local data intact", async () => {
      const harness = makeHarness();
      const stream = "todos|tenant:org1";
      harness.http.state.streams = [
        {collection: "todos", stream: DEFAULT_STREAM},
        {collection: "todos", stream},
      ];
      harness.http.state.pages[stream] = {
        cursor: 2,
        entities: [{data: {title: "org doc"}, deleted: false, id: "og", seq: 2}],
        frontierSeq: 2,
        hasMore: false,
        oldestRetainedSeq: 0,
        stream,
      };
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      expect(client.store.getEntity({collection: "todos", id: "og"})).toBeDefined();

      // A 401 during discovery is NOT a membership change: pause, purge NOTHING.
      harness.http.state.streamsError = new AuthRequiredError();
      await client.reconcile();
      await flush();

      expect(client.getSyncStatus().paused).toBe("auth");
      expect(client.store.getEntity({collection: "todos", id: "og"})?.data).toEqual({
        title: "org doc",
      });
      expect(client.store.getKnownStreams()).toContain(stream);
      await client.stop();
    });

    it("transport error during discovery: NO purge, data intact (not a membership change)", async () => {
      const harness = makeHarness();
      const stream = "todos|tenant:org1";
      harness.http.state.streams = [
        {collection: "todos", stream: DEFAULT_STREAM},
        {collection: "todos", stream},
      ];
      harness.http.state.pages[stream] = {
        cursor: 1,
        entities: [{data: {x: 1}, deleted: false, id: "og", seq: 1}],
        frontierSeq: 1,
        hasMore: false,
        oldestRetainedSeq: 0,
        stream,
      };
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      expect(client.store.getEntity({collection: "todos", id: "og"})).toBeDefined();

      harness.http.state.streamsError = new Error("network down");
      // reconcile rethrows a transport error; the client's warn() wrapper swallows it, but
      // either way no purge happens and the pause state is NOT auth.
      await client.reconcile().catch(() => {});
      await flush();

      expect(client.store.getEntity({collection: "todos", id: "og"})).toBeDefined();
      expect(client.store.getKnownStreams()).toContain(stream);
      expect(client.getSyncStatus().paused).toBeUndefined();
      await client.stop();
    });

    it("legacy migration: a snapshot:{collection} cursor is dropped and streams re-bootstrap", async () => {
      const harness = makeHarness();
      harness.http.state.pages[DEFAULT_STREAM] = {
        cursor: 3,
        entities: [{data: {title: "fresh"}, deleted: false, id: "f1", seq: 3}],
        frontierSeq: 3,
        hasMore: false,
        oldestRetainedSeq: 0,
        stream: DEFAULT_STREAM,
      };
      const client = createSyncDb(harness.config);
      // Seed a legacy snapshot cursor + a stale known-stream entry BEFORE start(), as a
      // deployed client would hold. (The store is shared with the client instance.)
      client.store.raw.setRow(CURSORS_TABLE, "snapshot:todos", {seq: 42, updatedAt: "old"});
      client.store.addKnownStream({collection: "todos", stream: "todos|owner:stale"});

      await client.start();
      await flush();

      // The legacy pseudo-cursor is gone...
      expect(client.store.raw.hasRow(CURSORS_TABLE, "snapshot:todos")).toBe(false);
      // ...and the streams were re-bootstrapped from the current membership set.
      expect(client.store.getEntity({collection: "todos", id: "f1"})?.data).toEqual({
        title: "fresh",
      });
      expect(client.store.getKnownStreams()).toContain(DEFAULT_STREAM);
      await client.stop();
    });
  });

  describe("wipe-on-user-change", () => {
    it("persists data across restarts for the same user", async () => {
      const name = uniqueName();
      const harness = makeHarness({name});
      const client = createSyncDb(harness.config);
      await client.start();
      client.mutate({collection: "todos", data: {title: "persisted"}, operation: "create"});
      await flush();
      await client.stop();

      const second = makeHarness({name});
      const reopened = createSyncDb(second.config);
      await reopened.start();
      expect(reopened.store.listEntities({collection: "todos"})).toHaveLength(1);
      expect(reopened.store.getLastUserId()).toBe("u1");
      await reopened.stop();
    });

    it("wipes entities, outbox, cursors, and conflicts when the user changes", async () => {
      const name = uniqueName();
      const harness = makeHarness({name});
      harness.transport.setDefaultResponder(() => {
        throw new Error("offline");
      });
      const client = createSyncDb(harness.config);
      await client.start();
      client.mutate({collection: "todos", data: {title: "secret"}, operation: "create"});
      harness.transport.deliverDelta(makeDelta({id: "t9", seq: 2}));
      await flush();
      await client.stop();

      const second = makeHarness({name});
      second.auth.setUserId("u2");
      const nextClient = createSyncDb(second.config);
      await nextClient.start();
      expect(nextClient.store.listEntities({collection: "todos", includeDeleted: true})).toEqual(
        []
      );
      expect(nextClient.outbox.listQueued({userId: "u1"})).toEqual([]);
      // u1's delta had advanced this stream's cursor to 2; the wipe reset it. (The row
      // itself is back because this harness serves the same stream key to every user, so
      // u2's own post-wipe bootstrap re-registered it — at seq 0, from scratch.)
      expect(nextClient.getSyncStatus().streams[DEFAULT_STREAM]).toBe(0);
      expect(nextClient.store.getLastUserId()).toBe("u2");
      await nextClient.stop();
    });

    it("wipes and replays on an in-session auth user switch", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({collection: "todos", data: {title: "mine"}, id: "t1", seq: 1});

      harness.auth.setUserId("u2");
      harness.auth.emitAuthChange();
      await waitUntil(() => client.store.getLastUserId() === "u2");
      expect(client.store.listEntities({collection: "todos"})).toEqual([]);
      expect(client.store.getLastUserId()).toBe("u2");
      await client.stop();
    });

    it("an auth change for the same user replays queued mutations", async () => {
      const harness = makeHarness();
      harness.transport.setDefaultResponder(() => {
        throw new Error("offline");
      });
      const client = createSyncDb(harness.config);
      await client.start();
      const {id} = client.mutate({collection: "todos", data: {title: "x"}, operation: "create"});
      await flush();
      expect(client.getSyncStatus().queuedCount).toBe(1);

      // The failed send armed a jittered transport-failure backoff (A3,
      // unlimited retries) — advance past its cap so the retry is eligible
      // again before the auth-change replay trigger runs.
      harness.clock.value += 30_000;
      harness.transport.setDefaultResponder();
      harness.auth.emitAuthChange();
      await flush();
      expect(client.getSyncStatus().queuedCount).toBe(0);
      expect(client.store.getEntity({collection: "todos", id})?.pendingMutationId).toBeUndefined();
      await client.stop();
    });

    it("bounces the transport (disconnect, reconnect, resubscribe) on a different-user login", async () => {
      const harness = makeHarness();
      const observable = makeObservableTransport(harness.transport);
      harness.config.transport = observable.transport;
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      observable.events.length = 0;

      harness.auth.setUserId("u2");
      harness.auth.emitAuthChange();
      await flush();

      expect(observable.events).toEqual(["disconnect", "connect", "subscribe"]);
      expect(client.getSyncStatus().isOnline).toBe(true);
      await client.stop();
    });

    it("never applies a delta from the stale connection while a user-switch bounce is in flight", async () => {
      const harness = makeHarness();
      const observable = makeObservableTransport(harness.transport);
      harness.config.transport = observable.transport;
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();

      const releaseConnect = observable.gateNextConnect();
      harness.auth.setUserId("u2");
      harness.auth.emitAuthChange();
      await flush();

      // The wipe has run and the reconnect is still in flight: a delta the OLD
      // user's socket flushes now must never land in the new user's store.
      harness.transport.deliverDelta(makeDelta({id: "stale-u1", seq: 7}));
      expect(client.store.getEntity({collection: "todos", id: "stale-u1"})).toBeUndefined();

      releaseConnect();
      await flush();

      // The rebound handler applies deltas arriving on the new connection.
      harness.transport.deliverDelta(makeDelta({id: "fresh-u2", seq: 1}));
      expect(client.store.getEntity({collection: "todos", id: "fresh-u2"})).toBeDefined();
      expect(client.store.getEntity({collection: "todos", id: "stale-u1"})).toBeUndefined();
      await client.stop();
    });

    it("does not bounce the transport on a same-user re-auth", async () => {
      const harness = makeHarness();
      const observable = makeObservableTransport(harness.transport);
      harness.config.transport = observable.transport;
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      observable.events.length = 0;

      harness.auth.emitAuthChange();
      await flush();

      expect(observable.events).toEqual([]);
      expect(client.getSyncStatus().isOnline).toBe(true);
      await client.stop();
    });

    it("disconnects without reconnecting on logout", async () => {
      const harness = makeHarness();
      const observable = makeObservableTransport(harness.transport);
      harness.config.transport = observable.transport;
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      observable.events.length = 0;

      harness.auth.setUserId(null);
      harness.auth.emitAuthChange();
      await flush();

      expect(observable.events).toEqual(["disconnect"]);
      expect(client.getSyncStatus().isOnline).toBe(false);
      await client.stop();
    });

    it("a signed-out auth change clears the current user without wiping", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({collection: "todos", data: {title: "kept"}, id: "t1"});

      harness.auth.setUserId(null);
      harness.auth.emitAuthChange();
      await flush();
      expect(client.store.listEntities({collection: "todos"})).toHaveLength(1);
      expect(() => client.mutate({collection: "todos", operation: "create"})).toThrow(
        "requires start()"
      );
      await client.stop();
    });
  });

  describe("simulated offline (goOffline/goOnline)", () => {
    it("mutate while offline applies locally, queues, and reports offline", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      let statusChanges = 0;
      const unsubscribe = client.onStatusChange(() => {
        statusChanges += 1;
      });

      client.goOffline();
      expect(client.getSyncStatus().isOnline).toBe(false);
      expect(statusChanges).toBe(1);

      const {id, mutationId} = client.mutate({
        collection: "todos",
        data: {title: "offline milk run"},
        operation: "create",
      });
      await flush();
      const entity = client.store.getEntity({collection: "todos", id});
      expect(entity?.data).toEqual({title: "offline milk run"});
      expect(entity?.pendingMutationId).toBe(mutationId);
      expect(client.outbox.getMutation({mutationId})?.status).toBe("queued");
      expect(client.getSyncStatus().queuedCount).toBe(1);
      // Nothing is sent while offline — not even via the HTTP fallback.
      expect(harness.transport.sentMutations).toHaveLength(0);

      unsubscribe();
      await client.stop();
    });

    it("goOnline reconnects and replays the queued mutation", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();

      client.goOffline();
      const {id} = client.mutate({
        collection: "todos",
        data: {title: "queued"},
        operation: "create",
      });
      await flush();
      expect(client.getSyncStatus().queuedCount).toBe(1);

      await client.goOnline();
      await flush();
      expect(client.getSyncStatus().isOnline).toBe(true);
      expect(client.getSyncStatus().queuedCount).toBe(0);
      expect(harness.transport.sentMutations).toHaveLength(1);
      expect(client.store.getEntity({collection: "todos", id})?.pendingMutationId).toBeUndefined();
      await client.stop();
    });

    it("goOffline/goOnline are idempotent and record debug transitions", async () => {
      const harness = makeHarness({debug: true});
      const client = createSyncDb(harness.config);
      await client.start();

      // A no-op goOnline while already online must not double-connect.
      await client.goOnline();
      expect(client.getSyncStatus().isOnline).toBe(true);

      client.goOffline();
      client.goOffline();
      expect(client.getSyncStatus().isOnline).toBe(false);
      await client.goOnline();
      await flush();
      expect(client.getSyncStatus().isOnline).toBe(true);

      const types = client.debug?.getEvents().map((event) => event.type) ?? [];
      expect(types).toContain("disconnect");
      expect(types.filter((type) => type === "connect").length).toBeGreaterThanOrEqual(2);
      await client.stop();
    });

    it("the periodic timer pauses while offline and resumes on goOnline", async () => {
      const harness = makeHarness({reconcileIntervalMs: 20});
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();

      client.goOffline();
      const baseline = harness.http.state.fetchCount;
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(harness.http.state.fetchCount).toBe(baseline);

      await client.goOnline();
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(harness.http.state.fetchCount).toBeGreaterThan(baseline);
      await client.stop();
    });
  });

  describe("conflicts", () => {
    it("records conflicts from nacks and resolves them via the client", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({collection: "todos", data: {title: "old"}, id: "t1", seq: 2});
      harness.transport.respondWithNack({
        code: "conflict",
        serverDoc: {title: "server wins"},
        serverSeq: 7,
      });

      const {mutationId} = client.mutate({
        collection: "todos",
        data: {title: "mine"},
        id: "t1",
        operation: "update",
      });
      await flush();
      expect(client.getSyncStatus().conflictCount).toBe(1);
      expect(getConflict({mutationId, store: client.store})?.serverSeq).toBe(7);

      client.resolveConflict({mutationId, strategy: "useServer"});
      await flush();
      expect(client.getSyncStatus().conflictCount).toBe(0);
      expect(client.store.getEntity({collection: "todos", id: "t1"})?.data).toEqual({
        title: "server wins",
      });
      await client.stop();
    });

    it("flushes a resolved conflict before an immediate client reload can restore it", async () => {
      const name = uniqueName();
      const keyProvider = createLocalKeyProvider({cacheDbName: uniqueName()});
      const persisterFactory = createWebPersisterFactory({keyProvider});
      const harness = makeHarness({name, persisterFactory});
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({collection: "todos", data: {title: "old"}, id: "t1", seq: 2});
      harness.transport.respondWithNack({
        code: "conflict",
        serverDoc: {title: "server wins"},
        serverSeq: 7,
      });
      const {mutationId} = client.mutate({
        collection: "todos",
        data: {title: "mine"},
        id: "t1",
        operation: "update",
      });
      await new Promise((resolve): void => {
        setTimeout(resolve, 600);
      });
      assert.equal(client.getSyncStatus().conflictCount, 1);

      client.resolveConflict({mutationId, strategy: "useServer"});
      // The status stays conflicted until the no-debounce durability write
      // completes, which is the same signal the UI/reload test waits on.
      assert.equal(client.getSyncStatus().conflictCount, 1);
      for (
        let attempt = 0;
        attempt < 20 && client.getSyncStatus().conflictCount > 0;
        attempt += 1
      ) {
        await flush();
      }
      assert.equal(client.getSyncStatus().conflictCount, 0);
      const reopenedHarness = makeHarness({name, persisterFactory});
      const reopened = createSyncDb(reopenedHarness.config);
      await reopened.start();

      assert.equal(reopened.getSyncStatus().conflictCount, 0);
      assert.deepEqual(reopened.store.getEntity({collection: "todos", id: "t1"})?.data, {
        title: "server wins",
      });
      await reopened.stop();
      await client.stop();
    });

    it("falls back to save() when a persister does not expose flush()", async () => {
      const name = uniqueName();
      let saveCount = 0;
      const persisterFactory: PersisterFactory = (args) => {
        const persister = memoryPersisterFactory(args);
        return {
          ...persister,
          save: (): ReturnType<typeof persister.save> => {
            saveCount += 1;
            return persister.save();
          },
        };
      };
      const harness = makeHarness({name, persisterFactory});
      const client = createSyncDb(harness.config);
      await client.start();
      const savesBeforeResolution = saveCount;
      client.store.upsertEntity({collection: "todos", data: {title: "old"}, id: "t1", seq: 2});
      harness.transport.respondWithNack({
        code: "conflict",
        serverDoc: {title: "server wins"},
        serverSeq: 7,
      });
      const {mutationId} = client.mutate({
        collection: "todos",
        data: {title: "mine"},
        id: "t1",
        operation: "update",
      });
      await flush();

      client.resolveConflict({mutationId, strategy: "useServer"});
      for (
        let attempt = 0;
        attempt < 20 && client.getSyncStatus().conflictCount > 0;
        attempt += 1
      ) {
        await flush();
      }

      assert.isAbove(saveCount, savesBeforeResolution);
      assert.equal(client.getSyncStatus().conflictCount, 0);
      const reopened = createSyncDb(makeHarness({name, persisterFactory}).config);
      await reopened.start();
      assert.deepEqual(reopened.store.getEntity({collection: "todos", id: "t1"})?.data, {
        title: "server wins",
      });
      await reopened.stop();
      await client.stop();
    });

    it("keeps a resolved conflict pending and surfaces an error when flush() fails", async () => {
      const persistenceError = new Error("persistence unavailable");
      const persisterFactory: PersisterFactory = (args) => {
        const persister = memoryPersisterFactory(args);
        return {
          ...persister,
          flush: async (): Promise<void> => {
            throw persistenceError;
          },
        };
      };
      const harness = makeHarness({persisterFactory});
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({collection: "todos", data: {title: "old"}, id: "t1", seq: 2});
      harness.transport.respondWithNack({
        code: "conflict",
        serverDoc: {title: "server wins"},
        serverSeq: 7,
      });
      const {mutationId} = client.mutate({
        collection: "todos",
        data: {title: "mine"},
        id: "t1",
        operation: "update",
      });
      await flush();

      client.resolveConflict({mutationId, strategy: "useServer"});
      await flush();

      assert.equal(client.getSyncStatus().conflictCount, 1);
      assert.equal(client.getSyncStatus().persistence, "error");
      await client.stop();
      assert.equal(client.getSyncStatus().conflictCount, 0);
      await client.start();
      assert.equal(client.getSyncStatus().conflictCount, 0);
      await client.stop();
    });

    it("ignores a stale conflict flush rejection after a stop and restart", async () => {
      let rejectStaleFlush: ((error: unknown) => void) | undefined;
      let factoryCalls = 0;
      const persisterFactory: PersisterFactory = (args) => {
        const persister = memoryPersisterFactory(args);
        factoryCalls += 1;
        if (factoryCalls > 1) {
          return persister;
        }
        return {
          ...persister,
          flush: (): Promise<void> =>
            new Promise((_resolve, reject): void => {
              rejectStaleFlush = reject;
            }),
        };
      };
      const harness = makeHarness({persisterFactory});
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({collection: "todos", data: {title: "old"}, id: "t1", seq: 2});
      harness.transport.respondWithNack({
        code: "conflict",
        serverDoc: {title: "server wins"},
        serverSeq: 7,
      });
      const {mutationId} = client.mutate({
        collection: "todos",
        data: {title: "mine"},
        id: "t1",
        operation: "update",
      });
      await flush();

      client.resolveConflict({mutationId, strategy: "useServer"});
      assert.isFunction(rejectStaleFlush);
      await client.stop();
      await client.start();
      rejectStaleFlush?.(new Error("stale flush failed"));
      await flush();

      assert.equal(client.getSyncStatus().conflictCount, 0);
      assert.equal(client.getSyncStatus().persistence, "durable");
      await client.stop();
    });

    it("keeps the first durability latch when conflict resolution is called twice", async () => {
      let resolvePersistenceFlush: (() => void) | undefined;
      const persisterFactory: PersisterFactory = (args) => {
        const persister = memoryPersisterFactory(args);
        return {
          ...persister,
          flush: (): Promise<void> =>
            new Promise((resolve): void => {
              resolvePersistenceFlush = resolve;
            }),
        };
      };
      const harness = makeHarness({persisterFactory});
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({collection: "todos", data: {title: "old"}, id: "t1", seq: 2});
      harness.transport.respondWithNack({
        code: "conflict",
        serverDoc: {title: "server wins"},
        serverSeq: 7,
      });
      const {mutationId} = client.mutate({
        collection: "todos",
        data: {title: "mine"},
        id: "t1",
        operation: "update",
      });
      await flush();

      client.resolveConflict({mutationId, strategy: "useServer"});
      assert.equal(client.getSyncStatus().conflictCount, 1);
      assert.throws(
        () => client.resolveConflict({mutationId, strategy: "useServer"}),
        /Conflict not found/
      );
      assert.equal(client.getSyncStatus().conflictCount, 1);
      resolvePersistenceFlush?.();
      await flush();

      assert.equal(client.getSyncStatus().conflictCount, 0);
      await client.stop();
    });

    // Task 9.12: an edit-vs-server-delete conflict resolved `useServer` must
    // leave a tombstone. A live row holding null data would keep showing up in
    // every list read (what useQuery/useEntityIds read) as an empty entity.
    it("useServer on a server-deleted conflict leaves a tombstone, not a ghost row (9.12)", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({collection: "todos", data: {title: "old"}, id: "t1", seq: 2});
      // The server reports a real seq with no document at it: deleted, hard-
      // deleted, or moved out of this client's scope.
      harness.transport.respondWithNack({code: "conflict", serverSeq: 7});

      const {mutationId} = client.mutate({
        collection: "todos",
        data: {title: "mine"},
        id: "t1",
        operation: "update",
      });
      await flush();
      client.resolveConflict({mutationId, strategy: "useServer"});

      const entity = client.store.getEntity({collection: "todos", id: "t1"});
      expect(entity?.deleted).toBe(true);
      expect(entity?.seq).toBe(7);
      expect(client.store.listEntities({collection: "todos"})).toHaveLength(0);
      await client.stop();
    });

    it("getSyncStatus attributes conflicts and failures to their collection", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({collection: "todos", data: {title: "old"}, id: "t1", seq: 2});
      harness.transport.respondWithNack({
        code: "conflict",
        serverDoc: {title: "server wins"},
        serverSeq: 7,
      });
      const {mutationId} = client.mutate({
        collection: "todos",
        data: {title: "mine"},
        id: "t1",
        operation: "update",
      });
      await flush();

      harness.transport.respondWithNack({code: "validation", message: "bad data"});
      client.mutate({collection: "todos", data: {title: "bad"}, operation: "create"});
      await flush();

      expect(client.getSyncStatus().collections).toEqual({
        todos: {conflictCount: 1, failedCount: 1, queuedCount: 0},
      });

      client.resolveConflict({mutationId, strategy: "useServer"});
      await flush();
      expect(client.getSyncStatus().collections).toEqual({
        todos: {conflictCount: 0, failedCount: 1, queuedCount: 0},
      });
      await client.stop();
    });

    it("getSyncStatus omits healthy collections from the breakdown", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      client.mutate({collection: "todos", data: {title: "fine"}, operation: "create"});
      await flush();

      expect(client.getSyncStatus().collections).toEqual({});
      await client.stop();
    });
  });

  describe("batched drain (B3/B4/B5)", () => {
    it("sends multiple queued mutations as a single batch via the socket transport", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      harness.transport.setConnected(true);
      await flush();

      // Enqueue directly (bypassing mutate()'s own per-call replay trigger,
      // which would otherwise start draining synchronously — up to its first
      // real await — before the second/third mutation exist, since each
      // mutate() call's fire-and-forget replayOutbox() can independently
      // observe the queue as it existed at that instant instead of all three
      // landing in the same batch) so a single replayOutbox() call sees all
      // three together deterministically.
      client.outbox.enqueue({
        args: {title: "a"},
        collection: "todos",
        entityId: "e1",
        operation: "create",
        userId: "u1",
      });
      client.outbox.enqueue({
        args: {title: "b"},
        collection: "todos",
        entityId: "e2",
        operation: "create",
        userId: "u1",
      });
      client.outbox.enqueue({
        args: {title: "c"},
        collection: "todos",
        entityId: "e3",
        operation: "create",
        userId: "u1",
      });
      await client.replayOutbox();

      expect(harness.transport.sentBatches.length).toBeGreaterThanOrEqual(1);
      expect(harness.transport.sentBatches.flat()).toHaveLength(3);
      expect(client.getSyncStatus().queuedCount).toBe(0);
      await client.stop();
    });

    it("re-probes batch support on reconnect after a batch-unsupported determination", async () => {
      const harness = makeHarness();
      harness.transport.setBatchResponder(() => ({type: "unsupported"}));
      const client = createSyncDb(harness.config);
      await client.start();
      harness.transport.setConnected(true);
      await flush();

      client.outbox.enqueue({
        args: {title: "a"},
        collection: "todos",
        entityId: "e1",
        operation: "create",
        userId: "u1",
      });
      client.outbox.enqueue({
        args: {title: "b"},
        collection: "todos",
        entityId: "e2",
        operation: "create",
        userId: "u1",
      });
      await client.replayOutbox();
      expect(client.getSyncStatus().queuedCount).toBe(0);
      expect(harness.transport.sentMutations).toHaveLength(2);

      harness.transport.setBatchResponder();
      // A reconnect re-probes batch support.
      harness.transport.setConnected(false);
      await flush();
      harness.transport.setConnected(true);
      await flush();
      client.outbox.enqueue({
        args: {title: "c"},
        collection: "todos",
        entityId: "e3",
        operation: "create",
        userId: "u1",
      });
      client.outbox.enqueue({
        args: {title: "d"},
        collection: "todos",
        entityId: "e4",
        operation: "create",
        userId: "u1",
      });
      await client.replayOutbox();
      expect(harness.transport.sentBatches.length).toBeGreaterThanOrEqual(1);
      await client.stop();
    });

    it("retryFailed re-enables an entity's successors after a validation failure", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      harness.transport.setConnected(true);

      harness.transport.respondWithNack({code: "validation", message: "bad data"});
      const {id} = client.mutate({collection: "todos", data: {title: "bad"}, operation: "create"});
      await flush();
      expect(client.getSyncStatus().failedCount).toBe(1);

      client.mutate({collection: "todos", data: {title: "v2"}, id, operation: "update"});
      await flush();
      // The successor is blocked and surfaced, not sent.
      expect(client.getSyncStatus().blockedEntities).toBe(1);
      expect(client.getSyncStatus().queuedCount).toBe(1);

      client.retryFailed({entityId: id});
      await flush();
      expect(client.getSyncStatus().blockedEntities).toBe(0);
      expect(client.getSyncStatus().queuedCount).toBe(0);
      await client.stop();
    });

    it("getSyncStatus reports draining and drain progress while a replay is in flight", async () => {
      const harness = makeHarness();
      let release: (() => void) | undefined;
      harness.transport.respondWith(async (request) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {ack: {id: request.id ?? "", mutationId: request.mutationId, seq: 1}, type: "ack"};
      });
      const client = createSyncDb(harness.config);
      await client.start();
      harness.transport.setConnected(true);
      // Let the startup no-op replay (empty queue) settle before enqueuing,
      // so the drain this test observes is the one triggered by mutate().
      await flush();

      client.mutate({collection: "todos", data: {title: "a"}, operation: "create"});
      await flush();
      const midDrainStatus = client.getSyncStatus();
      expect(midDrainStatus.draining).toBe(true);
      expect(midDrainStatus.totalThisDrain).toBeGreaterThanOrEqual(1);

      release?.();
      await flush();
      expect(client.getSyncStatus().draining).toBe(false);
      await client.stop();
    });

    it("respects a configured batchSize", async () => {
      const harness = makeHarness({batchSize: 2});
      const client = createSyncDb(harness.config);
      await client.start();
      harness.transport.setConnected(true);
      // Let the startup no-op replay (empty queue) settle first.
      await flush();

      for (let i = 0; i < 5; i++) {
        client.mutate({collection: "todos", data: {title: `t${i}`}, operation: "create"});
      }
      await flush();
      await flush();
      // 5 mutations at batchSize 2: two full batches of 2, then a lone
      // eligible mutation reuses the single-send path (not a batch of one).
      expect(harness.transport.sentBatches.map((b) => b.length)).toEqual([2, 2]);
      expect(harness.transport.sentMutations).toHaveLength(1);
      expect(client.getSyncStatus().queuedCount).toBe(0);
      await client.stop();
    });

    it("haltQueueOnConflict config plumbs through to the coordinator: a conflict halts the whole batch", async () => {
      const harness = makeHarness({haltQueueOnConflict: true});
      const client = createSyncDb(harness.config);
      await client.start();
      harness.transport.setConnected(true);
      // Let the startup no-op replay (empty queue) settle first.
      await flush();
      client.store.upsertEntity({collection: "todos", data: {title: "old"}, id: "t1", seq: 2});
      client.store.upsertEntity({collection: "todos", data: {title: "other"}, id: "t2"});

      // Enqueue both mutations via the outbox directly (bypassing mutate()'s
      // own fire-and-forget replay trigger, which would otherwise start
      // draining synchronously — up to its first real await — before the
      // second mutation exists, guaranteeing they land in separate chunks)
      // so a single replayOutbox() call sees both together deterministically.
      const mutationId = "halt-conflict-t1";
      client.outbox.enqueue({
        args: {title: "mine"},
        baseVersion: 2,
        collection: "todos",
        entityId: "t1",
        mutationId,
        operation: "update",
        userId: "u1",
      });
      client.outbox.enqueue({
        args: {title: "other"},
        collection: "todos",
        entityId: "t2",
        mutationId: "halt-conflict-t2",
        operation: "update",
        userId: "u1",
      });

      // Realistic server behavior (B2 stop-on-first-non-ack): t1 is first and
      // conflicts, so "other" never gets attempted — truncated response.
      harness.transport.setBatchResponder(() => ({
        results: [{nack: {code: "conflict", mutationId, serverSeq: 7}, type: "nack"}],
        type: "results",
      }));
      await client.replayOutbox();

      expect(client.getSyncStatus().conflictCount).toBe(1);
      // The second (distinct-entity) mutation never got a result and never
      // sent again this pass — haltQueueOnConflict stopped the whole drain.
      expect(client.getSyncStatus().queuedCount).toBe(1);
      expect(client.outbox.getMutation({mutationId})?.status).toBe("conflicted");
      await client.stop();
    });
  });

  it("falls back to the HTTP channel for mutations while disconnected", async () => {
    const harness = makeHarness();
    const offlineTransport: FakeTransport = {
      ...harness.transport,
      connect: async () => {
        throw new Error("no network");
      },
    };
    let httpMutations = 0;
    const http: HttpChannel = {
      fetchEntities: async () => ({entities: []}),
      fetchKeyMaterial: harness.http.channel.fetchKeyMaterial,
      fetchSnapshotPage: harness.http.channel.fetchSnapshotPage,
      fetchStreams: harness.http.channel.fetchStreams,
      sendMutation: async (request) => {
        httpMutations += 1;
        return {ack: {id: request.id ?? "", mutationId: request.mutationId, seq: 5}, type: "ack"};
      },
    };
    const client = createSyncDb({
      ...harness.config,
      httpChannel: http,
      transport: offlineTransport,
    });
    await client.start();

    const {id} = client.mutate({collection: "todos", data: {title: "x"}, operation: "create"});
    await flush();
    expect(httpMutations).toBe(1);
    expect(client.store.getEntity({collection: "todos", id})?.seq).toBe(5);
    await client.stop();
  });

  it("aggregates sync status", async () => {
    const harness = makeHarness();
    harness.transport.setDefaultResponder(() => {
      throw new Error("offline");
    });
    const client = createSyncDb(harness.config);
    await client.start();
    expect(client.getSyncStatus().isOnline).toBe(true);

    client.mutate({collection: "todos", data: {title: "a"}, operation: "create"});
    await flush();
    const status = client.getSyncStatus();
    expect(status.queuedCount).toBe(1);
    expect(status.conflictCount).toBe(0);
    expect(status.isSyncing).toBe(false);

    harness.transport.setConnected(false);
    expect(client.getSyncStatus().isOnline).toBe(false);
    await client.stop();
  });

  it("stop() disconnects and removes listeners", async () => {
    const harness = makeHarness();
    const client = createSyncDb(harness.config);
    await client.start();
    await client.stop();
    expect(client.getSyncStatus().isOnline).toBe(false);

    // Deltas delivered after stop are ignored (listener removed).
    harness.transport.deliverDelta(makeDelta());
    expect(client.store.getEntity({collection: "todos", id: "t1"})).toBeUndefined();
    // Auth changes after stop are ignored too.
    harness.auth.emitAuthChange();
    await flush();
  });

  describe("debug log", () => {
    it("is undefined by default and present when enabled", async () => {
      const off = createSyncDb(makeHarness().config);
      expect(off.debug).toBeUndefined();

      const on = createSyncDb(makeHarness({debug: true}).config);
      expect(on.debug).toBeDefined();
    });

    it("records local mutations, inbound deltas, sends and acks", async () => {
      const harness = makeHarness({debug: true});
      const client = createSyncDb(harness.config);
      await client.start();

      client.mutate({collection: "todos", data: {title: "a"}, operation: "create"});
      await flush();
      harness.transport.deliverDelta(makeDelta({id: "t9", seq: 1}));

      const types = client.debug?.getEvents().map((e) => e.type) ?? [];
      expect(types).toContain("mutate");
      expect(types).toContain("send");
      expect(types).toContain("ack");
      expect(types).toContain("delta");

      const mutateEvent = client.debug?.getEvents().find((e) => e.type === "mutate");
      expect(mutateEvent?.collection).toBe("todos");
      expect(mutateEvent?.operation).toBe("create");

      // The debug panel shows the create/update body: both the local mutate and
      // the outbound send carry the request body in `detail.data`.
      expect(mutateEvent?.detail?.data).toEqual({title: "a"});
      const sendEvent = client.debug?.getEvents().find((e) => e.type === "send");
      expect(sendEvent?.detail?.data).toEqual({title: "a"});
      await client.stop();
    });

    it("records conflict nacks", async () => {
      const harness = makeHarness({debug: true});
      harness.transport.setDefaultResponder((request) => ({
        nack: {
          code: "conflict",
          mutationId: request.mutationId,
          serverDoc: {title: "server wins"},
          serverSeq: 7,
        },
        type: "nack",
      }));
      const client = createSyncDb(harness.config);
      await client.start();

      client.mutate({collection: "todos", data: {title: "mine"}, operation: "create"});
      await flush();

      const conflict = client.debug?.getEvents().find((e) => e.type === "conflict");
      expect(conflict?.ok).toBe(false);
      expect(conflict?.detail?.serverSeq).toBe(7);
      // The conflicting create/update body is surfaced so it can be inspected.
      expect(conflict?.detail?.data).toEqual({title: "mine"});
      await client.stop();
    });

    it("skips the debug-only listQueued scan in replayOutbox() when debug is disabled (A3)", async () => {
      const countListQueuedCalls = async (debug: boolean): Promise<number> => {
        const harness = makeHarness({debug});
        const client = createSyncDb(harness.config);
        await client.start();
        await flush();
        const originalListQueued = client.outbox.listQueued;
        let calls = 0;
        // noExplicitAny: test-only spy shim on a private outbox method
        // biome-ignore lint/suspicious/noExplicitAny: test-only spy shim on a private outbox method
        (client.outbox as any).listQueued = (...args: any[]) => {
          calls += 1;
          return originalListQueued(...(args as [{collection?: string; userId: string}]));
        };
        await client.replayOutbox();
        await client.stop();
        return calls;
      };

      const withoutDebug = await countListQueuedCalls(false);
      const withDebug = await countListQueuedCalls(true);
      // The debug label adds exactly one extra listQueued scan (the drain
      // itself still calls listQueued to find work) — proving the debug-only
      // scan is conditional, not unconditional.
      expect(withDebug).toBe(withoutDebug + 1);
    });
  });

  describe("startup recovery (A1)", () => {
    it("recovers a stranded inFlight row on start(): it replays and the entity receives deltas again", async () => {
      const name = uniqueName();
      const harness = makeHarness({name});
      // Hold every send indefinitely so the mutation is still inFlight when
      // stop() is called (simulating a crash mid-send, not a clean stop).
      harness.transport.respondWith(() => new Promise(() => {}));
      const client = createSyncDb(harness.config);
      await client.start();
      const {id, mutationId} = client.mutate({
        collection: "todos",
        data: {title: "stranded"},
        operation: "create",
      });
      await flush();
      expect(client.outbox.getMutation({mutationId})?.status).toBe("inFlight");
      // stop() itself never repairs outbox state (only start() does) — a
      // clean stop() here still leaves the row inFlight in persisted content,
      // standing in for a hard crash that never ran a graceful shutdown.
      await client.stop();

      const second = makeHarness({name});
      const reopened = createSyncDb(second.config);
      await reopened.start();
      await flush();
      // Recovered to queued and replayed against the fresh (auto-acking)
      // transport: the row acks and — per A5 — is pruned immediately, so its
      // resolution shows up as a successful send, not a lingering outbox row.
      expect(reopened.outbox.getMutation({mutationId})).toBeUndefined();
      expect(second.transport.sentMutations.map((m) => m.mutationId)).toContain(mutationId);
      expect(
        reopened.store.getEntity({collection: "todos", id})?.pendingMutationId
      ).toBeUndefined();
      // The entity's pendingMutationId was released — a subsequent delta applies.
      second.transport.deliverDelta({
        collection: "todos",
        data: {title: "from server"},
        id,
        method: "update",
        seq: 99,
        stream: "todos|owner:u1",
      });
      expect(reopened.store.getEntity({collection: "todos", id})?.data).toEqual({
        title: "from server",
      });
      await reopened.stop();
    });

    it("clears a stale pendingMutationId for an acked-with-pending row on start()", async () => {
      const name = uniqueName();
      const harness = makeHarness({name});
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({
        collection: "todos",
        data: {title: "x"},
        id: "t1",
        pendingMutationId: "m1",
      });
      client.outbox.enqueue({
        args: {title: "x"},
        collection: "todos",
        entityId: "t1",
        mutationId: "m1",
        operation: "create",
        userId: "u1",
      });
      client.outbox.markInFlight({mutationId: "m1"});
      client.outbox.markAcked({mutationId: "m1"});
      // Simulate a crash between markAcked and releaseEntity.
      await flush();
      await client.stop();

      const second = makeHarness({name});
      const reopened = createSyncDb(second.config);
      await reopened.start();
      expect(
        reopened.store.getEntity({collection: "todos", id: "t1"})?.pendingMutationId
      ).toBeUndefined();
      await reopened.stop();
    });

    it("writes a missing conflict row for a conflicted mutation on start()", async () => {
      const name = uniqueName();
      const harness = makeHarness({name});
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({
        collection: "todos",
        data: {title: "local"},
        id: "t1",
        pendingMutationId: "m1",
      });
      client.outbox.enqueue({
        args: {title: "local"},
        collection: "todos",
        entityId: "t1",
        mutationId: "m1",
        operation: "create",
        userId: "u1",
      });
      client.outbox.markInFlight({mutationId: "m1"});
      client.outbox.markConflicted({mutationId: "m1"});
      // Simulate a crash between markConflicted and writeConflict: no row yet.
      expect(getConflict({mutationId: "m1", store: client.store})).toBeUndefined();
      await flush();
      await client.stop();

      const second = makeHarness({name});
      const reopened = createSyncDb(second.config);
      await reopened.start();
      const conflict = getConflict({mutationId: "m1", store: reopened.store});
      expect(conflict?.entityId).toBe("t1");
      expect(conflict?.serverSeq).toBe(0);
      await reopened.stop();
    });

    // Task 9.11b: a pendingMutationId pointing at a mutation with no `_outbox`
    // row (pruned, wiped, or lost to a partial persist) freezes the entity —
    // the delta applier skips it for pending protection and repair refuses to
    // overwrite it. The startup sweep is the only thing that can release it.
    it("releases an orphaned pendingMutationId on start() so the entity accepts deltas again (9.11b)", async () => {
      const name = uniqueName();
      const harness = makeHarness({name});
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({
        collection: "todos",
        data: {title: "frozen"},
        id: "t1",
        pendingMutationId: "row-never-persisted",
        seq: 4,
        stream: DEFAULT_STREAM,
      });
      await flush();
      await client.stop();

      const second = makeHarness({name});
      const reopened = createSyncDb(second.config);
      await reopened.start();
      const recovered = reopened.store.getEntity({collection: "todos", id: "t1"});
      // The persisted row survived the reload with its payload intact — only the
      // dangling pending lock was dropped.
      expect(recovered?.data).toEqual({title: "frozen"});
      expect(recovered?.seq).toBe(4);
      expect(recovered?.pendingMutationId).toBeUndefined();

      second.transport.deliverDelta(
        makeDelta({data: {title: "from server"}, id: "t1", method: "update", seq: 9})
      );
      const entity = reopened.store.getEntity({collection: "todos", id: "t1"});
      expect(entity?.data).toEqual({title: "from server"});
      expect(entity?.seq).toBe(9);
      await reopened.stop();
    });
  });

  // Task 9.11a: a terminal nack leaves optimistic data the server never
  // accepted. With no concurrent server write the entity's seq never moves, so
  // snapshot reconcile skips it — the terminal path must mark needs-repair so
  // the repair fetch pulls canonical state back over the rejected edit.
  describe("rejected optimistic data (9.11a)", () => {
    it("converges a validation-nacked entity back to server state", async () => {
      const harness = makeHarness();
      harness.http.channel.fetchEntities = async () => ({
        entities: [{data: {title: "server truth"}, deleted: false, id: "t1", seq: 5}],
      });
      const client = createSyncDb(harness.config);
      await client.start();
      harness.transport.deliverDelta(
        makeDelta({data: {title: "server truth"}, id: "t1", method: "create", seq: 5})
      );
      harness.transport.setDefaultResponder((request) => ({
        nack: {code: "validation", message: "title required", mutationId: request.mutationId},
        type: "nack",
      }));

      const {mutationId} = client.mutate({
        collection: "todos",
        data: {title: "rejected"},
        id: "t1",
        operation: "update",
      });
      await flush();

      expect(client.outbox.getMutation({mutationId})?.status).toBe("failed");
      const entity = client.store.getEntity({collection: "todos", id: "t1"});
      expect(entity?.data).toEqual({title: "server truth"});
      expect(entity?.seq).toBe(5);
      expect(entity?.pendingMutationId).toBeUndefined();
      // The repair landed, so nothing stays marked for a later reconcile pass.
      expect(client.store.hasNeedsRepair({collection: "todos", entityId: "t1"})).toBe(false);
      await client.stop();
    });

    // Editing a doc the server already deleted is the common shape of this: the
    // update 404s (a terminal `validation` nack, not a conflict — the server
    // cannot seq-conflict against a document its own read filter hides), so the
    // repair fetch is what teaches the client the entity is gone.
    it("converges to a tombstone when the server deleted the entity out from under the edit", async () => {
      const harness = makeHarness();
      harness.http.channel.fetchEntities = async () => ({
        entities: [{data: null, deleted: true, id: "t1", seq: 6}],
      });
      const client = createSyncDb(harness.config);
      await client.start();
      harness.transport.deliverDelta(
        makeDelta({data: {title: "server truth"}, id: "t1", method: "create", seq: 5})
      );
      harness.transport.setDefaultResponder((request) => ({
        nack: {code: "validation", message: "not found", mutationId: request.mutationId},
        type: "nack",
      }));

      client.mutate({
        collection: "todos",
        data: {title: "edited after delete"},
        id: "t1",
        operation: "update",
      });
      await flush();

      const entity = client.store.getEntity({collection: "todos", id: "t1"});
      expect(entity?.deleted).toBe(true);
      expect(entity?.seq).toBe(6);
      // No ghost row: the edited data never survives as a live entity.
      expect(client.store.listEntities({collection: "todos"})).toHaveLength(0);
      await client.stop();
    });

    it("keeps the needs-repair mark when the repair fetch fails, so a later reconcile retries it", async () => {
      const harness = makeHarness();
      harness.http.channel.fetchEntities = async () => {
        throw new Error("network down");
      };
      const client = createSyncDb(harness.config);
      await client.start();
      harness.transport.setDefaultResponder((request) => ({
        nack: {code: "validation", mutationId: request.mutationId},
        type: "nack",
      }));

      client.mutate({collection: "todos", data: {title: "rejected"}, operation: "create"});
      await flush();
      const [entity] = client.store.listEntities({collection: "todos"});
      expect(client.store.hasNeedsRepair({collection: "todos", entityId: entity.id})).toBe(true);
      await client.stop();
    });
  });

  describe("outbox hygiene (A5)", () => {
    it("prunes acked rows after a successful drain pass, driven end-to-end through mutate()", async () => {
      const harness = makeHarness();
      harness.transport.respondWithAck({seq: 1});
      const client = createSyncDb(harness.config);
      await client.start();

      const {mutationId} = client.mutate({
        collection: "todos",
        data: {title: "x"},
        operation: "create",
      });
      await flush();
      // The mutation acked and was pruned in the same drain pass — no lingering row.
      expect(client.outbox.getMutation({mutationId})).toBeUndefined();
      expect(client.getSyncStatus().queuedCount).toBe(0);
      await client.stop();
    });

    it("keeps failed rows visible in failedCount until pruned past the retention window", async () => {
      const harness = makeHarness();
      harness.transport.setDefaultResponder((request) => ({
        nack: {code: "validation", mutationId: request.mutationId},
        type: "nack",
      }));
      const client = createSyncDb(harness.config);
      await client.start();
      client.mutate({collection: "todos", data: {title: "bad"}, operation: "create"});
      await flush();
      expect(client.getSyncStatus().failedCount).toBe(1);
      await client.stop();
    });
  });

  describe("auth-pause pipeline (A4)", () => {
    /** Force sendMutation through the HTTP channel (offline transport) so AuthRequiredError surfaces. */
    const makeAuthPauseHarness = (
      overrides: Partial<SyncDbConfig> = {}
    ): Harness & {offlineTransport: FakeTransport} => {
      const harness = makeHarness(overrides);
      const offlineTransport: FakeTransport = {
        ...harness.transport,
        connect: async () => {
          throw new Error("no network");
        },
      };
      harness.config.transport = offlineTransport;
      return {...harness, offlineTransport};
    };

    it("AuthRequiredError from the HTTP channel pauses sync, leaves the outbox untouched, burns zero budget, and fires onAuthRequired once", async () => {
      const harness = makeAuthPauseHarness();
      let authRequiredCount = 0;
      harness.config.onAuthRequired = () => {
        authRequiredCount += 1;
      };
      harness.http.channel.sendMutation = async () => {
        throw new AuthRequiredError();
      };
      const client = createSyncDb(harness.config);
      await client.start();

      const {mutationId} = client.mutate({
        collection: "todos",
        data: {title: "x"},
        operation: "create",
      });
      await flush();

      expect(client.getSyncStatus().paused).toBe("auth");
      const mutation = client.outbox.getMutation({mutationId});
      expect(mutation?.status).toBe("queued");
      expect(mutation?.errorNackCount).toBe(0);
      expect(authRequiredCount).toBe(1);

      // A second replay trigger while still paused must not re-fire the hook.
      await client.replayOutbox();
      expect(authRequiredCount).toBe(1);
      await client.stop();
    });

    it("same-user re-auth clears the pause and drains the queue fully, entity converges", async () => {
      const harness = makeAuthPauseHarness();
      harness.http.channel.sendMutation = async () => {
        throw new AuthRequiredError();
      };
      const client = createSyncDb(harness.config);
      await client.start();
      const {id, mutationId} = client.mutate({
        collection: "todos",
        data: {title: "x"},
        operation: "create",
      });
      await flush();
      expect(client.getSyncStatus().paused).toBe("auth");

      // Re-authenticate as the SAME user with a channel that now works.
      harness.http.channel.sendMutation = async (request) => ({
        ack: {id: request.id ?? "", mutationId: request.mutationId, seq: 1},
        type: "ack",
      });
      harness.auth.emitAuthChange();
      await flush();

      expect(client.getSyncStatus().paused).toBeUndefined();
      expect(client.getSyncStatus().queuedCount).toBe(0);
      expect(client.outbox.getMutation({mutationId})).toBeUndefined();
      expect(client.store.getEntity({collection: "todos", id})?.pendingMutationId).toBeUndefined();
      await client.stop();
    });

    it("logout (userId -> undefined) retains local data; a later same-user login drains the queue", async () => {
      const harness = makeAuthPauseHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({collection: "todos", data: {title: "kept"}, id: "t1"});

      harness.auth.setUserId(null);
      harness.auth.emitAuthChange();
      await flush();
      expect(client.store.listEntities({collection: "todos"})).toHaveLength(1);
      expect(client.getSyncStatus().paused).toBe("auth");

      // Same user comes back — resumes fully, no wipe occurred.
      harness.auth.setUserId("u1");
      harness.auth.emitAuthChange();
      await flush();
      expect(client.getSyncStatus().paused).toBeUndefined();
      expect(client.store.listEntities({collection: "todos"})).toHaveLength(1);
      await client.stop();
    });

    it("a different-user login still wipes local data (regression)", async () => {
      const name = uniqueName();
      const harness = makeAuthPauseHarness({name});
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({collection: "todos", data: {title: "mine"}, id: "t1", seq: 1});

      harness.auth.setUserId("u2");
      harness.auth.emitAuthChange();
      await flush();
      expect(client.store.listEntities({collection: "todos"})).toEqual([]);
      expect(client.store.getLastUserId()).toBe("u2");
      await client.stop();
    });

    it("no reconcile/snapshot requests are issued while paused", async () => {
      const harness = makeAuthPauseHarness();
      harness.http.channel.sendMutation = async () => {
        throw new AuthRequiredError();
      };
      const client = createSyncDb(harness.config);
      await client.start();
      client.mutate({collection: "todos", data: {title: "x"}, operation: "create"});
      await flush();
      expect(client.getSyncStatus().paused).toBe("auth");

      const baseline = harness.http.state.fetchCount;
      await client.reconcile();
      expect(harness.http.state.fetchCount).toBe(baseline);
      await client.stop();
    });

    it("betterAuthAdapter's refresh() gets one silent attempt per pause episode, and a successful refresh resumes replay immediately", async () => {
      const harness = makeAuthPauseHarness();
      let refreshCalls = 0;
      let shouldSucceed = false;
      harness.config.authProvider = {
        ...harness.auth.provider,
        refresh: async () => {
          refreshCalls += 1;
          if (shouldSucceed) {
            // A real adapter's refresh() renews the underlying token in place;
            // simulate that by making the channel work again before reporting success.
            harness.http.channel.sendMutation = async (request) => ({
              ack: {id: request.id ?? "", mutationId: request.mutationId, seq: 1},
              type: "ack",
            });
          }
          return shouldSucceed;
        },
      };
      harness.http.channel.sendMutation = async () => {
        throw new AuthRequiredError();
      };
      const client = createSyncDb(harness.config);
      await client.start();
      const {mutationId} = client.mutate({
        collection: "todos",
        data: {title: "x"},
        operation: "create",
      });
      await flush();
      expect(refreshCalls).toBe(1);
      expect(client.getSyncStatus().paused).toBe("auth");

      // Further replay triggers within the SAME episode never re-attempt refresh.
      await client.replayOutbox();
      await client.replayOutbox();
      expect(refreshCalls).toBe(1);

      // The episode ends via same-user re-auth (not refresh) — the outbox is
      // still intact and unpaused replay drains it.
      harness.http.channel.sendMutation = async (request) => ({
        ack: {id: request.id ?? "", mutationId: request.mutationId, seq: 1},
        type: "ack",
      });
      harness.auth.emitAuthChange();
      await flush();
      expect(client.getSyncStatus().paused).toBeUndefined();
      expect(client.outbox.getMutation({mutationId})).toBeUndefined();

      // A FRESH pause episode (new failing mutation) gets its own refresh
      // attempt, and this time a successful refresh resumes replay immediately.
      shouldSucceed = true;
      harness.http.channel.sendMutation = async () => {
        throw new AuthRequiredError();
      };
      const {mutationId: secondMutationId} = client.mutate({
        collection: "todos",
        data: {title: "y"},
        operation: "create",
      });
      await flush();
      expect(refreshCalls).toBe(2);
      // The refresh succeeded, so the pause clears and replay retried with the
      // (now-working) channel rather than staying surfaced to the app.
      expect(client.getSyncStatus().paused).toBeUndefined();
      expect(client.outbox.getMutation({mutationId: secondMutationId})).toBeUndefined();
      await client.stop();
    });

    it("a refresh resolving a DIFFERENT user never unpauses or replays (INV-2)", async () => {
      const harness = makeAuthPauseHarness();
      harness.http.channel.sendMutation = async () => {
        throw new AuthRequiredError();
      };
      // The refresh succeeds, but the session it renewed belongs to another user
      // (a second tab signed in while this client was paused) — draining u1's
      // outbox under u2's identity is exactly what INV-2 forbids.
      harness.config.authProvider = {
        ...harness.auth.provider,
        refresh: async () => {
          harness.auth.setUserId("u2");
          return true;
        },
      };
      const client = createSyncDb(harness.config);
      await client.start();
      const {mutationId} = client.mutate({
        collection: "todos",
        data: {title: "x"},
        operation: "create",
      });
      await flush();

      expect(client.getSyncStatus().paused).toBe("auth");
      expect(client.outbox.getMutation({mutationId})?.status).toBe("queued");
      await client.stop();
    });

    // The silent refresh exists to recover a session that expired behind the
    // app's back. An explicit logout is the auth provider itself reporting "no
    // user", so there is nothing to refresh — and a refresh that somehow
    // succeeded could only resolve a user this client is not signed in as.
    it("does not attempt a silent refresh when the pause came from an explicit logout", async () => {
      const harness = makeHarness();
      let refreshCalls = 0;
      harness.config.authProvider = {
        ...harness.auth.provider,
        refresh: async () => {
          refreshCalls += 1;
          return true;
        },
      };
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();

      harness.auth.setUserId(null);
      harness.auth.emitAuthChange();
      await flush();

      expect(client.getSyncStatus().paused).toBe("auth");
      expect(refreshCalls).toBe(0);
      await client.stop();
    });

    it("a 401 surfacing through reconcile attempts exactly one silent refresh per episode", async () => {
      const harness = makeHarness();
      let refreshCalls = 0;
      harness.config.authProvider = {
        ...harness.auth.provider,
        refresh: async () => {
          refreshCalls += 1;
          return false;
        },
      };
      harness.http.state.streamsError = new AuthRequiredError();
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();

      expect(client.getSyncStatus().paused).toBe("auth");
      expect(refreshCalls).toBe(1);

      // Every later trigger inside the SAME episode is a no-op for the refresh.
      await client.reconcile();
      await client.replayOutbox();
      await flush();
      expect(refreshCalls).toBe(1);
      await client.stop();
    });
  });

  describe("socket session re-validation sweep mapping into auth-pause (D1)", () => {
    it("sync:auth-expired disconnect pauses sync with the outbox intact and zero budget consumed", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      harness.transport.setConnected(true);
      await flush();

      harness.transport.disconnectWithAuthExpired();
      await flush();
      expect(client.getSyncStatus().paused).toBe("auth");
      expect(client.getSyncStatus().isOnline).toBe(false);

      // A mutation enqueued WHILE paused must stay queued untouched — replay
      // stands down entirely until the pause clears (INV-2).
      const {mutationId} = client.mutate({
        collection: "todos",
        data: {title: "x"},
        operation: "create",
      });
      await flush();
      const mutation = client.outbox.getMutation({mutationId});
      expect(mutation?.status).toBe("queued");
      expect(mutation?.errorNackCount).toBe(0);
      expect(mutation?.attemptCount).toBe(0);
      await client.stop();
    });

    it("a plain disconnect (no auth-expired tag) does NOT enter the auth-pause state", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      harness.transport.setConnected(true);
      await flush();

      harness.transport.setConnected(false);
      await flush();

      expect(client.getSyncStatus().paused).toBeUndefined();
      expect(client.getSyncStatus().isOnline).toBe(false);
      await client.stop();
    });

    it("same-user re-auth after a sync:auth-expired pause resumes replay with the outbox intact", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      harness.transport.setConnected(true);
      await flush();

      harness.transport.disconnectWithAuthExpired();
      await flush();
      expect(client.getSyncStatus().paused).toBe("auth");

      // Enqueued while paused — stays queued (INV-2) until the pause clears.
      const {id, mutationId} = client.mutate({
        collection: "todos",
        data: {title: "x"},
        operation: "create",
      });
      await flush();
      expect(client.outbox.getMutation({mutationId})?.status).toBe("queued");

      // Same-user re-auth clears the pause; the transport reconnects and drains
      // the queue fully (the fake transport auto-acks by default).
      harness.auth.emitAuthChange();
      harness.transport.setConnected(true);
      await flush();

      expect(client.getSyncStatus().paused).toBeUndefined();
      expect(client.outbox.getMutation({mutationId})).toBeUndefined();
      expect(client.store.getEntity({collection: "todos", id})?.pendingMutationId).toBeUndefined();
      await client.stop();
    });

    it("no reconcile/replay is issued while paused from a sync:auth-expired disconnect", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      harness.transport.setConnected(true);
      await flush();

      harness.transport.disconnectWithAuthExpired();
      await flush();
      expect(client.getSyncStatus().paused).toBe("auth");

      const baseline = harness.http.state.fetchCount;
      await client.reconcile();
      expect(harness.http.state.fetchCount).toBe(baseline);
      await client.stop();
    });
  });

  describe("auth change while the session read fails (betterAuthAdapter)", () => {
    it("keeps the user and mutate() working when the device goes offline before the auth-change handler reads the session", async () => {
      // start() subscribes to the session atom, which hands over the current session at
      // once; the handler that emission queues runs after start() resolves. When the
      // network drops in between, its get-session read fails. That must not count as a
      // sign-out.
      const listeners = new Set<(value: unknown) => void>();
      // Only start()'s own read gets through; the network is gone for every later one.
      let sessionReads = 0;
      const session = {data: {session: {token: "tok"}, user: {id: "u1"}}};
      const harness = makeHarness({
        authProvider: betterAuthAdapter({
          getSession: async () => {
            sessionReads += 1;
            if (sessionReads > 1) {
              throw new TypeError("Failed to fetch");
            }
            return session;
          },
          useSession: {
            subscribe: (listener) => {
              listeners.add(listener);
              listener(session);
              return () => listeners.delete(listener);
            },
          },
        }),
      });
      const client = createSyncDb(harness.config);
      await client.start();
      await waitUntil(() => sessionReads > 1);
      await flush();

      expect(client.getSyncStatus().paused).toBeUndefined();
      const {id} = client.mutate({collection: "todos", data: {title: "x"}, operation: "create"});
      expect(id).toBeTruthy();
      await client.stop();
    });
  });

  describe("signOut() (A4)", () => {
    it("serializes against a concurrent auth change and leaves no destroyed persister behind", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({collection: "todos", data: {title: "kept"}, id: "t1"});

      // A user switch and a sign-out racing each other: both mutate
      // currentUserId/persister, so the lifecycle mutex must order them and the
      // later one must not write state the earlier one already tore down.
      harness.auth.setUserId("u2");
      harness.auth.emitAuthChange();
      const signOutPromise = client.signOut();
      await signOutPromise;
      await flush();

      // Sign-out ran last: no current user, and a mutation is rejected until a
      // fresh start() resolves one again.
      expect(() => client.mutate({collection: "todos", operation: "create"})).toThrow(
        "requires start()"
      );
      // The client is reusable: start() rebuilds persistence for the new user
      // rather than reusing the persister signOut() destroyed.
      await client.start();
      client.mutate({collection: "todos", data: {title: "after sign out"}, operation: "create"});
      await flush();
      expect(client.getSyncStatus().queuedCount).toBe(0);
      await client.stop();
    });

    it("clears the current user without wiping when wipeOnSignOut is not set", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({collection: "todos", data: {title: "kept"}, id: "t1"});

      await client.signOut();
      expect(client.store.listEntities({collection: "todos"})).toHaveLength(1);
      expect(() => client.mutate({collection: "todos", operation: "create"})).toThrow(
        "requires start()"
      );
    });

    it("wipes local data when wipeOnSignOut is configured", async () => {
      const harness = makeHarness({wipeOnSignOut: true});
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({collection: "todos", data: {title: "gone"}, id: "t1"});

      await client.signOut();
      expect(client.store.listEntities({collection: "todos", includeDeleted: true})).toEqual([]);
    });

    it("the wipeOnSignOut wipe also clears the cached derived encryption key (E3f)", async () => {
      const harness = makeHarness({
        persisterFactory: createWebPersisterFactory({saveDebounceMs: 0}),
        wipeOnSignOut: true,
      });
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      expect(
        await idbGet<CryptoKey>({databaseName: DEFAULT_KEY_CACHE_DB_NAME, key: "local:local"})
      ).toBeInstanceOf(CryptoKey);

      await client.signOut();

      expect(
        await idbGet<CryptoKey>({databaseName: DEFAULT_KEY_CACHE_DB_NAME, key: "local:local"})
      ).toBeUndefined();
    });
  });

  describe("lifecycle serialization (E1)", () => {
    it("a rapid stop()-then-start() for a new user leaves the new user's persistence working", async () => {
      const name = uniqueName();
      const harness = makeHarness({name});
      const client = createSyncDb(harness.config);
      await client.start();
      client.mutate({collection: "todos", data: {title: "user one"}, operation: "create"});
      await flush();

      // Rapid stop() immediately followed by start() for a DIFFERENT user —
      // this is the exact interleaving the original bug hit: stop() re-reads
      // the module-level `persister` after awaiting a debounced save(), and
      // an interleaved start() for the new user had already replaced it,
      // destroying the NEW user's persister instead of the old one (leaving
      // mutate() throwing for the new user). Do NOT await stop() before
      // calling start() — that's the whole point of "rapid".
      harness.auth.setUserId("u2");
      const stopPromise = client.stop();
      const startPromise = client.start();
      await Promise.all([stopPromise, startPromise]);

      // The new user's session must be fully functional: mutate() succeeds
      // and the entity persists through its own persister.
      const {id, mutationId} = client.mutate({
        collection: "todos",
        data: {title: "user two"},
        operation: "create",
      });
      expect(client.store.getEntity({collection: "todos", id})?.data).toEqual({title: "user two"});
      expect(client.outbox.getMutation({mutationId})).toBeDefined();
      expect(client.store.getLastUserId()).toBe("u2");
      await client.stop();

      // Re-opening under the same name for u2 must load what was just
      // written — proving the persister that survived the race was u2's, not
      // a destroyed/half-wired one.
      const reopened = createSyncDb({...harness.config, name});
      harness.auth.setUserId("u2");
      await reopened.start();
      expect(reopened.store.listEntities({collection: "todos"}).map((e) => e.data)).toContainEqual({
        title: "user two",
      });
      await reopened.stop();
    });

    it("double start() is a no-op: listeners are not double-registered", async () => {
      const harness = makeHarness();
      let onDeltaCalls = 0;
      let onStatusChangeCalls = 0;
      const countingTransport = {
        ...harness.transport,
        onDelta: (callback: (delta: SyncDelta) => void): (() => void) => {
          onDeltaCalls += 1;
          return harness.transport.onDelta(callback);
        },
        onStatusChange: (
          callback: (status: {connected: boolean; authExpired?: boolean}) => void
        ): (() => void) => {
          onStatusChangeCalls += 1;
          return harness.transport.onStatusChange(callback);
        },
      };
      const client = createSyncDb({...harness.config, transport: countingTransport});
      await client.start();
      expect(onDeltaCalls).toBe(1);
      expect(onStatusChangeCalls).toBe(1);

      // A second start() while already started must be a no-op — no new
      // listener registration, no thrown error.
      await client.start();
      expect(onDeltaCalls).toBe(1);
      expect(onStatusChangeCalls).toBe(1);

      // The client is still fully functional (the first start() "won").
      const {mutationId} = client.mutate({
        collection: "todos",
        data: {title: "still works"},
        operation: "create",
      });
      expect(client.outbox.getMutation({mutationId})).toBeDefined();
      await client.stop();
    });

    it("stop() disposes the coordinator's armed wake-up timer (A3) so no post-stop send fires", async () => {
      const harness = makeHarness();
      harness.transport.setDefaultResponder(() => {
        throw new Error("transient failure");
      });
      const client = createSyncDb(harness.config);
      await client.start();
      client.mutate({collection: "todos", data: {title: "x"}, operation: "create"});
      await flush();
      // The failed send armed a jittered backoff wake-up timer.
      expect(client.getSyncStatus().queuedCount).toBe(1);

      await client.stop();
      const sentBeforeWait = harness.transport.sentMutations.length;
      // Advance well past any plausible backoff window; if the timer were
      // still armed post-stop it would fire another send here.
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(harness.transport.sentMutations.length).toBe(sentBeforeWait);
    });
  });

  describe("schema versioning (E2)", () => {
    it("wipes and re-bootstraps when the persisted schemaVersion is stale", async () => {
      const name = uniqueName();
      const harness = makeHarness({name});
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({collection: "todos", data: {title: "v1 data"}, id: "t1", seq: 1});
      // Simulate a persisted store written under an OLDER schema version.
      client.store.raw.setValue("schemaVersion", 0);
      await flush();
      await client.stop();

      // Seed a snapshot page (keyed by the discovered stream — C2) so the
      // re-bootstrap after the wipe has something to fetch and the test can
      // prove it actually ran.
      const second = makeHarness({name});
      second.http.state.pages[DEFAULT_STREAM] = {
        cursor: 5,
        entities: [{data: {title: "from server"}, deleted: false, id: "server-1", seq: 5}],
        frontierSeq: 5,
        hasMore: false,
        oldestRetainedSeq: 0,
        stream: DEFAULT_STREAM,
      };
      const reopened = createSyncDb(second.config);
      await reopened.start();
      await flush();

      // The stale v1 data is gone (wiped, not merged) and the fresh
      // re-bootstrap populated the store from the server instead.
      expect(reopened.store.getEntity({collection: "todos", id: "t1"})).toBeUndefined();
      expect(reopened.store.getEntity({collection: "todos", id: "server-1"})?.data).toEqual({
        title: "from server",
      });
      expect(reopened.store.getSchemaVersion()).toBe(SYNC_SCHEMA_VERSION);
      await reopened.stop();
    });

    it("leaves data untouched when the persisted schemaVersion already matches", async () => {
      const name = uniqueName();
      const harness = makeHarness({name});
      const client = createSyncDb(harness.config);
      await client.start();
      client.store.upsertEntity({collection: "todos", data: {title: "current"}, id: "t1", seq: 1});
      await flush();
      await client.stop();

      const second = makeHarness({name});
      const reopened = createSyncDb(second.config);
      await reopened.start();
      await flush();

      expect(reopened.store.getEntity({collection: "todos", id: "t1"})?.data).toEqual({
        title: "current",
      });
      expect(reopened.store.getSchemaVersion()).toBe(SYNC_SCHEMA_VERSION);
      await reopened.stop();
    });

    it("stamps the current schema version on a genuinely fresh store", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      expect(client.store.getSchemaVersion()).toBe(SYNC_SCHEMA_VERSION);
      await client.stop();
    });
  });

  describe("persistence failure surfaces (E3)", () => {
    // These tests exercise the REAL web persister factory (encrypted
    // IndexedDB) rather than the memoryPersisterFactory default used
    // elsewhere in this file: under plain bun/Node (no Metro/webpack platform
    // resolution), importing "./persisters/defaultPersisterFactory" always
    // resolves to the neutral in-memory fallback, never the `.web.ts`
    // variant — so `client.ts`'s own E3 hooks (built for that default-factory
    // branch) are unreachable unless the test supplies the web factory
    // directly as `persisterFactory`. The client passes its hooks through to
    // ANY factory via the `hooks` argument (see `PersisterFactory`), so a
    // directly-supplied web factory still wires up SyncStatus surfacing
    // exactly as production code would under Metro/webpack.
    const makeWebPersisterFactory = (
      overrides: Parameters<typeof createWebPersisterFactory>[0] = {}
    ): SyncDbConfig["persisterFactory"] =>
      createWebPersisterFactory({
        keyProvider: createLocalKeyProvider({cacheDbName: uniqueName()}),
        saveDebounceMs: 0,
        ...overrides,
      });

    it("a quota-exceeded save surfaces persistence: 'error' on SyncStatus", async () => {
      const harness = makeHarness({
        persisterFactory: makeWebPersisterFactory({
          idbSetImpl: async () => {
            const error = new Error("The quota has been exceeded.");
            error.name = "QuotaExceededError";
            throw error;
          },
        }),
      });
      let statusChanges = 0;
      const client = createSyncDb(harness.config);
      const unsubscribe = client.onStatusChange(() => {
        statusChanges += 1;
      });
      // The very first startAutoSave() save already goes through the failing
      // idbSetImpl, so persistence surfaces "error" immediately on start() —
      // this is the correct, intentional behavior (a save failure is a save
      // failure regardless of whether the store was empty or not).
      await client.start();
      client.mutate({collection: "todos", data: {title: "x"}, operation: "create"});
      await flush();

      expect(client.getSyncStatus().persistence).toBe("error");
      expect(statusChanges).toBeGreaterThan(0);
      unsubscribe();
      await client.stop();
    });

    it("invokes the configured onDecryptFailure hook instead of the default wipe", async () => {
      const name = uniqueName();
      const keyProvider = createLocalKeyProvider({cacheDbName: uniqueName()});
      const harness = makeHarness({
        name,
        persisterFactory: createWebPersisterFactory({keyProvider, saveDebounceMs: 0}),
      });
      const client = createSyncDb(harness.config);
      await client.start();
      client.mutate({collection: "todos", data: {title: "keep"}, operation: "create"});
      await flush();
      await client.stop();

      let decryptFailureCalls = 0;
      const second = makeHarness({
        name,
        onDecryptFailure: () => {
          decryptFailureCalls += 1;
        },
        persisterFactory: createWebPersisterFactory({
          idbGetImpl: async <T>(): Promise<T | undefined> =>
            new Uint8Array([1, 2, 3, 4, 5]) as unknown as T,
          keyProvider,
          saveDebounceMs: 0,
        }),
      });
      const reopened = createSyncDb(second.config);
      await reopened.start();
      await flush();

      expect(decryptFailureCalls).toBe(1);
      await reopened.stop();
    });

    it("a clean stop() flushes a pending write before destroying the persister", async () => {
      const name = uniqueName();
      const keyProvider = createLocalKeyProvider({cacheDbName: uniqueName()});
      const harness = makeHarness({
        name,
        persisterFactory: createWebPersisterFactory({keyProvider, saveDebounceMs: 0}),
      });
      const client = createSyncDb(harness.config);
      await client.start();
      client.mutate({collection: "todos", data: {title: "before stop"}, operation: "create"});
      // Let the transaction-triggered autosave settle before stop()'s own
      // flush — see encryptedIndexedDbPersister.test.ts's
      // "destroy() flushes a pending debounced save and writes nothing after"
      // for the narrower, race-free version of this same guarantee at the
      // persister level.
      await flush();
      await client.stop();

      const reopened = createSyncDb({
        ...harness.config,
        persisterFactory: createWebPersisterFactory({keyProvider, saveDebounceMs: 0}),
      });
      await reopened.start();
      await flush();
      expect(
        reopened.store.listEntities({collection: "todos"}).map((entity) => entity.data)
      ).toContainEqual({title: "before stop"});
      await reopened.stop();
    });

    it("a different-user login clears the cached derived encryption key (E3f)", async () => {
      // No custom keyProvider/cacheDbName here: `client.ts`'s different-user
      // wipe path clears `DEFAULT_KEY_CACHE_DB_NAME` specifically (the
      // default local key provider's cache database), so this test must
      // exercise that exact default. The test builds the web persister
      // factory directly (bypassing client.ts's own userId-aware factory
      // construction — see the describe-level comment on why), so the
      // cached key's scope key is "local:local" (no userId override) rather
      // than the "local:{userId}" shape client.ts's own default path uses;
      // either way it lives in the same DEFAULT_KEY_CACHE_DB_NAME database
      // client.ts wipes.
      const harness = makeHarness({
        persisterFactory: createWebPersisterFactory({saveDebounceMs: 0}),
      });
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      // The default local key provider derives and caches a key on first use
      // (during the initial autoload/autosave above).
      expect(
        await idbGet<CryptoKey>({databaseName: DEFAULT_KEY_CACHE_DB_NAME, key: "local:local"})
      ).toBeInstanceOf(CryptoKey);

      harness.auth.setUserId("u2");
      harness.auth.emitAuthChange();
      await flush();

      expect(
        await idbGet<CryptoKey>({databaseName: DEFAULT_KEY_CACHE_DB_NAME, key: "local:local"})
      ).toBeUndefined();
      await client.stop();
    });
  });

  describe("client-side tombstone compaction (E5)", () => {
    it("a successful reconcile compacts tombstones older than the retention window", async () => {
      const harness = makeHarness({tombstoneRetentionMs: 90 * 24 * 60 * 60 * 1_000});
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();

      // A tombstone applied via a delta, stamped at the current (mocked) clock time.
      harness.transport.deliverDelta({
        collection: "todos",
        deleted: true,
        id: "old-tombstone",
        method: "delete",
        seq: 1,
        stream: "todos|owner:u1",
      });
      expect(client.store.getEntity({collection: "todos", id: "old-tombstone"})?.deleted).toBe(
        true
      );

      // Advance the clock past the retention window, then trigger a
      // reconcile (which must succeed for compaction to run at all).
      harness.clock.value += 91 * 24 * 60 * 60 * 1_000;
      await client.reconcile();

      expect(client.store.getEntity({collection: "todos", id: "old-tombstone"})).toBeUndefined();
      await client.stop();
    });

    it("does not compact tombstones still within the retention window", async () => {
      const harness = makeHarness({tombstoneRetentionMs: 90 * 24 * 60 * 60 * 1_000});
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();

      harness.transport.deliverDelta({
        collection: "todos",
        deleted: true,
        id: "fresh-tombstone",
        method: "delete",
        seq: 1,
        stream: "todos|owner:u1",
      });

      harness.clock.value += 5 * 24 * 60 * 60 * 1_000;
      await client.reconcile();

      expect(client.store.getEntity({collection: "todos", id: "fresh-tombstone"})?.deleted).toBe(
        true
      );
      await client.stop();
    });

    it("tombstoneRetentionMs: 0 disables compaction entirely", async () => {
      const harness = makeHarness({tombstoneRetentionMs: 0});
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();

      harness.transport.deliverDelta({
        collection: "todos",
        deleted: true,
        id: "never-compacted",
        method: "delete",
        seq: 1,
        stream: "todos|owner:u1",
      });

      harness.clock.value += 365 * 24 * 60 * 60 * 1_000;
      await client.reconcile();

      expect(client.store.getEntity({collection: "todos", id: "never-compacted"})?.deleted).toBe(
        true
      );
      await client.stop();
    });
  });

  describe("lifecycle hygiene (9.25)", () => {
    it("refuses to delete an id the local store has never seen", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();

      expect(() => client.mutate({collection: "todos", id: "ghost", operation: "delete"})).toThrow(
        /no such entity in the local store/
      );
      // No phantom tombstone, and no doomed mutation queued behind it.
      expect(client.store.getEntity({collection: "todos", id: "ghost"})).toBeUndefined();
      expect(client.getSyncStatus().queuedCount).toBe(0);
      await client.stop();
    });

    it("writes exactly one tombstone row for a delete and keeps the previous data", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();

      const {id} = client.mutate({
        collection: "todos",
        data: {title: "doomed"},
        operation: "create",
      });
      client.mutate({collection: "todos", id, operation: "delete"});

      const entity = client.store.getEntity<{title: string}>({collection: "todos", id});
      expect(entity?.deleted).toBe(true);
      expect(entity?.data?.title).toBe("doomed");
      expect(client.store.raw.getCell("todos", id, "deletedAt")).toBeTruthy();
      await client.stop();
    });

    it("coalesces concurrent reconcile calls into a single stream discovery", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      const streamsBefore = harness.http.state.streamsCount;

      const first = client.reconcile();
      const second = client.reconcile();
      expect(second).toBe(first);
      await Promise.all([first, second]);

      expect(harness.http.state.streamsCount).toBe(streamsBefore + 1);
      // Once the shared pass settles, the next trigger starts a fresh one.
      await client.reconcile();
      expect(harness.http.state.streamsCount).toBe(streamsBefore + 2);
      await client.stop();
    });

    it("closes the debug BroadcastChannel on stop and re-opens it on start", async () => {
      const globalScope = globalThis as unknown as {BroadcastChannel?: unknown};
      const original = globalScope.BroadcastChannel;
      const channels: Array<{name: string; closed: boolean}> = [];
      class FakeBroadcastChannel {
        onmessage: ((event: {data: unknown}) => void) | null = null;
        private readonly record: {name: string; closed: boolean};
        constructor(name: string) {
          this.record = {closed: false, name};
          channels.push(this.record);
        }
        postMessage(): void {}
        close(): void {
          this.record.closed = true;
        }
      }
      globalScope.BroadcastChannel = FakeBroadcastChannel;
      try {
        const harness = makeHarness({debug: true});
        const client = createSyncDb(harness.config);
        await client.start();
        await flush();
        expect(channels.length).toBe(1);
        expect(channels[0].closed).toBe(false);

        await client.stop();
        expect(channels[0].closed).toBe(true);

        // A restarted client mirrors again rather than going silent.
        await client.start();
        await flush();
        expect(channels.length).toBe(2);
        expect(channels[1].closed).toBe(false);
        await client.stop();
        expect(channels[1].closed).toBe(true);
      } finally {
        globalScope.BroadcastChannel = original;
      }
    });
  });

  describe("forceResync", () => {
    it("skips when there is no HTTP channel", async () => {
      const harness = makeHarness();
      const client = createSyncDb({
        ...harness.config,
        httpChannel: undefined,
      });
      const result = await client.forceResync();
      assert.deepEqual(result, {
        ok: false,
        purged: 0,
        reason: "noHttpChannel",
        repaired: 0,
        streams: 0,
      });
    });

    it("skips while simulated offline", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      client.goOffline();
      const result = await client.forceResync();
      assert.equal(result.ok, false);
      assert.equal(result.reason, "offline");
      await client.stop();
    });

    it("skips while auth-paused", async () => {
      const harness = makeHarness();
      harness.http.state.streamsError = new AuthRequiredError();
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      const result = await client.forceResync();
      assert.equal(result.ok, false);
      assert.equal(result.reason, "authPaused");
      await client.stop();
    });

    it("skips when the server and local store have no streams", async () => {
      const harness = makeHarness();
      harness.http.state.streams = [];
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      const result = await client.forceResync();
      assert.equal(result.ok, false);
      assert.equal(result.reason, "noStreams");
      await client.stop();
    });

    it("purges local rows and re-bootstraps from the snapshot", async () => {
      const harness = makeHarness();
      harness.http.state.pages[DEFAULT_STREAM] = {
        cursor: 1,
        entities: [{data: {title: "stale"}, deleted: false, id: "local-1", seq: 1}],
        frontierSeq: 1,
        hasMore: false,
        oldestRetainedSeq: 0,
        stream: DEFAULT_STREAM,
      };
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      assert.deepEqual(client.store.getEntity({collection: "todos", id: "local-1"})?.data, {
        title: "stale",
      });

      harness.http.state.pages[DEFAULT_STREAM] = {
        cursor: 9,
        entities: [{data: {title: "fresh"}, deleted: false, id: "server-1", seq: 9}],
        frontierSeq: 9,
        hasMore: false,
        oldestRetainedSeq: 0,
        stream: DEFAULT_STREAM,
      };
      const result = await client.forceResync();
      assert.equal(result.ok, true);
      assert.isAtLeast(result.streams, 1);
      assert.isAtLeast(result.purged, 1);
      assert.equal(client.store.getEntity({collection: "todos", id: "local-1"}), undefined);
      assert.deepEqual(client.store.getEntity({collection: "todos", id: "server-1"})?.data, {
        title: "fresh",
      });
      await client.stop();
    });

    it("falls back to locally known streams when discovery 401s", async () => {
      const harness = makeHarness();
      harness.http.state.pages[DEFAULT_STREAM] = {
        cursor: 2,
        entities: [{data: {title: "kept"}, deleted: false, id: "k1", seq: 2}],
        frontierSeq: 2,
        hasMore: false,
        oldestRetainedSeq: 0,
        stream: DEFAULT_STREAM,
      };
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      harness.http.state.streamsError = new AuthRequiredError();
      const result = await client.forceResync();
      assert.equal(result.ok, true);
      assert.equal(result.streams, 1);
      assert.deepEqual(client.store.getEntity({collection: "todos", id: "k1"})?.data, {
        title: "kept",
      });
      await client.stop();
    });

    it("pauses and reports authPaused when a snapshot page 401s mid-resync", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      harness.http.channel.fetchSnapshotPage = async () => {
        throw new AuthRequiredError();
      };
      const result = await client.forceResync();
      assert.equal(result.ok, false);
      assert.equal(result.reason, "authPaused");
      assert.equal(client.getSyncStatus().paused, "auth");
      await client.stop();
    });

    it("rethrows a non-auth discovery error", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      harness.http.state.streamsError = new Error("resync boom");
      await expect(client.forceResync()).rejects.toThrow("resync boom");
      await client.stop();
    });

    it("repairs marked entities after re-bootstrap", async () => {
      const harness = makeHarness();
      harness.http.state.pages[DEFAULT_STREAM] = {
        cursor: 1,
        entities: [{data: {title: "broken"}, deleted: false, id: "r1", seq: 1}],
        frontierSeq: 1,
        hasMore: false,
        oldestRetainedSeq: 0,
        stream: DEFAULT_STREAM,
      };
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      client.store.markNeedsRepair({
        collection: "todos",
        entityId: "r1",
        missedSeq: 1,
        stream: DEFAULT_STREAM,
      });
      harness.http.channel.fetchEntities = async () => ({
        entities: [
          {
            data: {title: "repaired"},
            deleted: false,
            id: "r1",
            seq: 2,
            stream: DEFAULT_STREAM,
          },
        ],
      });
      const result = await client.forceResync();
      assert.equal(result.ok, true);
      await client.stop();
    });

    it("abandons the resync when the user changes during discovery", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      const originalFetch = harness.http.channel.fetchStreams;
      harness.http.channel.fetchStreams = async () => {
        harness.auth.setUserId("other-user");
        harness.auth.emitAuthChange();
        for (let attempt = 0; attempt < 50; attempt += 1) {
          if (client.store.getLastUserId() === "other-user") {
            break;
          }
          await flush();
        }
        return originalFetch();
      };
      const result = await client.forceResync();
      assert.equal(result.ok, false);
      assert.equal(result.reason, "superseded");
      await client.stop();
    });

    it("abandons the resync when the user changes during bootstrap", async () => {
      const harness = makeHarness();
      const client = createSyncDb(harness.config);
      await client.start();
      await flush();
      harness.http.channel.fetchSnapshotPage = async ({stream}) => {
        harness.auth.setUserId("other-user");
        harness.auth.emitAuthChange();
        await flush();
        return emptyPage(stream);
      };
      const result = await client.forceResync();
      assert.equal(result.ok, false);
      assert.equal(result.reason, "superseded");
      await client.stop();
    });
  });
});

describe("snapshot paging concurrency", () => {
  /**
   * Wrap the harness channel so every snapshot page waits on a gate the test releases,
   * and record how many pages are in flight overall and per stream.
   */
  const trackSnapshotPages = (
    harness: Harness
  ): {
    fetched: string[];
    maxInFlight: () => number;
    maxInFlightPerStream: () => number;
    pending: () => number;
    releaseAll: () => void;
  } => {
    const fetched: string[] = [];
    const inFlight = new Map<string, number>();
    const gates: (() => void)[] = [];
    let total = 0;
    let maxTotal = 0;
    let maxPerStream = 0;
    const fetchSnapshotPage = harness.http.channel.fetchSnapshotPage;
    harness.http.channel.fetchSnapshotPage = async (args) => {
      fetched.push(args.stream);
      total += 1;
      maxTotal = Math.max(maxTotal, total);
      const streamCount = (inFlight.get(args.stream) ?? 0) + 1;
      inFlight.set(args.stream, streamCount);
      maxPerStream = Math.max(maxPerStream, streamCount);
      await new Promise<void>((resolve) => gates.push(resolve));
      total -= 1;
      inFlight.set(args.stream, (inFlight.get(args.stream) ?? 1) - 1);
      return fetchSnapshotPage(args);
    };
    return {
      fetched,
      maxInFlight: () => maxTotal,
      maxInFlightPerStream: () => maxPerStream,
      pending: () => gates.length,
      releaseAll: () => {
        for (const release of gates.splice(0)) {
          release();
        }
      },
    };
  };

  /** Release gated pages until `done` settles. */
  const drain = async <T>(
    pages: ReturnType<typeof trackSnapshotPages>,
    done: Promise<T>
  ): Promise<T> => {
    let settled = false;
    const result = done.finally(() => {
      settled = true;
    });
    for (let attempt = 0; attempt < 100 && !settled; attempt += 1) {
      pages.releaseAll();
      await flush();
    }
    return result;
  };

  const manyStreams = (count: number): SyncStreamInfo[] =>
    Array.from({length: count}, (_, index) => ({
      collection: "todos",
      stream: `todos|tenant:w${index}`,
    }));

  const isBootstrapped = (client: ReturnType<typeof createSyncDb>, stream: string): boolean =>
    client.store.raw.getCell(CURSORS_TABLE, stream, "bootstrapped") === true;

  it("pages streams side by side, up to snapshotConcurrency at once", async () => {
    const harness = makeHarness({snapshotConcurrency: 3});
    harness.http.state.streams = manyStreams(10);
    const pages = trackSnapshotPages(harness);
    const client = createSyncDb(harness.config);
    await client.start();

    await waitUntil(() => pages.pending() === 3);
    await flush();
    expect(pages.pending()).toBe(3);
    await drain(pages, client.reconcile());

    expect(pages.maxInFlight()).toBe(3);
    for (const {stream} of harness.http.state.streams) {
      expect(isBootstrapped(client, stream)).toBe(true);
    }
    await client.stop();
  });

  it("pages one stream at a time when snapshotConcurrency is 1", async () => {
    const harness = makeHarness({snapshotConcurrency: 1});
    harness.http.state.streams = manyStreams(4);
    const pages = trackSnapshotPages(harness);
    const client = createSyncDb(harness.config);
    await client.start();
    await drain(pages, client.reconcile());

    expect(pages.maxInFlight()).toBe(1);
    expect(pages.fetched).toHaveLength(4);
    await client.stop();
  });

  it("queues a subscribe catch-up behind an in-flight pass on the same stream", async () => {
    const harness = makeHarness();
    const pages = trackSnapshotPages(harness);
    const client = createSyncDb(harness.config);
    await client.start();
    await waitUntil(() => pages.pending() === 1);

    harness.transport.confirmSubscribed({collection: "todos", streams: [DEFAULT_STREAM]});
    harness.transport.confirmSubscribed({collection: "todos", streams: [DEFAULT_STREAM]});
    await flush();
    // The catch-up must not page beside the reconcile pass that began before the join.
    expect(pages.pending()).toBe(1);
    await drain(pages, client.reconcile());
    await waitUntil(() => pages.fetched.length === 2);
    pages.releaseAll();
    await flush();

    // One startup pass, then one fresh pass shared by both confirmations.
    expect(pages.fetched).toEqual([DEFAULT_STREAM, DEFAULT_STREAM]);
    expect(pages.maxInFlightPerStream()).toBe(1);
    await client.stop();
  });

  it("drops a queued catch-up when the client stops before it starts", async () => {
    const harness = makeHarness();
    const pages = trackSnapshotPages(harness);
    const client = createSyncDb(harness.config);
    await client.start();
    await waitUntil(() => pages.pending() === 1);
    harness.transport.confirmSubscribed({collection: "todos", streams: [DEFAULT_STREAM]});
    await flush();

    const stopped = client.stop();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      pages.releaseAll();
      await flush();
    }
    await stopped;

    // Only the startup pass paged; the catch-up queued behind it belonged to the
    // stopped lifecycle.
    expect(pages.fetched).toEqual([DEFAULT_STREAM]);
  });

  it("forceResync waits for an in-flight pass before purging the stream", async () => {
    const harness = makeHarness();
    harness.http.state.pages[DEFAULT_STREAM] = {
      cursor: 3,
      entities: [{data: {title: "kept"}, deleted: false, id: "t1", seq: 3}],
      frontierSeq: 3,
      hasMore: false,
      oldestRetainedSeq: 0,
      stream: DEFAULT_STREAM,
    };
    const pages = trackSnapshotPages(harness);
    const client = createSyncDb(harness.config);
    await client.start();
    await waitUntil(() => pages.pending() === 1);

    const resync = client.forceResync();
    await flush();
    await flush();
    // The purge-and-repage must not start while the startup pass is still paging.
    expect(pages.pending()).toBe(1);
    const result = await drain(pages, resync);

    assert.equal(result.ok, true);
    expect(pages.maxInFlightPerStream()).toBe(1);
    expect(client.store.getEntity({collection: "todos", id: "t1"})?.data).toEqual({
      title: "kept",
    });
    expect(isBootstrapped(client, DEFAULT_STREAM)).toBe(true);
    await client.stop();
  });

  it("stops taking new streams after one fails", async () => {
    const harness = makeHarness({snapshotConcurrency: 1});
    harness.http.state.streams = manyStreams(3);
    const failing = "todos|tenant:w1";
    const fetched: string[] = [];
    const fetchSnapshotPage = harness.http.channel.fetchSnapshotPage;
    harness.http.channel.fetchSnapshotPage = async (args) => {
      fetched.push(args.stream);
      if (args.stream === failing) {
        throw new Error("snapshot failed");
      }
      return fetchSnapshotPage(args);
    };
    const client = createSyncDb(harness.config);

    // start() fires a reconcile of its own; this call shares that pass.
    await client.start();
    await expect(client.reconcile()).rejects.toThrow("snapshot failed");

    expect(fetched).toEqual(["todos|tenant:w0", failing]);
    expect(isBootstrapped(client, "todos|tenant:w2")).toBe(false);
    await client.stop();
  });
});
