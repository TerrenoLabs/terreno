/**
 * Transaction-based test isolation for MongoDB.
 *
 * Instead of clearing and reloading all collections before every test,
 * this module wraps each test in a MongoDB transaction that is aborted
 * after the test completes. This rolls back all changes made during the
 * test, leaving the database in its original state for the next test.
 *
 * How it works:
 * 1. Mongoose operations (Query.exec, Model.save, Aggregate.exec, etc.)
 *    are monkey-patched to inject the current test session when active.
 * 2. Before each test, a session is started and a transaction is begun.
 * 3. After each test, the transaction is aborted and the session is ended.
 * 4. All DB operations during the test see the pre-test snapshot and any
 *    writes made within the transaction, but nothing is persisted.
 *
 * Session reuse: a single MongoDB session is reused across all tests within
 * a worker to avoid transaction number mismatches caused by the MongoDB driver's
 * server session pool. When sessions are ended and reacquired from the pool,
 * in-flight operations from a previous test can arrive with a stale transaction
 * number, causing NoSuchTransaction errors. Reusing one session avoids this.
 *
 * Operation serialization: MongoDB does not support concurrent operations on
 * the same session within a transaction. When app code uses Promise.all() to
 * run DB operations in parallel, concurrent operations on the same session
 * cause TransientTransactionError / NoSuchTransaction. We solve this with a
 * reentrant async mutex:
 * - Top-level operations (the ones fired by Promise.all) are serialized
 * - Nested operations (e.g. pre-save hooks that do queries) run without taking
 *   the mutex while the ancestor that owns it is still inside its critical
 *   section, preventing deadlocks
 * - AsyncLocalStorage tracks which critical section owns the current async chain
 *
 * Teardown drain: every operation is counted while in flight, and teardown waits
 * for that count to reach zero before aborting. Work a test leaves behind — a
 * fire-and-forget `void AuditLog.create(...)` write, follow-up writes spawned by
 * post-save hooks — would otherwise still be queued when the transaction is
 * aborted, then run against the aborted transaction or, once the session is no
 * longer transactional, commit for real.
 *
 * Test-boundary cancellation: operations still queued on the mutex when the
 * session is discarded reject with {@link TestTransactionOperationCancelledError}
 * instead of running. Use {@link isTestTransactionOperationCancelled} to
 * recognize that error (including when wrapped through `cause`).
 *
 * Limitations:
 * - App code that creates its own sessions (e.g. explicit transactions in
 *   route handlers) will have those sessions' operations redirected through
 *   the test session. The app's own commit/abort calls become no-ops.
 * - Native driver operations (mongoose.connection.db.collection(...)) are
 *   NOT patched. Only Mongoose-level operations are covered.
 */

import {AsyncLocalStorage} from "node:async_hooks";
import type {ClientSession} from "mongoose";
import mongoose from "mongoose";

let currentTestSession: ClientSession | null = null;
let patchesInstalled = false;

/** How deep {@link isTestTransactionOperationCancelled} follows `cause` chains. */
const MAX_CAUSE_DEPTH = 5;

/** Default budget for in-flight operations to settle before teardown gives up. */
// Below Bun's default 5s hook timeout, so a quarantine after a timed-out drain finishes
// inside the same afterEach instead of spilling into the next test.
const DEFAULT_DRAIN_TIMEOUT_MS = 3000;

// ============================================================================
// Cancellation Error
// ============================================================================

/**
 * Thrown when a queued DB operation is discarded at a test boundary.
 *
 * Rejecting stops the operation's `await` chain so later writes cannot run
 * after the test session is gone. `bun test` reports an unawaited rejection
 * itself (it does not call `process.on("unhandledRejection")` listeners), so a
 * fire-and-forget write that hits this error shows up as a test failure; await
 * the write, or check `isTestTransactionOperationCancelled` where it is caught.
 */
export class TestTransactionOperationCancelledError extends Error {
  constructor() {
    super("[testTransaction] Cancelled a queued operation at a test boundary");
    this.name = "TestTransactionOperationCancelledError";
  }
}

/** True when `error` is a test-boundary cancellation, including wrapped `cause` chains. */
export const isTestTransactionOperationCancelled = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth++) {
    if (current instanceof TestTransactionOperationCancelledError) {
      return true;
    }
    current = (current as {cause?: unknown}).cause;
  }
  return false;
};

