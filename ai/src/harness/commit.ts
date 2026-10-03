import {randomUUID} from "node:crypto";
import {DateTime, Duration} from "luxon";
import mongoose, {type ClientSession} from "mongoose";

import type {
  HarnessApprovalModel,
  HarnessChildTaskOptions,
  HarnessCommit,
  HarnessConversationModel,
  HarnessCreateTaskOptions,
  HarnessInboxEventModel,
  HarnessLeaseSettings,
  HarnessMemoModel,
  HarnessMessageModel,
  HarnessOwnerModel,
  HarnessOwnership,
  HarnessReplayPolicy,
  HarnessResolveInterruptedOptions,
  HarnessTaskDefinition,
  HarnessTaskDocument,
  HarnessTaskModel,
  HarnessTaskSpanKind,
  HarnessTestHooks,
  HarnessWaitCall,
  HarnessWaiting,
  HarnessWaitKind,
} from "../types/harness";
import {
  HARNESS_RESOLVE_ACTIONS,
  HARNESS_TASK_STATUSES,
  HARNESS_TERMINAL_STATUSES,
  HARNESS_WAIT_KINDS,
} from "../types/harness";
import type {ObsSpanModel, ObsTraceModel} from "../types/observability";

export interface HarnessModels {
  approval: HarnessApprovalModel;
  conversation: HarnessConversationModel;
  inbox: HarnessInboxEventModel;
  memo: HarnessMemoModel;
  message: HarnessMessageModel;
  owner: HarnessOwnerModel;
  span: ObsSpanModel;
  task: HarnessTaskModel;
  trace: ObsTraceModel;
}

/**
 * The task changed underneath this commit (checkpoint moved, status changed, or another
 * runner holds the lease); nothing was written and the result is discarded.
 */
export class HarnessCommitConflictError extends Error {
  constructor(taskId: string, phase: string) {
    super(`Harness commit for task ${taskId} phase "${phase}" lost its checkpoint fence`);
    this.name = "HarnessCommitConflictError";
  }
}

const DUPLICATE_KEY_CODE = 11000;

export const isDuplicateKeyError = (error: unknown): boolean => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as {code?: unknown}).code === DUPLICATE_KEY_CODE
  );
};

/**
 * Extra rows (messages, LLM spans, ...) written inside a commit's transaction, after the
 * task update. Every write must pass `session`. `task` is the task as updated (or
 * created); `traceStartedAt` anchors `startOffsetMs` for spans.
 */
export type HarnessCommitWrites = (context: {
  session: ClientSession;
  task: HarnessTaskDocument;
  traceStartedAt: DateTime;
}) => Promise<void>;

/** How the task's own audit span is named and typed. */
const taskSpanIdentity = (
  definition: HarnessTaskDefinition,
  input: unknown
): {kind: HarnessTaskSpanKind; name: string} => ({
  kind: definition.spanKind ?? "CHAIN",
  name: definition.spanName ? definition.spanName(input) : definition.key,
});

/** Run `work` in one Mongo transaction; every write inside must pass `session`. */
export const inTransaction = async <T>(
  work: (session: ClientSession) => Promise<T>
): Promise<T> => {
  const session = await mongoose.connection.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
};

/** Fresh lease fields for a phase that starts now under `lease.owner`. */
export const newTaskLease = (
  lease: HarnessLeaseSettings
): {acquiredAt: Date; expiresAt: Date; owner: string; token: string} => {
  const now = DateTime.now();
  return {
    acquiredAt: now.toJSDate(),
    expiresAt: now.plus(lease.duration).toJSDate(),
    owner: lease.owner,
    token: randomUUID(),
  };
};

const toObjectId = (
  value: mongoose.Types.ObjectId | string | undefined
): mongoose.Types.ObjectId | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" ? new mongoose.Types.ObjectId(value) : value;
};

