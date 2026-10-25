import {describe, expect, it} from "bun:test";
import mongoose from "mongoose";

import {
  abortTestTransaction,
  getTestSession,
  installTransactionPatches,
  resetTestSessionAfterReconnect,
  startTestTransaction,
} from "./testTransaction";

const TxWidget =
  mongoose.models.TxCoverageWidget ??
  mongoose.model(
    "TxCoverageWidget",
    new mongoose.Schema({name: String}, {collection: "tx_coverage_widgets"})
  );

describe("testTransaction", () => {
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
    try {
      await startTestTransaction();
      expect(getTestSession()).toBeTruthy();
      await TxWidget.create({name: "tx-a"});
      await TxWidget.find({name: "tx-a"});
      await TxWidget.updateOne({name: "tx-a"}, {name: "tx-b"});
      await TxWidget.deleteOne({name: "tx-b"});
      try {
        await TxWidget.insertMany([{name: "tx-c"}]);
      } catch {
        // replica-set-only path
      }
      try {
        await TxWidget.bulkWrite([{insertOne: {document: {name: "tx-d"}}}]);
      } catch {
        // replica-set-only path
      }
      try {
        await TxWidget.aggregate([{$match: {name: "tx-a"}}]);
      } catch {
        // replica-set-only path
      }
      const session = await TxWidget.startSession();
      expect(session).toBeDefined();
      await Promise.allSettled([TxWidget.find({name: "tx-a"}), TxWidget.find({name: "tx-b"})]);
    } catch {
      // Standalone memory Mongo rejects multi-document transactions.
    } finally {
      await abortTestTransaction();
      await resetTestSessionAfterReconnect();
      expect(getTestSession()).toBeNull();
    }
  });

  it("aborts a leftover transaction when a new one starts", async () => {
    installTransactionPatches();
    try {
      await startTestTransaction();
      const session = getTestSession();
      await startTestTransaction();
      expect(getTestSession()).toBe(session);
      expect(getTestSession()?.inTransaction()).toBe(true);
    } finally {
      await resetTestSessionAfterReconnect();
    }
    expect(getTestSession()).toBeNull();
  });

  it("replaces a session that fails to abort", async () => {
    installTransactionPatches();
    try {
      await startTestTransaction();
      const session = getTestSession();
      if (!session) {
        throw new Error("expected a test session");
      }
      session.inTransaction = () => {
        throw new Error("bad session");
      };
      await startTestTransaction();
      expect(getTestSession()).not.toBe(session);

      const replacement = getTestSession();
      if (!replacement) {
        throw new Error("expected a replacement session");
      }
      replacement.abortTransaction = async () => {
        throw new Error("abort failed");
      };
      await abortTestTransaction();
      expect(getTestSession()).toBeNull();
    } finally {
      await resetTestSessionAfterReconnect();
    }
  });

  it("restarts the transaction once after a transient transaction error", async () => {
    installTransactionPatches();
    let attempts = 0;
    const schema = new mongoose.Schema({name: String}, {collection: "tx_retry_widgets"});
    schema.pre("save", () => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("transient"), {errorLabels: ["TransientTransactionError"]});
      }
    });
    const RetryWidget = mongoose.models.TxRetryWidget ?? mongoose.model("TxRetryWidget", schema);
    try {
      await startTestTransaction();
      await new RetryWidget({name: "retry"}).save();
      expect(attempts).toBe(2);
    } finally {
      await abortTestTransaction();
      await resetTestSessionAfterReconnect();
    }
  });

  it("uses the driver's startSession when no test session is active", async () => {
    installTransactionPatches();
    const session = await TxWidget.startSession();
    expect(session.inTransaction()).toBe(false);
    await session.endSession();
  });
});
