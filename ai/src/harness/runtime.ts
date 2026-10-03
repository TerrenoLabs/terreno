import {logger} from "@terreno/api";
import {DateTime} from "luxon";

import mongoose from "mongoose";

import type {
  HarnessChildOutcome,
  HarnessChildTaskOptions,
  HarnessCommit,
  HarnessLeaseSettings,
  HarnessTaskDefinition,
  HarnessTaskDocument,
  HarnessTaskRuntime,
  HarnessWaitForTasksOptions,
} from "../types/harness";
import {
  HARNESS_TASK_STATUSES,
  HARNESS_TERMINAL_STATUSES,
  HARNESS_WAIT_KINDS,
  HARNESS_WAIT_POLICIES,
} from "../types/harness";
import {
  commitInterruption,
  commitPhase,
  commitRetry,
  commitWaiting,
  createChildTaskRecords,
  expiredLeaseFilter,
  HarnessCommitConflictError,
  type HarnessModels,
  newTaskLease,
} from "./commit";
import {taskDefinitionKey} from "./defineTask";
import {startTaskHeartbeat} from "./leases";
import {
  checkTaskWait,
  childOutcomes,
  errorMessage,
  type HarnessEngine,
  settleChildren,
  settleTaskOwner,
  sweepWaitingTasks,
  toTaskView,
} from "./ownership";
import {nextRetryAt, resolveRetryPolicy} from "./retryBackoff";

/** Most expired tasks one recovery pass handles; the next pass picks up the rest. */
const RECOVERY_BATCH_SIZE = 100;

/** A misuse of the task API; retrying the phase cannot fix it, so the task fails at once. */
class HarnessDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessDefinitionError";
  }
}

/** Unwinds a phase that committed `waiting`; the runner stops the task without failing it. */
class HarnessSuspendSignal extends Error {
  constructor(taskId: string) {
    super(`Harness task ${taskId} is waiting; the phase re-runs when the wait is satisfied`);
    this.name = "HarnessSuspendSignal";
  }
}

const assertValidNext = (
  definition: HarnessTaskDefinition,
  next: HarnessCommit<unknown, unknown>
): void => {
  if ("terminal" in next) {
    const {status} = next.terminal;
    if (status !== "completed" && status !== "failed") {
      throw new HarnessDefinitionError(
        `${definition.key}: terminal status must be "completed" or "failed"`
      );
    }
    return;
  }
  if (!definition.phases[next.phase]) {
    throw new HarnessDefinitionError(
      `${definition.key}: rt.commit to unknown phase "${next.phase}"`
    );
  }
};

const registeredFilter = (
  definitions: Map<string, HarnessTaskDefinition>
): Array<{name: string; version: number}> => {
  return [...definitions.values()].map(({name, version}) => ({name, version}));
};

/**
 * Atomically move the oldest runnable, registered task from `pending` to `running` and
 * give it a fresh lease (owner, fencing token, expiry) for the phase about to start.
 */
export const claimNextTask = async ({
  definitions,
  lease,
  models,
}: {
  definitions: Map<string, HarnessTaskDefinition>;
  lease: HarnessLeaseSettings;
  models: HarnessModels;
}): Promise<HarnessTaskDocument | null> => {
  if (definitions.size === 0) {
    return null;
  }
  const registered = registeredFilter(definitions);
  return models.task.findOneAndUpdate(
    {
      $and: [
        {$or: registered},
        {
          $or: [
            {runAt: {$exists: false}},
            {runAt: null},
            {runAt: {$lte: DateTime.now().toJSDate()}},
          ],
        },
      ],
      // A task being aborted never starts another run.
      "abortRequested.at": {$exists: false},
      status: HARNESS_TASK_STATUSES.pending,
    },
    {$set: {lease: newTaskLease(lease), status: HARNESS_TASK_STATUSES.running}},
    {returnDocument: "after", sort: {created: 1}}
  );
};

/**
 * Find `running` tasks whose lease expired (their runner died or froze mid-phase) and
 * resolve each by its current phase's `replay`: `safe` goes back to `pending` at the same
 * checkpoint, anything else is parked `interrupted`. Tasks of unregistered versions are
 * left for a runner that registers them. Then wake tasks whose child wait settled
 * without a wake (a crash between a child's outcome and its owner check). Returns how
 * many tasks became runnable.
 */
export const recoverExpiredTasks = async (engine: HarnessEngine): Promise<number> => {
  const {definitions, models, testHooks} = engine;
  if (definitions.size === 0) {
    return 0;
  }
  const expired = await models.task
    .find({...expiredLeaseFilter(DateTime.now()), $and: [{$or: registeredFilter(definitions)}]})
    .sort({created: 1})
    .limit(RECOVERY_BATCH_SIZE);

  let runnable = 0;
  for (const task of expired) {
    const definition = definitions.get(taskDefinitionKey(task));
    const replay = definition?.phases[task.phase]?.replay === "safe" ? "safe" : "never";
    try {
      await commitInterruption({models, replay, task, testHooks});
      logger.warn(
        `Harness task ${task._id} (${taskDefinitionKey(task)}) was interrupted in phase "${task.phase}"; ${replay === "safe" ? "re-running it" : "parked as interrupted"}`
      );
      if (replay === "safe") {
        runnable += 1;
      }
    } catch (error: unknown) {
      // Another runner recovered it first, or its lease was renewed after the scan.
      if (error instanceof HarnessCommitConflictError) {
        continue;
      }
      logger.error(`Harness could not recover task ${task._id}: ${errorMessage(error)}`);
    }
  }
  return runnable + (await sweepWaitingTasks(engine));
};

