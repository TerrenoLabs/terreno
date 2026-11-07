import {describe, expect, it} from "bun:test";
import {assert} from "chai";

import {createSyncStore, type SyncStore} from "../storage/store";
import {NEEDS_REPAIR_TABLE} from "../storage/types";
import type {SyncDelta} from "../types";
import {getCursor} from "./cursor";
import {applyDelta} from "./deltaApplier";

const STREAM = "todos|owner:u1";

const makeStore = (): SyncStore => createSyncStore({collections: ["todos"]});

const makeDelta = (overrides: Partial<SyncDelta> = {}): SyncDelta => ({
  collection: "todos",
  data: {title: "From server"},
  id: "t1",
  method: "create",
  seq: 1,
  stream: STREAM,
  ...overrides,
});

describe("applyDelta", () => {
  it("applies a create delta and advances the stream cursor", () => {
    const store = makeStore();
    const result = applyDelta({delta: makeDelta(), store});
    expect(result).toEqual({applied: true, seqJump: false});
    expect(store.getEntity({collection: "todos", id: "t1"})).toEqual({
      data: {title: "From server"},
      deleted: false,
      id: "t1",
      pendingMutationId: undefined,
      seq: 1,
      stream: STREAM,
    });
    expect(getCursor({store, stream: STREAM})).toBe(1);
  });

  it("applies an update delta over an existing entity", () => {
    const store = makeStore();
    applyDelta({delta: makeDelta(), store});
    const result = applyDelta({
      delta: makeDelta({data: {title: "Updated"}, method: "update", seq: 2}),
      store,
    });
    expect(result.applied).toBe(true);
    const entity = store.getEntity({collection: "todos", id: "t1"});
    expect(entity?.data).toEqual({title: "Updated"});
    expect(entity?.seq).toBe(2);
  });

  it("is idempotent for a duplicate delta (same seq)", () => {
    const store = makeStore();
    applyDelta({delta: makeDelta({data: {title: "v1"}, seq: 3}), store});
    const result = applyDelta({delta: makeDelta({data: {title: "dupe"}, seq: 3}), store});
    expect(result.applied).toBe(false);
    expect(store.getEntity({collection: "todos", id: "t1"})?.data).toEqual({title: "v1"});
    expect(getCursor({store, stream: STREAM})).toBe(3);
  });

  it("applies the server's doc for an own create whose ACK already stamped the same seq", () => {
    const store = makeStore();
    // releaseEntity stamps seq and awaitingServerDelta before the server's delta arrives.
    store.upsertEntity({
      awaitingServerDelta: true,
      collection: "todos",
      data: {title: "Optimistic"},
      id: "t1",
      seq: 4,
    });
    const result = applyDelta({
      delta: makeDelta({data: {_id: "t1", ownerId: "u1", title: "Optimistic"}, seq: 4}),
      store,
    });
    expect(result.applied).toBe(true);
    const entity = store.getEntity({collection: "todos", id: "t1"});
    expect(entity?.data).toEqual({_id: "t1", ownerId: "u1", title: "Optimistic"});
    expect(entity?.stream).toBe(STREAM);
    expect(entity?.awaitingServerDelta).toBeUndefined();
  });

  it("skips an equal-seq delta once a later local edit has cleared the ACK marker", () => {
    const store = makeStore();
    store.upsertEntity({
      awaitingServerDelta: true,
      collection: "todos",
      data: {title: "Optimistic"},
      id: "t1",
      seq: 4,
    });
    store.upsertEntity({collection: "todos", data: {title: "Edited after ACK"}, id: "t1"});
    const result = applyDelta({
      delta: makeDelta({data: {_id: "t1", title: "Optimistic"}, seq: 4}),
      store,
    });
    expect(result.applied).toBe(false);
    expect(store.getEntity({collection: "todos", id: "t1"})?.data).toEqual({
      title: "Edited after ACK",
    });
  });

  it("still skips an older delta for an ACK-stamped row with no stream", () => {
    const store = makeStore();
    store.upsertEntity({
      awaitingServerDelta: true,
      collection: "todos",
      data: {title: "Optimistic"},
      id: "t1",
      seq: 4,
    });
    const result = applyDelta({delta: makeDelta({data: {title: "Stale"}, seq: 3}), store});
    expect(result.applied).toBe(false);
    expect(store.getEntity({collection: "todos", id: "t1"})?.data).toEqual({title: "Optimistic"});
  });

  it("skips an out-of-order older delta without rewinding entity or cursor", () => {
    const store = makeStore();
    applyDelta({delta: makeDelta({data: {title: "v5"}, seq: 5}), store});
    const result = applyDelta({
      delta: makeDelta({data: {title: "stale"}, method: "update", seq: 2}),
      store,
    });
    expect(result.applied).toBe(false);
    expect(store.getEntity({collection: "todos", id: "t1"})?.seq).toBe(5);
    expect(getCursor({store, stream: STREAM})).toBe(5);
  });

  it("never overwrites an entity with a pending outbox mutation, but still advances the cursor", () => {
    const store = makeStore();
    store.upsertEntity({
      collection: "todos",
      data: {title: "Optimistic"},
      id: "t1",
      pendingMutationId: "m1",
      seq: 1,
    });
    const result = applyDelta({
      delta: makeDelta({data: {title: "Server wins?"}, method: "update", seq: 4}),
      store,
    });
    expect(result.applied).toBe(false);
    const entity = store.getEntity({collection: "todos", id: "t1"});
    expect(entity?.data).toEqual({title: "Optimistic"});
    expect(entity?.pendingMutationId).toBe("m1");
    expect(entity?.seq).toBe(1);
    expect(getCursor({store, stream: STREAM})).toBe(4);
    expect(store.hasNeedsRepair({collection: "todos", entityId: "t1"})).toBe(true);
    expect(store.raw.getCell(NEEDS_REPAIR_TABLE, "todos:t1", "missedSeq")).toBe(4);
  });

  it("applies a tombstone delta, preserving the last known data", () => {
    const store = makeStore();
    applyDelta({delta: makeDelta({data: {title: "Alive"}, seq: 1}), store});
    const result = applyDelta({
      delta: makeDelta({data: undefined, deleted: true, method: "delete", seq: 2}),
      store,
    });
    expect(result.applied).toBe(true);
    const entity = store.getEntity({collection: "todos", id: "t1"});
    expect(entity?.deleted).toBe(true);
    expect(entity?.data).toEqual({title: "Alive"});
    expect(entity?.seq).toBe(2);
    expect(store.listEntities({collection: "todos"})).toHaveLength(0);
  });

  it("creates a tombstone for a never-seen entity (scope-move tombstones)", () => {
    const store = makeStore();
    const result = applyDelta({
      delta: makeDelta({data: undefined, deleted: true, method: "delete", seq: 7}),
      store,
    });
    expect(result.applied).toBe(true);
    const entity = store.getEntity({collection: "todos", id: "t1"});
    expect(entity?.deleted).toBe(true);
    expect(entity?.data).toBeNull();
  });

  it("treats a delete method without an explicit deleted flag as a tombstone", () => {
    const store = makeStore();
    applyDelta({delta: makeDelta({seq: 1}), store});
    applyDelta({delta: makeDelta({data: undefined, method: "delete", seq: 2}), store});
    expect(store.getEntity({collection: "todos", id: "t1"})?.deleted).toBe(true);
  });

  it("reports a seq jump (before applying) as a hint, while still applying", () => {
    const store = makeStore();
    const result = applyDelta({delta: makeDelta({seq: 5}), store});
    expect(result).toEqual({applied: true, seqJump: true});
    expect(store.getEntity({collection: "todos", id: "t1"})?.seq).toBe(5);
    expect(getCursor({store, stream: STREAM})).toBe(5);
  });

  it("does not report a seq jump for contiguous deltas", () => {
    const store = makeStore();
    applyDelta({delta: makeDelta({seq: 1}), store});
    const result = applyDelta({
      delta: makeDelta({id: "t2", method: "create", seq: 2}),
      store,
    });
    expect(result.seqJump).toBe(false);
  });

  it("reports seq jumps on skipped deltas too", () => {
    const store = makeStore();
    store.upsertEntity({
      collection: "todos",
      data: {title: "Optimistic"},
      id: "t1",
      pendingMutationId: "m1",
      seq: 1,
    });
    const result = applyDelta({delta: makeDelta({method: "update", seq: 9}), store});
    expect(result).toEqual({applied: false, seqJump: true});
  });

  it("keys cursors by the delta's stream, not its collection", () => {
    const store = makeStore();
    applyDelta({delta: makeDelta({seq: 1, stream: "todos|owner:u1"}), store});
    applyDelta({
      delta: makeDelta({id: "t2", seq: 4, stream: "todos|tenant:org1"}),
      store,
    });
    expect(getCursor({store, stream: "todos|owner:u1"})).toBe(1);
    expect(getCursor({store, stream: "todos|tenant:org1"})).toBe(4);
    expect(getCursor({store, stream: "todos"})).toBe(0);
  });

  it("clears a stale pendingMutationId when applying over a non-pending entity", () => {
    const store = makeStore();
    applyDelta({delta: makeDelta({seq: 1}), store});
    const result = applyDelta({
      delta: makeDelta({data: {title: "v2"}, method: "update", seq: 2}),
      store,
    });
    expect(result.applied).toBe(true);
    expect(store.getEntity({collection: "todos", id: "t1"})?.pendingMutationId).toBeUndefined();
  });

  it("passes the injected clock through to the cursor row", () => {
    const store = makeStore();
    applyDelta({delta: makeDelta(), now: () => "2026-07-04T12:00:00Z", store});
    expect(store.raw.getCell("_cursors", STREAM, "updatedAt")).toBe("2026-07-04T12:00:00Z");
  });

  it("C1: clamps the cursor to min(seq, frontierSeq) when the frontier lags the seq", () => {
    const store = makeStore();
    // The delta is for seq 5 but the stream frontier sits at 3 (seq 4's owning write is
    // still uncommitted) — the entity applies at seq 5, but the cursor must not advance
    // past the frontier or catch-up would skip the still-pending hole at 4.
    const result = applyDelta({delta: makeDelta({frontierSeq: 3, seq: 5}), store});
    expect(result.applied).toBe(true);
    expect(store.getEntity({collection: "todos", id: "t1"})?.seq).toBe(5);
    expect(getCursor({store, stream: STREAM})).toBe(3);
  });

  it("C1: advances the cursor to the delta seq when frontierSeq is absent (older server)", () => {
    const store = makeStore();
    const result = applyDelta({delta: makeDelta({seq: 4}), store});
    expect(result.applied).toBe(true);
    expect(getCursor({store, stream: STREAM})).toBe(4);
  });

  it("C1: clamps the cursor even on a skipped (pending-protected) delta", () => {
    const store = makeStore();
    store.upsertEntity({
      collection: "todos",
      data: {title: "optimistic"},
      id: "t1",
      pendingMutationId: "m1",
      seq: 1,
    });
    const result = applyDelta({
      delta: makeDelta({frontierSeq: 2, method: "update", seq: 6}),
      store,
    });
    expect(result.applied).toBe(false);
    expect(getCursor({store, stream: STREAM})).toBe(2);
  });

  it("C2: records the stream on the entity so leave-purge can find it", () => {
    const store = makeStore();
    applyDelta({delta: makeDelta({stream: "todos|tenant:org7"}), store});
    expect(store.getEntity({collection: "todos", id: "t1"})?.stream).toBe("todos|tenant:org7");
  });

  it("throws for a delta targeting an unknown collection", () => {
    const store = makeStore();
    expect(() => applyDelta({delta: makeDelta({collection: "nope"}), store})).toThrow(
      /Unknown collection/
    );
  });
});

