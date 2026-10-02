import {logger} from "@terreno/api";
import {DateTime} from "luxon";

import type {
  HarnessCommit,
  HarnessTaskDefinition,
  HarnessTaskDocument,
  HarnessTaskRuntime,
  HarnessTaskView,
  HarnessTestHooks,
} from "../types/harness";
import {HARNESS_TASK_STATUSES} from "../types/harness";
import {commitPhase, type HarnessModels} from "./commit";
import {taskDefinitionKey} from "./defineTask";

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

/** Atomically move the oldest runnable, registered task from `pending` to `running`. */
export const claimNextTask = async ({
  definitions,
  models,
}: {
  definitions: Map<string, HarnessTaskDefinition>;
  models: HarnessModels;
}): Promise<HarnessTaskDocument | null> => {
  if (definitions.size === 0) {
    return null;
  }
  const registered = [...definitions.values()].map(({name, version}) => ({name, version}));
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
    {$set: {status: HARNESS_TASK_STATUSES.running}},
    {returnDocument: "after", sort: {created: 1}}
  );
};

/**
 * Run a claimed task's phases in order until it reaches a terminal status. A phase that
 * throws (or returns without committing) ends the task `failed`. When a commit
 * transaction itself fails the task is left at its last checkpoint for recovery.
 */
export const runClaimedTask = async ({
  definitions,
  models,
  task,
  testHooks,
}: {
  definitions: Map<string, HarnessTaskDefinition>;
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
    const result = await runPhase({definition, models, task: current, testHooks});
    if (!result) {
      return;
    }
    current = result;
  }
};

const runPhase = async ({
  definition,
  models,
  task,
  testHooks,
}: {
  definition: HarnessTaskDefinition;
  models: HarnessModels;
  task: HarnessTaskDocument;
  testHooks?: HarnessTestHooks;
}): Promise<HarnessTaskDocument | null> => {
  const taskId = String(task._id);
  const phaseStartedAt = DateTime.now();
  let committed: HarnessTaskDocument | null = null;
  let commitStarted = false;
  let commitFailure: unknown;

  const commit = async (next: HarnessCommit<unknown, unknown>): Promise<void> => {
    if (commitStarted) {
      throw new Error(
        `${definition.key}: rt.commit called more than once in phase "${task.phase}"`
      );
    }
    assertValidNext(definition, next);
    commitStarted = true;
    try {
      committed = await commitPhase({models, next, phaseStartedAt, task, testHooks});
    } catch (error: unknown) {
      commitFailure = error;
      throw error;
    }
  };

  const failTask = async (error: string): Promise<HarnessTaskDocument | null> => {
    try {
      return await commitPhase({
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
