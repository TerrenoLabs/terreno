import {afterEach, beforeEach, describe, it} from "bun:test";
import {assert} from "chai";

import {
  clearSyncDbSnapshotsForTests,
  getSyncDbState,
  syncDbAction,
  syncDbSnapshot,
} from "./syncDb.js";

interface FakeSyncDbState {
  collections: Record<string, {entities: Array<{data: Record<string, unknown>; id: string}>}>;
  debug: {events: unknown[]; stats: {total: number}};
  status: {queuedCount: number};
}

const makeState = (): FakeSyncDbState => ({
  collections: {
    todos: {
      entities: [{data: {password: "secret", title: "Before"}, id: "todo-1"}],
    },
  },
  debug: {events: [{detail: {accessToken: "token"}}], stats: {total: 1}},
  status: {queuedCount: 1},
});

describe("SyncDB local MCP tools", () => {
  let previousEval: string | undefined;
  let state: FakeSyncDbState;
  let mergedContent: unknown;
  let flushCount: number;

  beforeEach((): void => {
    previousEval = process.env.TERRENO_MCP_EVAL;
    Reflect.deleteProperty(process.env, "TERRENO_MCP_EVAL");
    clearSyncDbSnapshotsForTests();
    state = makeState();
    mergedContent = undefined;
    flushCount = 0;
    (
      globalThis as typeof globalThis & {
        __TERRENO_SYNCDB__?: unknown;
      }
    ).__TERRENO_SYNCDB__ = {
      clients: {
        app: {
          clearDebug: (): void => {
            state.debug.events = [];
          },
          deleteLocalEntity: (): void => {
            state.collections.todos.entities = [];
          },
          flush: async (): Promise<void> => {
            flushCount += 1;
            state.status.queuedCount = 0;
          },
          forceResync: async (): Promise<{ok: boolean}> => ({ok: true}),
          goOffline: (): void => {},
          goOnline: async (): Promise<void> => {},
          inspect: (): FakeSyncDbState => structuredClone(state),
          merge: (content: unknown): void => {
            mergedContent = content;
          },
          mutate: (): {id: string; mutationId: string} => ({
            id: "todo-1",
            mutationId: "mutation-1",
          }),
          reconcile: async (): Promise<void> => {},
          resolveConflict: (): void => {},
          retryFailed: (): void => {},
          setLocalEntity: (): void => {},
          snapshot: (): FakeSyncDbState & {mergeableContent: unknown} => ({
            ...structuredClone(state),
            mergeableContent: ["tinybase-content"],
          }),
        },
      },
      list: (): string[] => ["app"],
    };
  });

  afterEach((): void => {
    Reflect.deleteProperty(globalThis, "__TERRENO_SYNCDB__");
    clearSyncDbSnapshotsForTests();
    if (previousEval === undefined) {
      Reflect.deleteProperty(process.env, "TERRENO_MCP_EVAL");
    } else {
      process.env.TERRENO_MCP_EVAL = previousEval;
    }
  });

  it("returns debugger state while redacting sensitive fields", async (): Promise<void> => {
    const result = JSON.parse(await getSyncDbState({name: "app"})) as FakeSyncDbState;
    assert.equal(result.collections.todos.entities[0]?.data.password, "[REDACTED]");
    assert.equal(
      (result.debug.events[0] as {detail?: {accessToken?: string}}).detail?.accessToken,
      "[REDACTED]"
    );
    assert.equal(result.status.queuedCount, 1);
  });

  it("gates state-changing actions and flushes the outbox after opt-in", async (): Promise<void> => {
    assert.include(await syncDbAction({action: "flush"}), "Refused");
    process.env.TERRENO_MCP_EVAL = "1";

    const result = JSON.parse(await syncDbAction({action: "flush"})) as {
      state: FakeSyncDbState;
    };
    assert.equal(flushCount, 1);
    assert.equal(result.state.status.queuedCount, 0);
  });

  it("captures, compares, and merges snapshots", async (): Promise<void> => {
    const first = JSON.parse(await syncDbSnapshot({action: "capture"})) as {id: string};
    const entity = state.collections.todos.entities[0];
    assert.exists(entity);
    entity.data.title = "After";
    const second = JSON.parse(await syncDbSnapshot({action: "capture"})) as {id: string};
    const comparison = JSON.parse(
      await syncDbSnapshot({
        action: "compare",
        otherSnapshotId: second.id,
        snapshotId: first.id,
      })
    ) as {diffCount: number; diffs: Array<{path: string}>};
    assert.isAbove(comparison.diffCount, 0);
    assert.isTrue(comparison.diffs.some((diff) => diff.path.endsWith(".data.title")));

    process.env.TERRENO_MCP_EVAL = "true";
    await syncDbAction({action: "mergeSnapshot", snapshotId: first.id});
    assert.deepEqual(mergedContent, ["tinybase-content"]);
    assert.include(
      await syncDbAction({action: "mergeSnapshot", name: "other", snapshotId: first.id}),
      'belongs to SyncDB client "app"'
    );

    const listed = JSON.parse(await syncDbSnapshot({action: "list"})) as unknown[];
    assert.lengthOf(listed, 2);
  });

  it("covers remaining inspect, action, and snapshot branches", async (): Promise<void> => {
    process.env.TERRENO_MCP_EVAL = "1";
    const filtered = JSON.parse(
      await getSyncDbState({
        collection: "todos",
        entityId: "todo-1",
        includeDebugEvents: false,
        limit: 1,
        name: "app",
      })
    ) as FakeSyncDbState;
    assert.equal(filtered.collections.todos.entities[0]?.id, "todo-1");
    assert.include(await getSyncDbState({name: "missing"}), "Unknown SyncDB client");

    const actions = [
      "mutate",
      "setLocalEntity",
      "deleteLocalEntity",
      "reconcile",
      "forceResync",
      "resolveConflict",
      "retryFailed",
      "goOffline",
      "goOnline",
      "clearDebug",
    ] as const;
    for (const action of actions) {
      const result = JSON.parse(
        await syncDbAction({
          action,
          collection: "todos",
          data: {title: "x"},
          deleted: false,
          entityId: "todo-1",
          id: "todo-1",
          maxAttempts: 2,
          mutationId: "mutation-1",
          operation: "update",
          seq: 1,
          strategy: "keepLocal",
          stream: "todos|owner:user-1",
        })
      ) as {action: string};
      assert.equal(result.action, action);
    }
    assert.include(await syncDbAction({action: "unknown"}), "Unknown SyncDB action");
    assert.include(await syncDbAction({action: "mergeSnapshot"}), "Unknown or missing snapshotId");

    const captured = JSON.parse(await syncDbSnapshot({action: "capture"})) as {
      id: string;
      state: FakeSyncDbState;
    };
    const gotten = JSON.parse(await syncDbSnapshot({action: "get", snapshotId: captured.id})) as {
      id: string;
    };
    assert.equal(gotten.id, captured.id);
    assert.include(await syncDbSnapshot({action: "get"}), "Unknown or missing snapshotId");
    assert.include(
      await syncDbSnapshot({action: "compare", snapshotId: captured.id}),
      "Both snapshotId and otherSnapshotId"
    );
    assert.include(await syncDbSnapshot({action: "unknown"}), "Unknown snapshot action");
    const deleted = JSON.parse(
      await syncDbSnapshot({action: "delete", snapshotId: captured.id})
    ) as {deleted: boolean};
    assert.isTrue(deleted.deleted);
    const emptyDelete = JSON.parse(await syncDbSnapshot({action: "delete"})) as {
      deleted: boolean;
    };
    assert.isFalse(emptyDelete.deleted);
  });

  it("reports when no client is registered", async (): Promise<void> => {
    (
      globalThis as typeof globalThis & {
        __TERRENO_SYNCDB__?: unknown;
      }
    ).__TERRENO_SYNCDB__ = {
      clients: {},
      list: (): string[] => [],
    };
    assert.include(await getSyncDbState({}), "No SyncDB client is registered");
  });
});
