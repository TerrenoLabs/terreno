import {DateTime, Duration, type DurationLike} from "luxon";
import mongoose from "mongoose";

import type {
  HarnessAbortOptions,
  HarnessCreateTaskOptions,
  HarnessResolveInterruptedOptions,
  HarnessRunner,
  HarnessTaskDefinition,
  HarnessTaskDocument,
  HarnessTestHooks,
} from "../types/harness";
import {
  HARNESS_RESOLVE_ACTIONS,
  HARNESS_TASK_STATUSES,
  HARNESS_TERMINAL_STATUSES,
} from "../types/harness";
import type {ObsSpanModel, ObsTraceModel} from "../types/observability";
import {commitResolution, createTaskRecords, type HarnessModels} from "./commit";
import {taskDefinitionKey} from "./defineTask";
import {acquireOwnerLease, releaseOwnerLease} from "./leases";
import {registerHarnessOwner} from "./models/harnessOwner";
import {registerHarnessTask} from "./models/harnessTask";
import {abortTaskTree, type HarnessEngine, settleTaskOwner} from "./ownership";
import {InProcessRunner} from "./runners/inProcessRunner";
import {claimNextTask, recoverExpiredTasks, runClaimedTask} from "./runtime";

export type {
  HarnessAbortOptions,
  HarnessAbortRuntime,
  HarnessChildOutcome,
  HarnessChildTaskOptions,
  HarnessCommit,
  HarnessCreateTaskOptions,
  HarnessLeaseSettings,
  HarnessOutcome,
  HarnessPhaseCommit,
  HarnessPhaseDefinition,
  HarnessReplayPolicy,
  HarnessResolveAction,
  HarnessResolveInterruptedOptions,
  HarnessRetryPolicy,
  HarnessRunner,
  HarnessRunnerContext,
  HarnessTaskDefinition,
  HarnessTaskDefinitionInput,
  HarnessTaskDocument,
  HarnessTaskRuntime,
  HarnessTaskStatus,
  HarnessTaskView,
  HarnessTerminalCommit,
  HarnessTestHooks,
  HarnessWaitForTasksOptions,
  HarnessWaiting,
  HarnessWaitKind,
  HarnessWaitPolicy,
} from "../types/harness";
export {
  HARNESS_RESOLVE_ACTIONS,
  HARNESS_RETRY_DEFAULTS,
  HARNESS_TASK_STATUSES,
  HARNESS_WAIT_KINDS,
  HARNESS_WAIT_POLICIES,
} from "../types/harness";
export {HarnessCommitConflictError} from "./commit";
export {defineTask} from "./defineTask";
export {
  IN_PROCESS_RUNNER_ROLES,
  InProcessRunner,
  type InProcessRunnerOptions,
  type InProcessRunnerRole,
} from "./runners/inProcessRunner";

/** Any task definition, whatever its input, state, and output types. */
export type AnyHarnessTaskDefinition = HarnessTaskDefinition<never, unknown, unknown>;

export interface HarnessOpenOptions {
  /** Every task definition (and version) this process may create or resume. */
  registry: ReadonlyArray<AnyHarnessTaskDefinition>;
  /** Defaults to a new `InProcessRunner`. */
  runner?: HarnessRunner;
  /** Test-only seams; never set in production code. */
  testHooks?: HarnessTestHooks;
}

export interface HarnessWaitOptions {
  pollInterval?: DurationLike;
  timeout?: DurationLike;
}

const assertReplicaSet = async (): Promise<void> => {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Harness.open requires a connected mongoose default connection");
  }
  const hello = await db.command({hello: 1});
  // Replica set members report setName; mongos ("isdbgrid") also supports transactions.
  const isReplicaSet = typeof hello.setName === "string" && hello.setName.length > 0;
  if (!isReplicaSet && hello.msg !== "isdbgrid") {
    throw new Error(
      "Harness.open requires a MongoDB replica set: checkpoints and audit spans commit in one transaction"
    );
  }
};

