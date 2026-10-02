import {DateTime, Duration, type DurationLike} from "luxon";
import mongoose from "mongoose";

import type {
  HarnessCreateTaskOptions,
  HarnessRunner,
  HarnessTaskDefinition,
  HarnessTaskDocument,
  HarnessTestHooks,
} from "../types/harness";
import {HARNESS_TERMINAL_STATUSES} from "../types/harness";
import type {ObsSpanModel, ObsTraceModel} from "../types/observability";
import {createTaskRecords, type HarnessModels} from "./commit";
import {taskDefinitionKey} from "./defineTask";
import {registerHarnessTask} from "./models/harnessTask";
import {InProcessRunner} from "./runners/inProcessRunner";
import {claimNextTask, runClaimedTask} from "./runtime";

export type {
  HarnessCommit,
  HarnessCreateTaskOptions,
  HarnessOutcome,
  HarnessPhaseCommit,
  HarnessPhaseDefinition,
  HarnessReplayPolicy,
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
} from "../types/harness";
export {HARNESS_TASK_STATUSES} from "../types/harness";
export {HarnessCommitConflictError} from "./commit";
export {defineTask} from "./defineTask";
export {InProcessRunner, type InProcessRunnerOptions} from "./runners/inProcessRunner";

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
    // Transactions cannot create collections or indexes on every server version.
    await Promise.all([task.init(), span.init(), trace.init()]);
    return new Harness({
      definitions,
      models: {span, task, trace},
      runner: options.runner ?? new InProcessRunner(),
      testHooks: options.testHooks,
    });
  }

  /** Begin executing runnable tasks. */
  async start(): Promise<void> {
    if (this.isStarted) {
      throw new Error("Harness is already started");
    }
    this.isStarted = true;
    await this.runner.start({
      claimNext: () => claimNextTask({definitions: this.definitions, models: this.models}),
      runTask: (task) =>
        runClaimedTask({
          definitions: this.definitions,
          models: this.models,
          task,
          testHooks: this.testHooks,
        }),
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
