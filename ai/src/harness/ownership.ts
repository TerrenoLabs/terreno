import {logger} from "@terreno/api";
import {Duration} from "luxon";
import type mongoose from "mongoose";

import type {
  HarnessAgentDefinition,
  HarnessChildOutcome,
  HarnessExtensionDefinition,
  HarnessTaskDefinition,
  HarnessTaskDocument,
  HarnessTaskView,
  HarnessTerminalStatus,
  HarnessTestHooks,
  HarnessWaitPolicy,
} from "../types/harness";
import {
  HARNESS_TASK_STATUSES,
  HARNESS_TERMINAL_STATUSES,
  HARNESS_WAIT_KINDS,
  HARNESS_WAIT_POLICIES,
} from "../types/harness";
import {AGENT_TURN_TASK_NAME} from "./agentTaskNames";
import {
  claimAbortHandler,
  commitAbort,
  fenceForAbort,
  HarnessCommitConflictError,
  type HarnessModels,
  wakeWaitingTask,
} from "./commit";
import {startNextQueuedTurn} from "./conversation";
import {taskDefinitionKey} from "./defineTask";
import {errorMessage, harnessError} from "./errors";
import type {ExecutionEnv} from "./executionEnv";

/** Most waiting tasks one sweep re-checks; the next sweep picks up the rest. */
const WAIT_SWEEP_BATCH_SIZE = 100;

const NON_TERMINAL_STATUSES = Object.values(HARNESS_TASK_STATUSES).filter(
  (status) => !HARNESS_TERMINAL_STATUSES.has(status)
);

/** Everything the engine's task, ownership, and wait logic shares within one harness. */
export interface HarnessEngine {
  /** Registered agents, by name; `rt.runAgent` only runs these. */
  agents: Map<string, HarnessAgentDefinition>;
  /** Abort controllers of tasks running in this process, by task id. */
  controllers: Map<string, AbortController>;
  definitions: Map<string, HarnessTaskDefinition>;
  /** Handed to phases as `rt.env` and to tools as `api.env`. */
  env?: ExecutionEnv;
  /** Registered extensions, by name. */
  extensions: Map<string, HarnessExtensionDefinition>;
  models: HarnessModels;
  testHooks?: HarnessTestHooks;
  /** Tell the runner new work may be runnable. */
  wake: () => void;
}

export const toTaskView = (task: HarnessTaskDocument): HarnessTaskView<unknown, unknown> => {
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

const isTerminal = (task: HarnessTaskDocument): boolean =>
  HARNESS_TERMINAL_STATUSES.has(task.status);

const isFailure = (task: HarnessTaskDocument): boolean =>
  task.status === HARNESS_TASK_STATUSES.failed || task.status === HARNESS_TASK_STATUSES.aborted;

/** Tasks owned by any of `ownerIds`, oldest first. */
const findOwnedTasks = (
  models: HarnessModels,
  ownerIds: mongoose.Types.ObjectId[]
): Promise<HarnessTaskDocument[]> => {
  return models.task
    .find({"ownership.id": {$in: ownerIds}, "ownership.kind": "task"})
    .sort({created: 1});
};

/** Abort the in-process run of `task`, if this process is running it. */
const signalAbort = (engine: HarnessEngine, task: HarnessTaskDocument, reason: string): void => {
  const controller = engine.controllers.get(String(task._id));
  if (controller && !controller.signal.aborted) {
    controller.abort(new Error(`Aborted: ${reason}`));
  }
};

/** How often an abort re-checks a task whose handler another aborter is running. */
const ABORT_CLAIM_POLL = Duration.fromObject({milliseconds: 50});

/**
 * Wait until this call may run `task`'s abort handler. Returns null when the claim is
 * ours, or the task once it is terminal (aborted by another aborter, or finished on its
 * own).
 */
const awaitAbortClaim = async (
  engine: HarnessEngine,
  task: HarnessTaskDocument
): Promise<HarnessTaskDocument | null> => {
  for (;;) {
    if (await claimAbortHandler({models: engine.models, taskId: task._id})) {
      return null;
    }
    const current = await engine.models.task.findExactlyOne({_id: task._id});
    if (isTerminal(current)) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, ABORT_CLAIM_POLL.toMillis()));
  }
};

