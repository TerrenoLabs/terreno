import {logger} from "@terreno/api";
import {DateTime} from "luxon";

import type {
  HarnessCommit,
  HarnessLeaseSettings,
  HarnessTaskDefinition,
  HarnessTaskDocument,
  HarnessTaskRuntime,
  HarnessTaskView,
  HarnessTestHooks,
} from "../types/harness";
import {HARNESS_TASK_STATUSES} from "../types/harness";
import {
  commitInterruption,
  commitPhase,
  expiredLeaseFilter,
  HarnessCommitConflictError,
  type HarnessModels,
  newTaskLease,
} from "./commit";
import {taskDefinitionKey} from "./defineTask";
import {startTaskHeartbeat} from "./leases";

/** Most expired tasks one recovery pass handles; the next pass picks up the rest. */
const RECOVERY_BATCH_SIZE = 100;

const errorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const toTaskView = (task: HarnessTaskDocument): HarnessTaskView<unknown, unknown> => {
  return {
    attempt: task.attempt,
    id: String(task._id),
    input: task.input,
    name: task.name,
    phase: task.phase,
    state: task.state,
    userId: task.userId ? String(task.userId) : undefined,
    version: task.version,
  };
};

const assertValidNext = (
  definition: HarnessTaskDefinition,
  next: HarnessCommit<unknown, unknown>
): void => {
  if ("terminal" in next) {
    const {status} = next.terminal;
    if (status !== "completed" && status !== "failed") {
      throw new Error(`${definition.key}: terminal status must be "completed" or "failed"`);
    }
    return;
  }
  if (!definition.phases[next.phase]) {
    throw new Error(`${definition.key}: rt.commit to unknown phase "${next.phase}"`);
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
 * left for a runner that registers them. Returns how many tasks became runnable.
 */
export const recoverExpiredTasks = async ({
  definitions,
  models,
  testHooks,
}: {
  definitions: Map<string, HarnessTaskDefinition>;
  models: HarnessModels;
  testHooks?: HarnessTestHooks;
}): Promise<number> => {
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
  return runnable;
};

/**
 * Run a claimed task's phases in order until it reaches a terminal status. A phase that
 * throws (or returns without committing) ends the task `failed`. When a commit
 * transaction fails, or the lease was lost, the task is left at its last checkpoint and
 * expired-lease recovery decides what happens next.
 */
export const runClaimedTask = async ({
  definitions,
  lease,
  models,
  task,
  testHooks,
}: {
  definitions: Map<string, HarnessTaskDefinition>;
  lease: HarnessLeaseSettings;
  models: HarnessModels;
  task: HarnessTaskDocument;
  testHooks?: HarnessTestHooks;
}): Promise<void> => {
  const definition = definitions.get(taskDefinitionKey(task));
  if (!definition) {
    throw new Error(`No registered task definition for ${taskDefinitionKey(task)}`);
  }

  let current = task;
  while (current.status === HARNESS_TASK_STATUSES.running) {
    const result = await runPhase({definition, lease, models, task: current, testHooks});
    if (!result) {
      return;
    }
    current = result;
  }
};

const runPhase = async ({
  definition,
  lease,
  models,
  task,
  testHooks,
}: {
  definition: HarnessTaskDefinition;
  lease: HarnessLeaseSettings;
  models: HarnessModels;
  task: HarnessTaskDocument;
  testHooks?: HarnessTestHooks;
}): Promise<HarnessTaskDocument | null> => {
  const taskId = String(task._id);
  const phaseStartedAt = DateTime.now();
  let committed: HarnessTaskDocument | null = null;
  let commitStarted = false;
  let commitFailure: unknown;
  const heartbeat = startTaskHeartbeat({
    lease,
    models,
    taskId: task._id,
    testHooks,
    token: task.lease?.token,
  });

  const commit = async (next: HarnessCommit<unknown, unknown>): Promise<void> => {
    if (commitStarted) {
      throw new Error(
        `${definition.key}: rt.commit called more than once in phase "${task.phase}"`
      );
    }
    assertValidNext(definition, next);
    commitStarted = true;
    // The commit decides the lease's fate: renewed under a new token, cleared, or
    // (on failure) left to expire for recovery.
    await heartbeat.stop();
    try {
      committed = await commitPhase({lease, models, next, phaseStartedAt, task, testHooks});
    } catch (error: unknown) {
      commitFailure = error;
      throw error;
    }
  };

  const failTask = async (error: string): Promise<HarnessTaskDocument | null> => {
    await heartbeat.stop();
    try {
      return await commitPhase({
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
    return failTask(`${definition.key}: unknown phase "${task.phase}"`);
  }

  const rt: HarnessTaskRuntime<unknown, unknown> = {commit, taskId};
  try {
    await phase.run(toTaskView(task), rt);
  } catch (error: unknown) {
    await heartbeat.stop();
    if (commitFailure !== undefined) {
      logger.error(
        `Harness task ${taskId} phase "${task.phase}" commit failed; task stays at its last checkpoint: ${errorMessage(commitFailure)}`
      );
      return null;
    }
    if (committed) {
      logger.warn(
        `Harness task ${taskId} phase "${task.phase}" threw after committing; keeping the checkpoint: ${errorMessage(error)}`
      );
      return committed;
    }
    return failTask(errorMessage(error));
  }
  await heartbeat.stop();

  if (commitFailure !== undefined) {
    logger.error(
      `Harness task ${taskId} phase "${task.phase}" commit failed; task stays at its last checkpoint: ${errorMessage(commitFailure)}`
    );
    return null;
  }
  if (!committed) {
    return failTask(`${definition.key}: phase "${task.phase}" returned without calling rt.commit`);
  }
  return committed;
};
