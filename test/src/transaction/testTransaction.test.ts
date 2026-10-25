import {afterEach, describe, expect, it} from "bun:test";
import mongoose from "mongoose";

import {
  abortTestTransaction,
  getTestSession,
  installTransactionPatches,
  isTestTransactionOperationCancelled,
  resetTestSessionAfterReconnect,
  startTestTransaction,
  TestTransactionOperationCancelledError,
} from "./testTransaction";

const TxWidget =
  mongoose.models.TxCoverageWidget ??
  mongoose.model(
    "TxCoverageWidget",
    new mongoose.Schema({name: String}, {collection: "tx_coverage_widgets"})
  );

// Lets a test hold the session mutex: a `find` on this model parks inside its
// critical section until the gate opens.
let findGate: Promise<void> | null = null;
const txHoldSchema = new mongoose.Schema({name: String}, {collection: "tx_hold_widgets"});
txHoldSchema.pre("find", async () => {
  if (findGate !== null) {
    await findGate;
  }
});
const TxHoldWidget = mongoose.models.TxHoldWidget ?? mongoose.model("TxHoldWidget", txHoldSchema);

// Counts document-level deleteOne middleware, which Mongoose wires up through
// per-instance hooks on the query that `doc.deleteOne()` returns.
let documentDeleteHookCalls = 0;
const txHookSchema = new mongoose.Schema({name: String}, {collection: "tx_hook_widgets"});
txHookSchema.post("deleteOne", {document: true, query: false}, () => {
  documentDeleteHookCalls++;
});
const TxHookWidget = mongoose.models.TxHookWidget ?? mongoose.model("TxHookWidget", txHookSchema);

interface Gate {
  open: () => void;
  promise: Promise<void>;
}

const createGate = (): Gate => {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {open, promise};
};

/** Settles a promise into a value so a later rejection is never unhandled. */
const settle = <T>(promise: Promise<T>): Promise<{error?: unknown; value?: T}> =>
  promise.then(
    (value) => ({value}),
    (error: unknown) => ({error})
  );

describe("isTestTransactionOperationCancelled", () => {
  it("detects the cancellation error directly", () => {
    const error = new TestTransactionOperationCancelledError();
    expect(error.name).toBe("TestTransactionOperationCancelledError");
    expect(error.message).toContain("test boundary");
    expect(isTestTransactionOperationCancelled(error)).toBe(true);
  });

  it("detects the cancellation error through cause chains", () => {
    const cancelled = new TestTransactionOperationCancelledError();
    const once = new Error("wrapped once", {cause: cancelled});
    const thrice = new Error("outer", {cause: new Error("middle", {cause: once})});
    expect(isTestTransactionOperationCancelled(once)).toBe(true);
    expect(isTestTransactionOperationCancelled(thrice)).toBe(true);
    expect(isTestTransactionOperationCancelled({cause: cancelled})).toBe(true);
  });

  it("rejects unrelated errors and non-errors", () => {
    expect(isTestTransactionOperationCancelled(new Error("boom"))).toBe(false);
    expect(
      isTestTransactionOperationCancelled(new Error("outer", {cause: new Error("inner")}))
    ).toBe(false);
    expect(isTestTransactionOperationCancelled(undefined)).toBe(false);
    expect(isTestTransactionOperationCancelled(null)).toBe(false);
    expect(isTestTransactionOperationCancelled("cancelled")).toBe(false);
    const cancelledError = new TestTransactionOperationCancelledError();
    expect(isTestTransactionOperationCancelled({message: cancelledError.message})).toBe(false);
  });

  it("stops following causes after five levels and on cycles", () => {
    let deep: unknown = new TestTransactionOperationCancelledError();
    for (let i = 0; i < 5; i++) {
      deep = new Error(`level ${i}`, {cause: deep});
    }
    expect(isTestTransactionOperationCancelled(deep)).toBe(false);

    const cyclic: {cause?: unknown} = {};
    cyclic.cause = cyclic;
    expect(isTestTransactionOperationCancelled(cyclic)).toBe(false);
  });
});