// ============================================================================
// Reentrant Async Mutex
// ============================================================================

/**
 * Identifies the critical section that the current async context belongs to.
 * A nested operation skips the mutex only while that section still holds it,
 * which avoids deadlocks without letting detached work bypass serialization.
 */
const serializationContext = new AsyncLocalStorage<{owner: object}>();

interface MutexWaiter {
  reject: (error: Error) => void;
  resolve: (generation: number) => void;
}

/**
 * Async mutex that serializes access to the MongoDB session.
 * Only one DB operation can be in-flight at a time when a test session is active.
 */
class AsyncMutex {
  private queue: MutexWaiter[] = [];
  private locked = false;
  /**
   * Bumped by {@link reset}. A holder releases with the generation it acquired
   * in, so a holder stranded by a reset cannot unlock (or hand off) a mutex that
   * a later test now owns.
   */
  private generation = 0;

  /** Resolves with the generation the lock was granted in; pass it to {@link release}. */
  async acquire(): Promise<number> {
    if (!this.locked) {
      this.locked = true;
      return this.generation;
    }
    return new Promise<number>((resolve, reject) => {
      this.queue.push({reject, resolve});
    });
  }

  release(generation: number): void {
    if (generation !== this.generation) {
      return;
    }
    const next = this.queue.shift();
    if (next) {
      next.resolve(this.generation);
    } else {
      this.locked = false;
    }
  }

  /**
   * Cancels queued work when the owning test session is discarded.
   *
   * Resolving every waiter as though it owned the lock would let them all
   * proceed concurrently on the shared session. Rejecting with
   * {@link TestTransactionOperationCancelledError} instead stops `await`
   * chains so later writes cannot run after the session is reset.
   */
  reset(): void {
    const stranded = this.queue;
    this.queue = [];
    this.locked = false;
    this.generation++;
    for (const waiter of stranded) {
      waiter.reject(new TestTransactionOperationCancelledError());
    }
  }
}

const sessionMutex = new AsyncMutex();

/**
 * Identity of the critical section that currently holds {@link sessionMutex}.
 * A nested operation may only skip the mutex while its own ancestor still holds
 * it; see {@link serialized}.
 */
let currentMutexOwner: object | null = null;

/** Clears the mutex and its holder identity between tests. */
const resetSessionMutex = (): void => {
  currentMutexOwner = null;
  sessionMutex.reset();
};

// ============================================================================
// In-Flight Operation Tracking
// ============================================================================

/**
 * DB operations issued through {@link serialized} that have not settled yet.
 *
 * This counts queued operations as well as running ones, because a test can
 * leave work behind after its body returns — fire-and-forget writes, and
 * follow-up writes spawned by post-save hooks. Teardown must wait for all of it.
 */
let pendingOperationCount = 0;

/**
 * Incremented when tracking is abandoned so that late `finally` blocks from a
 * previous epoch cannot drive {@link pendingOperationCount} negative.
 */
let operationEpoch = 0;

/** Resolvers waiting for {@link pendingOperationCount} to reach zero. */
let drainWaiters: Array<() => void> = [];

const notifyDrained = (): void => {
  const waiters = drainWaiters;
  drainWaiters = [];
  for (const resolve of waiters) {
    resolve();
  }
};

/** Runs an operation while counting it as in-flight. */
const trackOperation = async <T>(operation: () => T | Promise<T>): Promise<T> => {
  const epoch = operationEpoch;
  pendingOperationCount++;
  try {
    return await operation();
  } finally {
    if (epoch === operationEpoch) {
      pendingOperationCount--;
      if (pendingOperationCount === 0) {
        notifyDrained();
      }
    }
  }
};

/** Resolves once no tracked operation is in flight. */
const whenNoOperationsInFlight = (): Promise<void> => {
  if (pendingOperationCount === 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    drainWaiters.push(resolve);
  });
};

/**
 * Clears operation accounting after the session that owns it is quarantined.
 *
 * Late `finally` blocks from the discarded session belong to the previous
 * epoch, so they cannot affect accounting for the next test.
 */
const abandonOperationTracking = (): void => {
  operationEpoch++;
  pendingOperationCount = 0;
  notifyDrained();
};

/** Minimal shape of a Mongoose connection (`Model.db`) needed to compare clients. */
type ConnectionLike = {getClient?: () => unknown} | null | undefined;