/**
 * Fence every non-terminal task below `top` for abort and return them deepest first (and
 * newest first within a level), so each is aborted only after everything it owns. Each
 * level is fenced before its children are read, so no task in the tree can create a
 * child the scan misses.
 */
const fenceOwnedForAbort = async ({
  engine,
  reason,
  top,
  userId,
}: {
  engine: HarnessEngine;
  reason: string;
  top: HarnessTaskDocument;
  userId?: string;
}): Promise<HarnessTaskDocument[]> => {
  const levels: HarnessTaskDocument[][] = [];
  const seen = new Set<string>([String(top._id)]);
  let frontier = [top._id];
  while (frontier.length > 0) {
    const found = (await findOwnedTasks(engine.models, frontier)).filter(
      (task) => !seen.has(String(task._id))
    );
    const fenced: HarnessTaskDocument[] = [];
    for (const task of found) {
      seen.add(String(task._id));
      if (isTerminal(task)) {
        continue;
      }
      const current = await fenceForAbort({
        models: engine.models,
        reason,
        taskId: task._id,
        userId,
      });
      if (current) {
        signalAbort(engine, current, reason);
        fenced.push(current);
      }
    }
    levels.push(fenced);
    frontier = found.map((task) => task._id);
  }
  return levels.reverse().flatMap((level) => [...level].reverse());
};

interface AbortHandlerResult {
  error?: string;
  status: "error" | "none" | "ok" | "unregistered";
}

/** Run `task`'s abort handler; a throw is captured, never rethrown. */
const runAbortHandler = async ({
  engine,
  reason,
  task,
  userId,
}: {
  engine: HarnessEngine;
  reason: string;
  task: HarnessTaskDocument;
  userId?: string;
}): Promise<AbortHandlerResult> => {
  const definition = engine.definitions.get(taskDefinitionKey(task));
  if (!definition) {
    return {
      error: `${taskDefinitionKey(task)} is not in this harness registry; no abort handler ran`,
      status: "unregistered",
    };
  }
  if (!definition.abort) {
    return {status: "none"};
  }
  try {
    await definition.abort(toTaskView(task), {reason, taskId: String(task._id), userId});
    return {status: "ok"};
  } catch (error: unknown) {
    logger.error(
      `Harness abort handler for task ${task._id} (${definition.key}) failed; aborting anyway: ${errorMessage(error)}`
    );
    return {error: errorMessage(error), status: "error"};
  }
};

/** How the top task of an abort is fenced and audited, when not a plain `abort`. */
export interface AbortTopOverride {
  error: string;
  filter: Record<string, unknown>;
  output: Record<string, unknown>;
  spanName: string;
}

const abortOne = async ({
  engine,
  override,
  reason,
  requestedOn,
  task,
  userId,
}: {
  engine: HarnessEngine;
  override?: AbortTopOverride;
  reason: string;
  requestedOn: string;
  task: HarnessTaskDocument;
  userId?: string;
}): Promise<HarnessTaskDocument> => {
  const settledElsewhere = await awaitAbortClaim(engine, task);
  if (settledElsewhere?.status === HARNESS_TASK_STATUSES.aborted) {
    return settledElsewhere;
  }
  // It completed or failed on its own before this abort could claim it.
  if (settledElsewhere) {
    throw new HarnessCommitConflictError(String(task._id), task.phase);
  }
  const handler = await runAbortHandler({engine, reason, task, userId});
  const handlerFailed = handler.status === "error";
  const handlerOutput = handler.error ? handler : {status: handler.status};
  return commitAbort({
    error: override?.error ?? `Aborted: ${reason}`,
    filter: override?.filter ?? {status: {$in: NON_TERMINAL_STATUSES}},
    models: engine.models,
    span: {
      error: handlerFailed ? `Abort handler failed: ${handler.error}` : undefined,
      name: override?.spanName ?? "abort",
      output: override
        ? {...override.output, abortHandler: handlerOutput}
        : {abortedBy: userId, abortHandler: handlerOutput, reason, requestedOn},
      status: handlerFailed ? "error" : "ok",
    },
    task,
    testHooks: engine.testHooks,
  });
};