const findByRequestId = async ({
  definition,
  models,
  requestId,
  userId,
}: {
  definition: HarnessTaskDefinition;
  models: HarnessModels;
  requestId: string;
  userId?: mongoose.Types.ObjectId;
}): Promise<HarnessTaskDocument> => {
  // Soft-deleted owners still hold the unique index entry, so look past the deleted filter.
  const existing = await models.task.findExactlyOne({deleted: {$in: [false, true]}, requestId});
  // Never hand one user's task (input, state) to another caller reusing the key.
  if (String(existing.userId ?? "") !== String(userId ?? "")) {
    throw new Error(`requestId "${requestId}" already belongs to a task for a different user`);
  }
  if (existing.name !== definition.name) {
    throw new Error(
      `requestId "${requestId}" already belongs to task ${existing._id} (${existing.name}), not ${definition.name}`
    );
  }
  return existing;
};

/**
 * Insert a root task with its `ObsTrace` and root `CHAIN` span in one transaction.
 * A repeated `requestId` hits the unique index, rolls the whole transaction back (so no
 * orphan trace survives), and returns the task that already owns it.
 */
export const createTaskRecords = async ({
  definition,
  input,
  models,
  options,
  ownership = {kind: "root"},
  writes,
}: {
  definition: HarnessTaskDefinition;
  input: unknown;
  models: HarnessModels;
  options: HarnessCreateTaskOptions;
  /** Root tasks default to `{kind: "root"}`; conversation turns are owned by the conversation. */
  ownership?: HarnessOwnership;
  writes?: HarnessCommitWrites;
}): Promise<HarnessTaskDocument> => {
  const initial = definition.initial(input);
  if (!definition.phases[initial.phase]) {
    throw new Error(
      `${definition.key}: initial phase "${initial.phase}" is not one of ${Object.keys(definition.phases).join(", ")}`
    );
  }

  const taskId = new mongoose.Types.ObjectId();
  const traceId = new mongoose.Types.ObjectId();
  const rootSpanId = new mongoose.Types.ObjectId();
  const traceStartedAt = DateTime.now();
  const startedAt = traceStartedAt.toJSDate();
  const userId = toObjectId(options.userId);
  const spanIdentity = taskSpanIdentity(definition, input);

  try {
    return await inTransaction(async (session) => {
      await models.trace.create(
        [{_id: traceId, input, name: definition.key, startedAt, status: "ok", userId}],
        {session}
      );
      await models.span.create(
        [
          {
            _id: rootSpanId,
            input,
            kind: spanIdentity.kind,
            name: spanIdentity.name,
            startedAt,
            startOffsetMs: 0,
            status: "ok",
            traceId,
          },
        ],
        {session}
      );
      const [task] = await models.task.create(
        [
          {
            _id: taskId,
            input,
            name: definition.name,
            ownership,
            phase: initial.phase,
            requestId: options.requestId,
            retry: definition.retry,
            rootSpanId,
            rootTaskId: taskId,
            state: initial.state,
            status: HARNESS_TASK_STATUSES.pending,
            traceId,
            userId,
            version: definition.version,
          },
        ],
        {session}
      );
      await writes?.({session, task, traceStartedAt});
      return task;
    });
  } catch (error: unknown) {
    // An earlier or concurrent create with the same requestId owns the unique index entry.
    if (options.requestId && isDuplicateKeyError(error)) {
      return findByRequestId({definition, models, requestId: options.requestId, userId});
    }
    throw error;
  }
};

/** Whether `task` is the top of its ownership tree, and so owns the `ObsTrace`. */
const isRootTask = (task: HarnessTaskDocument): boolean =>
  String(task._id) === String(task.rootTaskId);

/**
 * Idempotency key that names one child of one attempt of one phase visit of `parent`. A
 * re-run of the same attempt (wake, crash replay) finds the child again; a retry (next
 * attempt) or a later visit of the phase creates a fresh one.
 */
const childRequestId = ({key, parent}: {key: string; parent: HarnessTaskDocument}): string =>
  `harness-child:${parent._id}:${parent.step ?? 0}:${parent.attempt ?? 0}:${key}`;

/**
 * Insert a child task owned by `parent`, in `parent`'s trace, with its own `CHAIN` span
 * nested under `parent`'s span. Fenced on `parent`'s lease token (renewing the lease in
 * the same transaction), so a runner that lost the parent cannot create children. A
 * repeated `key` within the same attempt of a phase visit returns the child created first.
 */