/**
 * Returns whether the active test transaction session can be attached to DB
 * operations on the given Mongoose connection. The Node driver's
 * `ClientSession` must belong to the same `MongoClient` as the collection;
 * otherwise operations throw `MongoInvalidArgumentError` (observed in CI when
 * mixing connections).
 *
 * @param connection - Mongoose connection (`Model.db`), or undefined when unknown
 * @returns True when the session should be passed into driver options / `.session()`
 */
const shouldAttachTestSessionToConnection = (connection: ConnectionLike): boolean => {
  if (!currentTestSession) {
    return false;
  }
  const sessionClient = (currentTestSession as {client?: unknown}).client;
  if (!connection || typeof connection.getClient !== "function") {
    return true;
  }
  const connClient = connection.getClient();
  if (!sessionClient || !connClient) {
    return true;
  }
  return sessionClient === connClient;
};

const drainTimeoutError = (): Error =>
  new Error(
    `[testTransaction] Timed out waiting for ${pendingOperationCount} serialized operation(s) to drain`
  );

/**
 * Waits until every serialized DB operation has settled before test teardown.
 *
 * Taking one turn on the mutex is not enough: the mutex is FIFO, so a turn only
 * proves that operations queued *before* teardown have finished. Work the test
 * left behind — a fire-and-forget write, a follow-up write spawned by a
 * post-save hook — queues after teardown and would still be pending. Those
 * operations then execute against a transaction that has already been aborted,
 * which surfaces as a NoSuchTransaction error, or worse, land after
 * {@link serialized} has given up on the transaction and get committed for real.
 *
 * Waiting on the in-flight count instead covers both queued and running work,
 * and re-checks after yielding because settling one operation can enqueue the
 * next one in its chain. Uses the monotonic clock so `setSystemTime` in a test
 * cannot stretch or shrink the budget.
 */
const waitForSerializedOperationsToDrain = async (timeoutMs: number): Promise<void> => {
  const deadline = performance.now() + timeoutMs;

  while (pendingOperationCount > 0) {
    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0) {
      throw drainTimeoutError();
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        whenNoOperationsInFlight(),
        new Promise<void>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(drainTimeoutError());
          }, remainingMs);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }

    // Yield a macrotask so any operation chained onto the ones that just settled
    // is registered before we conclude the queue is empty.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

/**
 * Guarantees the reused session has an open transaction before an operation runs.
 *
 * When the server aborts the transaction mid-test, the session stays usable but
 * is no longer transactional. Every subsequent write would then execute as an
 * ordinary write and be committed, permanently leaking the test's fixtures into
 * the shared database and corrupting every test file that runs after it.
 * Reopening a transaction keeps those writes rollback-able.
 */
const ensureTransactionOpen = (): void => {
  if (currentTestSession && !currentTestSession.inTransaction()) {
    currentTestSession.startTransaction();
  }
};

/**
 * Discards a session whose operations did not settle before teardown.
 *
 * A drain timeout means the session can no longer safely isolate the following
 * test. Aborting and ending it makes the old operations fail instead of letting
 * them attach to a new transaction; clearing the global lets the next test
 * obtain a fresh session.
 */
const quarantineTestSession = async (): Promise<void> => {
  const session = currentTestSession;
  if (!session) {
    return;
  }

  currentTestSession = null;
  try {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
  } catch {
    // The session is being discarded after a teardown failure.
  }
  try {
    await session.endSession();
  } catch {
    // The session is being discarded after a teardown failure.
  }
};

/**
 * Wraps an async DB operation with the session mutex. Reentrant: while the
 * critical section that owns the mutex is still running, operations it spawns
 * run directly without acquiring the mutex, so nested work like a pre-save hook
 * issuing its own query cannot deadlock against its caller.
 *
 * Restart caveat: when a `TransientTransactionError` is hit mid-test, this
 * function restarts the transaction and retries only the *failing* operation.
 * The restart discards the transaction's snapshot, so writes the test made
 * earlier are silently rolled back and a later assertion can fail against a DB
 * state the test doesn't expect. The restart path is a last resort — the drain
 * and reentrancy rules above exist to keep operations from arriving on an
 * already-aborted transaction in the first place.
 */