/**
 * Abort `top` and every non-terminal task it owns. First, top-down, each task is fenced
 * (no new claims; a running phase loses its lease token) and its in-process run is
 * signalled. Then, bottom-up, each task's `abort` handler runs and the task is committed
 * `aborted` with an audit span. A descendant that settled on its own before its fence is
 * skipped. Afterwards `top`'s owner is re-checked, since an aborted child can settle a
 * parent's wait. Throws `HarnessCommitConflictError` when `top` is already terminal.
 */
export const abortTaskTree = async ({
  engine,
  override,
  reason,
  settleOwner = true,
  top,
  userId,
}: {
  engine: HarnessEngine;
  override?: AbortTopOverride;
  reason: string;
  /** False when the caller already handles the owner (a failFast sibling abort). */
  settleOwner?: boolean;
  top: HarnessTaskDocument;
  userId?: string;
}): Promise<HarnessTaskDocument> => {
  const requestedOn = String(top._id);
  const fencedTop = await fenceForAbort({models: engine.models, reason, taskId: top._id, userId});
  if (!fencedTop) {
    throw new HarnessCommitConflictError(requestedOn, top.phase);
  }
  signalAbort(engine, fencedTop, reason);
  for (const task of await fenceOwnedForAbort({engine, reason, top: fencedTop, userId})) {
    try {
      // Owners are aborted too, so only a subagent turn's conversation needs settling.
      await releaseConversation({
        engine,
        task: await abortOne({engine, reason, requestedOn, task, userId}),
      });
    } catch (error: unknown) {
      // It finished on its own between the scan and the abort commit.
      if (!(error instanceof HarnessCommitConflictError)) {
        throw error;
      }
    }
  }
  const aborted = await abortOne({
    engine,
    override,
    reason,
    requestedOn,
    task: fencedTop,
    userId,
  });
  if (settleOwner) {
    await settleTaskOwner({engine, task: aborted});
  }
  return aborted;
};

/** Settled children of a `waitForTasks` call, in the order their ids were passed. */
export const childOutcomes = (
  ids: ReadonlyArray<string>,
  children: ReadonlyArray<HarnessTaskDocument>
): HarnessChildOutcome[] => {
  const byId = new Map(children.map((child) => [String(child._id), child]));
  return ids.map((id) => {
    const child = byId.get(id);
    if (!child) {
      throw harnessError({
        detail: `Child task ${id} disappeared while its owner waited on it`,
        kind: "notFound",
      });
    }
    const outcome: HarnessChildOutcome = {
      id,
      name: child.name,
      status: child.status as HarnessTerminalStatus,
    };
    if (child.outcome?.error !== undefined) {
      outcome.error = child.outcome.error;
    }
    if (child.outcome?.result !== undefined) {
      outcome.result = child.outcome.result;
    }
    return outcome;
  });
};

/**
 * Settle a child wait under `policy`. Under `failFast`, the first failed or aborted child
 * aborts every sibling still in flight (with the sibling's subtree) before the wait
 * resolves. Returns the children as they now stand and whether the wait is satisfied.
 */
export const settleChildren = async ({
  engine,
  ids,
  ownerId,
  policy,
}: {
  engine: HarnessEngine;
  ids: ReadonlyArray<mongoose.Types.ObjectId>;
  ownerId: mongoose.Types.ObjectId;
  policy: HarnessWaitPolicy;
}): Promise<{children: HarnessTaskDocument[]; isSettled: boolean}> => {
  let children = await engine.models.task.find({_id: {$in: ids}});
  if (children.every(isTerminal)) {
    return {children, isSettled: true};
  }
  const failed = children.find(isFailure);
  if (policy !== HARNESS_WAIT_POLICIES.failFast || !failed) {
    return {children, isSettled: false};
  }
  for (const sibling of children.filter((child) => !isTerminal(child))) {
    try {
      await abortTaskTree({
        engine,
        reason: `Sibling task ${failed._id} ${failed.status} (failFast wait of ${ownerId})`,
        settleOwner: false,
        top: sibling,
      });
    } catch (error: unknown) {
      if (!(error instanceof HarnessCommitConflictError)) {
        throw error;
      }
    }
  }
  children = await engine.models.task.find({_id: {$in: ids}});
  return {children, isSettled: children.every(isTerminal)};
};