export const createChildTaskRecords = async ({
  definition,
  input,
  key,
  lease,
  models,
  options,
  parent,
  span,
  writes,
}: {
  definition: HarnessTaskDefinition;
  input: unknown;
  key: string;
  lease: HarnessLeaseSettings;
  models: HarnessModels;
  options: HarnessChildTaskOptions;
  parent: HarnessTaskDocument;
  /** Replaces the definition's span identity (and the span's input) for this child. */
  span?: {input?: unknown; kind: HarnessTaskSpanKind; name: string};
  /** Rows created with the child, in its transaction (a subagent's conversation). */
  writes?: HarnessCommitWrites;
}): Promise<HarnessTaskDocument> => {
  const initial = definition.initial(input);
  if (!definition.phases[initial.phase]) {
    throw new Error(
      `${definition.key}: initial phase "${initial.phase}" is not one of ${Object.keys(definition.phases).join(", ")}`
    );
  }
  const requestId = childRequestId({key, parent});
  const existing = await models.task.findOneOrNone({deleted: {$in: [false, true]}, requestId});
  if (existing) {
    if (existing.name !== definition.name) {
      throw new Error(
        `Child key "${key}" already belongs to task ${existing._id} (${existing.name}), not ${definition.name}`
      );
    }
    return existing;
  }

  const trace = await models.trace.findExactlyOne({_id: parent.traceId});
  const taskId = new mongoose.Types.ObjectId();
  const spanId = new mongoose.Types.ObjectId();
  const startedAt = DateTime.now();
  const spanIdentity = span ?? taskSpanIdentity(definition, input);
  const spanInput = span && "input" in span ? span.input : input;

  try {
    return await inTransaction(async (session) => {
      const fenced = await models.task.updateOne(
        {
          _id: parent._id,
          "lease.token": parent.lease?.token ?? null,
          phase: parent.phase,
          status: HARNESS_TASK_STATUSES.running,
        },
        {$set: {"lease.expiresAt": startedAt.plus(lease.duration).toJSDate()}},
        {session}
      );
      if (fenced.matchedCount === 0) {
        throw new HarnessCommitConflictError(String(parent._id), parent.phase);
      }
      await models.span.create(
        [
          {
            _id: spanId,
            input: spanInput,
            kind: spanIdentity.kind,
            name: spanIdentity.name,
            parentSpanId: parent.rootSpanId,
            startedAt: startedAt.toJSDate(),
            startOffsetMs: startedAt.diff(DateTime.fromJSDate(trace.startedAt)).toMillis(),
            status: "ok",
            traceId: parent.traceId,
          },
        ],
        {session}
      );
      const [task] = await models.task.create(
        [
          {
            _id: taskId,
            background: options.background ?? false,
            input,
            name: definition.name,
            ownership: {id: parent._id, kind: "task"},
            phase: initial.phase,
            requestId,
            retry: definition.retry,
            rootSpanId: spanId,
            rootTaskId: parent.rootTaskId,
            state: initial.state,
            status: HARNESS_TASK_STATUSES.pending,
            traceId: parent.traceId,
            userId: parent.userId,
            version: definition.version,
          },
        ],
        {session}
      );
      await writes?.({session, task, traceStartedAt: DateTime.fromJSDate(trace.startedAt)});
      return task;
    });
  } catch (error: unknown) {
    // A concurrent run of the same phase visit created this child first.
    if (isDuplicateKeyError(error)) {
      return models.task.findExactlyOne({deleted: {$in: [false, true]}, requestId});
    }
    throw error;
  }
};

const describeNext = (next: HarnessCommit<unknown, unknown>): Record<string, unknown> => {
  if ("terminal" in next) {
    return {terminal: next.terminal};
  }
  return {phase: next.phase, state: next.state};
};

interface TransitionSpan {
  error?: string;
  input: unknown;
  name: string;
  output: unknown;
  startedAt: DateTime;
  status: "error" | "ok";
}

