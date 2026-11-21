import {describe, expect, it} from "bun:test";
import mongoose, {type ClientSession, type Connection} from "mongoose";

import {
  enableTransactionAsyncLocalStorage,
  isBulkCommitUnknownError,
  isTransientTransactionError,
  runInBulkTransaction,
  supportsTransactions,
} from "./bulkTransaction";

const labelled = (label: string): Error => Object.assign(new Error(label), {errorLabels: [label]});

interface FakeSession {
  calls: string[];
  session: ClientSession;
}

// A session whose commit fails with the given errors in order, then succeeds.
const fakeSession = (commitErrors: Error[] = []): FakeSession => {
  const calls: string[] = [];
  const session = {
    abortTransaction: async (): Promise<void> => {
      calls.push("abort");
    },
    commitTransaction: async (): Promise<void> => {
      calls.push("commit");
      const next = commitErrors.shift();
      if (next) {
        throw next;
      }
    },
    endSession: async (): Promise<void> => {
      calls.push("end");
    },
    startTransaction: (): void => {
      calls.push("start");
    },
  } as unknown as ClientSession;
  return {calls, session};
};

const connectionFor = (session: ClientSession): Connection =>
  ({startSession: async () => session}) as unknown as Connection;

const transactionBase = (): mongoose.Mongoose => {
  const base = new mongoose.Mongoose();
  enableTransactionAsyncLocalStorage(base);
  return base;
};

describe("runInBulkTransaction", () => {
  it("commits once and ends the session when fn resolves", async () => {
    const {calls, session} = fakeSession();
    const result = await runInBulkTransaction({
      base: transactionBase(),
      connection: connectionFor(session),
      fn: async () => "done",
    });
    expect(result).toBe("done");
    expect(calls).toEqual(["start", "commit", "end"]);
  });

  it("runs fn with the session in the transaction store", async () => {
    const base = transactionBase();
    const {session} = fakeSession();
    const seen = await runInBulkTransaction({
      base,
      connection: connectionFor(session),
      fn: async () =>
        (
          base as unknown as {
            transactionAsyncLocalStorage: {getStore: () => {session: ClientSession}};
          }
        ).transactionAsyncLocalStorage.getStore().session,
    });
    expect(seen).toBe(session);
  });

  it("aborts, ends the session, and rethrows when fn throws", async () => {
    const {calls, session} = fakeSession();
    const failure = new Error("item failed");
    await expect(
      runInBulkTransaction({
        base: transactionBase(),
        connection: connectionFor(session),
        fn: async () => {
          throw failure;
        },
      })
    ).rejects.toBe(failure);
    expect(calls).toEqual(["start", "abort", "end"]);
  });

  it("retries the commit once on UnknownTransactionCommitResult and succeeds", async () => {
    const {calls, session} = fakeSession([labelled("UnknownTransactionCommitResult")]);
    const result = await runInBulkTransaction({
      base: transactionBase(),
      connection: connectionFor(session),
      fn: async () => 1,
    });
    expect(result).toBe(1);
    expect(calls).toEqual(["start", "commit", "commit", "end"]);
  });

  it("reports a second UnknownTransactionCommitResult as an unknown outcome, not a conflict", async () => {
    const {calls, session} = fakeSession([
      labelled("UnknownTransactionCommitResult"),
      labelled("UnknownTransactionCommitResult"),
    ]);
    let thrown: unknown;
    try {
      await runInBulkTransaction({
        base: transactionBase(),
        connection: connectionFor(session),
        fn: async () => 1,
      });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isBulkCommitUnknownError(thrown)).toBe(true);
    expect(isTransientTransactionError(thrown)).toBe(false);
    expect(calls).toEqual(["start", "commit", "commit", "end"]);
  });

  it("rethrows a TransientTransactionError from commit without retrying", async () => {
    const conflict = labelled("TransientTransactionError");
    const {calls, session} = fakeSession([conflict]);
    await expect(
      runInBulkTransaction({
        base: transactionBase(),
        connection: connectionFor(session),
        fn: async () => 1,
      })
    ).rejects.toBe(conflict);
    expect(calls).toEqual(["start", "commit", "end"]);
  });

  it("refuses to run when transactionAsyncLocalStorage is off", async () => {
    const {session} = fakeSession();
    await expect(
      runInBulkTransaction({
        base: new mongoose.Mongoose(),
        connection: connectionFor(session),
        fn: async () => 1,
      })
    ).rejects.toThrow("transactionAsyncLocalStorage is not enabled");
  });
});

describe("isTransientTransactionError", () => {
  it("finds the label on a wrapped cause", () => {
    const wrapped = new Error("wrapped", {cause: labelled("TransientTransactionError")});
    expect(isTransientTransactionError(wrapped)).toBe(true);
  });

  it("does not treat an unknown commit result or a plain error as transient", () => {
    expect(isTransientTransactionError(labelled("UnknownTransactionCommitResult"))).toBe(false);
    expect(isTransientTransactionError(new Error("plain"))).toBe(false);
  });
});

describe("supportsTransactions", () => {
  it("is false for a connection with no database, and probes again once it connects", async () => {
    const connection = {db: undefined} as unknown as {db: unknown};
    expect(await supportsTransactions(connection as unknown as Connection)).toBe(false);
    connection.db = {admin: () => ({command: async () => ({setName: "rs0"})})};
    expect(await supportsTransactions(connection as unknown as Connection)).toBe(true);
  });

  it("is true for a replica set and false for a standalone server", async () => {
    const connectionWithHello = (hello: Record<string, unknown>): Connection =>
      ({db: {admin: () => ({command: async () => hello})}}) as unknown as Connection;
    expect(await supportsTransactions(connectionWithHello({setName: "rs0"}))).toBe(true);
    expect(await supportsTransactions(connectionWithHello({msg: "isdbgrid"}))).toBe(true);
    expect(await supportsTransactions(connectionWithHello({}))).toBe(false);
  });

  it("does not cache a failed probe", async () => {
    let attempts = 0;
    const connection = {
      db: {
        admin: () => ({
          command: async (): Promise<Record<string, unknown>> => {
            attempts += 1;
            if (attempts === 1) {
              throw new Error("probe failed");
            }
            return {setName: "rs0"};
          },
        }),
      },
    } as unknown as Connection;
    await expect(supportsTransactions(connection)).rejects.toThrow("probe failed");
    expect(await supportsTransactions(connection)).toBe(true);
  });
});