/**
 * Wake `taskId` when it is `waiting` on child tasks that have now settled. Safe to call
 * any number of times from anywhere: the wake itself is fenced on the wait.
 */
export const checkTaskWait = async ({
  engine,
  taskId,
}: {
  engine: HarnessEngine;
  taskId: mongoose.Types.ObjectId;
}): Promise<boolean> => {
  const task = await engine.models.task.findOneOrNone({_id: taskId});
  const waiting = task?.waiting;
  if (
    !task ||
    task.status !== HARNESS_TASK_STATUSES.waiting ||
    waiting?.kind !== HARNESS_WAIT_KINDS.tasks
  ) {
    return false;
  }
  const {isSettled} = await settleChildren({
    engine,
    ids: waiting.taskIds ?? [],
    ownerId: task._id,
    policy: waiting.policy ?? HARNESS_WAIT_POLICIES.all,
  });
  if (!isSettled) {
    return false;
  }
  const isWoken = await wakeWaitingTask({
    kind: HARNESS_WAIT_KINDS.tasks,
    models: engine.models,
    taskId: task._id,
  });
  if (isWoken) {
    engine.wake();
  }
  return isWoken;
};

/**
 * Mark a conversation `idle` once its active turn task is terminal. Fenced on the turn,
 * so a later turn is never released by an earlier one. `submit` also releases a
 * conversation whose active turn is terminal, should this write be lost to a crash.
 */
const releaseConversation = async ({
  engine,
  task,
}: {
  engine: HarnessEngine;
  task: HarnessTaskDocument;
}): Promise<void> => {
  const conversationId = turnConversationId(task);
  if (!conversationId) {
    return;
  }
  try {
    await engine.models.conversation.updateOne(
      {_id: conversationId, activeTurnTaskId: task._id, status: "busy"},
      {$set: {status: "idle"}, $unset: {activeTurnTaskId: 1}}
    );
  } catch (error: unknown) {
    logger.error(
      `Harness could not release conversation ${conversationId} after turn ${task._id}: ${errorMessage(error)}`
    );
  }
};

/**
 * The conversation a turn task runs on: its owner for a root conversation's turn, its
 * input for a subagent turn (owned by the task that called `rt.runAgent`).
 */
const turnConversationId = (task: HarnessTaskDocument): string | undefined => {
  if (task.ownership?.kind === "conversation" && task.ownership.id) {
    return String(task.ownership.id);
  }
  if (task.name !== AGENT_TURN_TASK_NAME) {
    return undefined;
  }
  const conversationId = (task.input as {conversationId?: unknown} | undefined)?.conversationId;
  return typeof conversationId === "string" ? conversationId : undefined;
};

/** Registry key of the built-in agent turn. */
const AGENT_TURN_KEY = taskDefinitionKey({name: AGENT_TURN_TASK_NAME, version: 1});

/**
 * Run the conversation's next queued submission now that its turn ended. A failure here
 * leaves the submission queued; the owner's queue sweep (or the next `send`) starts it.
 */
const startQueuedTurn = async ({
  conversationId,
  engine,
}: {
  conversationId: mongoose.Types.ObjectId;
  engine: HarnessEngine;
}): Promise<boolean> => {
  const turn = engine.definitions.get(AGENT_TURN_KEY);
  if (!turn) {
    return false;
  }
  try {
    const started = await startNextQueuedTurn({
      context: {models: engine.models, turn, wake: engine.wake},
      conversationId,
    });
    return started !== null;
  } catch (error: unknown) {
    logger.error(
      `Harness could not start the next queued turn of conversation ${conversationId}: ${errorMessage(error)}`
    );
    return false;
  }
};

/**
 * Free `busy` conversations whose active turn is terminal or gone. Every terminal turn
 * commit frees its conversation in the same transaction; this repairs conversations left
 * busy by data written before that, or by a write that failed. Fenced on the stale turn,
 * so a conversation that moved on is untouched. Returns how many were freed.
 */