interface TransitionClose {
  error?: string;
  output: unknown;
  status: "error" | "ok";
}

/**
 * Apply one fenced task update and insert its `CHAIN` span (closing the root span and
 * `ObsTrace` when `close` is set) in a single transaction. Throws
 * `HarnessCommitConflictError`, writing nothing, when `filter` no longer matches.
 */
const commitTransition = async ({
  close,
  filter,
  models,
  span,
  task,
  testHooks,
  update,
  writes,
}: {
  close?: TransitionClose;
  filter: Record<string, unknown>;
  models: HarnessModels;
  span: TransitionSpan;
  task: HarnessTaskDocument;
  testHooks?: HarnessTestHooks;
  update: Record<string, unknown>;
  writes?: HarnessCommitWrites;
}): Promise<HarnessTaskDocument> => {
  const taskId = String(task._id);
  const trace = await models.trace.findExactlyOne({_id: task.traceId});
  const traceStartedAt = DateTime.fromJSDate(trace.startedAt);
  // A root task's span starts with the trace; a child's span starts when it was created.
  const taskSpanStartedAt =
    close && !isRootTask(task)
      ? DateTime.fromJSDate((await models.span.findExactlyOne({_id: task.rootSpanId})).startedAt)
      : traceStartedAt;
  const endedAt = DateTime.now();

  return inTransaction(async (session) => {
    const updated = await models.task.findOneAndUpdate({_id: task._id, ...filter}, update, {
      returnDocument: "after",
      session,
    });
    if (!updated) {
      throw new HarnessCommitConflictError(taskId, task.phase);
    }

    await models.span.create(
      [
        {
          durationMs: endedAt.diff(span.startedAt).toMillis(),
          endedAt: endedAt.toJSDate(),
          error: span.error,
          input: span.input,
          kind: "CHAIN",
          name: span.name,
          output: span.output,
          parentSpanId: task.rootSpanId,
          startedAt: span.startedAt.toJSDate(),
          startOffsetMs: span.startedAt.diff(traceStartedAt).toMillis(),
          status: span.status,
          traceId: task.traceId,
        },
      ],
      {session}
    );

    if (close) {
      // A child closes its own span; only the root task closes the shared trace.
      await models.span.updateOne(
        {_id: task.rootSpanId},
        {
          $set: {
            durationMs: endedAt.diff(taskSpanStartedAt).toMillis(),
            endedAt: endedAt.toJSDate(),
            error: close.error,
            output: close.output,
            status: close.status,
          },
        },
        {session}
      );
    }
    if (close && isRootTask(task)) {
      await models.trace.updateOne(
        {_id: task.traceId},
        {
          $set: {
            endedAt: endedAt.toJSDate(),
            errorSummary: close.error,
            output: close.output,
            status: close.status,
          },
        },
        {session}
      );
    }

    await writes?.({session, task: updated, traceStartedAt});
    await testHooks?.beforeCommitEnd?.({phase: task.phase, session, taskId});
    return updated;
  });
};

/** Fence for every commit made by the run that holds `task`'s current lease. */
const runFence = (task: HarnessTaskDocument): Record<string, unknown> => ({
  "lease.token": task.lease?.token ?? null,
  phase: task.phase,
  status: HARNESS_TASK_STATUSES.running,
});

/**
 * Commit one phase: update the task checkpoint (or terminal outcome) and insert the
 * phase's `CHAIN` span in a single transaction. The commit is fenced by the task's
 * status, phase, and lease token, so a runner that lost its lease writes nothing. A
 * phase commit hands the next phase a fresh lease token; a terminal commit clears the
 * lease and closes the root span and `ObsTrace`.
 */
