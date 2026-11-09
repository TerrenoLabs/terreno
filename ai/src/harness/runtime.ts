import {logger} from "@terreno/api";
import {DateTime, type DurationLike} from "luxon";

import mongoose from "mongoose";

import type {
  HarnessAgentDefinition,
  HarnessApprovalOptions,
  HarnessApprovalResult,
  HarnessChildOutcome,
  HarnessChildTaskOptions,
  HarnessCommit,
  HarnessLeaseSettings,
  HarnessRunAgentOptions,
  HarnessRunnableTask,
  HarnessTaskDefinition,
  HarnessTaskDocument,
  HarnessTaskRuntime,
  HarnessWaitForOptions,
  HarnessWaitForTasksOptions,
} from "../types/harness";
import {
  HARNESS_EVENT_TYPES,
  HARNESS_TASK_STATUSES,
  HARNESS_TERMINAL_STATUSES,
  HARNESS_WAIT_KINDS,
  HARNESS_WAIT_POLICIES,
} from "../types/harness";
import {AGENT_TURN_TASK_NAME} from "./agentTaskNames";
import {type ApprovalWaitPlan, approvalWaitPlan, parseApprovalRequest} from "./approvals";
import {
  commitInterruption,
  commitPhase,
  commitRetry,
  commitWaiting,
  createChildTaskRecords,
  expiredLeaseFilter,
  HarnessCommitConflictError,
  type HarnessCommitWrites,
  type HarnessInterruptionAction,
  type HarnessModels,
  newTaskLease,
} from "./commit";
import {taskDefinitionKey} from "./defineTask";
import {HarnessDefinitionError} from "./definitionError";
import {errorMessage, harnessError} from "./errors";
import {appendTaskEvents} from "./events";
import {HARNESS_INTERNAL_RUNTIME} from "./internalRuntime";
import {startTaskHeartbeat} from "./leases";
import {createMemo} from "./memo";
import {
  checkTaskWait,
  childOutcomes,
  type HarnessEngine,
  settleChildren,
  settleTaskOwner,
  sweepQueuedConversations,
  sweepWaitingTasks,
  toTaskView,
} from "./ownership";
import {nextRetryAt, resolveRetryPolicy} from "./retryBackoff";
import {
  serializeOutputSchema,
  startSubagentTurn,
  subagentContent,
  subagentPrompts,
  subagentResult,
} from "./subagent";
import {HarnessSuspendSignal} from "./suspend";
import {parseWaitDuration, resolveWaitCall, type WaitCallPlan, waitCallKey} from "./waits";

/** Registry key of the built-in agent turn every subagent runs. */
const AGENT_TURN_KEY = taskDefinitionKey({name: AGENT_TURN_TASK_NAME, version: 1});

/** Most expired tasks one recovery pass handles; the next pass picks up the rest. */
const RECOVERY_BATCH_SIZE = 100;

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
 * Mongo filter for a registered task a runner may claim now: `pending` and due, or
 * `waiting` on an event or sleep whose `timeoutAt` passed, and not being aborted.
 */
const runnableTaskFilter = (
  definitions: Map<string, HarnessTaskDefinition>,
  now: DateTime
): Record<string, unknown> => ({
  $and: [
    {$or: registeredFilter(definitions)},
    {
      $or: [
        {
          $or: [{runAt: {$exists: false}}, {runAt: null}, {runAt: {$lte: now.toJSDate()}}],
          status: HARNESS_TASK_STATUSES.pending,
        },
        // An event wait or sleep whose timeout passed resumes like a due retry.
        {
          status: HARNESS_TASK_STATUSES.waiting,
          "waiting.kind": {$in: [HARNESS_WAIT_KINDS.event, HARNESS_WAIT_KINDS.sleep]},
          "waiting.timeoutAt": {$lte: now.toJSDate()},
        },
      ],
    },
  ],
  // A task being aborted never starts another run.
  "abortRequested.at": {$exists: false},
});

/** Move a runnable task to `running` under a fresh lease (owner, fencing token, expiry). */
const claimUpdate = (lease: HarnessLeaseSettings): Record<string, unknown> => ({
  $inc: {claims: 1},
  $set: {lease: newTaskLease(lease), status: HARNESS_TASK_STATUSES.running},
  $unset: {waiting: 1},
});