describe("testTransaction", () => {
  afterEach(async () => {
    findGate = null;
    await resetTestSessionAfterReconnect();
  });

  it("installs patches idempotently and no-ops without a session", async () => {
    expect(getTestSession()).toBeNull();
    installTransactionPatches();
    installTransactionPatches();
    await abortTestTransaction();
    await resetTestSessionAfterReconnect();
    expect(getTestSession()).toBeNull();
  });

  it("serializes mongoose operations while a test session is active", async () => {
    installTransactionPatches();
    await startTestTransaction();
    expect(getTestSession()).toBeTruthy();
    await TxWidget.create({name: "tx-a"});
    expect(await TxWidget.countDocuments({name: "tx-a"})).toBe(1);
    await TxWidget.updateOne({name: "tx-a"}, {name: "tx-b"});
    await TxWidget.insertMany([{name: "tx-c"}]);
    await TxWidget.bulkWrite([{insertOne: {document: {name: "tx-d"}}}]);
    await TxWidget.create([{name: "tx-e"}, {name: "tx-f"}]);
    await TxWidget.collection.insertOne({name: "tx-g"});
    await TxWidget.collection.updateOne({name: "tx-g"}, {$set: {name: "tx-h"}});
    const aggregated = await TxWidget.aggregate([{$match: {name: "tx-b"}}]);
    expect(aggregated).toHaveLength(1);
    const [first, second] = await Promise.all([
      TxWidget.find({name: "tx-b"}),
      TxWidget.find({name: {$in: ["tx-c", "tx-d", "tx-e", "tx-f", "tx-h"]}}),
    ]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(5);
    await TxWidget.deleteOne({name: "tx-b"});

    const appSession = await TxWidget.startSession();
    expect(appSession.inTransaction()).toBe(true);
    appSession.startTransaction();
    await appSession.commitTransaction();
    await appSession.abortTransaction();
    const fromCallback = await appSession.withTransaction(async () => "done");
    expect(fromCallback).toBe("done");
    await appSession.endSession();

    await abortTestTransaction();
    expect(getTestSession()).toBeTruthy();

    // The abort rolled every write back.
    await startTestTransaction();
    expect(await TxWidget.countDocuments({name: /^tx-/})).toBe(0);
    await abortTestTransaction();
  });

  it("saves varargs creates in order as the first write of a transaction", async () => {
    installTransactionPatches();
    for (let attempt = 0; attempt < 5; attempt++) {
      await startTestTransaction();
      const created = (await TxWidget.create(
        {name: "tx-v1"},
        {name: "tx-v2"},
        {name: "tx-v3"}
      )) as unknown as Array<{name: string}>;
      expect(created.map((doc) => doc.name)).toEqual(["tx-v1", "tx-v2", "tx-v3"]);
      expect(await TxWidget.countDocuments({name: /^tx-v/})).toBe(3);
      await abortTestTransaction();
    }
  });

  it("runs document deleteOne middleware inside a test transaction", async () => {
    installTransactionPatches();
    await startTestTransaction();
    documentDeleteHookCalls = 0;
    const widget = await TxHookWidget.create({name: "tx-hook"});
    await widget.deleteOne();
    expect(documentDeleteHookCalls).toBe(1);
    expect(await TxHookWidget.countDocuments({name: "tx-hook"})).toBe(0);
    await abortTestTransaction();
  });

  it("waits for fire-and-forget operations to settle before aborting", async () => {
    installTransactionPatches();
    await startTestTransaction();
    const gate = createGate();
    findGate = gate.promise;

    const leftBehind = settle(TxHoldWidget.find({}).exec());
    setTimeout(gate.open, 20);
    await abortTestTransaction();

    const result = await leftBehind;
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual([]);
    expect(getTestSession()).toBeTruthy();
  });

  it("rejects queued operations with the cancellation error when teardown times out", async () => {
    installTransactionPatches();
    await startTestTransaction();
    const gate = createGate();
    findGate = gate.promise;

    // The first operation holds the mutex; the second queues behind it.
    const holder = settle(TxHoldWidget.find({}).exec());
    const queued = settle(TxWidget.countDocuments({}).exec());

    const aborted = await settle(abortTestTransaction({drainTimeoutMs: 50}));
    expect(String(aborted.error)).toContain("Timed out waiting for 2 serialized operation(s)");
    expect(getTestSession()).toBeNull();

    const queuedResult = await queued;
    expect(queuedResult.error).toBeInstanceOf(TestTransactionOperationCancelledError);
    expect(isTestTransactionOperationCancelled(queuedResult.error)).toBe(true);

    // The holder resumes against the quarantined session and fails instead of
    // leaking into the next test's transaction.
    gate.open();
    const holderResult = await holder;
    expect(holderResult.error).toBeDefined();
    expect(isTestTransactionOperationCancelled(holderResult.error)).toBe(false);

    // A fresh session is created for the next test.
    await startTestTransaction();
    expect(getTestSession()).toBeTruthy();
    expect(await TxWidget.countDocuments({})).toBe(0);
    await abortTestTransaction();
  });

  it("ignores a quarantined holder's release once the next test owns the mutex", async () => {
    installTransactionPatches();
    await startTestTransaction();
    const staleGate = createGate();
    findGate = staleGate.promise;
    const staleHolder = settle(TxHoldWidget.find({}).exec());
    await settle(abortTestTransaction({drainTimeoutMs: 50}));

    // The next test takes the mutex and queues a second operation behind it.
    await startTestTransaction();
    const freshGate = createGate();
    findGate = freshGate.promise;
    const freshHolder = settle(TxHoldWidget.find({}).exec());
    let isQueuedSettled = false;
    const queued = settle(TxWidget.countDocuments({}).exec()).then((result) => {
      isQueuedSettled = true;
      return result;
    });

    // The stale holder finishing must not hand the mutex to the queued operation.
    staleGate.open();
    await staleHolder;
    await Promise.race([queued, new Promise((resolve) => setTimeout(resolve, 200))]);
    expect(isQueuedSettled).toBe(false);

    freshGate.open();
    expect((await freshHolder).error).toBeUndefined();
    expect((await queued).value).toBe(0);
    await abortTestTransaction();
  });

  it("rejects queued operations when the session is reset after a reconnect", async () => {
    installTransactionPatches();
    await startTestTransaction();
    const gate = createGate();
    findGate = gate.promise;

    const holder = settle(TxHoldWidget.find({}).exec());
    const queued = settle(TxWidget.find({}).exec());

    await resetTestSessionAfterReconnect();
    const queuedResult = await queued;
    expect(queuedResult.error).toBeInstanceOf(TestTransactionOperationCancelledError);

    gate.open();
    await holder;
    expect(getTestSession()).toBeNull();
  });
});