/**
 * Run a claimed task's phases in order until it stops: terminal, `pending` for a retry,
 * `waiting`, or aborted. A phase that throws is retried under the task's `retry` policy
 * and fails the task once attempts run out. When a commit transaction fails, or the lease
 * was lost, the task is left at its last checkpoint and expired-lease recovery decides
 * what happens next. A terminal task re-checks the task that owns it.
 */
export const runClaimedTask = async ({
  engine,
  lease,
  task,
}: {
  engine: HarnessEngine;
  lease: HarnessLeaseSettings;
  task: HarnessTaskDocument;
}): Promise<void> => {
  const definition = engine.definitions.get(taskDefinitionKey(task));
  if (!definition) {
    throw new Error(`No registered task definition for ${taskDefinitionKey(task)}`);
  }

  const taskId = String(task._id);
  const controller = new AbortController();
  engine.controllers.set(taskId, controller);
  try {
    let current = task;
    let isFirstPhase = true;
    while (current.status === HARNESS_TASK_STATUSES.running && !controller.signal.aborted) {
      // An abort from another process may have fenced the task since the last commit.
      if (!isFirstPhase && !(await holdsLease(engine.models, current))) {
        logger.info(`Harness task ${taskId} lost its lease between phases; stopping`);
        return;
      }
      isFirstPhase = false;
      const result = await runPhase({controller, definition, engine, lease, task: current});
      if (!result) {
        return;
      }
      current = result;
    }
    if (HARNESS_TERMINAL_STATUSES.has(current.status)) {
      await settleTaskOwner({engine, task: current});
    }
  } finally {
    engine.controllers.delete(taskId);
  }
};

/** Whether `task`'s current lease token is still the one stored. */
const holdsLease = async (models: HarnessModels, task: HarnessTaskDocument): Promise<boolean> => {
  const held = await models.task.countDocuments({
    _id: task._id,
    "lease.token": task.lease?.token ?? null,
    status: HARNESS_TASK_STATUSES.running,
  });
  return held > 0;
};

const toObjectId = (id: mongoose.Types.ObjectId | string): mongoose.Types.ObjectId => {
  return typeof id === "string" ? new mongoose.Types.ObjectId(id) : id;
};