/**
 * Atomically move the oldest runnable, registered task (`pending` and due, or `waiting` on
 * an event or sleep whose `timeoutAt` passed) to `running` and give it a fresh lease (owner, fencing token, expiry) for the phase about to start.
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
  return models.task.findOneAndUpdate(
    runnableTaskFilter(definitions, DateTime.now()),
    claimUpdate(lease),
    {returnDocument: "after", sort: {created: 1}}
  );
};

/**
 * Claim one task by id under the same rules as `claimNextTask`. Null when the task is not
 * runnable now: unknown, not due, already claimed by another runner, terminal, or aborting.
 */
export const claimTaskById = async ({
  definitions,
  lease,
  models,
  taskId,
}: {
  definitions: Map<string, HarnessTaskDefinition>;
  lease: HarnessLeaseSettings;
  models: HarnessModels;
  taskId: string;
}): Promise<HarnessTaskDocument | null> => {
  if (definitions.size === 0 || !mongoose.isValidObjectId(taskId)) {
    return null;
  }
  return models.task.findOneAndUpdate(
    {...runnableTaskFilter(definitions, DateTime.now()), _id: toObjectId(taskId)},
    claimUpdate(lease),
    {returnDocument: "after"}
  );
};

/** Oldest runnable, registered tasks first, at most `limit`, without claiming them. */
export const listRunnableTasks = async ({
  definitions,
  limit,
  models,
}: {
  definitions: Map<string, HarnessTaskDefinition>;
  limit: number;
  models: HarnessModels;
}): Promise<HarnessRunnableTask[]> => {
  if (definitions.size === 0) {
    return [];
  }
  const tasks = await models.task
    .find(runnableTaskFilter(definitions, DateTime.now()))
    .select({attempt: 1, claims: 1, phase: 1})
    .sort({created: 1})
    .limit(limit);
  return tasks.map((task) => ({
    attempt: task.attempt ?? 0,
    claims: task.claims ?? 0,
    phase: task.phase,
    taskId: String(task._id),
  }));
};

/**
 * Give a task that is still `running` under `task`'s lease back to the runners as
 * `pending` at its current checkpoint. False when the lease moved on (aborted, recovered).
 */
const releaseTask = async (models: HarnessModels, task: HarnessTaskDocument): Promise<boolean> => {
  const result = await models.task.updateOne(
    {
      _id: task._id,
      "lease.token": task.lease?.token ?? null,
      status: HARNESS_TASK_STATUSES.running,
    },
    {$set: {status: HARNESS_TASK_STATUSES.pending}, $unset: {lease: 1}}
  );
  return result.modifiedCount > 0;
};

