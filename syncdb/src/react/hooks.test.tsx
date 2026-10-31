import {describe, expect, it} from "bun:test";
import {act, renderHook} from "@testing-library/react-native";
import React from "react";

import {createSyncDb, type SyncDb} from "../client";
import {memoryPersisterFactory} from "../persisters/memoryPersister";
import {AuthRequiredError} from "../sync/httpChannel";
import {createFakeTransport, type FakeTransport} from "../testing/fakeTransport";
import type {AuthProvider, SyncDelta} from "../types";
import {
  useConflicts,
  useEntity,
  useEntityIds,
  useMutate,
  useQuery,
  useSyncDebugLog,
  useSyncStatus,
} from "./hooks";
import {SyncDbProvider, useSyncDbClient} from "./provider";

interface TodoData {
  title: string;
  completed?: boolean;
}

let nameCounter = 0;
const uniqueName = (): string => {
  nameCounter += 1;
  return `react-hooks-test-${nameCounter}`;
};

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 5));
};

const makeAuthProvider = (userId: string): AuthProvider & {emitAuthChange: () => void} => {
  const listeners = new Set<() => void>();
  return {
    emitAuthChange: (): void => {
      for (const listener of listeners) {
        listener();
      }
    },
    getToken: async () => "token",
    getUserId: async () => userId,
    onAuthChange: (callback: () => void): (() => void) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  };
};

interface Harness {
  client: SyncDb;
  transport: FakeTransport;
  auth: ReturnType<typeof makeAuthProvider>;
  wrapper: React.FC<{children: React.ReactNode}>;
}

