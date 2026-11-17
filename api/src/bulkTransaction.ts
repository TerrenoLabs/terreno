/**
 * Transaction plumbing for atomic `POST /bulk` (see `bulk.ts`).
 *
 * Atomic bulk runs every item inside one Mongo transaction joined through Mongoose's
 * `transactionAsyncLocalStorage`: inside {@link runInBulkTransaction}, every Mongoose operation
 * (including writes made by router hooks) picks up the session without passing it explicitly.
 * There is no automatic retry, because a retry would run `pre*` hooks twice.
 */
import type {AsyncLocalStorage} from "node:async_hooks";
import type {ClientSession, Connection, Mongoose} from "mongoose";

import {APIError} from "./errors";

interface TransactionStore {
  session: ClientSession;
}

type MongooseWithTransactionStore = Mongoose & {
  transactionAsyncLocalStorage?: AsyncLocalStorage<TransactionStore>;
};

const transactionSupport = new WeakMap<Connection, Promise<boolean>>();

/**
 * Turns on `transactionAsyncLocalStorage` for a Mongoose instance. This is app-wide: from then on
 * every Mongoose operation inside any transaction store joins that transaction, including stores
 * opened by the app's own `connection.transaction()` calls. Operations outside a store are
 * unaffected.
 */
export const enableTransactionAsyncLocalStorage = (base: Mongoose): void => {
  if (!base.get("transactionAsyncLocalStorage")) {
    base.set("transactionAsyncLocalStorage", true);
  }
};

/** Whether the connection's deployment supports transactions (replica set or sharded). */
export const supportsTransactions = (connection: Connection): Promise<boolean> => {
  const cached = transactionSupport.get(connection);
  if (cached) {
    return cached;
  }
  const check = (async (): Promise<boolean> => {
    const db = connection.db;
    if (!db) {
      return false;
    }
    const hello = await db.admin().command({hello: 1});
    return Boolean(hello.setName) || hello.msg === "isdbgrid";
  })();
  // Do not cache a failed probe; the next request tries again.
  check.catch(() => transactionSupport.delete(connection));
  transactionSupport.set(connection, check);
  return check;
};

const hasErrorLabel = (error: unknown, label: string): boolean => {
  const labelled = error as {hasErrorLabel?: (name: string) => boolean; errorLabels?: string[]};
  if (typeof labelled?.hasErrorLabel === "function" && labelled.hasErrorLabel(label)) {
    return true;
  }
  return Array.isArray(labelled?.errorLabels) && labelled.errorLabels.includes(label);
};

/**
 * Whether an error (or any error in its `cause` chain, since executors wrap driver errors in
 * APIErrors) is a transient transaction failure, such as a write conflict: the transaction was
 * aborted and nothing it wrote is visible.
 */
export const isTransientTransactionError = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (hasErrorLabel(current, "TransientTransactionError")) {
      return true;
    }
    current = (current as {cause?: unknown}).cause;
  }
  return false;
};

/** Thrown when a commit's outcome stays unknown after one retry: the writes may have landed. */
export class BulkCommitUnknownError extends Error {
  readonly isBulkCommitUnknown = true;

  constructor(readonly cause: unknown) {
    super("Bulk transaction commit outcome is unknown");
  }
}

export const isBulkCommitUnknownError = (error: unknown): error is BulkCommitUnknownError =>
  Boolean((error as {isBulkCommitUnknown?: unknown} | undefined)?.isBulkCommitUnknown);

// The driver's guidance for UnknownTransactionCommitResult: retry the commit itself, which is
// safe and runs no hooks again. A second unknown result is reported, never guessed.
const commitWithOneRetry = async (session: ClientSession): Promise<void> => {
  try {
    await session.commitTransaction();
  } catch (error: unknown) {
    if (!hasErrorLabel(error, "UnknownTransactionCommitResult")) {
      throw error;
    }
    try {
      await session.commitTransaction();
    } catch (retryError: unknown) {
      if (hasErrorLabel(retryError, "UnknownTransactionCommitResult")) {
        throw new BulkCommitUnknownError(retryError);
      }
      throw retryError;
    }
  }
};

/**
 * Runs `fn` inside one transaction on `connection`, with every Mongoose operation of `base`
 * joined to it. Commits when `fn` resolves; aborts and rethrows when it throws. Work `fn` starts
 * without awaiting keeps the session after the transaction ends, so it must leave the store.
 */
export const runInBulkTransaction = async <R>({
  base,
  connection,
  fn,
}: {
  base: Mongoose;
  connection: Connection;
  fn: () => Promise<R>;
}): Promise<R> => {
  const storage = (base as MongooseWithTransactionStore).transactionAsyncLocalStorage;
  if (!storage) {
    throw new APIError({
      status: 500,
      title: "transactionAsyncLocalStorage is not enabled on this Mongoose instance",
    });
  }
  const session = await connection.startSession();
  try {
    session.startTransaction();
    let result: R;
    try {
      result = await storage.run({session}, fn);
    } catch (error: unknown) {
      await session.abortTransaction().catch(() => undefined);
      throw error;
    }
    await commitWithOneRetry(session);
    return result;
  } finally {
    await session.endSession();
  }
};