export const commitPhase = async ({
  failedAttempts,
  lease,
  models,
  next,
  phaseStartedAt,
  task,
  testHooks,
  writes,
}: {
  /** Set when the phase failed for good; recorded as the task's `attempt`. */
  failedAttempts?: number;
  lease: HarnessLeaseSettings;
  models: HarnessModels;
  next: HarnessCommit<unknown, unknown>;
  phaseStartedAt: DateTime;
  task: HarnessTaskDocument;
  testHooks?: HarnessTestHooks;
  /** Extra rows committed in the same transaction (agent messages, LLM spans). */
  writes?: HarnessCommitWrites;
}): Promise<HarnessTaskDocument> => {
  const isTerminal = "terminal" in next;
  const error = isTerminal && next.terminal.status === "failed" ? next.terminal.error : undefined;
  const isFailure = error !== undefined;

  const update = isTerminal
    ? {
        $set: {
          outcome: next.terminal,
          status: next.terminal.status,
          ...(failedAttempts === undefined ? {} : {attempt: failedAttempts}),
        },
        $unset: {lease: 1, runAt: 1, waits: 1},
      }
    : {
        $inc: {step: 1},
        $set: {
          attempt: 0,
          lease: newTaskLease(lease),
          phase: next.phase,
          state: next.state === undefined ? task.state : next.state,
        },
        // Wait records belong to one phase visit; the next visit starts with none.
        $unset: {runAt: 1, waits: 1},
      };

  return commitTransition({
    close: isTerminal
      ? {
          error,
          output: next.terminal.status === "failed" ? {error} : next.terminal.result,
          status: isFailure ? "error" : "ok",
        }
      : undefined,
    // A task without a lease (written before leases existed) is fenced on "no token".
    filter: runFence(task),
    models,
    span: {
      error,
      input: {attempt: task.attempt, state: task.state},
      name: task.phase,
      output: describeNext(next),
      startedAt: phaseStartedAt,
      status: isFailure ? "error" : "ok",
    },
    task,
    testHooks,
    update,
    writes,
  });
};

/**
 * Record a thrown phase that has attempts left: back to `pending` at the same checkpoint
 * with `attempt` raised and `runAt` set to the backoff time, plus an error `CHAIN` span,
 * in one transaction fenced on the run's lease token.
 */
export const commitRetry = async ({
  error,
  failedAttempts,
  maxAttempts,
  models,
  phaseStartedAt,
  runAt,
  task,
  testHooks,
}: {
  error: string;
  failedAttempts: number;
  maxAttempts: number;
  models: HarnessModels;
  phaseStartedAt: DateTime;
  runAt: DateTime;
  task: HarnessTaskDocument;
  testHooks?: HarnessTestHooks;
}): Promise<HarnessTaskDocument> => {
  return commitTransition({
    filter: runFence(task),
    models,
    span: {
      error,
      input: {attempt: task.attempt, state: task.state},
      name: task.phase,
      output: {retry: {attempt: failedAttempts, maxAttempts, runAt: runAt.toISO()}},
      startedAt: phaseStartedAt,
      status: "error",
    },
    task,
    testHooks,
    update: {
      $set: {
        attempt: failedAttempts,
        runAt: runAt.toJSDate(),
        status: HARNESS_TASK_STATUSES.pending,
      },
      $unset: {lease: 1},
    },
  });
};

/**
 * Park a running task as `waiting` on `waiting` (child tasks, an event, or a sleep). Gives
 * up the lease so no runner holds the task while it waits; the phase re-runs from its
 * checkpoint once the wait is satisfied. `waitCall` records the `rt.waitFor` / `rt.sleep`
 * call that started the wait. An event wait checks the inbox inside the transaction and,
 * when a matching event is already buffered, returns the task straight to `pending`:
 * `sendEvent` writes the task in its own transaction, so the two can never miss each other.
 */
