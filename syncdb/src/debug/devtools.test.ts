import {afterEach, describe, it} from "bun:test";
import {assert} from "chai";

import {createSyncDb, type SyncDb} from "../client";
import {OUTBOX_TABLE} from "../storage/types";
import {createFakeTransport} from "../testing/fakeTransport";

interface TestDevtoolsInspect {
  collections: Record<
    string,
    {entities: Array<{data: unknown; id: string; seq: number}>; total: number; truncated: boolean}
  >;
  debug?: {events: unknown[]};
  outbox: Record<string, {args?: unknown}>;
  status: {online?: boolean};
}

interface TestDevtoolsClient {
  inspect: (options?: Record<string, unknown>) => TestDevtoolsInspect;
  snapshot: (
    options?: Record<string, unknown>
  ) => TestDevtoolsInspect & {mergeableContent: unknown};
  setLocalEntity: (args: Record<string, unknown>) => void;
  deleteLocalEntity: (args: Record<string, unknown>) => void;
  merge: (content: unknown) => void;
  mutate: (args: Record<string, unknown>) => unknown;
  flush: () => Promise<void>;
  reconcile: () => Promise<void>;
  forceResync: () => Promise<unknown>;
  resolveConflict: (args: Record<string, unknown>) => void;
  retryFailed: (args: Record<string, unknown>) => void;
  goOffline: () => void;
  goOnline: () => Promise<void>;
  clearDebug: () => void;
}

interface TestDevtoolsRegistry {
  clients: Record<string, TestDevtoolsClient>;
  list: () => string[];
}

const getRegistry = (): TestDevtoolsRegistry | undefined => {
  return (
    globalThis as typeof globalThis & {
      __TERRENO_SYNCDB__?: TestDevtoolsRegistry;
    }
  ).__TERRENO_SYNCDB__;
};

const createDebugClient = ({name}: {name: string}): SyncDb => {
  return createSyncDb({
    authProvider: {
      getToken: async (): Promise<string | null> => "token",
      getUserId: async (): Promise<string | null> => "user-1",
      onAuthChange:
        (_callback: () => void): (() => void) =>
        (): void => {},
    },
    collections: ["todos", "notes"],
    debug: true,
    name,
    reconcileIntervalMs: 0,
    transport: createFakeTransport(),
  });
};

afterEach((): void => {
  Reflect.deleteProperty(globalThis, "__TERRENO_SYNCDB__");
});