describe("applyDelta window |admin (Task 3.5)", () => {
  const ADMIN_STREAM = "todos|admin";

  it("is a no-op for an unknown id (no surprise insert) and still advances the cursor", () => {
    const store = makeStore();
    const result = applyDelta({
      delta: makeDelta({
        data: {title: "surprise"},
        id: "unknown",
        method: "create",
        seq: 4,
        stream: ADMIN_STREAM,
      }),
      store,
    });
    assert.isFalse(result.applied);
    assert.isUndefined(store.getEntity({collection: "todos", id: "unknown"}));
    assert.equal(getCursor({store, stream: ADMIN_STREAM}), 4);
  });

  it("updates a known id on the admin stream", () => {
    const store = makeStore();
    store.upsertEntity({
      collection: "todos",
      data: {title: "old"},
      id: "t1",
      seq: 1,
      stream: ADMIN_STREAM,
    });
    const result = applyDelta({
      delta: makeDelta({
        data: {title: "new"},
        method: "update",
        seq: 2,
        stream: ADMIN_STREAM,
      }),
      store,
    });
    assert.isTrue(result.applied);
    assert.equal(
      store.getEntity<{title: string}>({collection: "todos", id: "t1"})?.data.title,
      "new"
    );
  });

  it("delete delta removes a known id and ignores an unknown id", () => {
    const store = makeStore();
    store.upsertEntity({
      collection: "todos",
      data: {title: "gone"},
      id: "t1",
      seq: 1,
      stream: ADMIN_STREAM,
    });
    const known = applyDelta({
      delta: makeDelta({deleted: true, id: "t1", method: "delete", seq: 2, stream: ADMIN_STREAM}),
      store,
    });
    const unknown = applyDelta({
      delta: makeDelta({deleted: true, id: "nope", method: "delete", seq: 3, stream: ADMIN_STREAM}),
      store,
    });
    assert.isTrue(known.applied);
    assert.isTrue(store.getEntity({collection: "todos", id: "t1"})?.deleted);
    assert.isFalse(unknown.applied);
    assert.isUndefined(store.getEntity({collection: "todos", id: "nope"}));
  });
});
