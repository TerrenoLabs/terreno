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

interface TransactionStore {
  session: ClientSession;
}

type MongooseWithTransactionStore = Mongoose & {
  transactionAsyncLocalStorage?: AsyncLocalStorage<TransactionStore>;
};

const transactionSupport = new WeakMap<Connection, Promise<boolean>>();

/**
 * Turns on `transactionAsyncLocalStorage` for a Mongoose instance. It only affects operations
 * run inside a transaction store, so enabling it changes nothing outside atomic bulk requests.
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
 * APIErrors) is a transient transaction failure: a write conflict or an unknown commit result.
 */
export const isTransientTransactionError = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (
      hasErrorLabel(current, "TransientTransactionError") ||
      hasErrorLabel(current, "UnknownTransactionCommitResult")
    ) {
      return true;
    }
    current = (current as {cause?: unknown}).cause;
  }
  return false;
};

/**
 * Runs `fn` inside one transaction on `connection`, with every Mongoose operation of `base`
 * joined to it. Commits when `fn` resolves; aborts and rethrows when it throws.
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
    throw new Error("transactionAsyncLocalStorage is not enabled on this Mongoose instance");
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
    await session.commitTransaction();
    return result;
  } finally {
    await session.endSession();
  }
};