const serialized = <T>(fn: () => T | Promise<T>): T | Promise<T> => {
  // If no test session is active, skip serialization entirely
  if (!currentTestSession) {
    return fn();
  }

  // Nested call whose ancestor still holds the mutex: acquiring it again would
  // deadlock, so run directly. The ancestor check is deliberately by identity
  // rather than a plain "am I inside a serialized block" flag — the async
  // context is inherited by fire-and-forget work too, and such an operation can
  // resume long after its ancestor released the mutex. Treating that as nested
  // would let it run concurrently with another operation on the same session,
  // which MongoDB rejects.
  const store = serializationContext.getStore();
  if (store && store.owner === currentMutexOwner) {
    return trackOperation(fn);
  }

  // Top-level call: acquire mutex, then run inside the serialization context
  const run = async (): Promise<T> => {
    let hasRetried = false;

    while (true) {
      const generation = await sessionMutex.acquire();
      const owner = {};
      currentMutexOwner = owner;
      try {
        ensureTransactionOpen();
        return await serializationContext.run({owner}, fn);
      } catch (error) {
        if (isTestTransactionOperationCancelled(error)) {
          throw error;
        }
        // If this error aborted the transaction (e.g. E11000 duplicate key),
        // restart it and retry once so transient transaction-number mismatches
        // don't fail the test immediately.
        const transactionError = error as {errorLabels?: string[]};
        const isTransactionAborted =
          transactionError?.errorLabels?.includes?.("TransientTransactionError") ||
          (currentTestSession && !currentTestSession.inTransaction());

        if (!hasRetried && isTransactionAborted && currentTestSession) {
          hasRetried = true;
          try {
            // Explicitly abort client-side transaction state before restart.
            if (currentTestSession.inTransaction()) {
              await currentTestSession.abortTransaction();
            }
            currentTestSession.startTransaction();
            continue;
          } catch {
            // Ignore — fallback to throwing original error below.
          }
        }

        throw error;
      } finally {
        if (currentMutexOwner === owner) {
          currentMutexOwner = null;
        }
        sessionMutex.release(generation);
      }
    }
  };
  return trackOperation(run);
};

// ============================================================================
// Public API
// ============================================================================

/** Returns the current test session, or null if not in a test transaction. */
export const getTestSession = (): ClientSession | null => currentTestSession;

/**
 * Starts a new test transaction. Call in beforeEach.
 *
 * Reuses the existing MongoDB session when possible. A new session is only
 * created on the very first call or after the previous session has been
 * explicitly ended (e.g., due to an error).
 */
export const startTestTransaction = async (): Promise<void> => {
  if (currentTestSession) {
    // Abort any leftover transaction from a previous test that wasn't cleaned up
    try {
      if (currentTestSession.inTransaction()) {
        await currentTestSession.abortTransaction();
      }
    } catch {
      // Session may be in a bad state — create a fresh one below
      try {
        await currentTestSession.endSession();
      } catch {
        // Ignore
      }
      currentTestSession = null;
    }
  }

  if (!currentTestSession) {
    currentTestSession = await mongoose.startSession();
  }

  resetSessionMutex();
  currentTestSession.startTransaction();
};

export interface AbortTestTransactionOptions {
  /** How long to wait for in-flight and queued operations to settle. Defaults to 3000ms. */
  drainTimeoutMs?: number;
}

/**
 * Aborts the current test transaction. Call in afterEach.
 *
 * Waits for in-flight and queued operations to settle first. If they do not
 * settle within the drain budget, the session is quarantined (aborted and
 * ended), queued operations reject with {@link TestTransactionOperationCancelledError},
 * and the drain timeout error is rethrown so the offending test fails.
 *
 * The session is otherwise kept alive (not ended) so it can be reused by
 * the next test. This avoids returning the session to the driver's server
 * session pool, which prevents transaction number mismatches when in-flight
 * operations from a previous test complete after the session has been recycled.
 */