const setup = async (options?: {debug?: boolean}): Promise<Harness> => {
  const transport = createFakeTransport();
  const auth = makeAuthProvider("u1");
  const client = createSyncDb({
    authProvider: auth,
    collections: ["todos"],
    debug: options?.debug,
    name: uniqueName(),
    persisterFactory: memoryPersisterFactory,
    reconcileIntervalMs: 0,
    transport,
  });
  await client.start();
  // TinyBase 9 + React 19 `act()` will wait on in-flight start work
  // (`void reconcile()` / `void replayOutbox()`). Drain those before tests
  // wrap `stop()` in `act`, or `act` never settles.
  await client.reconcile();
  await client.replayOutbox();
  const wrapper: React.FC<{children: React.ReactNode}> = ({children}) => (
    <SyncDbProvider client={client}>{children}</SyncDbProvider>
  );
  return {auth, client, transport, wrapper};
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

describe("SyncDbProvider / useSyncDbClient", () => {
  it("throws a descriptive error outside the provider", () => {
    expect(() => renderHook(() => useSyncDbClient())).toThrow(
      "useSyncDbClient must be used within a <SyncDbProvider"
    );
  });

  it("returns the client inside the provider", async () => {
    const {client, wrapper} = await setup();
    const {result} = renderHook(() => useSyncDbClient(), {wrapper});
    expect(result.current).toBe(client);
    await act(async () => {
      await client.stop();
    });
  });
});

describe("useEntity", () => {
  it("returns an empty snapshot for a missing entity", async () => {
    const {client, wrapper} = await setup();
    const {result} = renderHook(() => useEntity<TodoData>("todos", "missing"), {wrapper});
    expect(result.current).toEqual({data: undefined, deleted: false, isPending: false, seq: 0});
    await act(async () => {
      await client.stop();
    });
  });

  it("re-renders on a local write and reports the pending flag", async () => {
    const {client, transport, wrapper} = await setup();
    // Never ack so the optimistic pending flag stays observable. Do not throw:
    // an unhandled sendMutation rejection leaks into other files under bun test.
    transport.setDefaultResponder(() => new Promise(() => {}));
    const {result} = renderHook(() => useEntity<TodoData>("todos", "t1"), {wrapper});
    expect(result.current.data).toBeUndefined();

    act(() => {
      client.mutate({collection: "todos", data: {title: "Local"}, id: "t1", operation: "create"});
    });

    expect(result.current.data?.title).toBe("Local");
    expect(result.current.isPending).toBe(true);
    expect(result.current.deleted).toBe(false);
    await act(async () => {
      await client.stop();
    });
  });

  it("re-renders when a server delta is applied, including tombstones", async () => {
    const {client, transport, wrapper} = await setup();
    const {result} = renderHook(() => useEntity<TodoData>("todos", "t1"), {wrapper});

    act(() => {
      transport.deliverDelta(makeDelta({data: {title: "from server"}, seq: 1}));
    });
    expect(result.current.data?.title).toBe("from server");
    expect(result.current.seq).toBe(1);
    expect(result.current.isPending).toBe(false);

    act(() => {
      transport.deliverDelta(makeDelta({deleted: true, method: "delete", seq: 2}));
    });
    expect(result.current.deleted).toBe(true);
    await act(async () => {
      await client.stop();
    });
  });
});

describe("useQuery", () => {
  it("re-renders on table changes and excludes tombstones by default", async () => {
    const {client, transport, wrapper} = await setup();
    const {result} = renderHook(() => useQuery<TodoData>("todos"), {wrapper});
    expect(result.current).toEqual([]);

    act(() => {
      transport.deliverDelta(makeDelta({data: {title: "one"}, id: "t1", seq: 1}));
      transport.deliverDelta(makeDelta({data: {title: "two"}, id: "t2", seq: 2}));
    });
    expect(result.current.map((todo) => todo.title).sort()).toEqual(["one", "two"]);

    act(() => {
      client.store.softDeleteEntity({collection: "todos", id: "t1"});
    });
    expect(result.current.map((todo) => todo.title)).toEqual(["two"]);
    await act(async () => {
      await client.stop();
    });
  });

  it("includes tombstones when includeDeleted is set", async () => {
    const {client, wrapper} = await setup();
    act(() => {
      client.store.upsertEntity({collection: "todos", data: {title: "gone"}, id: "t1"});
      client.store.softDeleteEntity({collection: "todos", id: "t1"});
    });
    const {result} = renderHook(() => useQuery<TodoData>("todos", {includeDeleted: true}), {
      wrapper,
    });
    expect(result.current).toHaveLength(1);
    await act(async () => {
      await client.stop();
    });
  });

  it("applies filter and sort in JS", async () => {
    const {client, wrapper} = await setup();
    act(() => {
      client.store.upsertEntity({
        collection: "todos",
        data: {completed: true, title: "b done"},
        id: "t1",
      });
      client.store.upsertEntity({
        collection: "todos",
        data: {completed: false, title: "c open"},
        id: "t2",
      });
      client.store.upsertEntity({
        collection: "todos",
        data: {completed: true, title: "a done"},
        id: "t3",
      });
    });
    const {result} = renderHook(
      () =>
        useQuery<TodoData>("todos", {
          filter: (todo) => todo.completed === true,
          sort: (a, b) => a.title.localeCompare(b.title),
        }),
      {wrapper}
    );
    expect(result.current.map((todo) => todo.title)).toEqual(["a done", "b done"]);
    await act(async () => {
      await client.stop();
    });
  });

  it("keeps a stable array identity across unrelated re-renders", async () => {
    const {client, wrapper} = await setup();
    act(() => {
      client.store.upsertEntity({collection: "todos", data: {title: "same"}, id: "t1"});
    });
    const {rerender, result} = renderHook(() => useQuery<TodoData>("todos"), {wrapper});
    const first = result.current;
    rerender({});
    expect(result.current).toBe(first);
    await act(async () => {
      await client.stop();
    });
  });

  it("does not recompute the selection on unrelated re-renders (no per-render O(n) work)", async () => {
    const {client, wrapper} = await setup();
    act(() => {
      client.store.upsertEntity({collection: "todos", data: {title: "one"}, id: "t1"});
      client.store.upsertEntity({collection: "todos", data: {title: "two"}, id: "t2"});
    });
    // The filter runs inside the hook's `select`; counting its invocations tells
    // us whether an unrelated re-render re-ran the whole decode/filter/sort pass.
    // The predicate is defined ONCE (as a memoized callback would be) — a fresh
    // inline function every render is a genuinely different filter as far as the
    // hook can tell, and must invalidate the cache (see the options-change test).
    let filterCalls = 0;
    const filter = (): boolean => {
      filterCalls += 1;
      return true;
    };
    const {rerender} = renderHook(() => useQuery<TodoData>("todos", {filter}), {wrapper});
    const afterInitial = filterCalls;
    expect(afterInitial).toBeGreaterThan(0);

    // Re-render without any store change: the cached snapshot must be reused, so
    // the selector (and its filter) must NOT run again.
    rerender({});
    rerender({});
    expect(filterCalls).toBe(afterInitial);

    // A real store change bumps the revision and recomputes exactly once.
    act(() => {
      client.store.upsertEntity({collection: "todos", data: {title: "three"}, id: "t3"});
    });
    expect(filterCalls).toBeGreaterThan(afterInitial);
    await act(async () => {
      await client.stop();
    });
  });

  it("returns the new result immediately when the filter changes between renders (no store write)", async () => {
    const {client, wrapper} = await setup();
    act(() => {
      client.store.upsertEntity({
        collection: "todos",
        data: {completed: true, title: "done"},
        id: "t1",
      });
      client.store.upsertEntity({
        collection: "todos",
        data: {completed: false, title: "open"},
        id: "t2",
      });
    });
    const {rerender, result} = renderHook(
      ({showCompleted}: {showCompleted: boolean}) =>
        useQuery<TodoData>("todos", {filter: (todo) => todo.completed === showCompleted}),
      {initialProps: {showCompleted: true}, wrapper}
    );
    expect(result.current.map((todo) => todo.title)).toEqual(["done"]);

    // A state-driven filter flip with no store write at all: the previous
    // implementation kept returning the cached array until an unrelated write.
    rerender({showCompleted: false});
    expect(result.current.map((todo) => todo.title)).toEqual(["open"]);
    await act(async () => {
      await client.stop();
    });
  });

  it("returns the new result immediately when includeDeleted changes between renders", async () => {
    const {client, wrapper} = await setup();
    act(() => {
      client.store.upsertEntity({collection: "todos", data: {title: "live"}, id: "t1"});
      client.store.upsertEntity({collection: "todos", data: {title: "gone"}, id: "t2"});
      client.store.softDeleteEntity({collection: "todos", id: "t2"});
    });
    const {rerender, result} = renderHook(
      ({includeDeleted}: {includeDeleted: boolean}) =>
        useQuery<TodoData>("todos", {includeDeleted}),
      {initialProps: {includeDeleted: false}, wrapper}
    );
    expect(result.current.map((todo) => todo.title)).toEqual(["live"]);

    rerender({includeDeleted: true});
    expect(result.current.map((todo) => todo.title).sort()).toEqual(["gone", "live"]);
    await act(async () => {
      await client.stop();
    });
  });

  // Options being part of the selection identity means an inline filter makes
  // every render recompute — and `useSyncExternalStore` re-renders whenever the
  // snapshot it recorded changes. This asserts that recomputation costs exactly
  // one render per cause (re-render, store write) rather than cascading.
  it("does not re-render repeatedly when the filter is a fresh inline function every render", async () => {
    const {client, wrapper} = await setup();
    act(() => {
      client.store.upsertEntity({collection: "todos", data: {title: "one"}, id: "t1"});
    });
    let renders = 0;
    const {rerender, result} = renderHook(
      () => {
        renders += 1;
        return useQuery<TodoData>("todos", {filter: (todo) => todo.title !== "hidden"});
      },
      {wrapper}
    );
    const afterMount = renders;
    expect(result.current).toHaveLength(1);

    rerender({});
    expect(renders).toBe(afterMount + 1);

    act(() => {
      client.store.upsertEntity({collection: "todos", data: {title: "two"}, id: "t2"});
    });
    expect(renders).toBe(afterMount + 2);
    expect(result.current).toHaveLength(2);
    await act(async () => {
      await client.stop();
    });
  });

  it("skips a corrupt row (undecodable data) instead of throwing (E4)", async () => {
    const {client, wrapper} = await setup();
    act(() => {
      client.store.upsertEntity({collection: "todos", data: {title: "healthy"}, id: "t1"});
      // Write a raw row whose `data` cell is not valid JSON, bypassing the
      // encoder — this is what a corrupt/legacy row looks like on disk.
      // store.ts's decodeData already swallows the JSON.parse failure and
      // returns null (with a console.warn) rather than throwing; useQuery
      // must additionally skip that row from its results rather than handing
      // list consumers a `null` entry that crashes on first field access.
      client.store.raw.setRow("todos", "corrupt-1", {
        data: "{not valid json",
        deleted: false,
        pendingMutationId: "",
        seq: 1,
      });
    });
    const {result} = renderHook(() => useQuery<TodoData>("todos"), {wrapper});
    expect(() => result.current).not.toThrow();
    expect(result.current).toHaveLength(1);
    expect(result.current[0]?.title).toBe("healthy");
    await act(async () => {
      await client.stop();
    });
  });
});

describe("useEntityIds", () => {
  it("keeps a stable array identity when only a field changes (not membership)", async () => {
    const {client, wrapper} = await setup();
    act(() => {
      client.store.upsertEntity({
        collection: "todos",
        data: {completed: false, title: "a"},
        id: "t1",
      });
      client.store.upsertEntity({
        collection: "todos",
        data: {completed: false, title: "b"},
        id: "t2",
      });
    });
    const {result} = renderHook(() => useEntityIds<TodoData>("todos"), {wrapper});
    const first = result.current;
    expect(first.slice().sort()).toEqual(["t1", "t2"]);

    // A field-only update (title change) must NOT change the id-array identity —
    // this is what keeps the list container from re-rendering on a row edit.
    act(() => {
      client.store.upsertEntity({
        collection: "todos",
        data: {completed: true, title: "a2"},
        id: "t1",
      });
    });
    expect(result.current).toBe(first);

    // Adding a row changes membership → new identity.
    act(() => {
      client.store.upsertEntity({collection: "todos", data: {title: "c"}, id: "t3"});
    });
    expect(result.current).not.toBe(first);
    expect(result.current.slice().sort()).toEqual(["t1", "t2", "t3"]);
    await act(async () => {
      await client.stop();
    });
  });

  it("returns the new ids immediately when the filter changes between renders (no store write)", async () => {
    const {client, wrapper} = await setup();
    act(() => {
      client.store.upsertEntity({
        collection: "todos",
        data: {completed: true, title: "done"},
        id: "t1",
      });
      client.store.upsertEntity({
        collection: "todos",
        data: {completed: false, title: "open"},
        id: "t2",
      });
    });
    const {rerender, result} = renderHook(
      ({showCompleted}: {showCompleted: boolean}) =>
        useEntityIds<TodoData>("todos", {filter: (todo) => todo.completed === showCompleted}),
      {initialProps: {showCompleted: true}, wrapper}
    );
    expect(result.current).toEqual(["t1"]);

    rerender({showCompleted: false});
    expect(result.current).toEqual(["t2"]);
    await act(async () => {
      await client.stop();
    });
  });

  it("keeps the id array identity across re-renders with inline options that select the same ids", async () => {
    const {client, wrapper} = await setup();
    act(() => {
      client.store.upsertEntity({
        collection: "todos",
        data: {completed: false, title: "a"},
        id: "t1",
      });
    });
    // An inline predicate is a new reference every render, so the selection is
    // recomputed — but an unchanged id list must keep its identity so list
    // containers do not re-render (and useSyncExternalStore cannot loop).
    const {rerender, result} = renderHook(
      () => useEntityIds<TodoData>("todos", {filter: (todo) => todo.completed === false}),
      {wrapper}
    );
    const first = result.current;
    rerender({});
    rerender({});
    expect(result.current).toBe(first);
    await act(async () => {
      await client.stop();
    });
  });

  it("excludes tombstones and drops ids that get soft-deleted", async () => {
    const {client, wrapper} = await setup();
    act(() => {
      client.store.upsertEntity({collection: "todos", data: {title: "keep"}, id: "t1"});
      client.store.upsertEntity({collection: "todos", data: {title: "gone"}, id: "t2"});
    });
    const {result} = renderHook(() => useEntityIds<TodoData>("todos"), {wrapper});
    expect(result.current.slice().sort()).toEqual(["t1", "t2"]);

    act(() => {
      client.store.softDeleteEntity({collection: "todos", id: "t2"});
    });
    expect(result.current).toEqual(["t1"]);
    await act(async () => {
      await client.stop();
    });
  });
});

describe("useMutate", () => {
  it("create applies optimistically and enqueues an outbox mutation", async () => {
    const {client, transport, wrapper} = await setup();
    transport.setDefaultResponder(() => {
      throw new Error("offline");
    });
    const {result} = renderHook(
      () => ({mutate: useMutate("todos"), todos: useQuery<TodoData>("todos")}),
      {wrapper}
    );

    let created: {mutationId: string; id: string} | undefined;
    act(() => {
      created = result.current.mutate.create({data: {title: "Offline task"}});
    });
    expect(created?.id).toBeTruthy();
    expect(result.current.todos.map((todo) => todo.title)).toEqual(["Offline task"]);

    // The failed send requeues the mutation; it stays durably queued.
    await act(flush);
    expect(client.outbox.listQueued({userId: "u1"})).toHaveLength(1);
    await act(async () => {
      await client.stop();
    });
  });

  it("update merges fields and remove tombstones the entity", async () => {
    const {client, transport, wrapper} = await setup();
    transport.setDefaultResponder(() => {
      throw new Error("offline");
    });
    act(() => {
      client.store.upsertEntity({
        collection: "todos",
        data: {completed: false, title: "keep me"},
        id: "t1",
      });
    });
    const {result} = renderHook(
      () => ({entity: useEntity<TodoData>("todos", "t1"), mutate: useMutate("todos")}),
      {wrapper}
    );

    act(() => {
      result.current.mutate.update({data: {completed: true}, id: "t1"});
    });
    expect(result.current.entity.data).toEqual({completed: true, title: "keep me"});

    act(() => {
      result.current.mutate.remove({id: "t1"});
    });
    expect(result.current.entity.deleted).toBe(true);

    await act(flush);
    const operations = client.outbox.listQueued({userId: "u1"}).map((m) => m.operation);
    expect(operations).toEqual(["update", "delete"]);
    await act(async () => {
      await client.stop();
    });
  });
});

describe("useSyncStatus", () => {
  it("reflects queued counts and connectivity reactively", async () => {
    const {client, transport, wrapper} = await setup();
    transport.setDefaultResponder(() => {
      throw new Error("offline");
    });
    const {result} = renderHook(() => useSyncStatus(), {wrapper});
    expect(result.current.isOnline).toBe(true);
    expect(result.current.queuedCount).toBe(0);

    await act(async () => {
      client.mutate({collection: "todos", data: {title: "queued"}, operation: "create"});
      await flush();
    });
    expect(result.current.queuedCount).toBe(1);

    act(() => {
      transport.setConnected(false);
    });
    expect(result.current.isOnline).toBe(false);
    await act(async () => {
      await client.stop();
    });
  });

  it("reflects conflict counts and stream cursors reactively", async () => {
    const {client, transport, wrapper} = await setup();
    const {result} = renderHook(() => useSyncStatus(), {wrapper});
    expect(result.current.conflictCount).toBe(0);
    expect(result.current.streams).toEqual({});

    act(() => {
      transport.deliverDelta(makeDelta({seq: 1}));
    });
    expect(result.current.streams).toEqual({"todos|owner:u1": 1});

    act(() => {
      client.store.upsertEntity({collection: "todos", data: {title: "mine"}, id: "t9"});
    });
    transport.respondWithNack({code: "conflict", serverDoc: {title: "server"}, serverSeq: 7});
    await act(async () => {
      client.mutate({collection: "todos", data: {title: "mine v2"}, id: "t9", operation: "update"});
      await flush();
    });
    expect(result.current.conflictCount).toBe(1);
    await act(async () => {
      await client.stop();
    });
  });

  it("reflects the auth-pause state reactively (A4)", async () => {
    const {auth, client, transport, wrapper} = await setup();
    transport.setDefaultResponder(() => {
      throw new AuthRequiredError();
    });
    const {result} = renderHook(() => useSyncStatus(), {wrapper});
    expect(result.current.paused).toBeUndefined();

    await act(async () => {
      client.mutate({collection: "todos", data: {title: "x"}, operation: "create"});
      await flush();
    });
    expect(result.current.paused).toBe("auth");

    // Same-user re-auth is the unpause path (no refresh() configured here).
    transport.setDefaultResponder();
    await act(async () => {
      auth.emitAuthChange();
      await flush();
    });
    expect(result.current.paused).toBeUndefined();
    await act(async () => {
      await client.stop();
    });
  });
});

describe("useConflicts", () => {
  const recordConflict = async (harness: Harness): Promise<string> => {
    const {client, transport} = harness;
    act(() => {
      client.store.upsertEntity({collection: "todos", data: {title: "mine"}, id: "t1"});
    });
    transport.respondWithNack({code: "conflict", serverDoc: {title: "server"}, serverSeq: 7});
    let mutationId = "";
    await act(async () => {
      mutationId = client.mutate({
        collection: "todos",
        data: {title: "mine v2"},
        id: "t1",
        operation: "update",
      }).mutationId;
      await flush();
    });
    return mutationId;
  };

  it("lists conflicts reactively and resolve clears them", async () => {
    const harness = await setup();
    const {client, wrapper} = harness;
    const {result} = renderHook(
      () => ({conflicts: useConflicts(), entity: useEntity<TodoData>("todos", "t1")}),
      {wrapper}
    );
    expect(result.current.conflicts.conflicts).toEqual([]);

    const mutationId = await recordConflict(harness);
    expect(result.current.conflicts.conflicts).toHaveLength(1);
    expect(result.current.conflicts.conflicts[0]?.mutationId).toBe(mutationId);
    expect(result.current.conflicts.conflicts[0]?.serverSeq).toBe(7);

    act(() => {
      result.current.conflicts.resolve({mutationId, strategy: "useServer"});
    });
    expect(result.current.conflicts.conflicts).toEqual([]);
    expect(result.current.entity.data?.title).toBe("server");
    expect(result.current.entity.seq).toBe(7);
    await act(async () => {
      await client.stop();
    });
  });

  it("keepMine requeues the mutation and keeps the optimistic data", async () => {
    const harness = await setup();
    const {client, transport, wrapper} = harness;
    const {result} = renderHook(
      () => ({conflicts: useConflicts(), entity: useEntity<TodoData>("todos", "t1")}),
      {wrapper}
    );
    const mutationId = await recordConflict(harness);

    // Keep the requeued retry pending so the requeue itself is observable.
    transport.setDefaultResponder(() => {
      throw new Error("offline");
    });
    act(() => {
      result.current.conflicts.resolve({mutationId, strategy: "keepMine"});
    });
    expect(result.current.conflicts.conflicts).toEqual([]);
    expect(result.current.entity.data?.title).toBe("mine v2");
    // The retry is requeued under a fresh mutationId (the original id is burned on the
    // server's idempotency ledger).
    expect(client.outbox.getMutation({mutationId})).toBeUndefined();
    // resolveConflict kicks an immediate replay; the offline responder rejects the
    // send and the retry settles back into the queue.
    await act(flush);
    const retry = client.outbox
      .listQueued({userId: "u1"})
      .find((mutation) => mutation.entityId === "t1");
    expect(retry?.status).toBe("queued");
    expect(retry?.baseVersion).toBe(7);
    await act(async () => {
      await client.stop();
    });
  });
});

describe("listener cleanup on unmount (E4)", () => {
  it("useEntity removes its row listener on unmount", async () => {
    const {client, wrapper} = await setup();
    const baseline = client.store.raw.getListenerStats();
    const {unmount} = renderHook(() => useEntity<TodoData>("todos", "t1"), {wrapper});
    expect(client.store.raw.getListenerStats().row).toBe(baseline.row + 1);
    unmount();
    expect(client.store.raw.getListenerStats()).toEqual(baseline);
    await act(async () => {
      await client.stop();
    });
  });

  it("useQuery removes its table listener on unmount", async () => {
    const {client, wrapper} = await setup();
    const baseline = client.store.raw.getListenerStats();
    const {unmount} = renderHook(() => useQuery<TodoData>("todos"), {wrapper});
    expect(client.store.raw.getListenerStats().table).toBe(baseline.table + 1);
    unmount();
    expect(client.store.raw.getListenerStats()).toEqual(baseline);
    await act(async () => {
      await client.stop();
    });
  });

  it("useSyncStatus removes its outbox/conflicts/cursors table listeners on unmount", async () => {
    const {client, wrapper} = await setup();
    const baseline = client.store.raw.getListenerStats();
    const {unmount} = renderHook(() => useSyncStatus(), {wrapper});
    expect(client.store.raw.getListenerStats().table).toBe(baseline.table + 3);
    unmount();
    expect(client.store.raw.getListenerStats()).toEqual(baseline);
    await act(async () => {
      await client.stop();
    });
  });

  it("useConflicts removes its conflicts table listener on unmount", async () => {
    const {client, wrapper} = await setup();
    const baseline = client.store.raw.getListenerStats();
    const {unmount} = renderHook(() => useConflicts(), {wrapper});
    expect(client.store.raw.getListenerStats().table).toBe(baseline.table + 1);
    unmount();
    expect(client.store.raw.getListenerStats()).toEqual(baseline);
    await act(async () => {
      await client.stop();
    });
  });

  it("useEntityIds removes its table listener on unmount", async () => {
    const {client, wrapper} = await setup();
    const baseline = client.store.raw.getListenerStats();
    const {unmount} = renderHook(() => useEntityIds<TodoData>("todos"), {wrapper});
    expect(client.store.raw.getListenerStats().table).toBe(baseline.table + 1);
    unmount();
    expect(client.store.raw.getListenerStats()).toEqual(baseline);
    await act(async () => {
      await client.stop();
    });
  });
});

describe("useSyncDebugLog", () => {
  it("stays disabled and clear is a no-op when the client has no debug log", async () => {
    const {client, wrapper} = await setup();
    const {result, unmount} = renderHook(() => useSyncDebugLog(), {wrapper});
    expect(result.current.enabled).toBe(false);
    expect(result.current.events).toEqual([]);
    expect(result.current.log).toBeUndefined();
    expect(result.current.stats).toBeUndefined();
    act(() => {
      result.current.clear();
    });
    expect(result.current.events).toEqual([]);
    unmount();
    await act(async () => {
      await client.stop();
    });
  });

  it("reads recorded events and clears them when debug is on", async () => {
    const {client, wrapper} = await setup({debug: true});
    const {result, unmount} = renderHook(() => useSyncDebugLog(), {wrapper});
    expect(result.current.enabled).toBe(true);
    act(() => {
      client.debug?.record({direction: "system", label: "seed", type: "connect"});
    });
    expect(result.current.events.some((event) => event.label === "seed")).toBe(true);
    expect(result.current.stats?.retained).toBeGreaterThan(0);
    act(() => {
      result.current.clear();
    });
    expect(client.debug?.getEvents()).toEqual([]);
    expect(client.debug?.getStats().retained).toBe(0);
    unmount();
    await act(async () => {
      await client.stop();
    });
  });
});