/**
 * Find `running` tasks whose lease expired (their runner died or froze mid-phase) and
 * resolve each by its current phase's `replay`: `safe` goes back to `pending` at the same
 * checkpoint; anything else is parked `interrupted`, or failed (owner woken) when the
 * definition sets `onInterrupt: "fail"`. Tasks of unregistered versions are
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
    const action = interruptionAction(definition, task.phase);
    try {
      const recovered = await commitInterruption({action, models, task, testHooks});
      logger.warn(
        `Harness task ${task._id} (${taskDefinitionKey(task)}) was interrupted in phase "${task.phase}"; ${INTERRUPTION_LOG[action]}`
      );
      if (action === "replay") {
        runnable += 1;
      }
      if (action === "fail") {
        await settleTaskOwner({engine, task: recovered});
      }
    } catch (error: unknown) {
      // Another runner recovered it first, or its lease was renewed after the scan.
      if (error instanceof HarnessCommitConflictError) {
        continue;
      }
      logger.error(`Harness could not recover task ${task._id}: ${errorMessage(error)}`);
    }
  }
  return runnable + (await sweepWaitingTasks(engine)) + (await sweepQueuedConversations(engine));
};

const INTERRUPTION_LOG: Record<HarnessInterruptionAction, string> = {
  fail: "failed it (not retried)",
  park: "parked as interrupted",
  replay: "re-running it",
};

/** What recovery does with an expired task in `phase`, by its definition's policies. */
const interruptionAction = (
  definition: HarnessTaskDefinition | undefined,
  phase: string
): HarnessInterruptionAction => {
  if (definition?.phases[phase]?.replay === "safe") {
    return "replay";
  }
  return definition?.onInterrupt === "fail" ? "fail" : "park";
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
  maxPhases,
  task,
}: {
  engine: HarnessEngine;
  lease: HarnessLeaseSettings;
  /** Hand the task back as `pending` once this many phases committed and it still runs. */
  maxPhases?: number;
  task: HarnessTaskDocument;
}): Promise<void> => {
  const definition = engine.definitions.get(taskDefinitionKey(task));
  if (!definition) {
    throw harnessError({
      detail: `No registered task definition for ${taskDefinitionKey(task)}`,
      kind: "notRegistered",
    });
  }

  const taskId = String(task._id);
  const controller = new AbortController();
  engine.controllers.set(taskId, controller);
  try {
    let current = task;
    let phasesRun = 0;
    while (current.status === HARNESS_TASK_STATUSES.running && !controller.signal.aborted) {
      if (maxPhases !== undefined && phasesRun >= maxPhases) {
        if (!(await releaseTask(engine.models, current))) {
          logger.info(`Harness task ${taskId} lost its lease before hand-off; stopping`);
        }
        return;
      }
      // An abort from another process may have fenced the task since the last commit.
      if (phasesRun > 0 && !(await holdsLease(engine.models, current))) {
        logger.info(`Harness task ${taskId} lost its lease between phases; stopping`);
        return;
      }
      phasesRun += 1;
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
  let agentIndex = 0;
  let waitIndex = 0;
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

  const commitWithWrites = async (
    next: HarnessCommit<unknown, unknown>,
    writes?: HarnessCommitWrites
  ): Promise<void> => {
    if (commitStarted) {
      throw new HarnessDefinitionError(
        `${definition.key}: rt.commit called more than once in phase "${task.phase}"`
      );
    }
    assertValidNext(definition, next);
    await settlePhase(() =>
      commitPhase({lease, models, next, phaseStartedAt, task, testHooks, writes})
    );
  };

  const commit = (next: HarnessCommit<unknown, unknown>): Promise<void> => commitWithWrites(next);

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
    await settlePhase(async () => {
      const parked = await commitWaiting({
        models,
        phaseStartedAt,
        task,
        testHooks,
        waiting: {kind: HARNESS_WAIT_KINDS.tasks, policy, taskIds: childIds},
      });
      return parked.task;
    });
    // A child may have settled between the check above and the waiting commit.
    await checkTaskWait({engine, taskId: task._id});
    throw new HarnessSuspendSignal(taskId);
  };

  /**
   * Shared by `rt.waitFor`, `rt.sleep`, and `rt.approval`: resolve the call now, or park the
   * task on it. `plan` builds the request from the call's key.
   */
  const waitCall = async (
    method: string,
    plan: (callKey: string) => WaitCallPlan
  ): Promise<unknown> => {
    assertOpen(method);
    // Taken before any await, so the call's key depends only on its order in the phase.
    const callKey = waitCallKey({index: waitIndex, task});
    waitIndex += 1;
    const {afterPark, onPark, request} = plan(callKey);
    let result: Awaited<ReturnType<typeof resolveWaitCall>>;
    try {
      result = await resolveWaitCall({
        callKey,
        label: definition.key,
        lease,
        models,
        request,
        task,
        testHooks,
      });
    } catch (error: unknown) {
      // A lost lease ends the run like a failed commit: nothing more may be written.
      if (error instanceof HarnessCommitConflictError) {
        commitStarted = true;
        commitFailure = error;
      }
      throw error;
    }
    if (result.isResolved) {
      return result.payload;
    }
    const {entry} = result;
    let isWoken = false;
    await settlePhase(async () => {
      const parked = await commitWaiting({
        models,
        phaseStartedAt,
        task,
        testHooks,
        waitCall: {entry, key: callKey},
        waiting: {key: entry.key, kind: entry.kind, timeoutAt: entry.timeoutAt},
        writes: onPark,
      });
      isWoken = parked.isWoken;
      return parked.task;
    });
    // An event buffered before the wait committed sent the task straight back to pending.
    if (isWoken) {
      engine.wake();
    }
    await afterPark?.();
    throw new HarnessSuspendSignal(taskId);
  };

  const requestApproval = async (
    key: string,
    options: HarnessApprovalOptions,
    extension?: string
  ): Promise<HarnessApprovalResult> => {
    assertOpen("rt.approval");
    const timeout = parseApprovalRequest({key, label: definition.key, options});
    let approval: ApprovalWaitPlan | undefined;
    await waitCall("rt.approval", (callKey) => {
      approval = approvalWaitPlan({callKey, extension, key, models, options, task, timeout});
      return approval;
    });
    return (approval as ApprovalWaitPlan).result();
  };

  const waitFor = async (event: string, options: HarnessWaitForOptions = {}): Promise<unknown> => {
    if (typeof event !== "string" || !event.trim()) {
      assertOpen("rt.waitFor");
      throw new HarnessDefinitionError(`${definition.key}: rt.waitFor requires an event name`);
    }
    const timeout =
      options?.timeout === undefined
        ? undefined
        : parseWaitDuration(options.timeout, `${definition.key}: rt.waitFor timeout`);
    return waitCall("rt.waitFor", () => ({
      request: {duration: timeout, event, kind: HARNESS_WAIT_KINDS.event},
    }));
  };

  const sleep = async (duration: DurationLike): Promise<void> => {
    const length = parseWaitDuration(duration, `${definition.key}: rt.sleep duration`);
    await waitCall("rt.sleep", () => ({
      request: {duration: length, kind: HARNESS_WAIT_KINDS.sleep},
    }));
  };

  const runAgent = async <Result>(
    agent: HarnessAgentDefinition,
    options: HarnessRunAgentOptions<Result>
  ): Promise<Result> => {
    assertOpen("rt.runAgent");
    if (!options || typeof options !== "object") {
      throw new HarnessDefinitionError(`${definition.key}: rt.runAgent requires {input}`);
    }
    // Taken before any await, so the call's key depends only on its order in the phase.
    const callIndex = agentIndex;
    agentIndex += 1;
    if (!agent?.name || engine.agents.get(agent.name) !== agent) {
      throw new HarnessDefinitionError(
        `${definition.key}: rt.runAgent agent "${agent?.name}" is not in this harness registry`
      );
    }
    const content = subagentContent(options.input);
    if (content === undefined) {
      throw new HarnessDefinitionError(`${definition.key}: rt.runAgent requires non-empty input`);
    }
    const turn = engine.definitions.get(AGENT_TURN_KEY);
    if (!turn) {
      throw harnessError({detail: `${AGENT_TURN_KEY} is not registered`, kind: "notRegistered"});
    }
    const schema = (options.output ?? agent.output) as HarnessRunAgentOptions<Result>["output"];
    let outputSchema: string | undefined;
    if (schema) {
      try {
        outputSchema = await serializeOutputSchema(schema);
      } catch (error: unknown) {
        throw new HarnessDefinitionError(
          `${definition.key}: rt.runAgent output for "${agent.name}" cannot be expressed as JSON Schema: ${errorMessage(error)}`
        );
      }
    }
    const {instructions, prompts} = subagentPrompts({
      instructions: options.instructions,
      prompts: options.prompts,
      where: `${definition.key}: rt.runAgent`,
    });
    const {conversationId, turnTask} = await startSubagentTurn({
      agent,
      callIndex,
      content,
      extensions: engine.extensions,
      instructions,
      lease,
      models,
      outputSchema,
      parent: task,
      prompts,
      turn,
    });
    engine.wake();
    const [outcome] = await waitForTasks([turnTask._id]);
    return subagentResult({
      agent,
      conversationId,
      outcome: outcome as HarnessChildOutcome,
      schema,
    });
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

  const memoFor = (scopeTaskId: mongoose.Types.ObjectId | string) =>
    createMemo({
      assertWritable: () => assertOpen("rt.memo"),
      fence: {phase: task.phase, taskId: task._id, token: task.lease?.token},
      lease,
      models,
      scopeTaskId: toObjectId(scopeTaskId),
    });

  const output = async (text: string): Promise<void> => {
    assertOpen("rt.output");
    if (typeof text !== "string") {
      throw new HarnessDefinitionError(`${definition.key}: rt.output takes a string`);
    }
    if (!text) {
      return;
    }
    await appendTaskEvents({
      events: [
        {
          payload: {attempt: task.attempt, phase: task.phase, text},
          type: HARNESS_EVENT_TYPES.output,
        },
      ],
      models,
      task,
    });
  };

  const phase = definition.phases[task.phase];
  if (!phase) {
    return failOrRetry({
      error: `${definition.key}: unknown phase "${task.phase}"`,
      isRetryable: false,
    });
  }

  const rt: HarnessTaskRuntime<unknown, unknown> & {[HARNESS_INTERNAL_RUNTIME]: unknown} = {
    [HARNESS_INTERNAL_RUNTIME]: {
      approvalFor: (extension: string) => (key, options) =>
        requestApproval(key, options, extension),
      commitWithWrites,
      memoFor,
    },
    approval: (key, options) => requestApproval(key, options),
    commit,
    createTask: createTask as HarnessTaskRuntime<unknown, unknown>["createTask"],
    env: engine.env,
    memo: memoFor(task._id),
    output,
    runAgent: runAgent as HarnessTaskRuntime<unknown, unknown>["runAgent"],
    signal: controller.signal,
    sleep,
    taskId,
    waitFor: waitFor as HarnessTaskRuntime<unknown, unknown>["waitFor"],
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