export const commitWaiting = async ({
  models,
  phaseStartedAt,
  task,
  testHooks,
  waitCall,
  waiting,
  writes,
}: {
  models: HarnessModels;
  phaseStartedAt: DateTime;
  task: HarnessTaskDocument;
  testHooks?: HarnessTestHooks;
  waitCall?: {entry: HarnessWaitCall; key: string};
  waiting: HarnessWaiting;
  /** Extra rows committed with the wait (an approval request). */
  writes?: HarnessCommitWrites;
}): Promise<{isWoken: boolean; task: HarnessTaskDocument}> => {
  let isWoken = false;
  const committed = await commitTransition({
    filter: runFence(task),
    models,
    span: {
      input: {attempt: task.attempt, state: task.state},
      name: task.phase,
      output: {
        waiting: {
          ...waiting,
          taskIds: waiting.taskIds?.map(String),
          timeoutAt: waiting.timeoutAt?.toISOString(),
        },
      },
      startedAt: phaseStartedAt,
      status: "ok",
    },
    task,
    testHooks,
    update: {
      $set: {
        status: HARNESS_TASK_STATUSES.waiting,
        waiting,
        ...(waitCall ? {[`waits.${waitCall.key}`]: waitCall.entry} : {}),
      },
      $unset: {lease: 1},
    },
    writes: async (context) => {
      const {session} = context;
      isWoken = false;
      await writes?.(context);
      if (waiting.kind !== HARNESS_WAIT_KINDS.event || !waiting.key) {
        return;
      }
      const buffered = await models.inbox.countDocuments(
        {consumedKey: {$exists: false}, name: waiting.key, taskId: task._id},
        {session}
      );
      if (buffered === 0) {
        return;
      }
      await models.task.updateOne(
        {_id: task._id},
        {$set: {status: HARNESS_TASK_STATUSES.pending}, $unset: {waiting: 1}},
        {session}
      );
      isWoken = true;
    },
  });
  return {isWoken, task: committed};
};

/**
 * Record how one `rt.waitFor` / `rt.sleep` call resolved, plus its resume span, in one
 * transaction fenced on the run's lease. `writes` claims the delivered event in the same
 * transaction. The phase keeps running under its lease.
 */
export const commitWaitResolution = async ({
  callKey,
  entry,
  lease,
  models,
  span,
  task,
  testHooks,
  writes,
}: {
  callKey: string;
  entry: HarnessWaitCall;
  lease: HarnessLeaseSettings;
  models: HarnessModels;
  span: {input: unknown; name: string; output: unknown};
  task: HarnessTaskDocument;
  testHooks?: HarnessTestHooks;
  writes?: HarnessCommitWrites;
}): Promise<void> => {
  await commitTransition({
    filter: runFence(task),
    models,
    span: {...span, startedAt: DateTime.fromJSDate(entry.startedAt), status: "ok"},
    task,
    testHooks,
    update: {
      $set: {
        "lease.expiresAt": DateTime.now().plus(lease.duration).toJSDate(),
        [`waits.${callKey}`]: entry,
      },
    },
    writes,
  });
};

/**
 * Return a `waiting` task to `pending` at the same checkpoint. Fenced on the wait it was
 * parked on, so only one waker wins and a task that left `waiting` is untouched. Returns
 * whether this call woke it.
 */
export const wakeWaitingTask = async ({
  kind,
  models,
  taskId,
}: {
  kind: HarnessWaitKind;
  models: HarnessModels;
  taskId: mongoose.Types.ObjectId;
}): Promise<boolean> => {
  const result = await models.task.updateOne(
    {_id: taskId, status: HARNESS_TASK_STATUSES.waiting, "waiting.kind": kind},
    {$set: {status: HARNESS_TASK_STATUSES.pending}, $unset: {waiting: 1}}
  );
  return result.modifiedCount > 0;
};

/**
 * First step of an abort: record the request (which stops runners from claiming the
 * task) and, when a phase is running, rotate its lease token so the run's commits,
 * child creation, and lease renewals all fail from here on. Returns the task as it now
 * stands, or null when it is already terminal.
 */