const runPhase = async ({
  controller,
  definition,
  engine,
  lease,
  task,
}: {
  controller: AbortController;
  definition: HarnessTaskDefinition;
  engine: HarnessEngine;
  lease: HarnessLeaseSettings;
  task: HarnessTaskDocument;
}): Promise<HarnessTaskDocument | null> => {
  const {models, testHooks} = engine;
  const taskId = String(task._id);
  const phaseStartedAt = DateTime.now();
  let committed: HarnessTaskDocument | null = null;
  let commitStarted = false;
  let commitFailure: unknown;
  let childIndex = 0;
  const heartbeat = startTaskHeartbeat({
    lease,
    models,
    onLost: () => controller.abort(new Error("Task lease lost")),
    taskId: task._id,
    testHooks,
    token: task.lease?.token,
  });

  const assertOpen = (method: string): void => {
    if (commitStarted) {
      throw new HarnessDefinitionError(
        `${definition.key}: ${method} called after the phase "${task.phase}" committed or started waiting`
      );
    }
  };

  /** Run one fenced write that ends the phase; record its failure for the caller. */
  const settlePhase = async (write: () => Promise<HarnessTaskDocument>): Promise<void> => {
    commitStarted = true;
    // The commit decides the lease's fate: renewed under a new token, cleared, or
    // (on failure) left to expire for recovery.
    await heartbeat.stop();
    try {
      committed = await write();
    } catch (error: unknown) {
      commitFailure = error;
      throw error;
    }
  };

  const commit = async (next: HarnessCommit<unknown, unknown>): Promise<void> => {
    if (commitStarted) {
      throw new Error(
        `${definition.key}: rt.commit called more than once in phase "${task.phase}"`
      );
    }
    assertValidNext(definition, next);
    await settlePhase(() => commitPhase({lease, models, next, phaseStartedAt, task, testHooks}));
  };

  const createTask = async (
    childDefinition: HarnessTaskDefinition<never, unknown, unknown>,
    input: unknown,
    options: HarnessChildTaskOptions = {}
  ): Promise<string> => {
    assertOpen("rt.createTask");
    const registered = engine.definitions.get(childDefinition.key);
    if (!registered) {
      throw new HarnessDefinitionError(`${childDefinition.key} is not in this harness registry`);
    }
    const key = options.key ?? String(childIndex);
    childIndex += 1;
    const child = await createChildTaskRecords({
      definition: registered,
      input,
      key,
      lease,
      models,
      options,
      parent: task,
    });
    engine.wake();
    return String(child._id);
  };

  const waitForTasks = async (
    ids: ReadonlyArray<mongoose.Types.ObjectId | string>,
    options: HarnessWaitForTasksOptions = {}
  ): Promise<HarnessChildOutcome[]> => {
    assertOpen("rt.waitForTasks");
    const policy = options.policy ?? HARNESS_WAIT_POLICIES.all;
    if (!Object.values(HARNESS_WAIT_POLICIES).includes(policy)) {
      throw new HarnessDefinitionError(
        `rt.waitForTasks policy must be one of ${Object.values(HARNESS_WAIT_POLICIES).join(", ")}`
      );
    }
    const childIds = [...new Set(ids.map(String))].map(toObjectId);
    const owned = await models.task.countDocuments({
      _id: {$in: childIds},
      "ownership.id": task._id,
      "ownership.kind": "task",
    });
    if (owned !== childIds.length) {
      throw new HarnessDefinitionError(
        `${definition.key}: rt.waitForTasks only waits on tasks this task created with rt.createTask`
      );
    }
    const {children, isSettled} = await settleChildren({
      engine,
      ids: childIds,
      ownerId: task._id,
      policy,
    });
    if (isSettled) {
      return childOutcomes(ids.map(String), children);
    }
    await settlePhase(() =>
      commitWaiting({
        models,
        phaseStartedAt,
        task,
        testHooks,
        waiting: {kind: HARNESS_WAIT_KINDS.tasks, policy, taskIds: childIds},
      })
    );
    // A child may have settled between the check above and the waiting commit.
    await checkTaskWait({engine, taskId: task._id});
    throw new HarnessSuspendSignal(taskId);
  };

  const failOrRetry = async ({
    error,
    isRetryable,
  }: {
    error: string;
    isRetryable: boolean;
  }): Promise<HarnessTaskDocument | null> => {
    await heartbeat.stop();
    const policy = resolveRetryPolicy(task.retry);
    const failedAttempts = task.attempt + 1;
    try {
      if (isRetryable && failedAttempts < policy.maxAttempts) {
        const runAt = nextRetryAt({failedAttempts, policy, random: testHooks?.random});
        const retried = await commitRetry({
          error,
          failedAttempts,
          maxAttempts: policy.maxAttempts,
          models,
          phaseStartedAt,
          runAt,
          task,
          testHooks,
        });
        logger.warn(
          `Harness task ${taskId} phase "${task.phase}" failed (attempt ${failedAttempts} of ${policy.maxAttempts}); retrying at ${runAt.toISO()}: ${error}`
        );
        return retried;
      }
      return await commitPhase({
        failedAttempts: isRetryable ? failedAttempts : undefined,
        lease,
        models,
        next: {terminal: {error, status: "failed"}},
        phaseStartedAt,
        task,
        testHooks,
      });
    } catch (commitError: unknown) {
      logger.error(
        `Harness task ${taskId} could not record failure of phase "${task.phase}": ${errorMessage(commitError)}`
      );
      return null;
    }
  };

  const phase = definition.phases[task.phase];
  if (!phase) {
    return failOrRetry({
      error: `${definition.key}: unknown phase "${task.phase}"`,
      isRetryable: false,
    });
  }

  const rt: HarnessTaskRuntime<unknown, unknown> = {
    commit,
    createTask: createTask as HarnessTaskRuntime<unknown, unknown>["createTask"],
    signal: controller.signal,
    taskId,
    waitForTasks,
  };
  let thrown: {error: unknown} | undefined;
  try {
    await phase.run(toTaskView(task), rt);
  } catch (error: unknown) {
    thrown = {error};
  }
  await heartbeat.stop();

  if (commitFailure !== undefined && controller.signal.aborted) {
    logger.info(
      `Harness task ${taskId} phase "${task.phase}" was aborted; its commit was discarded`
    );
    return null;
  }
  if (commitFailure !== undefined) {
    logger.error(
      `Harness task ${taskId} phase "${task.phase}" commit failed; task stays at its last checkpoint: ${errorMessage(commitFailure)}`
    );
    return null;
  }
  if (committed) {
    if (thrown && !(thrown.error instanceof HarnessSuspendSignal)) {
      logger.warn(
        `Harness task ${taskId} phase "${task.phase}" threw after committing; keeping the checkpoint: ${errorMessage(thrown.error)}`
      );
    }
    return committed;
  }
  // Aborted (or taken over) mid-phase: the abort already settled the task; record nothing.
  if (controller.signal.aborted) {
    logger.info(`Harness task ${taskId} phase "${task.phase}" stopped after its abort signal`);
    return null;
  }
  if (thrown) {
    return failOrRetry({
      error: errorMessage(thrown.error),
      isRetryable: !(thrown.error instanceof HarnessDefinitionError),
    });
  }
  return failOrRetry({
    error: `${definition.key}: phase "${task.phase}" returned without calling rt.commit`,
    isRetryable: false,
  });
};