describe("SyncDB devtools registry", () => {
  it("registers debug clients with debugger state and mutation controls", async (): Promise<void> => {
    const client = createDebugClient({name: "devtools-test"});
    await client.start();

    const registry = getRegistry();
    assert.include(registry?.list() ?? [], "devtools-test");
    const bridge = registry?.clients["devtools-test"];
    assert.exists(bridge);

    bridge.setLocalEntity({
      collection: "todos",
      data: {password: "visible-to-MCP-redactor", title: "Local"},
      id: "todo-1",
      seq: 4,
      stream: "todos|owner:user-1",
    });
    const state = bridge.inspect();
    assert.equal(state?.collections.todos?.entities[0]?.id, "todo-1");
    assert.equal(state?.collections.todos?.entities[0]?.seq, 4);
    assert.exists(state?.debug);

    const snapshot = bridge.snapshot();
    bridge.deleteLocalEntity({collection: "todos", id: "todo-1"});
    assert.lengthOf(bridge.inspect().collections.todos?.entities ?? [], 0);
    bridge.merge(snapshot.mergeableContent);
    assert.lengthOf(bridge.inspect().collections.todos?.entities ?? [], 0);

    bridge.mutate({
      collection: "todos",
      data: {title: "Updated"},
      id: "todo-1",
      operation: "update",
    });
    await bridge.flush();
    assert.equal(
      (bridge.inspect().collections.todos?.entities[0]?.data as {title?: string})?.title,
      "Updated"
    );
    await client.stop();
  });

  it("CRDT-merges snapshot content instead of replacing newer local rows", async (): Promise<void> => {
    const client = createDebugClient({name: "merge-test"});
    await client.start();
    const bridge = getRegistry()?.clients["merge-test"];
    assert.exists(bridge);

    bridge.setLocalEntity({
      collection: "todos",
      data: {title: "Original"},
      id: "todo-1",
      seq: 1,
      stream: "todos|owner:user-1",
    });
    const snapshot = bridge.snapshot();
    bridge.setLocalEntity({
      collection: "todos",
      data: {title: "Newer"},
      id: "todo-1",
      seq: 2,
      stream: "todos|owner:user-1",
    });
    bridge.setLocalEntity({
      collection: "notes",
      data: {title: "Kept"},
      id: "note-1",
      seq: 1,
      stream: "notes|owner:user-1",
    });
    bridge.merge(snapshot.mergeableContent);

    const state = bridge.inspect();
    assert.equal((state.collections.todos?.entities[0]?.data as {title?: string})?.title, "Newer");
    assert.equal(state.collections.notes?.entities[0]?.id, "note-1");
    await client.stop();
  });

  it("exposes inspect filters, outbox decoding, and remaining debugger controls", async (): Promise<void> => {
    const first = createDebugClient({name: "zeta-client"});
    const second = createDebugClient({name: "alpha-client"});
    await first.start();
    await second.start();
    const registry = getRegistry();
    assert.deepEqual(registry?.list(), ["alpha-client", "zeta-client"]);
    const bridge = registry?.clients["alpha-client"];
    assert.exists(bridge);

    bridge.setLocalEntity({
      collection: "todos",
      data: {title: "One"},
      id: "todo-1",
      seq: 1,
      stream: "todos|owner:user-1",
    });
    bridge.setLocalEntity({
      collection: "todos",
      data: {title: "Two"},
      id: "todo-2",
      seq: 1,
      stream: "todos|owner:user-1",
    });
    second.store.raw.setRow(OUTBOX_TABLE, "m-json", {
      args: JSON.stringify({title: "queued"}),
      collection: "todos",
    });
    second.store.raw.setRow(OUTBOX_TABLE, "m-invalid", {
      args: "{not-json",
      collection: "todos",
    });

    const filtered = bridge.inspect({collection: "todos", entityId: "todo-2", limit: 1});
    assert.deepEqual(Object.keys(filtered.collections), ["todos"]);
    assert.equal(filtered.collections.todos?.entities[0]?.id, "todo-2");
    assert.equal(filtered.collections.todos?.total, 1);

    const truncated = bridge.inspect({collection: "todos", limit: 1});
    assert.isTrue(truncated.collections.todos?.truncated);
    assert.lengthOf(truncated.collections.todos?.entities ?? [], 1);

    const missing = bridge.inspect({collection: "todos", entityId: "missing"});
    assert.lengthOf(missing.collections.todos?.entities ?? [], 0);

    const quiet = bridge.inspect({includeDebugEvents: false});
    assert.deepEqual(quiet.debug?.events, []);
    assert.equal((quiet.outbox["m-json"]?.args as {title?: string})?.title, "queued");
    assert.equal(quiet.outbox["m-invalid"]?.args, "{not-json");

    assert.throws((): void => {
      bridge.deleteLocalEntity({collection: "unknown", id: "x"});
    }, /Unknown collection "unknown"/);

    bridge.goOffline();
    await bridge.goOnline();
    await bridge.reconcile();
    await bridge.forceResync();
    await bridge.flush();
    bridge.clearDebug();
    bridge.retryFailed({entityId: "todo-1"});
    assert.throws((): void => {
      bridge.resolveConflict({mutationId: "missing", strategy: "keepLocal"});
    });
    assert.deepEqual(bridge.inspect({includeDebugEvents: false}).debug?.events, []);
    await first.stop();
    await second.stop();
  });

  it("does not register clients when debugging is disabled", (): void => {
    createSyncDb({
      authProvider: {
        getToken: async (): Promise<string | null> => "token",
        getUserId: async (): Promise<string | null> => "user-1",
        onAuthChange:
          (_callback: () => void): (() => void) =>
          (): void => {},
      },
      collections: ["todos"],
      name: "production-client",
      transport: createFakeTransport(),
    });

    assert.isUndefined(getRegistry());
  });
});