export const abortTestTransaction = async ({
  drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
}: AbortTestTransactionOptions = {}): Promise<void> => {
  if (!currentTestSession) {
    return;
  }

  // Ensure any in-flight/queued DB work from the current test has settled
  // before aborting, so it cannot land on the next test's transaction.
  try {
    await waitForSerializedOperationsToDrain(drainTimeoutMs);
  } catch (error) {
    await quarantineTestSession();
    abandonOperationTracking();
    resetSessionMutex();
    throw error;
  }

  try {
    if (currentTestSession.inTransaction()) {
      await currentTestSession.abortTransaction();
    }
  } catch (error) {
    console.warn("[testTransaction] Error aborting transaction:", error);
    // If the abort failed, the session may be in a bad state. End it so
    // startTestTransaction creates a fresh one.
    try {
      await currentTestSession.endSession();
    } catch {
      // Ignore
    }
    currentTestSession = null;
  } finally {
    // Clean slate for the next test transaction.
    resetSessionMutex();
  }
};

/**
 * Drops the cached test session after an out-of-band mongoose reconnect.
 *
 * Reconnects can swap the underlying MongoClient, which invalidates any active
 * ClientSession. Clearing here prevents subsequent tests from reusing a stale
 * or expired session.
 */
export const resetTestSessionAfterReconnect = async (): Promise<void> => {
  if (!currentTestSession) {
    resetSessionMutex();
    return;
  }

  try {
    if (currentTestSession.inTransaction()) {
      await currentTestSession.abortTransaction();
    }
    await currentTestSession.endSession();
  } catch {
    // Ignore cleanup failures; session is being discarded regardless.
  } finally {
    currentTestSession = null;
    resetSessionMutex();
  }
};

// ============================================================================
// Mongoose Monkey-Patches
// ============================================================================

/**
 * Installs Mongoose monkey-patches that inject the test session into all DB operations.
 *
 * Patches are idempotent — calling this multiple times is safe.
 * The patches only activate when currentTestSession is non-null (i.e., during a test).
 * All operations are serialized through the async mutex to prevent concurrent
 * operations on the same MongoDB session.
 *
 * Patched operations:
 * - Query.prototype.exec — covers find, findOne, updateOne, deleteMany, countDocuments, etc.
 * - Model.prototype.save and $save — covers save() and create() (Model.create calls $save)
 * - Aggregate.prototype.exec — covers aggregation pipelines
 * - Model.bulkWrite — covers bulk write operations
 * - Model.insertMany — covers bulk inserts (uses native driver, not save)
 * - Model.create — serializes multi-document creates (forces `ordered: true`) so
 *   their saves cannot race each other on the shared session
 * - Model.startSession — returns a no-op wrapper so app-level transactions don't conflict
 * - Collection.prototype (insertOne, updateOne, deleteOne, etc.) — covers native driver
 *   operations used by tests that call Model.collection.insertOne() directly
 *
 * When a model or collection uses a different MongoClient than the one that
 * created the test session, patches skip session injection for that operation
 * so the driver does not reject mismatched clients.
 */
