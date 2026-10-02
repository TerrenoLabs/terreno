import {DateTime} from "luxon";
import mongoose, {type ClientSession} from "mongoose";

import type {
  HarnessCommit,
  HarnessCreateTaskOptions,
  HarnessTaskDefinition,
  HarnessTaskDocument,
  HarnessTaskModel,
  HarnessTestHooks,
} from "../types/harness";
import {HARNESS_TASK_STATUSES} from "../types/harness";
import type {ObsSpanModel, ObsTraceModel} from "../types/observability";

export interface HarnessModels {
  span: ObsSpanModel;
  task: HarnessTaskModel;
  trace: ObsTraceModel;
}

/** The task changed underneath this commit; the phase result is discarded. */
export class HarnessCommitConflictError extends Error {
  constructor(taskId: string, phase: string) {
    super(`Harness commit for task ${taskId} phase "${phase}" lost its checkpoint fence`);
    this.name = "HarnessCommitConflictError";
  }
}

const DUPLICATE_KEY_CODE = 11000;

const isDuplicateKeyError = (error: unknown): boolean => {
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

/**
 * Commit one phase: update the task checkpoint (or terminal outcome) and insert the
 * phase's `CHAIN` span in a single transaction. On a terminal commit the root span and
 * `ObsTrace` are closed in the same transaction.
 */
export const commitPhase = async ({
  models,
  next,
  phaseStartedAt,
  task,
  testHooks,
}: {
  models: HarnessModels;
  next: HarnessCommit<unknown, unknown>;
  phaseStartedAt: DateTime;
  task: HarnessTaskDocument;
  testHooks?: HarnessTestHooks;
}): Promise<HarnessTaskDocument> => {
  const taskId = String(task._id);
  const trace = await models.trace.findExactlyOne({_id: task.traceId});
  const traceStartedAt = DateTime.fromJSDate(trace.startedAt);
  const endedAt = DateTime.now();
  const isTerminal = "terminal" in next;
  const isFailure = isTerminal && next.terminal.status === "failed";
  const error = isTerminal && next.terminal.status === "failed" ? next.terminal.error : undefined;

  const taskUpdate: Record<string, unknown> = isTerminal
    ? {
        outcome: next.terminal,
        status: next.terminal.status,
      }
    : {
        attempt: 0,
        phase: next.phase,
        state: next.state === undefined ? task.state : next.state,
      };

  return inTransaction(async (session) => {
    // The (status, phase) fence rejects a commit whose checkpoint moved on; Task 1.2
    // adds the lease token to this filter.
    const updated = await models.task.findOneAndUpdate(
      {_id: task._id, phase: task.phase, status: HARNESS_TASK_STATUSES.running},
      {$set: taskUpdate},
      {returnDocument: "after", session}
    );
    if (!updated) {
      throw new HarnessCommitConflictError(taskId, task.phase);
    }

    await models.span.create(
      [
        {
          durationMs: endedAt.diff(phaseStartedAt).toMillis(),
          endedAt: endedAt.toJSDate(),
          error,
          input: {attempt: task.attempt, state: task.state},
          kind: "CHAIN",
          name: task.phase,
          output: describeNext(next),
          parentSpanId: task.rootSpanId,
          startedAt: phaseStartedAt.toJSDate(),
          startOffsetMs: phaseStartedAt.diff(traceStartedAt).toMillis(),
          status: isFailure ? "error" : "ok",
          traceId: task.traceId,
        },
      ],
      {session}
    );

    if (isTerminal) {
      const status = isFailure ? "error" : "ok";
      const output = next.terminal.status === "failed" ? {error} : next.terminal.result;
      await models.span.updateOne(
        {_id: task.rootSpanId},
        {
          $set: {
            durationMs: endedAt.diff(traceStartedAt).toMillis(),
            endedAt: endedAt.toJSDate(),
            error,
            output,
            status,
          },
        },
        {session}
      );
      await models.trace.updateOne(
        {_id: task.traceId},
        {$set: {endedAt: endedAt.toJSDate(), errorSummary: error, output, status}},
        {session}
      );
    }

    await testHooks?.beforeCommitEnd?.({phase: task.phase, session, taskId});
    return updated;
  });
};