export const fenceForAbort = async ({
  models,
  reason,
  taskId,
  userId,
}: {
  models: HarnessModels;
  reason: string;
  taskId: mongoose.Types.ObjectId;
  userId?: string;
}): Promise<HarnessTaskDocument | null> => {
  const nonTerminal = {$nin: [...HARNESS_TERMINAL_STATUSES]};
  // The first request wins; a repeated abort keeps its record (and any handler claim).
  await models.task.updateOne(
    {_id: taskId, "abortRequested.at": {$exists: false}, status: nonTerminal},
    {$set: {abortRequested: {at: DateTime.now().toJSDate(), reason, userId: toObjectId(userId)}}}
  );
  const requested = await models.task.findOneOrNone({_id: taskId, status: nonTerminal});
  if (!requested || requested.status !== HARNESS_TASK_STATUSES.running) {
    return requested;
  }
  // Not fenced on the old token: a phase that just committed holds a newer one.
  const revoked = await models.task.findOneAndUpdate(
    {_id: taskId, status: HARNESS_TASK_STATUSES.running},
    {$set: {"lease.token": `abort:${randomUUID()}`}},
    {returnDocument: "after"}
  );
  return revoked ?? models.task.findOneOrNone({_id: taskId, status: nonTerminal});
};

/**
 * How long one aborter holds a task's abort-handler claim. Another abort of the same task
 * waits for the claim holder to finish, and takes over only after this lapses (the holder
 * died mid-handler).
 */
const ABORT_HANDLER_CLAIM = Duration.fromObject({minutes: 1});

/**
 * Claim the right to run `taskId`'s abort handler and commit its abort, so concurrent
 * aborts (an operator and a failFast sibling, say) never run one handler twice. Returns
 * false while another live aborter holds the claim, or once the task is terminal.
 */
export const claimAbortHandler = async ({
  models,
  taskId,
}: {
  models: HarnessModels;
  taskId: mongoose.Types.ObjectId;
}): Promise<boolean> => {
  const now = DateTime.now();
  const claimed = await models.task.updateOne(
    {
      _id: taskId,
      $or: [
        {"abortRequested.handlerClaimExpiresAt": {$exists: false}},
        {"abortRequested.handlerClaimExpiresAt": {$lte: now.toJSDate()}},
      ],
      status: {$nin: [...HARNESS_TERMINAL_STATUSES]},
    },
    {$set: {"abortRequested.handlerClaimExpiresAt": now.plus(ABORT_HANDLER_CLAIM).toJSDate()}}
  );
  return claimed.modifiedCount > 0;
};

/**
 * Mark a task `aborted` with `outcome.error`, clear its lease and wait, close its span
 * (and the trace for a root task), and write one audit span, in one transaction. Fenced
 * on `filter` (status only, not the lease token: an abort deliberately overrides the
 * run in flight, whose later commit is then rejected).
 */
export const commitAbort = async ({
  error,
  filter,
  models,
  span,
  task,
  testHooks,
}: {
  error: string;
  filter: Record<string, unknown>;
  models: HarnessModels;
  span: {error?: string; name: string; output: unknown; status: "error" | "ok"};
  task: HarnessTaskDocument;
  testHooks?: HarnessTestHooks;
}): Promise<HarnessTaskDocument> => {
  return commitTransition({
    close: {error, output: {error}, status: "error"},
    filter,
    models,
    span: {
      ...span,
      input: {phase: task.phase, state: task.state, status: task.status},
      startedAt: DateTime.now(),
    },
    task,
    testHooks,
    update: {
      $set: {
        outcome: {error, status: HARNESS_TASK_STATUSES.aborted},
        status: HARNESS_TASK_STATUSES.aborted,
      },
      $unset: {lease: 1, runAt: 1, waiting: 1, waits: 1},
    },
  });
};

/** Mongo filter for a `running` task whose lease lapsed (or that never had one). */
export const expiredLeaseFilter = (now: DateTime): Record<string, unknown> => ({
  $or: [{"lease.expiresAt": {$lte: now.toJSDate()}}, {"lease.expiresAt": {$exists: false}}],
  status: HARNESS_TASK_STATUSES.running,
});

/** What recovery does with a task whose lease expired mid-phase. */
export type HarnessInterruptionAction = "fail" | "park" | "replay";

const interruptionOutcomes = (
  leaseOwner: string
): Record<
  HarnessInterruptionAction,
  {error: string; replay: HarnessReplayPolicy; status: HarnessTaskDocument["status"]}