const releaseStaleConversations = async (engine: HarnessEngine): Promise<number> => {
  const {conversation, task} = engine.models;
  const stale = await conversation.aggregate<{
    _id: mongoose.Types.ObjectId;
    activeTurnTaskId?: mongoose.Types.ObjectId;
  }>([
    {$match: {status: "busy"}},
    {
      $lookup: {
        as: "turn",
        foreignField: "_id",
        from: task.collection.name,
        localField: "activeTurnTaskId",
        pipeline: [{$project: {status: 1}}],
      },
    },
    {
      $match: {
        $or: [{"turn.0": {$exists: false}}, {"turn.status": {$in: [...HARNESS_TERMINAL_STATUSES]}}],
      },
    },
    {$limit: QUEUE_SWEEP_BATCH_SIZE},
    {$project: {activeTurnTaskId: 1}},
  ]);
  let released = 0;
  for (const {_id, activeTurnTaskId} of stale) {
    const result = await conversation.updateOne(
      {_id, activeTurnTaskId: activeTurnTaskId ?? null, status: "busy"},
      {$set: {status: "idle"}, $unset: {activeTurnTaskId: 1}}
    );
    released += result.modifiedCount;
  }
  return released;
};

/** Most idle conversations with a backlog one sweep starts. */
const QUEUE_SWEEP_BATCH_SIZE = 100;

/**
 * Start the next queued submission of every conversation that still has one, after
 * freeing conversations stuck `busy` on a finished turn. A turn frees its conversation in
 * its terminal commit and starts the next queued turn right after; this covers a process
 * that died between the two. Returns how many turns started.
 */
export const sweepQueuedConversations = async (engine: HarnessEngine): Promise<number> => {
  await releaseStaleConversations(engine);
  const stranded = await engine.models.conversation
    .find({"queued.requestId": {$exists: true}, status: "idle"})
    .select({_id: 1})
    .limit(QUEUE_SWEEP_BATCH_SIZE)
    .lean();
  let started = 0;
  for (const {_id} of stranded) {
    if (await startQueuedTurn({conversationId: _id, engine})) {
      started += 1;
    }
  }
  return started;
};

/**
 * Wake whatever owns a task that just settled: a waiting parent task re-checks its wait;
 * a conversation whose turn ended goes back to `idle` and starts its next queued submission.
 */
export const settleTaskOwner = async ({
  engine,
  task,
}: {
  engine: HarnessEngine;
  task: HarnessTaskDocument;
}): Promise<void> => {
  if (task.ownership?.kind === "conversation" && task.ownership.id) {
    await releaseConversation({engine, task});
    await startQueuedTurn({conversationId: task.ownership.id, engine});
    return;
  }
  // A subagent turn frees its conversation, then wakes the task waiting on it.
  await releaseConversation({engine, task});
  if (task.ownership?.kind !== "task" || !task.ownership.id) {
    return;
  }
  try {
    await checkTaskWait({engine, taskId: task.ownership.id});
  } catch (error: unknown) {
    // The periodic wait sweep retries; the child's own outcome is already committed.
    logger.error(
      `Harness could not wake owner ${task.ownership.id} of task ${task._id}: ${errorMessage(error)}`
    );
  }
};

/**
 * Re-check tasks waiting on children. Covers wakes lost to a crash between a child's
 * terminal commit and its owner check. Returns how many tasks were woken.
 */
export const sweepWaitingTasks = async (engine: HarnessEngine): Promise<number> => {
  const waiting = await engine.models.task
    .find({status: HARNESS_TASK_STATUSES.waiting, "waiting.kind": HARNESS_WAIT_KINDS.tasks})
    .sort({updated: 1})
    .limit(WAIT_SWEEP_BATCH_SIZE);
  let woken = 0;
  for (const task of waiting) {
    try {
      if (await checkTaskWait({engine, taskId: task._id})) {
        woken += 1;
      }
    } catch (error: unknown) {
      logger.error(`Harness could not re-check waiting task ${task._id}: ${errorMessage(error)}`);
    }
  }
  return woken;
};
