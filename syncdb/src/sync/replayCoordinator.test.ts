import {describe, expect, it} from "bun:test";

import {getConflict} from "../mutations/conflicts";
import {createOutbox, type Outbox} from "../mutations/outbox";
import {createSyncStore, type SyncStore} from "../storage/store";
import {createFakeTransport, type FakeTransport} from "../testing/fakeTransport";
import type {SyncMutateRequest} from "../types";
import {AuthRequiredError} from "./httpChannel";
import {
  BATCH_UNSUPPORTED_REPROBE_INTERVAL_MS,
  type CreateReplayCoordinatorArgs,
  createReplayCoordinator,
  ERROR_NACK_BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_ERROR_NACK_ATTEMPTS,
  type ReplayCoordinator,
} from "./replayCoordinator";

const USER = "user-1";

interface Harness {
  store: SyncStore;
  outbox: Outbox;
  transport: FakeTransport;
  coordinator: ReplayCoordinator;
  clock: {value: number};
}

const makeHarness = (): Harness => {
  const store = createSyncStore({collections: ["notes", "todos"]});
  const outbox = createOutbox({store});
  const transport = createFakeTransport();
  const clock = {value: 1_000_000};
  const coordinator = createReplayCoordinator({
    now: () => clock.value,
    outbox,
    sendMutation: transport.sendMutation,
    store,
  });
  return {clock, coordinator, outbox, store, transport};
};

/** Harness variant with the batch transport wired in (B3), plus optional overrides. */
const makeBatchHarness = (overrides: Partial<CreateReplayCoordinatorArgs> = {}): Harness => {
  const store = createSyncStore({collections: ["notes", "todos"]});
  const outbox = createOutbox({store});
  const transport = createFakeTransport();
  const clock = {value: 1_000_000};
  const coordinator = createReplayCoordinator({
    now: () => clock.value,
    outbox,
    sendMutation: transport.sendMutation,
    sendMutationBatch: transport.sendMutationBatch,
    store,
    ...overrides,
  });
  return {clock, coordinator, outbox, store, transport};
};

/** A fake, controllable timer queue: setTimeoutFn/clearTimeoutFn injectable into the coordinator. */
interface FakeTimers {
  /** Fire every timer whose delay has elapsed at the current clock value, in schedule order. */
  flush: () => void;
  /** Number of currently armed (not yet fired/cleared) timers. */
  armedCount: () => number;
}

const makeFakeTimers = (clock: {
  value: number;
}): {timers: FakeTimers} & Pick<CreateReplayCoordinatorArgs, "setTimeoutFn" | "clearTimeoutFn"> => {
  interface Entry {
    id: number;
    handler: () => void;
    dueAt: number;
    cleared: boolean;
  }
  const entries = new Map<number, Entry>();
  let nextId = 1;
  const setTimeoutFn = (handler: () => void, ms: number): unknown => {
    const id = nextId++;
    entries.set(id, {cleared: false, dueAt: clock.value + ms, handler, id});
    return id;
  };
  const clearTimeoutFn = (handle: unknown): void => {
    const entry = entries.get(handle as number);
    if (entry) {
      entry.cleared = true;
      entries.delete(handle as number);
    }
  };
  const flush = (): void => {
    const due = [...entries.values()]
      .filter((entry) => !entry.cleared && entry.dueAt <= clock.value)
      .sort((a, b) => a.dueAt - b.dueAt || a.id - b.id);
    for (const entry of due) {
      if (entries.get(entry.id)?.cleared) {
        continue;
      }
      entries.delete(entry.id);
      entry.handler();
    }
  };
  return {
    clearTimeoutFn,
    setTimeoutFn,
    timers: {
      armedCount: () => entries.size,
      flush,
    },
  };
};

/** Enqueue a mutation plus its optimistic entity state, mirroring client.mutate. */
const enqueue = (
  harness: Harness,
  {
    collection = "todos",
    entityId,
    mutationId,
    data = {title: entityId},
    baseVersion,
    maxAttempts,
    operation = "create" as const,
    userId = USER,
  }: {
    collection?: string;
    entityId: string;
    mutationId: string;
    data?: Record<string, unknown>;
    baseVersion?: number;
    maxAttempts?: number;
    operation?: "create" | "update" | "delete";
    userId?: string;
  }
): void => {
  harness.store.upsertEntity({
    collection,
    data,
    id: entityId,
    pendingMutationId: mutationId,
    seq: baseVersion,
  });
  harness.outbox.enqueue({
    args: data,
    baseVersion,
    collection,
    entityId,
    ...(maxAttempts !== undefined ? {maxAttempts} : {}),
    mutationId,
    operation,
    userId,
  });
};