> => ({
  fail: {
    error: `Interrupted, not retried: lease of ${leaseOwner} expired mid-phase (replay: never)`,
    replay: "never",
    status: HARNESS_TASK_STATUSES.failed,
  },
  park: {
    error: `Interrupted: lease of ${leaseOwner} expired mid-phase; awaiting resolveInterrupted (replay: never)`,
    replay: "never",
    status: HARNESS_TASK_STATUSES.interrupted,
  },
  replay: {
    error: `Interrupted: lease of ${leaseOwner} expired mid-phase; re-running (replay: safe)`,
    replay: "safe",
    status: HARNESS_TASK_STATUSES.pending,
  },
});

/**
 * Record that a task's lease expired mid-phase. `replay` returns it to `pending` at the
 * same checkpoint so a runner re-runs the phase; `park` sets `interrupted` for
 * `resolveInterrupted`; `fail` (a `replay: "never"` phase of an `onInterrupt: "fail"`
 * task) ends it `failed` with an "Interrupted, not retried" outcome and closes its span.
 * Each writes an error `CHAIN` span in the same transaction. Fenced on the expired lease,
 * so a renewed lease is left alone.
 */
export const commitInterruption = async ({
  action,
  models,
  task,
  testHooks,
}: {
  action: HarnessInterruptionAction;
  models: HarnessModels;
  task: HarnessTaskDocument;
  testHooks?: HarnessTestHooks;
}): Promise<HarnessTaskDocument> => {
  const now = DateTime.now();
  const leaseOwner = task.lease?.owner ?? "unknown";
  const {error, replay, status} = interruptionOutcomes(leaseOwner)[action];
  const isFailure = action === "fail";

  return commitTransition({
    close: isFailure ? {error, output: {error}, status: "error"} : undefined,
    filter: {
      ...expiredLeaseFilter(now),
      phase: task.phase,
      // Fence on the token from the snapshot so the span names the lease that actually lapsed
      ...(task.lease?.token ? {"lease.token": task.lease.token} : {}),
    },
    models,
    span: {
      error,
      input: {attempt: task.attempt, state: task.state},
      name: task.phase,
      output: {interrupted: true, leaseOwner, replay, status},
      startedAt: task.lease?.acquiredAt ? DateTime.fromJSDate(task.lease.acquiredAt) : now,
      status: "error",
    },
    task,
    testHooks,
    update: isFailure
      ? {$set: {outcome: {error, status}, status}, $unset: {lease: 1, runAt: 1, waits: 1}}
      : {$set: {status}, $unset: {lease: 1}},
  });
};

/**
 * Apply an operator's `retry` or `complete` decision to an `interrupted` task and audit
 * it with a `resolveInterrupted` span recording action, reason, and `decidedBy`. An
 * `abort` decision goes through the abort path so the task's abort handler runs.
 */
export const commitResolution = async ({
  models,
  options,
  task,
  testHooks,
}: {
  models: HarnessModels;
  options: HarnessResolveInterruptedOptions & {action: "complete" | "retry"};
  task: HarnessTaskDocument;
  testHooks?: HarnessTestHooks;
}): Promise<HarnessTaskDocument> => {
  const {action, reason, result} = options;
  const decidedBy = options.userId === undefined ? undefined : String(options.userId);

  const resolutions = {
    [HARNESS_RESOLVE_ACTIONS.complete]: {
      close: {output: result, status: "ok" as const},
      update: {
        $set: {
          outcome: {result, status: HARNESS_TASK_STATUSES.completed},
          status: HARNESS_TASK_STATUSES.completed,
        },
      },
    },
    [HARNESS_RESOLVE_ACTIONS.retry]: {
      close: undefined,
      update: {$set: {status: HARNESS_TASK_STATUSES.pending}},
    },
  };
  const resolution = resolutions[action];

  return commitTransition({
    close: resolution.close,
    filter: {phase: task.phase, status: HARNESS_TASK_STATUSES.interrupted},
    models,
    span: {
      input: {phase: task.phase, state: task.state},
      name: "resolveInterrupted",
      output: {action, decidedBy, phase: task.phase, reason, result},
      startedAt: DateTime.now(),
      status: "ok",
    },
    task,
    testHooks,
    update: resolution.update,
  });
};