const resolveObservabilityModels = (): {span: ObsSpanModel; trace: ObsTraceModel} => {
  const span = mongoose.models.ObsSpan as ObsSpanModel | undefined;
  const trace = mongoose.models.ObsTrace as ObsTraceModel | undefined;
  if (!span || !trace) {
    throw new Error(
      "Harness.open requires the local observability plugin: call createLocalObservabilityPlugin() (or register ObservabilityApp with it) before opening the harness"
    );
  }
  return {span, trace};
};

const buildRegistry = (
  registry: ReadonlyArray<AnyHarnessTaskDefinition>
): Map<string, HarnessTaskDefinition> => {
  const definitions = new Map<string, HarnessTaskDefinition>();
  for (const definition of registry) {
    if (definitions.has(definition.key)) {
      throw new Error(`Harness registry lists ${definition.key} more than once`);
    }
    definitions.set(definition.key, definition as unknown as HarnessTaskDefinition);
  }
  return definitions;
};

/**
 * Durable task engine. Owns the registry and Mongo storage; a pluggable runner decides
 * who executes runnable tasks.
 */
export class Harness {
  private readonly definitions: Map<string, HarnessTaskDefinition>;
  private readonly engine: HarnessEngine;
  private isStarted = false;
  private readonly models: HarnessModels;
  private readonly runner: HarnessRunner;
  private readonly testHooks: HarnessTestHooks | undefined;

  private constructor({
    definitions,
    models,
    runner,
    testHooks,
  }: {
    definitions: Map<string, HarnessTaskDefinition>;
    models: HarnessModels;
    runner: HarnessRunner;
    testHooks?: HarnessTestHooks;
  }) {
    this.definitions = definitions;
    this.models = models;
    this.runner = runner;
    this.testHooks = testHooks;
    this.engine = {
      controllers: new Map(),
      definitions,
      models,
      testHooks,
      wake: () => runner.wake(),
    };
  }

  /**
   * Validate the environment and build a harness. Throws when the local observability
   * models are missing or the connection is not a replica set.
   */
  static async open(options: HarnessOpenOptions): Promise<Harness> {
    const {span, trace} = resolveObservabilityModels();
    await assertReplicaSet();
    const definitions = buildRegistry(options.registry);
    const task = registerHarnessTask();
    const owner = registerHarnessOwner();
    // Transactions cannot create collections or indexes on every server version.
    await Promise.all([task.init(), owner.init(), span.init(), trace.init()]);
    return new Harness({
      definitions,
      models: {owner, span, task, trace},
      runner: options.runner ?? new InProcessRunner(),
      testHooks: options.testHooks,
    });
  }