export const installTransactionPatches = (): void => {
  if (patchesInstalled) {
    return;
  }

  // --- Query.prototype.exec ---
  const originalQueryExec = mongoose.Query.prototype.exec;
  mongoose.Query.prototype.exec = function (this: mongoose.Query<unknown, unknown>) {
    if (currentTestSession) {
      if (!shouldAttachTestSessionToConnection(this.model?.db)) {
        return originalQueryExec.apply(this);
      }
      let attempt = 0;
      return serialized(() => {
        // Query instances are single-use in Mongoose, so when serialized() retries
        // after restarting a transaction it must execute a fresh clone. The first
        // attempt runs the original: `clone()` drops per-instance hooks such as the
        // ones `doc.deleteOne()` registers to run document middleware.
        const queryForExecution = attempt === 0 ? this : this.clone();
        attempt++;
        queryForExecution.session(currentTestSession);
        return originalQueryExec.apply(queryForExecution);
      });
    }
    return originalQueryExec.apply(this);
  } as unknown as typeof mongoose.Query.prototype.exec;

  // --- Model.prototype.save and $save ---
  // Model.create() calls $save (not save). $save is assigned from save at module
  // load time (Model.prototype.$save = Model.prototype.save), so we must patch
  // both to ensure Model.create() goes through our session injection.
  const patchSave = (original: (...args: unknown[]) => unknown) =>
    function (
      this: mongoose.Document,
      options?: mongoose.SaveOptions | ((error: Error | null) => void)
    ) {
      if (currentTestSession) {
        const connection = (this.constructor as unknown as {db?: ConnectionLike}).db;
        if (!shouldAttachTestSessionToConnection(connection)) {
          return original.call(this, options);
        }
        if (typeof options === "function") {
          this.$session(currentTestSession);
          return serialized(() => original.call(this, options));
        }
        const optionsWithSession = {...(options ?? {}), session: currentTestSession};
        return serialized(() => original.call(this, optionsWithSession));
      }
      return original.call(this, options);
    };

  const originalSave = mongoose.Model.prototype.save;
  mongoose.Model.prototype.save = patchSave(
    originalSave as unknown as (...args: unknown[]) => unknown
  ) as unknown as typeof mongoose.Model.prototype.save;

  // $save is what Model.create() actually calls
  const original$Save = mongoose.Model.prototype.$save;
  mongoose.Model.prototype.$save = patchSave(
    original$Save as unknown as (...args: unknown[]) => unknown
  ) as unknown as typeof mongoose.Model.prototype.$save;

  // --- Aggregate.prototype.exec ---
  const originalAggExec = mongoose.Aggregate.prototype.exec;
  mongoose.Aggregate.prototype.exec = function (this: mongoose.Aggregate<unknown>) {
    if (currentTestSession) {
      const aggregateInternals = this as unknown as {
        _model?: {db?: ConnectionLike};
        _connection?: ConnectionLike;
      };
      const connection = aggregateInternals._model?.db ?? aggregateInternals._connection;
      if (!shouldAttachTestSessionToConnection(connection)) {
        return originalAggExec.apply(this);
      }
      this.session(currentTestSession);
      return serialized(() => originalAggExec.apply(this));
    }
    return originalAggExec.apply(this);
  } as unknown as typeof mongoose.Aggregate.prototype.exec;

  // --- Model.bulkWrite (static) ---
  const originalBulkWrite = mongoose.Model.bulkWrite as unknown as (
    this: unknown,
    ...args: unknown[]
  ) => unknown;
  mongoose.Model.bulkWrite = function (this: {db?: ConnectionLike}, ...args: unknown[]) {
    if (currentTestSession) {
      if (!shouldAttachTestSessionToConnection(this.db)) {
        return originalBulkWrite.apply(this, args);
      }
      const [ops, options] = args;
      const optionsWithSession = {...((options as object) ?? {}), session: currentTestSession};
      return serialized(() => originalBulkWrite.apply(this, [ops, optionsWithSession]));
    }
    return originalBulkWrite.apply(this, args);
  } as unknown as typeof mongoose.Model.bulkWrite;

  // --- Model.insertMany (static) ---
  const originalInsertMany = mongoose.Model.insertMany as unknown as (
    this: unknown,
    ...args: unknown[]
  ) => unknown;
  mongoose.Model.insertMany = function (this: {db?: ConnectionLike}, ...args: unknown[]) {
    if (currentTestSession) {
      if (!shouldAttachTestSessionToConnection(this.db)) {
        return originalInsertMany.apply(this, args);
      }
      const [docs, options] = args;
      const optionsWithSession = {...((options as object) ?? {}), session: currentTestSession};
      return serialized(() => originalInsertMany.apply(this, [docs, optionsWithSession]));
    }
    return originalInsertMany.apply(this, args);
  } as unknown as typeof mongoose.Model.insertMany;

  // --- Model.create (static) ---
  // Some code paths call Model.create() directly (including through
  // mongoose.Model.create.call(...)), which can otherwise bypass our top-level
  // serialization guard and race with other operations on the shared test
  // session. Wrapping create ensures transient transaction aborts trigger the
  // same auto-restart logic in serialized().
  //
  // Multi-document creates are additionally forced to `ordered: true`. Mongoose
  // saves an array of documents with `Promise.all` unless ordered, and those
  // nested saves are reentrant children of this critical section, so they skip
  // the mutex and hit the shared session concurrently. When such a create is the
  // first operation of a transaction, only one of the racing inserts carries
  // `startTransaction: true`; if a sibling reaches the server first, the server
  // rejects it with NoSuchTransaction ("Given transaction number N ... does not
  // match any in-progress transactions"). Mongoose enforces the same constraint
  // itself for explicitly-passed sessions — our session is injected lower down,
  // at `$save`, so that guard never sees it.
  // Varargs (`create(doc1, doc2)`) cannot carry options, so multi-document
  // calls are rewritten to the equivalent array form, which also returns an array.
  const toOrderedCreateArgs = (args: unknown[]): unknown[] => {
    if (Array.isArray(args[0])) {
      return [args[0], {...((args[1] as object) ?? {}), ordered: true}, ...args.slice(2)];
    }
    // Mongoose drops a trailing falsy argument from varargs creates.
    const docs = args.length > 1 && !args[args.length - 1] ? args.slice(0, -1) : args;
    return docs.length > 1 ? [docs, {ordered: true}] : args;
  };
  const originalCreate = mongoose.Model.create as unknown as (
    this: unknown,
    ...args: unknown[]
  ) => unknown;
  mongoose.Model.create = function (this: {db?: ConnectionLike}, ...args: unknown[]) {
    if (currentTestSession) {
      if (!shouldAttachTestSessionToConnection(this.db)) {
        return originalCreate.apply(this, args);
      }
      return serialized(() => originalCreate.apply(this, toOrderedCreateArgs(args)));
    }
    return originalCreate.apply(this, args);
  } as unknown as typeof mongoose.Model.create;

  // --- Model.startSession (static) ---
  // When test session is active, return a wrapper that redirects operations
  // through the test session. This ensures app code that creates its own
  // transactions doesn't bypass test isolation.
  const originalStartSession = mongoose.Model.startSession as unknown as (
    this: unknown,
    ...args: unknown[]
  ) => unknown;
  mongoose.Model.startSession = async function (this: unknown, ...args: unknown[]) {
    if (currentTestSession) {
      const testSession = currentTestSession;
      return {
        ...testSession,
        abortTransaction: async (): Promise<void> => {},
        commitTransaction: async (): Promise<void> => {},
        endSession: async (): Promise<void> => {},
        id: testSession.id,
        inTransaction: (): boolean => currentTestSession?.inTransaction() ?? false,
        startTransaction: (): void => {},
        withTransaction: async <T>(callback: (session: ClientSession) => Promise<T>): Promise<T> =>
          callback(testSession),
      };
    }
    return originalStartSession.apply(this, args);
  } as unknown as typeof mongoose.Model.startSession;

  // --- Collection.prototype (native driver operations) ---
  // Some test files call Model.collection.insertOne() etc. directly, bypassing
  // Mongoose. We patch the Mongoose Collection wrapper to inject the session
  // into these operations so they participate in the test transaction.
  //
  // Methods are grouped by their options argument position:
  // - optionsAt1: (docOrFilter, options?) — insertOne, deleteOne, deleteMany, findOne, etc.
  // - optionsAt2: (filter, update, options?) — updateOne, updateMany, findOneAndUpdate, etc.
  const patchCollectionMethod = (method: string, optionsIndex: number): void => {
    const collectionPrototype = mongoose.Collection.prototype as unknown as Record<string, unknown>;
    const original = collectionPrototype[method];
    if (typeof original !== "function") {
      return;
    }
    const originalMethod = original as (this: unknown, ...args: unknown[]) => unknown;
    collectionPrototype[method] = function (this: {conn?: ConnectionLike}, ...args: unknown[]) {
      if (!currentTestSession) {
        return originalMethod.apply(this, args);
      }
      if (!shouldAttachTestSessionToConnection(this.conn)) {
        return originalMethod.apply(this, args);
      }
      return serialized(() => {
        // Inject session into the options argument at the correct position
        const existingOptions = args[optionsIndex];
        if (existingOptions && typeof existingOptions === "object") {
          args[optionsIndex] = {...(existingOptions as object), session: currentTestSession};
        } else {
          args[optionsIndex] = {session: currentTestSession};
        }
        return originalMethod.apply(this, args);
      });
    };
  };

  // (docOrFilter, options?) — options at index 1
  for (const method of [
    "insertOne",
    "insertMany",
    "deleteOne",
    "deleteMany",
    "findOne",
    "findOneAndDelete",
    "countDocuments",
    "aggregate",
  ]) {
    patchCollectionMethod(method, 1);
  }

  // (filter, update/replacement, options?) — options at index 2
  for (const method of [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "findOneAndReplace",
    "replaceOne",
  ]) {
    patchCollectionMethod(method, 2);
  }

  patchesInstalled = true;
  if (process.env.DEBUG_TEST_TRANSACTION === "true") {
    console.debug("[testTransaction] Mongoose patches installed");
  }
};