describe("createReplayCoordinator", () => {
  it("acks finalize the mutation, clear pendingMutationId, and stamp the server seq", async () => {
    const harness = makeHarness();
    enqueue(harness, {entityId: "t1", mutationId: "m1"});
    harness.transport.respondWithAck({seq: 42});

    const result = await harness.coordinator.replay({userId: USER});
    expect(result).toEqual({});
    expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("acked");
    const entity = harness.store.getEntity({collection: "todos", id: "t1"});
    expect(entity?.pendingMutationId).toBeUndefined();
    expect(entity?.seq).toBe(42);
    expect(entity?.data).toEqual({title: "t1"});
  });

  it("ignores an ack that resolves after its replay lifecycle is reset", async () => {
    const harness = makeHarness();
    enqueue(harness, {entityId: "t1", mutationId: "m1"});
    let resolveResponse:
      | ((result: {ack: {id: string; mutationId: string; seq: number}; type: "ack"}) => void)
      | undefined;
    harness.transport.respondWith(
      (request) =>
        new Promise((resolve) => {
          resolveResponse = resolve;
          expect(request.mutationId).toBe("m1");
        })
    );

    const replay = harness.coordinator.replay({userId: USER});
    await Promise.resolve();
    expect(resolveResponse).toBeDefined();

    // A lifecycle boundary can reset replay state while an HTTP request is still
    // pending; the mutation can subsequently be restored to queued for a retry.
    harness.coordinator.reset();
    harness.outbox.markQueued({mutationId: "m1"});
    resolveResponse?.({ack: {id: "t1", mutationId: "m1", seq: 42}, type: "ack"});

    await replay;
    expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("queued");
  });

  it("does not clear a pendingMutationId owned by a newer mutation", async () => {
    const harness = makeHarness();
    enqueue(harness, {entityId: "t1", mutationId: "m1"});
    // A second optimistic edit re-protects the entity before m1 resolves.
    harness.store.upsertEntity({
      collection: "todos",
      data: {title: "newer"},
      id: "t1",
      pendingMutationId: "m2",
    });
    harness.transport.respondWithAck({seq: 5});

    await harness.coordinator.replay({userId: USER});
    const entity = harness.store.getEntity({collection: "todos", id: "t1"});
    expect(entity?.pendingMutationId).toBe("m2");
    expect(entity?.seq).toBe(5);
  });

  it("sends mutations with parsed data, baseVersion, and no data for deletes", async () => {
    const harness = makeHarness();
    enqueue(harness, {
      baseVersion: 3,
      data: {title: "hello"},
      entityId: "t1",
      mutationId: "m1",
      operation: "update",
    });
    enqueue(harness, {baseVersion: 4, entityId: "t2", mutationId: "m2", operation: "delete"});

    await harness.coordinator.replay({userId: USER});
    const [first, second] = harness.transport.sentMutations;
    expect(first).toEqual({
      baseVersion: 3,
      collection: "todos",
      data: {title: "hello"},
      id: "t1",
      mutationId: "m1",
      operation: "update",
    });
    expect(second).toEqual({
      baseVersion: 4,
      collection: "todos",
      id: "t2",
      mutationId: "m2",
      operation: "delete",
    });
  });

  describe("send-time baseVersion refresh (A2)", () => {
    it("chains a create + update to the same entity through one queue with no self-conflict", async () => {
      const harness = makeHarness();
      // create: no baseVersion (new entity).
      enqueue(harness, {
        data: {title: "v1"},
        entityId: "t1",
        mutationId: "m1",
        operation: "create",
      });
      // update enqueued offline BEFORE the create acked: captured baseVersion
      // is still the stale 0/undefined floor.
      harness.store.upsertEntity({collection: "todos", data: {title: "v2"}, id: "t1"});
      harness.outbox.enqueue({
        args: {title: "v2"},
        collection: "todos",
        entityId: "t1",
        mutationId: "m2",
        operation: "update",
        userId: USER,
      });

      await harness.coordinator.replay({userId: USER});
      const [createReq, updateReq] = harness.transport.sentMutations;
      expect(createReq.baseVersion).toBeUndefined();
      // The create's ack (seq 1) stamped the entity's seq before the update's
      // request was built — the update carries the FRESH seq, not the stale
      // enqueue-time floor, so it never manufactures a conflict.
      expect(updateReq.baseVersion).toBe(1);
      expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("acked");
      expect(harness.outbox.getMutation({mutationId: "m2"})?.status).toBe("acked");
    });

    it("chains update + update through one queue: the second request carries the first's acked seq", async () => {
      const harness = makeHarness();
      harness.store.upsertEntity({collection: "todos", data: {title: "v0"}, id: "t1", seq: 5});
      harness.outbox.enqueue({
        args: {title: "v1"},
        baseVersion: 5,
        collection: "todos",
        entityId: "t1",
        mutationId: "m1",
        operation: "update",
        userId: USER,
      });
      harness.outbox.enqueue({
        // Enqueued while m1 is still unacked: same stale baseVersion captured.
        args: {title: "v2"},
        baseVersion: 5,
        collection: "todos",
        entityId: "t1",
        mutationId: "m2",
        operation: "update",
        userId: USER,
      });
      harness.transport.respondWithAck({seq: 6});

      await harness.coordinator.replay({userId: USER});
      const [firstReq, secondReq] = harness.transport.sentMutations;
      expect(firstReq.baseVersion).toBe(5);
      // m1's ack (seq 6) stamped the entity's seq before m2's request was
      // built — m2 carries that fresh seq, not the stale enqueue-time floor.
      expect(secondReq.baseVersion).toBe(6);
      expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("acked");
      expect(harness.outbox.getMutation({mutationId: "m2"})?.status).toBe("acked");
    });

    it("never sends a baseVersion lower than the one stored at enqueue time (floor)", async () => {
      const harness = makeHarness();
      // The entity's live seq (2) is BELOW the stored baseVersion (5) — e.g. a
      // stale local write raced a delta application. The stored value is the
      // floor and must win.
      harness.store.upsertEntity({collection: "todos", data: {title: "v1"}, id: "t1", seq: 2});
      harness.outbox.enqueue({
        args: {title: "v1"},
        baseVersion: 5,
        collection: "todos",
        entityId: "t1",
        mutationId: "m1",
        operation: "update",
        userId: USER,
      });

      await harness.coordinator.replay({userId: USER});
      expect(harness.transport.sentMutations[0]?.baseVersion).toBe(5);
    });

    it("regression: a genuinely stale base (server changed underneath) still conflicts", async () => {
      const harness = makeHarness();
      enqueue(harness, {
        baseVersion: 2,
        data: {title: "local"},
        entityId: "t1",
        mutationId: "m1",
        operation: "update",
      });
      harness.transport.respondWithNack({
        code: "conflict",
        serverDoc: {title: "server wins"},
        serverSeq: 9,
      });

      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("conflicted");
      expect(getConflict({mutationId: "m1", store: harness.store})?.serverSeq).toBe(9);
    });
  });

  it("drains FIFO within a collection", async () => {
    const harness = makeHarness();
    enqueue(harness, {entityId: "t1", mutationId: "m1"});
    enqueue(harness, {entityId: "t2", mutationId: "m2"});
    enqueue(harness, {entityId: "t3", mutationId: "m3"});

    await harness.coordinator.replay({userId: USER});
    expect(harness.transport.sentMutations.map((m) => m.mutationId)).toEqual(["m1", "m2", "m3"]);
  });

  it("a transport rejection halts the ENTIRE global drain (INV-1), not just its collection", async () => {
    const harness = makeHarness();
    enqueue(harness, {entityId: "t1", mutationId: "m1"});
    enqueue(harness, {entityId: "t2", mutationId: "m2"});
    enqueue(harness, {collection: "notes", entityId: "n1", mutationId: "m3"});
    harness.transport.setDefaultResponder((request) => {
      if (request.collection === "todos") {
        throw new Error("timeout");
      }
      return {ack: {id: request.id ?? "", mutationId: request.mutationId, seq: 1}, type: "ack"};
    });

    await harness.coordinator.replay({userId: USER});
    // m1 (head of the global FIFO) failed to send and went back to queued;
    // the drain stops the line — m2 AND m3 (a different collection) are never
    // attempted, even though m3's transport would have acked it.
    expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("queued");
    expect(harness.outbox.getMutation({mutationId: "m2"})?.status).toBe("queued");
    expect(harness.outbox.getMutation({mutationId: "m3"})?.status).toBe("queued");
    expect(harness.transport.sentMutations.map((m) => m.mutationId)).toEqual(["m1"]);

    // The next replay resumes the whole queue once the transport recovers and
    // the jittered backoff has elapsed.
    harness.transport.setDefaultResponder();
    harness.clock.value += ERROR_NACK_BASE_BACKOFF_MS * 30;
    await harness.coordinator.replay({userId: USER});
    expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("acked");
    expect(harness.outbox.getMutation({mutationId: "m2"})?.status).toBe("acked");
    expect(harness.outbox.getMutation({mutationId: "m3"})?.status).toBe("acked");
  });

  it("conflict nacks record a _conflicts row and leave the optimistic entity in place", async () => {
    const harness = makeHarness();
    enqueue(harness, {
      baseVersion: 2,
      data: {title: "local"},
      entityId: "t1",
      mutationId: "m1",
      operation: "update",
    });
    harness.transport.respondWithNack({
      code: "conflict",
      serverDoc: {title: "server"},
      serverSeq: 9,
    });

    await harness.coordinator.replay({userId: USER});
    expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("conflicted");
    expect(getConflict({mutationId: "m1", store: harness.store})).toEqual({
      collection: "todos",
      dismissed: false,
      entityId: "t1",
      localData: JSON.stringify({title: "local"}),
      mutationId: "m1",
      serverData: JSON.stringify({title: "server"}),
      serverDeleted: false,
      serverSeq: 9,
    });
    const entity = harness.store.getEntity({collection: "todos", id: "t1"});
    expect(entity?.data).toEqual({title: "local"});
    expect(entity?.pendingMutationId).toBe("m1");
  });

  // Task 9.12: the flag has to survive onto the `_conflicts` row, since that is
  // all `resolveConflict` sees when the user eventually picks a side.
  it("records a conflict nack's serverDeleted flag on the conflict row (9.12)", async () => {
    const harness = makeHarness();
    enqueue(harness, {
      baseVersion: 2,
      data: {title: "local"},
      entityId: "t1",
      mutationId: "m1",
      operation: "update",
    });
    harness.transport.respondWithNack({code: "conflict", serverDeleted: true, serverSeq: 9});

    await harness.coordinator.replay({userId: USER});
    expect(getConflict({mutationId: "m1", store: harness.store})?.serverDeleted).toBe(true);
  });

  it("unauthorized nacks requeue, pause replay for the user, and resume on the next call", async () => {
    const harness = makeHarness();
    enqueue(harness, {entityId: "t1", mutationId: "m1"});
    enqueue(harness, {entityId: "t2", mutationId: "m2"});
    enqueue(harness, {collection: "notes", entityId: "n1", mutationId: "m3"});
    harness.transport.setDefaultResponder((request) => ({
      nack: {code: "unauthorized", mutationId: request.mutationId},
      type: "nack",
    }));

    const result = await harness.coordinator.replay({userId: USER});
    expect(result).toEqual({paused: "auth"});
    expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("queued");
    expect(harness.outbox.getMutation({mutationId: "m2"})?.status).toBe("queued");

    // Resumable: after auth is restored the next replay drains everything.
    harness.transport.setDefaultResponder();
    const resumed = await harness.coordinator.replay({userId: USER});
    expect(resumed).toEqual({});
    expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("acked");
    expect(harness.outbox.getMutation({mutationId: "m2"})?.status).toBe("acked");
    expect(harness.outbox.getMutation({mutationId: "m3"})?.status).toBe("acked");
  });

  it("AuthRequiredError thrown by the send channel (A4) is treated exactly like an unauthorized nack: requeue, pause, zero budget burn", async () => {
    const harness = makeHarness();
    enqueue(harness, {entityId: "t1", mutationId: "m1"});
    enqueue(harness, {entityId: "t2", mutationId: "m2"});
    harness.transport.respondWith(() => {
      throw new AuthRequiredError();
    });

    const result = await harness.coordinator.replay({userId: USER});
    expect(result).toEqual({paused: "auth"});
    const mutation = harness.outbox.getMutation({mutationId: "m1"});
    expect(mutation?.status).toBe("queued");
    // No budget consumed at all: neither the diagnostic attemptCount (beyond
    // the single send attempt already counted by markInFlight) nor the
    // error-nack terminality counter.
    expect(mutation?.errorNackCount).toBe(0);
    expect(harness.outbox.getMutation({mutationId: "m2"})?.status).toBe("queued");

    // Resumable exactly like an unauthorized nack.
    harness.transport.setDefaultResponder();
    const resumed = await harness.coordinator.replay({userId: USER});
    expect(resumed).toEqual({});
    expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("acked");
    expect(harness.outbox.getMutation({mutationId: "m2"})?.status).toBe("acked");
  });

  it("validation nacks are terminal failures that release the entity", async () => {
    const harness = makeHarness();
    enqueue(harness, {entityId: "t1", mutationId: "m1"});
    harness.transport.respondWithNack({code: "validation", message: "title required"});

    await harness.coordinator.replay({userId: USER});
    expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("failed");
    // pendingMutationId is released so future server deltas can apply.
    expect(
      harness.store.getEntity({collection: "todos", id: "t1"})?.pendingMutationId
    ).toBeUndefined();
  });

  // Task 9.11a: a terminal nack means the server never accepted the optimistic
  // payload, and (absent a concurrent server write) the entity's seq never
  // moves, so snapshot reconcile skips it forever. Marking needs-repair in the
  // terminal path is what makes the rejected data converge back to the server.
  it("marks the entity needs-repair on a terminal validation nack (9.11a)", async () => {
    const harness = makeHarness();
    harness.store.upsertEntity({
      collection: "todos",
      data: {title: "server"},
      id: "t1",
      seq: 7,
      stream: "todos|owner:u1",
    });
    enqueue(harness, {
      baseVersion: 7,
      data: {title: "rejected"},
      entityId: "t1",
      mutationId: "m1",
      operation: "update",
    });
    harness.transport.respondWithNack({code: "validation", message: "title required"});

    await harness.coordinator.replay({userId: USER});
    expect(harness.store.listNeedsRepair()).toEqual([
      {collection: "todos", entityId: "t1", missedSeq: 7, stream: "todos|owner:u1"},
    ]);
  });

  it("marks the entity needs-repair when the error-nack budget is exhausted (9.11a)", async () => {
    const harness = makeHarness();
    harness.store.upsertEntity({
      collection: "todos",
      data: {title: "server"},
      id: "t1",
      seq: 2,
      stream: "todos|owner:u1",
    });
    enqueue(harness, {
      baseVersion: 2,
      entityId: "t1",
      mutationId: "m1",
      operation: "update",
    });
    harness.transport.setDefaultResponder((request) => ({
      nack: {code: "error", mutationId: request.mutationId},
      type: "nack",
    }));

    for (let attempt = 1; attempt <= MAX_ERROR_NACK_ATTEMPTS; attempt += 1) {
      harness.clock.value += MAX_BACKOFF_MS;
      await harness.coordinator.replay({userId: USER});
    }
    expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("failed");
    expect(harness.store.hasNeedsRepair({collection: "todos", entityId: "t1"})).toBe(true);
  });

  it("passes the released entity to the repair hook with its needs-repair mark already set (9.11a)", async () => {
    const store = createSyncStore({collections: ["notes", "todos"]});
    const outbox = createOutbox({store});
    const transport = createFakeTransport();
    const markedWhenNotified: boolean[] = [];
    const coordinator = createReplayCoordinator({
      onEntityReleasedWithoutServerAck: (mutation) => {
        markedWhenNotified.push(
          store.hasNeedsRepair({collection: mutation.collection, entityId: mutation.entityId})
        );
      },
      outbox,
      sendMutation: transport.sendMutation,
      store,
    });
    const harness: Harness = {clock: {value: 0}, coordinator, outbox, store, transport};
    enqueue(harness, {entityId: "t1", mutationId: "m1", operation: "update"});
    transport.respondWithNack({code: "validation"});

    await coordinator.replay({userId: USER});
    expect(markedWhenNotified).toEqual([true]);
  });

  it("error nacks requeue with exponential backoff and block the collection head", async () => {
    const harness = makeHarness();
    enqueue(harness, {entityId: "t1", mutationId: "m1"});
    enqueue(harness, {entityId: "t2", mutationId: "m2"});
    harness.transport.respondWithNack({code: "error"});

    await harness.coordinator.replay({userId: USER});
    expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("queued");
    // FIFO: m2 is not sent while the head is backing off.
    expect(harness.transport.sentMutations.map((m) => m.mutationId)).toEqual(["m1"]);

    // Within the backoff window nothing is retried.
    await harness.coordinator.replay({userId: USER});
    expect(harness.transport.sentMutations).toHaveLength(1);

    // After the first backoff delay elapses, the head retries and the queue drains.
    harness.clock.value += ERROR_NACK_BASE_BACKOFF_MS;
    await harness.coordinator.replay({userId: USER});
    expect(harness.transport.sentMutations.map((m) => m.mutationId)).toEqual(["m1", "m1", "m2"]);
    expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("acked");
    expect(harness.outbox.getMutation({mutationId: "m2"})?.status).toBe("acked");
  });

  it("fails terminally after one error nack when maxAttempts is 1", async () => {
    const harness = makeHarness();
    enqueue(harness, {entityId: "t1", maxAttempts: 1, mutationId: "m1"});
    harness.transport.setDefaultResponder((request) => ({
      nack: {code: "error", mutationId: request.mutationId},
      type: "nack",
    }));

    await harness.coordinator.replay({userId: USER});
    expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("failed");
    expect(harness.transport.sentMutations).toHaveLength(1);
  });

  it("fails terminally after three error nacks when maxAttempts is 3", async () => {
    const harness = makeHarness();
    enqueue(harness, {entityId: "t1", maxAttempts: 3, mutationId: "m1"});
    harness.transport.setDefaultResponder((request) => ({
      nack: {code: "error", mutationId: request.mutationId},
      type: "nack",
    }));

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await harness.coordinator.replay({userId: USER});
      harness.clock.value += ERROR_NACK_BASE_BACKOFF_MS * 2 ** attempt;
    }
    expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("failed");
    expect(harness.transport.sentMutations).toHaveLength(3);
  });

  it(`marks failed after ${MAX_ERROR_NACK_ATTEMPTS} error-nack attempts`, async () => {
    const harness = makeHarness();
    enqueue(harness, {entityId: "t1", mutationId: "m1"});
    harness.transport.setDefaultResponder((request) => ({
      nack: {code: "error", mutationId: request.mutationId},
      type: "nack",
    }));

    for (let attempt = 1; attempt <= MAX_ERROR_NACK_ATTEMPTS; attempt += 1) {
      await harness.coordinator.replay({userId: USER});
      // Jump past any backoff so the next attempt is eligible.
      harness.clock.value += ERROR_NACK_BASE_BACKOFF_MS * 2 ** attempt;
    }
    expect(harness.transport.sentMutations).toHaveLength(MAX_ERROR_NACK_ATTEMPTS);
    expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("failed");
    expect(
      harness.store.getEntity({collection: "todos", id: "t1"})?.pendingMutationId
    ).toBeUndefined();

    // Terminal: further replays never resend it.
    harness.clock.value += ERROR_NACK_BASE_BACKOFF_MS * 100;
    await harness.coordinator.replay({userId: USER});
    expect(harness.transport.sentMutations).toHaveLength(MAX_ERROR_NACK_ATTEMPTS);
  });

  it("marks failed after one error-nack when maxAttempts is 1", async () => {
    const harness = makeHarness();
    enqueue(harness, {entityId: "t1", maxAttempts: 1, mutationId: "m1"});
    harness.transport.setDefaultResponder((request) => ({
      nack: {code: "error", mutationId: request.mutationId},
      type: "nack",
    }));

    await harness.coordinator.replay({userId: USER});
    expect(harness.transport.sentMutations).toHaveLength(1);
    expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("failed");
  });

  it("marks failed after three error-nack attempts when maxAttempts is 3", async () => {
    const harness = makeHarness();
    enqueue(harness, {entityId: "t1", maxAttempts: 3, mutationId: "m1"});
    harness.transport.setDefaultResponder((request) => ({
      nack: {code: "error", mutationId: request.mutationId},
      type: "nack",
    }));

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await harness.coordinator.replay({userId: USER});
      harness.clock.value += ERROR_NACK_BASE_BACKOFF_MS * 2 ** attempt;
    }
    expect(harness.transport.sentMutations).toHaveLength(3);
    expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("failed");
  });

  it("a concurrent replay for the same user returns the in-flight promise", async () => {
    const harness = makeHarness();
    enqueue(harness, {entityId: "t1", mutationId: "m1"});
    let release: (() => void) | undefined;
    harness.transport.respondWith(async (request: SyncMutateRequest) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {ack: {id: request.id ?? "", mutationId: request.mutationId, seq: 1}, type: "ack"};
    });

    const first = harness.coordinator.replay({userId: USER});
    const second = harness.coordinator.replay({userId: USER});
    expect(second).toBe(first);
    release?.();
    await first;
    expect(harness.transport.sentMutations).toHaveLength(1);

    // After completion a new replay starts fresh.
    const third = harness.coordinator.replay({userId: USER});
    expect(third).not.toBe(first);
    await third;
  });

  it("only replays mutations belonging to the requested user", async () => {
    const harness = makeHarness();
    enqueue(harness, {entityId: "t1", mutationId: "m1", userId: "someone-else"});
    enqueue(harness, {entityId: "t2", mutationId: "m2"});

    await harness.coordinator.replay({userId: USER});
    expect(harness.transport.sentMutations.map((m) => m.mutationId)).toEqual(["m2"]);
    expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("queued");
  });

  it("tolerates unparseable stored args by sending empty data", async () => {
    const harness = makeHarness();
    harness.store.upsertEntity({
      collection: "todos",
      data: null,
      id: "t1",
      pendingMutationId: "m1",
    });
    harness.outbox.enqueue({
      args: {},
      collection: "todos",
      entityId: "t1",
      mutationId: "m1",
      operation: "create",
      userId: USER,
    });
    harness.store.raw.setCell("_outbox", "m1", "args", "{not json");

    await harness.coordinator.replay({userId: USER});
    expect(harness.transport.sentMutations[0]?.data).toEqual({});
  });

  describe("real scheduler: drain-until-empty + timed wake-ups + jittered backoff (A3)", () => {
    it("sends a mutation enqueued during an active drain, within the same replay() call", async () => {
      const store = createSyncStore({collections: ["todos"]});
      const outbox = createOutbox({store});
      const transport = createFakeTransport();
      let armedSecond = false;
      transport.respondWith(async (request) => {
        // Enqueue m2 WHILE m1's send is in flight — before the drain loop's
        // "is the queue now empty" recheck runs.
        if (!armedSecond) {
          armedSecond = true;
          outbox.enqueue({
            args: {title: "t2"},
            collection: "todos",
            entityId: "t2",
            mutationId: "m2",
            operation: "create",
            userId: USER,
          });
        }
        return {ack: {id: request.id ?? "", mutationId: request.mutationId, seq: 1}, type: "ack"};
      });
      const coordinator = createReplayCoordinator({
        outbox,
        sendMutation: transport.sendMutation,
        store,
      });
      outbox.enqueue({
        args: {title: "t1"},
        collection: "todos",
        entityId: "t1",
        mutationId: "m1",
        operation: "create",
        userId: USER,
      });

      await coordinator.replay({userId: USER});
      expect(transport.sentMutations.map((m) => m.mutationId)).toEqual(["m1", "m2"]);
      expect(outbox.getMutation({mutationId: "m2"})?.status).toBe("acked");
    });

    it("an error-nack backoff elapsing fires the retry from the armed timer alone (no external trigger)", async () => {
      const store = createSyncStore({collections: ["todos"]});
      const outbox = createOutbox({store});
      const transport = createFakeTransport();
      const clock = {value: 1_000_000};
      const {timers, ...timerArgs} = makeFakeTimers(clock);
      const coordinator = createReplayCoordinator({
        ...timerArgs,
        now: () => clock.value,
        outbox,
        random: () => 0.999999, // near-max jitter for a deterministic wake delay
        sendMutation: transport.sendMutation,
        store,
      });
      outbox.enqueue({
        args: {title: "t1"},
        collection: "todos",
        entityId: "t1",
        mutationId: "m1",
        operation: "create",
        userId: USER,
      });
      transport.respondWithNack({code: "error"});

      await coordinator.replay({userId: USER});
      expect(outbox.getMutation({mutationId: "m1"})?.status).toBe("queued");
      expect(transport.sentMutations).toHaveLength(1);
      expect(timers.armedCount()).toBe(1);

      // Advance the clock past the backoff and fire the armed timer directly —
      // no replay()/replayOutbox() call from the test.
      clock.value += ERROR_NACK_BASE_BACKOFF_MS;
      timers.flush();
      await Promise.resolve();
      await Promise.resolve();
      expect(transport.sentMutations.map((m) => m.mutationId)).toEqual(["m1", "m1"]);
      expect(outbox.getMutation({mutationId: "m1"})?.status).toBe("acked");
    });

    it("transport failures get unlimited retries (never terminal) and don't burn the error-nack budget; a subsequent error-nack budget starts at 1", async () => {
      const harness = makeHarness();
      enqueue(harness, {entityId: "t1", mutationId: "m1"});
      harness.transport.setDefaultResponder(() => {
        throw new Error("network down");
      });

      // Ten transport failures — still queued, never terminal, attemptCount
      // climbs but errorNackCount (the terminality budget) stays at 0.
      for (let i = 0; i < 10; i += 1) {
        await harness.coordinator.replay({userId: USER});
        harness.clock.value += MAX_BACKOFF_MS;
      }
      const afterTransportFailures = harness.outbox.getMutation({mutationId: "m1"});
      expect(afterTransportFailures?.status).toBe("queued");
      expect(afterTransportFailures?.errorNackCount).toBe(0);
      expect(afterTransportFailures?.attemptCount).toBe(10);

      // Now the server responds with a real error-nack: its budget starts at 1,
      // not at 10 (proving the two counters are tracked separately).
      harness.transport.setDefaultResponder((request) => ({
        nack: {code: "error", mutationId: request.mutationId},
        type: "nack",
      }));
      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "m1"})?.errorNackCount).toBe(1);
    });

    it("rate_limited nacks are treated exactly like a transport failure: unlimited retries, zero errorNackCount burn (FIX 1)", async () => {
      const harness = makeHarness();
      enqueue(harness, {entityId: "t1", mutationId: "m1"});
      harness.transport.setDefaultResponder((request) => ({
        nack: {code: "rate_limited", mutationId: request.mutationId, retryAfterMs: 500},
        type: "nack",
      }));

      // Five-plus rate-limit nacks — more than MAX_ERROR_NACK_ATTEMPTS would
      // ever tolerate for a real error-nack — must never go terminal.
      for (let i = 0; i < 6; i += 1) {
        const result = await harness.coordinator.replay({userId: USER});
        expect(result).toEqual({});
        harness.clock.value += MAX_BACKOFF_MS;
      }
      const mutation = harness.outbox.getMutation({mutationId: "m1"});
      expect(mutation?.status).toBe("queued");
      expect(mutation?.errorNackCount).toBe(0);

      // Once the server allows it through, the mutation drains successfully.
      harness.transport.setDefaultResponder();
      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("acked");
    });

    it("rate_limited respects retryAfterMs as a backoff floor — no retry before the server's window clears", async () => {
      const harness = makeHarness();
      enqueue(harness, {entityId: "t1", mutationId: "m1"});
      harness.transport.respondWithNack({code: "rate_limited", retryAfterMs: 10_000});

      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("queued");
      expect(harness.transport.sentMutations).toHaveLength(1);

      // A jittered backoff well under the server's floor must not fire yet.
      harness.transport.setDefaultResponder();
      harness.clock.value += 1_000;
      await harness.coordinator.replay({userId: USER});
      expect(harness.transport.sentMutations).toHaveLength(1);

      // Past the 10s floor, the armed wake-up (or an explicit replay) retries.
      harness.clock.value += 10_000;
      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("acked");
    });

    it("a rate_limited chunk response requeues the WHOLE batch untouched and halts the drain (FIX 1, batch path)", async () => {
      const harness = makeBatchHarness();
      enqueue(harness, {entityId: "e1", mutationId: "m1"});
      enqueue(harness, {entityId: "e2", mutationId: "m2"});
      harness.transport.setBatchResponder((request) => ({
        results: request.mutations.map((mutation) => ({
          nack: {code: "rate_limited" as const, mutationId: mutation.mutationId, retryAfterMs: 200},
          type: "nack" as const,
        })),
        type: "results",
      }));

      await harness.coordinator.replay({userId: USER});
      for (const id of ["m1", "m2"]) {
        const mutation = harness.outbox.getMutation({mutationId: id});
        expect(mutation?.status).toBe("queued");
        expect(mutation?.errorNackCount).toBe(0);
      }

      harness.transport.setBatchResponder();
      harness.clock.value += 1_000;
      await harness.coordinator.replay({userId: USER});
      for (const id of ["m1", "m2"]) {
        expect(harness.outbox.getMutation({mutationId: id})?.status).toBe("acked");
      }
    });

    it("jitter: two backoffs for the same attempt differ under an injected seeded random source", async () => {
      const seeds = [0.1, 0.9];
      let call = 0;
      const transport = createFakeTransport();
      const clock = {value: 1_000_000};
      const delays: number[] = [];

      // A fresh store/outbox/coordinator per mutation isolates each one's
      // "attempt 1" backoff so both draw from the seeded random source below.
      for (const id of ["m1", "m2"]) {
        const store = createSyncStore({collections: ["todos"]});
        const outbox = createOutbox({store});
        const coordinator = createReplayCoordinator({
          now: () => clock.value,
          outbox,
          random: () => seeds[call++] ?? 0.5,
          sendMutation: transport.sendMutation,
          setTimeoutFn: (_handler, ms) => {
            delays.push(ms);
            return 0;
          },
          store,
        });
        outbox.enqueue({
          args: {},
          collection: "todos",
          entityId: id,
          mutationId: id,
          operation: "create",
          userId: USER,
        });
        transport.respondWithNack({code: "error"});
        await coordinator.replay({userId: USER});
      }
      expect(delays).toHaveLength(2);
      expect(delays[0]).not.toBe(delays[1]);
    });

    it("global order: mutations across two collections replay strictly in enqueue order", async () => {
      const harness = makeHarness();
      enqueue(harness, {collection: "todos", entityId: "t1", mutationId: "m1"});
      enqueue(harness, {collection: "notes", entityId: "n1", mutationId: "m2"});
      enqueue(harness, {collection: "todos", entityId: "t2", mutationId: "m3"});
      enqueue(harness, {collection: "notes", entityId: "n2", mutationId: "m4"});

      await harness.coordinator.replay({userId: USER});
      expect(harness.transport.sentMutations.map((m) => m.mutationId)).toEqual([
        "m1",
        "m2",
        "m3",
        "m4",
      ]);
    });

    it("dispose() clears armed timers so nothing sends after stop", async () => {
      const store = createSyncStore({collections: ["todos"]});
      const outbox = createOutbox({store});
      const transport = createFakeTransport();
      const clock = {value: 1_000_000};
      const {timers, ...timerArgs} = makeFakeTimers(clock);
      const coordinator = createReplayCoordinator({
        ...timerArgs,
        now: () => clock.value,
        outbox,
        sendMutation: transport.sendMutation,
        store,
      });
      outbox.enqueue({
        args: {},
        collection: "todos",
        entityId: "t1",
        mutationId: "m1",
        operation: "create",
        userId: USER,
      });
      transport.respondWithNack({code: "error"});

      await coordinator.replay({userId: USER});
      expect(timers.armedCount()).toBe(1);

      coordinator.dispose({userId: USER});
      expect(timers.armedCount()).toBe(0);

      // Even if the clock advances past the backoff, nothing fires — the
      // timer was cleared, not just superseded.
      clock.value += ERROR_NACK_BASE_BACKOFF_MS * 10;
      timers.flush();
      await Promise.resolve();
      expect(transport.sentMutations).toHaveLength(1);
    });

    it("skips the debug-only listQueued scan when debug logging is disabled", async () => {
      const harness = makeHarness();
      expect(harness.coordinator).toBeDefined();
      // No debug log was configured for this harness; replay must not throw or
      // require one — the debug-only scan path is conditional on its presence.
      await harness.coordinator.replay({userId: USER});
    });
  });

  describe("batched drain on top of the global FIFO (B3)", () => {
    const enqueueN = (
      harness: Harness,
      count: number,
      {collection = "todos", prefix = "m"}: {collection?: string; prefix?: string} = {}
    ): void => {
      for (let i = 0; i < count; i++) {
        enqueue(harness, {collection, entityId: `${prefix}-e${i}`, mutationId: `${prefix}-${i}`});
      }
    };

    it("120 queued across 2 collections drains in exactly 3 batch round-trips, order preserved", async () => {
      const harness = makeBatchHarness();
      // Interleave two collections in enqueue order so global FIFO ordering is
      // actually exercised, not just per-collection ordering.
      for (let i = 0; i < 60; i++) {
        enqueue(harness, {collection: "todos", entityId: `t-e${i}`, mutationId: `t-${i}`});
        enqueue(harness, {collection: "notes", entityId: `n-e${i}`, mutationId: `n-${i}`});
      }
      await harness.coordinator.replay({userId: USER});
      expect(harness.transport.sentBatches).toHaveLength(3);
      // Default batchSize is 50: 120 mutations drain as 50 + 50 + 20.
      expect(harness.transport.sentBatches.map((batch) => batch.length)).toEqual([50, 50, 20]);
      // Global enqueue order preserved across the whole drain, not just within
      // a chunk — assert via server-assigned seq order.
      const allMutationIds = harness.transport.sentBatches.flat();
      expect(allMutationIds).toHaveLength(120);
      for (const id of allMutationIds) {
        expect(harness.outbox.getMutation({mutationId: id})?.status).toBe("acked");
      }
      // Cross-check enqueue order: the Nth mutation sent must be the Nth
      // enqueued (t-0, n-0, t-1, n-1, ...).
      const expectedOrder: string[] = [];
      for (let i = 0; i < 60; i++) {
        expectedOrder.push(`t-${i}`, `n-${i}`);
      }
      expect(allMutationIds).toEqual(expectedOrder);
    });

    it("at most one mutation per entity per chunk: a second mutation for an already-included entity cuts the chunk short", async () => {
      const harness = makeBatchHarness();
      enqueue(harness, {entityId: "a", mutationId: "m1", operation: "create"});
      enqueue(harness, {entityId: "shared", mutationId: "m2", operation: "create"});
      harness.outbox.enqueue({
        args: {title: "v2"},
        collection: "todos",
        entityId: "shared",
        mutationId: "m3",
        operation: "update",
        userId: USER,
      });
      enqueue(harness, {entityId: "other", mutationId: "m4"});

      await harness.coordinator.replay({userId: USER});
      // m1 and m2 (distinct entities) fill the first chunk; m3 (second
      // mutation for "shared", already in this chunk via m2) cuts it short —
      // m4 is deferred behind the cut too, preserving global FIFO order
      // (INV-1) rather than reordering around it. Once m1/m2 ack, the
      // remaining queue is [m3, m4] — distinct entities, so they batch
      // together in a second chunk (m3 now carries the fresh A2 base).
      expect(harness.transport.sentBatches[0]).toEqual(["m1", "m2"]);
      expect(harness.transport.sentBatches[1]).toEqual(["m3", "m4"]);
      for (const id of ["m1", "m2", "m3", "m4"]) {
        expect(harness.outbox.getMutation({mutationId: id})?.status).toBe("acked");
      }
    });

    it("respects a configured batchSize", async () => {
      const harness = makeBatchHarness({batchSize: 10});
      enqueueN(harness, 25);
      await harness.coordinator.replay({userId: USER});
      expect(harness.transport.sentBatches.map((b) => b.length)).toEqual([10, 10, 5]);
    });

    it("capability detection: HTTP-style unsupported response falls back to single sends after 2 CONSECUTIVE strikes (FIX 5), re-probed after reconnect", async () => {
      const harness = makeBatchHarness();
      harness.transport.setBatchResponder(() => ({type: "unsupported"}));
      enqueueN(harness, 5);

      await harness.coordinator.replay({userId: USER});
      // FIX 5: a single unsupported result must not latch — it takes 2
      // CONSECUTIVE unsupported results (the same 5-mutation chunk retried
      // once) before falling back to single sends, still in FIFO order.
      expect(harness.transport.sentBatches).toHaveLength(2);
      expect(harness.transport.sentMutations.map((m) => m.mutationId)).toEqual([
        "m-0",
        "m-1",
        "m-2",
        "m-3",
        "m-4",
      ]);
      for (let i = 0; i < 5; i++) {
        expect(harness.outbox.getMutation({mutationId: `m-${i}`})?.status).toBe("acked");
      }

      // Further mutations on the SAME connection keep using single sends —
      // batching is not re-probed until a reconnect (or the 60s timer).
      enqueueN(harness, 2, {prefix: "later"});
      await harness.coordinator.replay({userId: USER});
      expect(harness.transport.sentBatches).toHaveLength(2);

      // Re-probe after reconnect: batching works again.
      harness.transport.setBatchResponder();
      harness.coordinator.notifyReconnect();
      enqueueN(harness, 3, {prefix: "reconnected"});
      await harness.coordinator.replay({userId: USER});
      expect(harness.transport.sentBatches).toHaveLength(3);
      expect(harness.transport.sentBatches[2]).toEqual([
        "reconnected-0",
        "reconnected-1",
        "reconnected-2",
      ]);
    });

    it("a single stray unsupported result does not latch — the very next batch send on the same connection succeeds normally (FIX 5)", async () => {
      const harness = makeBatchHarness();
      enqueueN(harness, 4);
      let calls = 0;
      harness.transport.setBatchResponder((request) => {
        calls += 1;
        if (calls === 1) {
          return {type: "unsupported"};
        }
        return {
          results: request.mutations.map((mutation) => ({
            ack: {id: mutation.id ?? "", mutationId: mutation.mutationId, seq: 1},
            type: "ack" as const,
          })),
          type: "results",
        };
      });

      await harness.coordinator.replay({userId: USER});
      // Two batch sends: the stray unsupported one, then a real one that
      // succeeds — never falling back to single sends.
      expect(harness.transport.sentBatches).toHaveLength(2);
      expect(harness.transport.sentMutations).toHaveLength(0);
      for (let i = 0; i < 4; i++) {
        expect(harness.outbox.getMutation({mutationId: `m-${i}`})?.status).toBe("acked");
      }

      // A later stray unsupported result also doesn't latch, since the
      // counter reset after the successful batch above.
      enqueueN(harness, 2, {prefix: "later"});
      calls = 0;
      await harness.coordinator.replay({userId: USER});
      expect(harness.transport.sentMutations).toHaveLength(0);
    });

    it("FIX 5: while latched, batching is re-probed on a 60s timer even without a reconnect", async () => {
      const store = createSyncStore({collections: ["todos"]});
      const outbox = createOutbox({store});
      const transport = createFakeTransport();
      const clock = {value: 1_000_000};
      const {timers, ...timerArgs} = makeFakeTimers(clock);
      transport.setBatchResponder(() => ({type: "unsupported"}));
      const coordinator = createReplayCoordinator({
        ...timerArgs,
        now: () => clock.value,
        outbox,
        sendMutation: transport.sendMutation,
        sendMutationBatch: transport.sendMutationBatch,
        store,
      });
      for (let i = 0; i < 3; i++) {
        outbox.enqueue({
          args: {title: `t${i}`},
          collection: "todos",
          entityId: `t${i}`,
          mutationId: `m${i}`,
          operation: "create",
          userId: USER,
        });
      }

      // Two consecutive unsupported batch sends latch batchUnsupported —
      // the coordinator falls back to single sends for the same mutations
      // (auto-ack default responder handles the single-send fallback).
      await coordinator.replay({userId: USER});
      expect(outbox.getMutation({mutationId: "m0"})?.status).toBe("acked");
      expect(transport.sentBatches).toHaveLength(2);
      expect(transport.sentMutations.map((m) => m.mutationId)).toEqual(["m0", "m1", "m2"]);

      // Latched: further mutations on this connection use single sends only.
      outbox.enqueue({
        args: {title: "later"},
        collection: "todos",
        entityId: "later",
        mutationId: "m-later",
        operation: "create",
        userId: USER,
      });
      await coordinator.replay({userId: USER});
      expect(transport.sentBatches).toHaveLength(2);

      // Advance past the 60s re-probe interval with NO reconnect — the armed
      // timer clears the latch on its own.
      clock.value += BATCH_UNSUPPORTED_REPROBE_INTERVAL_MS;
      timers.flush();
      transport.setBatchResponder((request) => ({
        results: request.mutations.map((mutation) => ({
          ack: {id: mutation.id ?? "", mutationId: mutation.mutationId, seq: 1},
          type: "ack" as const,
        })),
        type: "results",
      }));
      // Two mutations so the chunk genuinely exercises the batch path
      // (a lone eligible mutation reuses the single-send path regardless of
      // batchUnsupported — see the "lone chunk" comment in drainOnce).
      outbox.enqueue({
        args: {title: "reprobed-a"},
        collection: "todos",
        entityId: "reprobed-a",
        mutationId: "m-reprobed-a",
        operation: "create",
        userId: USER,
      });
      outbox.enqueue({
        args: {title: "reprobed-b"},
        collection: "todos",
        entityId: "reprobed-b",
        mutationId: "m-reprobed-b",
        operation: "create",
        userId: USER,
      });
      await coordinator.replay({userId: USER});
      expect(transport.sentBatches).toHaveLength(3);
      expect(transport.sentBatches[2]).toEqual(["m-reprobed-a", "m-reprobed-b"]);
    });

    it("short response (server halted mid-batch) requeues the tail untouched, never burning error-nack budget; next drain resends from the halt point", async () => {
      const harness = makeBatchHarness();
      enqueueN(harness, 5);
      harness.transport.respondBatchWith((request) => ({
        results: request.mutations.slice(0, 2).map((mutation) => ({
          ack: {id: mutation.id ?? "", mutationId: mutation.mutationId, seq: 1},
          type: "ack" as const,
        })),
        type: "results",
      }));

      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "m-0"})?.status).toBe("acked");
      expect(harness.outbox.getMutation({mutationId: "m-1"})?.status).toBe("acked");
      // m-2..m-4 got no result: requeued untouched. The short response halts
      // THIS replay() call (INV-1 — nothing after an unresolved halt point is
      // attempted this pass) rather than being immediately re-swept within
      // the same call.
      for (let i = 2; i < 5; i++) {
        const mutation = harness.outbox.getMutation({mutationId: `m-${i}`});
        expect(mutation?.status).toBe("queued");
        expect(mutation?.attemptCount).toBe(1); // markInFlight counted the attempt
        expect(mutation?.errorNackCount).toBe(0); // never treated as an error-nack
      }

      // The next drain (a fresh trigger) resends from the halt point; the
      // server ledger would dedupe any overlap (INV-3) — here nothing
      // overlaps since the tail was never actually applied.
      await harness.coordinator.replay({userId: USER});
      for (let i = 0; i < 5; i++) {
        expect(harness.outbox.getMutation({mutationId: `m-${i}`})?.status).toBe("acked");
      }
      // Applied exactly once: m-0..m-4 sent in the first (truncated) batch,
      // m-2..m-4 resent in a second batch — never duplicated in either.
      const allSent = harness.transport.sentBatches.flat();
      const counts = new Map<string, number>();
      for (const id of allSent) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      for (let i = 0; i < 5; i++) {
        expect(counts.get(`m-${i}`)).toBe(i < 2 ? 1 : 2);
      }
    });

    it("a lone eligible mutation in a chunk is sent as a single send, not a batch of one", async () => {
      const harness = makeBatchHarness();
      enqueue(harness, {entityId: "solo", mutationId: "solo-1"});
      await harness.coordinator.replay({userId: USER});
      expect(harness.transport.sentBatches).toHaveLength(0);
      expect(harness.transport.sentMutations.map((m) => m.mutationId)).toEqual(["solo-1"]);
      expect(harness.outbox.getMutation({mutationId: "solo-1"})?.status).toBe("acked");
    });
  });

  describe("stop-the-line policy (B4)", () => {
    it("mid-batch socket disconnect (transport rejection) re-queues the WHOLE chunk untouched and halts the drain", async () => {
      const harness = makeBatchHarness();
      const enqueueThree = (): void => {
        enqueue(harness, {entityId: "e1", mutationId: "m1"});
        enqueue(harness, {entityId: "e2", mutationId: "m2"});
        enqueue(harness, {entityId: "e3", mutationId: "m3"});
      };
      enqueueThree();
      harness.transport.setBatchResponder(() => {
        throw new Error("socket disconnected mid-batch");
      });

      await harness.coordinator.replay({userId: USER});
      for (const id of ["m1", "m2", "m3"]) {
        expect(harness.outbox.getMutation({mutationId: id})?.status).toBe("queued");
      }

      harness.transport.setBatchResponder();
      harness.clock.value += ERROR_NACK_BASE_BACKOFF_MS * 30;
      await harness.coordinator.replay({userId: USER});
      for (const id of ["m1", "m2", "m3"]) {
        expect(harness.outbox.getMutation({mutationId: id})?.status).toBe("acked");
      }
      // Applied exactly once: only one ack recorded per mutation across both
      // drains (the coordinator never double-applies a chunk).
      expect(harness.transport.sentMutations).toHaveLength(0);
      expect(harness.transport.sentBatches.flat().filter((id) => id === "m1")).toHaveLength(2);
    });

    it("a conflict blocks only its entity's later mutations; other entities keep draining", async () => {
      const harness = makeBatchHarness();
      // Entity X has two queued mutations (second must be blocked by the first's
      // conflict); entity Y has one and should proceed independently. Y is
      // enqueued BEFORE x2 so the first chunk (x1, y1 — distinct entities)
      // has length ≥ 2 and genuinely exercises the batch path rather than
      // degenerating into a lone single-send.
      enqueue(harness, {
        baseVersion: 1,
        entityId: "x",
        mutationId: "x1",
        operation: "update",
      });
      enqueue(harness, {entityId: "y", mutationId: "y1"});
      harness.outbox.enqueue({
        args: {title: "x-v2"},
        baseVersion: 1,
        collection: "todos",
        entityId: "x",
        mutationId: "x2",
        operation: "update",
        userId: USER,
      });

      harness.transport.setBatchResponder((request) => ({
        results: request.mutations.map((mutation) => {
          if (mutation.mutationId === "x1") {
            return {
              nack: {code: "conflict" as const, mutationId: mutation.mutationId, serverSeq: 9},
              type: "nack" as const,
            };
          }
          return {
            ack: {id: mutation.id ?? "", mutationId: mutation.mutationId, seq: 1},
            type: "ack" as const,
          };
        }),
        type: "results",
      }));

      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "x1"})?.status).toBe("conflicted");
      expect(harness.outbox.getMutation({mutationId: "y1"})?.status).toBe("acked");
      // x2 stays queued and blocked — it must never have been sent while x1's
      // conflict is unresolved.
      expect(harness.outbox.getMutation({mutationId: "x2"})?.status).toBe("queued");
      expect(harness.transport.sentBatches.flat()).not.toContain("x2");
      expect(harness.coordinator.getBlockedEntities({userId: USER})).toContain("todos:x");

      // A further replay call still skips x2 — it stays absent from
      // subsequent batches while the conflict is unresolved.
      harness.transport.setBatchResponder();
      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "x2"})?.status).toBe("queued");

      // Resolve the conflict (keepMine requeues under a fresh mutationId) —
      // x2 (now unblocked) drains in its original relative position.
      const {resolveConflict} = await import("../mutations/resolveConflict");
      resolveConflict({
        mutationId: "x1",
        outbox: harness.outbox,
        store: harness.store,
        strategy: "keepMine",
      });
      expect(harness.coordinator.getBlockedEntities({userId: USER})).not.toContain("todos:x");
      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "x2"})?.status).toBe("acked");
    });

    it("haltQueueOnConflict: true halts the entire drain — nothing after the conflict is sent at all", async () => {
      const harness = makeBatchHarness({haltQueueOnConflict: true});
      enqueue(harness, {baseVersion: 1, entityId: "x", mutationId: "x1", operation: "update"});
      enqueue(harness, {entityId: "y", mutationId: "y1"});
      enqueue(harness, {entityId: "z", mutationId: "z1"});

      // Realistic server behavior (B2 stop-on-first-non-ack): x1 is first in
      // the chunk and conflicts, so the server never attempts y1/z1 — the
      // response is truncated to just x1's nack.
      harness.transport.setBatchResponder((request) => ({
        results: [
          {
            nack: {
              code: "conflict" as const,
              mutationId: request.mutations[0].mutationId,
              serverSeq: 9,
            },
            type: "nack" as const,
          },
        ],
        type: "results",
      }));

      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "x1"})?.status).toBe("conflicted");
      // y1 and z1 got no result (server never attempted them) — requeued
      // untouched, and haltQueueOnConflict stops the drain from building a
      // follow-up chunk to retry them immediately.
      expect(harness.outbox.getMutation({mutationId: "y1"})?.status).toBe("queued");
      expect(harness.outbox.getMutation({mutationId: "z1"})?.status).toBe("queued");
      expect(harness.transport.sentBatches).toHaveLength(1);
    });

    it("haltQueueOnConflict also halts when the conflict is delivered via the single-send fallback (lone chunk)", async () => {
      // batchSize 1 forces every chunk to be a "lone eligible mutation",
      // which reuses the single-mutation send path (not a batch of one) —
      // haltQueueOnConflict must still stop the drain in that path.
      const harness = makeBatchHarness({batchSize: 1, haltQueueOnConflict: true});
      enqueue(harness, {baseVersion: 1, entityId: "x", mutationId: "x1", operation: "update"});
      enqueue(harness, {entityId: "y", mutationId: "y1"});
      harness.transport.respondWithNack({code: "conflict", serverSeq: 9});

      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "x1"})?.status).toBe("conflicted");
      expect(harness.outbox.getMutation({mutationId: "y1"})?.status).toBe("queued");
      expect(harness.transport.sentMutations.map((m) => m.mutationId)).toEqual(["x1"]);
    });

    it("validation failure: successors for that entity are skipped and surfaced; retryFailed re-enables them", async () => {
      const harness = makeBatchHarness();
      // "good" is enqueued BEFORE b2 so the first chunk (b1, g1 — distinct
      // entities) has length ≥ 2 and genuinely exercises the batch path.
      enqueue(harness, {entityId: "bad", mutationId: "b1"});
      enqueue(harness, {entityId: "good", mutationId: "g1"});
      harness.outbox.enqueue({
        args: {title: "b2"},
        collection: "todos",
        entityId: "bad",
        mutationId: "b2",
        operation: "update",
        userId: USER,
      });

      harness.transport.setBatchResponder((request) => ({
        results: request.mutations.map((mutation) =>
          mutation.mutationId === "b1"
            ? {
                nack: {code: "validation" as const, mutationId: mutation.mutationId},
                type: "nack" as const,
              }
            : {
                ack: {id: mutation.id ?? "", mutationId: mutation.mutationId, seq: 1},
                type: "ack" as const,
              }
        ),
        type: "results",
      }));

      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "b1"})?.status).toBe("failed");
      expect(harness.outbox.getMutation({mutationId: "g1"})?.status).toBe("acked");
      // b2 is skipped-and-surfaced: stays queued, never sent.
      expect(harness.outbox.getMutation({mutationId: "b2"})?.status).toBe("queued");
      expect(harness.transport.sentBatches.flat()).not.toContain("b2");
      expect(harness.coordinator.getBlockedEntities({userId: USER})).toContain("todos:bad");

      // retryFailed re-enables the entity's queued successors.
      harness.coordinator.retryFailed({entityId: "bad"});
      expect(harness.coordinator.getBlockedEntities({userId: USER})).not.toContain("todos:bad");
      harness.transport.setBatchResponder();
      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "b2"})?.status).toBe("acked");
    });

    it("FIX 2: a cross-collection reference to a blocked entity's id is also blocked, and unblocks with its root", async () => {
      // P (create project, conflicts) and T (create todo in another collection,
      // args reference P's id) — T must never drain while P is blocked, even
      // though T's own entity has no conflict of its own. Y is an unrelated
      // entity enqueued alongside P so P's own chunk has length >= 2 and
      // genuinely exercises the batch path rather than degenerating into a
      // lone single-send (the FIX 2 same-batch guard excludes T from P's
      // chunk since T references P, whose outcome isn't known yet).
      const harness = makeBatchHarness();
      enqueue(harness, {collection: "notes", entityId: "p", mutationId: "p1"});
      enqueue(harness, {entityId: "y", mutationId: "y1"});
      harness.outbox.enqueue({
        args: {projectId: "p", title: "todo referencing p"},
        collection: "todos",
        entityId: "t",
        mutationId: "t1",
        operation: "create",
        userId: USER,
      });
      harness.store.upsertEntity({
        collection: "todos",
        data: {projectId: "p", title: "todo referencing p"},
        id: "t",
        pendingMutationId: "t1",
      });

      harness.transport.setBatchResponder((request) => ({
        results: request.mutations.map((mutation) =>
          mutation.mutationId === "p1"
            ? {
                nack: {code: "conflict" as const, mutationId: mutation.mutationId, serverSeq: 3},
                type: "nack" as const,
              }
            : {
                ack: {id: mutation.id ?? "", mutationId: mutation.mutationId, seq: 1},
                type: "ack" as const,
              }
        ),
        type: "results",
      }));

      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "p1"})?.status).toBe("conflicted");
      expect(harness.outbox.getMutation({mutationId: "y1"})?.status).toBe("acked");
      // t1 was never sent — it stays queued, budgets untouched.
      expect(harness.outbox.getMutation({mutationId: "t1"})?.status).toBe("queued");
      expect(harness.outbox.getMutation({mutationId: "t1"})?.errorNackCount).toBe(0);
      expect(harness.transport.sentBatches.flat()).not.toContain("t1");
      expect(harness.coordinator.getBlockedEntities({userId: USER})).toContain("notes:p");
      expect(harness.coordinator.getBlockedEntities({userId: USER})).toContain("todos:t");

      // A further replay still skips t1 while p is blocked.
      harness.transport.setBatchResponder();
      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "t1"})?.status).toBe("queued");

      // Resolving p (keepMine requeues under a fresh mutationId) naturally
      // unblocks t on the next drain — no persisted dependency graph needed.
      const {resolveConflict} = await import("../mutations/resolveConflict");
      resolveConflict({
        mutationId: "p1",
        outbox: harness.outbox,
        store: harness.store,
        strategy: "keepMine",
      });
      expect(harness.coordinator.getBlockedEntities({userId: USER})).not.toContain("todos:t");
      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "t1"})?.status).toBe("acked");
    });

    it("FIX 2: reference blocking is conservative — a nested/array reference to a blocked id is also caught", async () => {
      const harness = makeBatchHarness();
      enqueue(harness, {collection: "notes", entityId: "p", mutationId: "p1"});
      enqueue(harness, {entityId: "y", mutationId: "y1"});
      harness.outbox.enqueue({
        args: {meta: {tags: ["x", "p"]}, title: "nested ref"},
        collection: "todos",
        entityId: "t",
        mutationId: "t1",
        operation: "create",
        userId: USER,
      });

      harness.transport.setBatchResponder((request) => ({
        results: request.mutations.map((mutation) =>
          mutation.mutationId === "p1"
            ? {
                nack: {code: "conflict" as const, mutationId: mutation.mutationId, serverSeq: 3},
                type: "nack" as const,
              }
            : {
                ack: {id: mutation.id ?? "", mutationId: mutation.mutationId, seq: 1},
                type: "ack" as const,
              }
        ),
        type: "results",
      }));

      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "t1"})?.status).toBe("queued");
    });

    it("FIX 3: coordinator lifecycle scoping — reset() clears all state so a different user reusing a blocked entity id is unaffected", async () => {
      const harness = makeHarness();
      enqueue(harness, {entityId: "singleton", mutationId: "m1"});
      harness.transport.respondWithNack({code: "validation", message: "bad"});
      await harness.coordinator.replay({userId: USER});
      // A queued successor keeps the block observable (FIX 4: a block with no
      // queued successor is GC'd immediately — see the FIX 4 tests below).
      harness.outbox.enqueue({
        args: {title: "v2"},
        collection: "todos",
        entityId: "singleton",
        mutationId: "m1b",
        operation: "update",
        userId: USER,
      });
      expect(harness.coordinator.getBlockedEntities({userId: USER})).toContain("todos:singleton");

      // Lifecycle boundary: dispose()/reset() as client.ts wires on a
      // different-user login wipe path.
      harness.coordinator.reset();

      // A brand-new user reusing the same deterministic entity id must never
      // be falsely blocked by the previous user's stale in-memory state.
      const OTHER_USER = "user-2";
      harness.outbox.enqueue({
        args: {title: "fresh"},
        collection: "todos",
        entityId: "singleton",
        mutationId: "m2",
        operation: "create",
        userId: OTHER_USER,
      });
      harness.transport.respondWithAck({seq: 1});
      await harness.coordinator.replay({userId: OTHER_USER});
      expect(harness.outbox.getMutation({mutationId: "m2"})?.status).toBe("acked");
      expect(harness.coordinator.getBlockedEntities({userId: OTHER_USER})).toHaveLength(0);
    });

    it("FIX 3: validationBlockedEntities is keyed per-user — one user's block never leaks to another", async () => {
      const harness = makeHarness();
      const OTHER_USER = "user-2";
      enqueue(harness, {entityId: "shared-id", mutationId: "m1", userId: USER});
      harness.transport.respondWithNack({code: "validation", message: "bad"});
      await harness.coordinator.replay({userId: USER});
      // A queued successor keeps USER's block observable (FIX 4).
      harness.outbox.enqueue({
        args: {title: "v2"},
        collection: "todos",
        entityId: "shared-id",
        mutationId: "m1b",
        operation: "update",
        userId: USER,
      });
      expect(harness.coordinator.getBlockedEntities({userId: USER})).toContain("todos:shared-id");

      // Same entity id, different user: must drain freely, unaffected by
      // USER's block, and must not appear in USER's blocked list.
      harness.outbox.enqueue({
        args: {title: "other user's doc"},
        collection: "todos",
        entityId: "shared-id",
        mutationId: "m2",
        operation: "create",
        userId: OTHER_USER,
      });
      harness.transport.respondWithAck({seq: 7});
      await harness.coordinator.replay({userId: OTHER_USER});
      expect(harness.outbox.getMutation({mutationId: "m2"})?.status).toBe("acked");
      expect(harness.coordinator.getBlockedEntities({userId: OTHER_USER})).toHaveLength(0);
      // USER's own block is untouched by the other user's activity.
      expect(harness.coordinator.getBlockedEntities({userId: USER})).toContain("todos:shared-id");
    });

    it("FIX 4: a validation block with no queued successor is GC'd once its failed row is pruned, letting a later NEW mutation for that entity drain", async () => {
      const harness = makeHarness();
      enqueue(harness, {entityId: "e1", mutationId: "m1"});
      harness.transport.respondWithNack({code: "validation", message: "bad"});
      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("failed");
      // The failed row still exists (not yet pruned) with no successor
      // queued — the block surfaces the failure until the user acts or the
      // row ages out, exactly like the pre-FIX-4 behavior.
      expect(harness.coordinator.getBlockedEntities({userId: USER})).toContain("todos:e1");

      // Prune (removes the failed row — keepFailed: 0 forces it out here;
      // the default keepFailed of 50 would keep a single row around, which
      // is exactly the realistic "not pruned yet" case already covered
      // above): with NO queued successor left to protect the ordering of,
      // the block is now stale — GC'd, so a brand new mutation for the same
      // entity is free to drain rather than being quarantined forever
      // pending an explicit retryFailed the user may never call.
      harness.outbox.prune({keepFailed: 0, userId: USER});
      expect(harness.coordinator.getBlockedEntities({userId: USER})).not.toContain("todos:e1");
      harness.outbox.enqueue({
        args: {title: "fresh attempt"},
        collection: "todos",
        entityId: "e1",
        mutationId: "m2",
        operation: "create",
        userId: USER,
      });
      harness.transport.respondWithAck({seq: 1});
      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "m2"})?.status).toBe("acked");
    });

    it("FIX 4: a validation block WITH a queued successor stays blocked until retryFailed, surviving prune of the failed row", async () => {
      const harness = makeHarness();
      enqueue(harness, {entityId: "e1", mutationId: "m1"});
      harness.transport.respondWithNack({code: "validation", message: "bad"});
      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("failed");

      // A successor is queued before anything prunes the failed row.
      harness.outbox.enqueue({
        args: {title: "v2"},
        collection: "todos",
        entityId: "e1",
        mutationId: "m2",
        operation: "update",
        userId: USER,
      });
      expect(harness.coordinator.getBlockedEntities({userId: USER})).toContain("todos:e1");

      // Pruning the failed row (keepFailed: 0 forces it out) must not drop
      // the block while m2 is queued.
      harness.outbox.prune({keepFailed: 0, userId: USER});
      expect(harness.outbox.getMutation({mutationId: "m1"})).toBeUndefined();
      expect(harness.coordinator.getBlockedEntities({userId: USER})).toContain("todos:e1");
      harness.transport.setDefaultResponder();
      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "m2"})?.status).toBe("queued");

      harness.coordinator.retryFailed({entityId: "e1"});
      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "m2"})?.status).toBe("acked");
    });

    it("error nack halts the whole drain (transient — retry without user action)", async () => {
      const harness = makeBatchHarness();
      enqueue(harness, {entityId: "e1", mutationId: "m1"});
      enqueue(harness, {entityId: "e2", mutationId: "m2"});
      harness.transport.setBatchResponder((request) => ({
        results: request.mutations.map((mutation) => ({
          nack: {code: "error" as const, mutationId: mutation.mutationId},
          type: "nack" as const,
        })),
        type: "results",
      }));

      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("queued");
      expect(harness.outbox.getMutation({mutationId: "m2"})?.status).toBe("queued");

      harness.transport.setBatchResponder();
      harness.clock.value += ERROR_NACK_BASE_BACKOFF_MS * 30;
      await harness.coordinator.replay({userId: USER});
      expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("acked");
      expect(harness.outbox.getMutation({mutationId: "m2"})?.status).toBe("acked");
    });

    it("unauthorized halts everything and enters auth pause with no data touched", async () => {
      const harness = makeBatchHarness();
      enqueue(harness, {entityId: "e1", mutationId: "m1"});
      enqueue(harness, {entityId: "e2", mutationId: "m2"});
      // Realistic server behavior (B2 stop-on-first-non-ack): the response is
      // truncated at the first nack — m2 gets no result at all, not a second
      // nack, since the server never attempted it.
      harness.transport.setBatchResponder((request) => ({
        results: [
          {
            nack: {code: "unauthorized" as const, mutationId: request.mutations[0].mutationId},
            type: "nack" as const,
          },
        ],
        type: "results",
      }));

      const result = await harness.coordinator.replay({userId: USER});
      expect(result).toEqual({paused: "auth"});
      expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("queued");
      expect(harness.outbox.getMutation({mutationId: "m2"})?.status).toBe("queued");

      harness.transport.setBatchResponder();
      const resumed = await harness.coordinator.replay({userId: USER});
      expect(resumed).toEqual({});
      expect(harness.outbox.getMutation({mutationId: "m1"})?.status).toBe("acked");
      expect(harness.outbox.getMutation({mutationId: "m2"})?.status).toBe("acked");
    });
  });
});