  /**
   * Begin executing runnable tasks. The runner recovers tasks whose lease expired once it
   * owns execution (immediately, or on takeover when another owner holds the lease).
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      throw new Error("Harness is already started");
    }
    this.isStarted = true;
    const {definitions, engine, models, testHooks} = this;
    await this.runner.start({
      acquireOwnerLease: (lease) => acquireOwnerLease({lease, models, testHooks}),
      claimNext: (lease) => claimNextTask({definitions, lease, models}),
      recoverExpired: () => recoverExpiredTasks(engine),
      releaseOwnerLease: (lease) => releaseOwnerLease({lease, models}),
      runTask: (task, lease) => runClaimedTask({engine, lease, task}),
    });
  }

  /** Stop claiming work and wait for the phase in flight to settle. */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }
    await this.runner.stop();
    this.isStarted = false;
  }

  /**
   * Create a root task pinned to `definition`'s `name@version`. With `requestId`, a
   * repeated call returns the task created first.
   */
  async createTask<In, State, Out>(
    definition: HarnessTaskDefinition<In, State, Out>,
    input: In,
    options: HarnessCreateTaskOptions = {}
  ): Promise<HarnessTaskDocument> {
    const registered = this.definitions.get(definition.key);
    if (!registered) {
      throw new Error(`${definition.key} is not in this harness registry`);
    }
    const task = await createTaskRecords({
      definition: registered,
      input,
      models: this.models,
      options,
    });
    this.runner.wake();
    return task;
  }

  /**
   * Abort a task and every non-terminal task it owns, deepest first. Each task's running
   * phase (in this process, or elsewhere within one heartbeat) sees `rt.signal` abort; its
   * `abort` handler runs; then it is committed `aborted` with an `abort` audit span. A
   * failing handler is recorded on that span and the abort proceeds. Throws when `reason`
   * is blank or the task is already terminal.
   */
  async abort(
    taskId: mongoose.Types.ObjectId | string,
    options: HarnessAbortOptions
  ): Promise<HarnessTaskDocument> {
    if (typeof options?.reason !== "string" || !options.reason.trim()) {
      throw new Error("abort requires a reason");
    }
    const task = await this.models.task.findExactlyOne({_id: taskId});
    if (HARNESS_TERMINAL_STATUSES.has(task.status)) {
      throw new Error(`Task ${taskId} is already ${task.status}`);
    }
    return abortTaskTree({
      engine: this.engine,
      reason: options.reason,
      top: task,
      userId: options.userId === undefined ? undefined : String(options.userId),
    });
  }

  /**
   * Decide what happens to an `interrupted` task: `retry` re-queues the same phase,
   * `abort` runs its abort handler (after aborting every task it owns) and ends it
   * `aborted`, `complete` ends it `completed` with `result`. The decision and its reason
   * are audited in a `resolveInterrupted` span. Throws when the task is not
   * `interrupted` or `reason` is empty.
   */
  async resolveInterrupted(
    taskId: mongoose.Types.ObjectId | string,
    options: HarnessResolveInterruptedOptions
  ): Promise<HarnessTaskDocument> {
    if (!Object.values(HARNESS_RESOLVE_ACTIONS).includes(options.action)) {
      throw new Error(
        `resolveInterrupted action must be one of ${Object.values(HARNESS_RESOLVE_ACTIONS).join(", ")}`
      );
    }
    if (typeof options.reason !== "string" || !options.reason.trim()) {
      throw new Error("resolveInterrupted requires a reason");
    }
    const task = await this.models.task.findExactlyOne({_id: taskId});
    if (task.status !== HARNESS_TASK_STATUSES.interrupted) {
      throw new Error(`Task ${taskId} is ${task.status}, not interrupted`);
    }
    if (options.action === HARNESS_RESOLVE_ACTIONS.retry && task.abortRequested?.at) {
      throw new Error(`Task ${taskId} is being aborted; resolve it with abort, not retry`);
    }
    const decidedBy = options.userId === undefined ? undefined : String(options.userId);
    if (options.action === HARNESS_RESOLVE_ACTIONS.abort) {
      return abortTaskTree({
        engine: this.engine,
        override: {
          error: `Aborted after interruption: ${options.reason}`,
          filter: {phase: task.phase, status: HARNESS_TASK_STATUSES.interrupted},
          output: {action: options.action, decidedBy, phase: task.phase, reason: options.reason},
          spanName: "resolveInterrupted",
        },
        reason: options.reason,
        top: task,
        userId: decidedBy,
      });
    }
    const resolved = await commitResolution({
      models: this.models,
      options: {...options, action: options.action},
      task,
      testHooks: this.testHooks,
    });
    if (options.action === HARNESS_RESOLVE_ACTIONS.retry) {
      this.runner.wake();
    } else {
      await settleTaskOwner({engine: this.engine, task: resolved});
    }
    return resolved;
  }

  /** Poll until the task is terminal; throws after `timeout` (default 30 seconds). */
  async waitForTask(
    taskId: mongoose.Types.ObjectId | string,
    options: HarnessWaitOptions = {}
  ): Promise<HarnessTaskDocument> {
    const deadline = DateTime.now().plus(
      Duration.fromDurationLike(options.timeout ?? {seconds: 30})
    );
    const pollMs = Duration.fromDurationLike(options.pollInterval ?? {milliseconds: 50}).toMillis();
    for (;;) {
      const task = await this.models.task.findExactlyOne({_id: taskId});
      if (HARNESS_TERMINAL_STATUSES.has(task.status)) {
        return task;
      }
      if (DateTime.now() >= deadline) {
        throw new Error(
          `Timed out waiting for task ${taskId} (${taskDefinitionKey(task)}) in status ${task.status}`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}
