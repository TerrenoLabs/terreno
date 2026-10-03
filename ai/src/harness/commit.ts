import {randomUUID} from "node:crypto";
import {DateTime} from "luxon";
import mongoose, {type ClientSession} from "mongoose";

import type {
  HarnessCommit,
  HarnessCreateTaskOptions,
  HarnessLeaseSettings,
  HarnessOwnerModel,
  HarnessReplayPolicy,
  HarnessResolveInterruptedOptions,
  HarnessTaskDefinition,
  HarnessTaskDocument,
  HarnessTaskModel,
  HarnessTestHooks,
} from "../types/harness";
import {HARNESS_RESOLVE_ACTIONS, HARNESS_TASK_STATUSES} from "../types/harness";
import type {ObsSpanModel, ObsTraceModel} from "../types/observability";

export interface HarnessModels {
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

/** Run `work` in one Mongo transaction; every write inside must pass `session`. */
const inTransaction = async <T>(work: (session: ClientSession) => Promise<T>): Promise<T> => {
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
}: {
  definition: HarnessTaskDefinition;
  input: unknown;
  models: HarnessModels;
  options: HarnessCreateTaskOptions;
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
  const startedAt = DateTime.now().toJSDate();
  const userId = toObjectId(options.userId);

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
            kind: "CHAIN",
            name: definition.key,
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
            ownership: {kind: "root"},
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
}: {
  close?: TransitionClose;
  filter: Record<string, unknown>;
  models: HarnessModels;
  span: TransitionSpan;
  task: HarnessTaskDocument;
  testHooks?: HarnessTestHooks;
  update: Record<string, unknown>;
}): Promise<HarnessTaskDocument> => {
  const taskId = String(task._id);
  const trace = await models.trace.findExactlyOne({_id: task.traceId});
  const traceStartedAt = DateTime.fromJSDate(trace.startedAt);
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
      await models.span.updateOne(
        {_id: task.rootSpanId},
        {
          $set: {
            durationMs: endedAt.diff(traceStartedAt).toMillis(),
            endedAt: endedAt.toJSDate(),
            error: close.error,
            output: close.output,
            status: close.status,
          },
        },
        {session}
      );
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

    await testHooks?.beforeCommitEnd?.({phase: task.phase, session, taskId});
    return updated;
  });
};

/**
 * Commit one phase: update the task checkpoint (or terminal outcome) and insert the
 * phase's `CHAIN` span in a single transaction. The commit is fenced by the task's
 * status, phase, and lease token, so a runner that lost its lease writes nothing. A
 * phase commit hands the next phase a fresh lease token; a terminal commit clears the
 * lease and closes the root span and `ObsTrace`.
 */
export const commitPhase = async ({
  lease,
  models,
  next,
  phaseStartedAt,
  task,
  testHooks,
}: {
  lease: HarnessLeaseSettings;
  models: HarnessModels;
  next: HarnessCommit<unknown, unknown>;
  phaseStartedAt: DateTime;
  task: HarnessTaskDocument;
  testHooks?: HarnessTestHooks;
}): Promise<HarnessTaskDocument> => {
  const isTerminal = "terminal" in next;
  const error = isTerminal && next.terminal.status === "failed" ? next.terminal.error : undefined;
  const isFailure = error !== undefined;

  const update = isTerminal
    ? {$set: {outcome: next.terminal, status: next.terminal.status}, $unset: {lease: 1}}
    : {
        $set: {
          attempt: 0,
          lease: newTaskLease(lease),
          phase: next.phase,
          state: next.state === undefined ? task.state : next.state,
        },
      };

  return commitTransition({
    close: isTerminal
      ? {
          error,
          output: next.terminal.status === "failed" ? {error} : next.terminal.result,
          status: isFailure ? "error" : "ok",
        }
      : undefined,
    filter: {
      // A task without a lease (written before leases existed) is fenced on "no token".
      "lease.token": task.lease?.token ?? null,
      phase: task.phase,
      status: HARNESS_TASK_STATUSES.running,
    },
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
  });
};

/** Mongo filter for a `running` task whose lease lapsed (or that never had one). */
export const expiredLeaseFilter = (now: DateTime): Record<string, unknown> => ({
  $or: [{"lease.expiresAt": {$lte: now.toJSDate()}}, {"lease.expiresAt": {$exists: false}}],
  status: HARNESS_TASK_STATUSES.running,
});

/**
 * Record that a task's lease expired mid-phase. `replay: "safe"` returns it to `pending`
 * at the same checkpoint so a runner re-runs the phase; `never` parks it `interrupted`
 * for `resolveInterrupted`. Either way an error `CHAIN` span records the interruption in
 * the same transaction. Fenced on the expired lease, so a renewed lease is left alone.
 */
export const commitInterruption = async ({
  models,
  replay,
  task,
  testHooks,
}: {
  models: HarnessModels;
  replay: HarnessReplayPolicy;
  task: HarnessTaskDocument;
  testHooks?: HarnessTestHooks;
}): Promise<HarnessTaskDocument> => {
  const now = DateTime.now();
  const isReplay = replay === "safe";
  const leaseOwner = task.lease?.owner ?? "unknown";
  const error = isReplay
    ? `Interrupted: lease of ${leaseOwner} expired mid-phase; re-running (replay: safe)`
    : `Interrupted: lease of ${leaseOwner} expired mid-phase; awaiting resolveInterrupted (replay: never)`;
  const status = isReplay ? HARNESS_TASK_STATUSES.pending : HARNESS_TASK_STATUSES.interrupted;

  return commitTransition({
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
    update: {$set: {status}, $unset: {lease: 1}},
  });
};

/**
 * Apply an operator's decision to an `interrupted` task and audit it with a
 * `resolveInterrupted` span recording action, reason, and `decidedBy`.
 */
export const commitResolution = async ({
  models,
  options,
  task,
  testHooks,
}: {
  models: HarnessModels;
  options: HarnessResolveInterruptedOptions;
  task: HarnessTaskDocument;
  testHooks?: HarnessTestHooks;
}): Promise<HarnessTaskDocument> => {
  const {action, reason, result} = options;
  const decidedBy = options.userId === undefined ? undefined : String(options.userId);
  const abortError = `Aborted after interruption: ${reason}`;

  const resolutions = {
    [HARNESS_RESOLVE_ACTIONS.abort]: {
      close: {error: abortError, output: {error: abortError}, status: "error" as const},
      update: {
        $set: {
          outcome: {error: abortError, status: HARNESS_TASK_STATUSES.aborted},
          status: HARNESS_TASK_STATUSES.aborted,
        },
      },
    },
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
