import type {RESTMethod, User} from "@terreno/api";
import {DateTime, Duration, type DurationLike} from "luxon";
import mongoose from "mongoose";
import {getObservabilityApp} from "../observability/observabilityAppRegistry";
import type {ModelPrice} from "../observability/types";
import type {
  HarnessAbortOptions,
  HarnessAgentDefinition,
  HarnessApprovalDocument,
  HarnessCreateTaskOptions,
  HarnessDecideApprovalOptions,
  HarnessExtensionDefinition,
  HarnessInboxEventDocument,
  HarnessLeaseSettings,
  HarnessModelResolver,
  HarnessResolveInterruptedOptions,
  HarnessRunner,
  HarnessSendEventOptions,
  HarnessStreamingOptions,
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
import {type AgentTasks, createAgentTasks} from "./agentLoop";
import {
  type ApprovalRegistry,
  decideApprovalRecords,
  HARNESS_RESERVED_EVENT_PREFIX,
  listApprovableApprovals,
  userMayApprove,
} from "./approvals";
import {commitResolution, createTaskRecords, type HarnessModels} from "./commit";
import {
  type ConversationContext,
  conversationAgentSnapshot,
  HarnessConversationHandle,
} from "./conversation";
import {extensionName} from "./defineAgent";
import {taskDefinitionKey} from "./defineTask";
import {harnessError} from "./errors";
import {resolveStreamingOptions} from "./events";
import type {ExecutionEnv} from "./executionEnv";
import {acquireOwnerLease, releaseOwnerLease} from "./leases";
import {registerHarnessApproval} from "./models/harnessApproval";
import {registerHarnessConversation} from "./models/harnessConversation";
import {registerHarnessEvent, registerHarnessEventStream} from "./models/harnessEvent";
import {registerHarnessInboxEvent} from "./models/harnessInboxEvent";
import {registerHarnessMemo} from "./models/harnessMemo";
import {registerHarnessMessage} from "./models/harnessMessage";
import {registerHarnessOwner} from "./models/harnessOwner";
import {registerHarnessTask} from "./models/harnessTask";
import {
  abortTaskTree,
  type HarnessEngine,
  settleTaskOwner,
  sweepQueuedConversations,
} from "./ownership";
import {
  type AnyHarnessTaskDefinition,
  assertInFlightVersionsRegistered,
  buildTaskRegistry,
  type HarnessRegistryEntry,
  splitRegistry,
} from "./registry";
import {InProcessRunner} from "./runners/inProcessRunner";
import {
  claimNextTask,
  claimTaskById,
  listRunnableTasks,
  recoverExpiredTasks,
  runClaimedTask,
} from "./runtime";
import {sendEventRecords} from "./waits";

export type {
  AnyHarnessToolDefinition,
  HarnessAbortOptions,
  HarnessAbortRuntime,
  HarnessAgentDefinition,
  HarnessAgentDefinitionInput,
  HarnessApprovalDocument,
  HarnessApprovalOptions,
  HarnessApprovalPolicy,
  HarnessApprovalRequest,
  HarnessApprovalResult,
  HarnessApprovalStatus,
  HarnessApprover,
  HarnessBeforeToolResult,
  HarnessChildOutcome,
  HarnessChildTaskOptions,
  HarnessCommit,
  HarnessConversationAgent,
  HarnessConversationDocument,
  HarnessConversationStatus,
  HarnessCreateTaskOptions,
  HarnessDecideApprovalOptions,
  HarnessEventDocument,
  HarnessEventType,
  HarnessExtensionDefinition,
  HarnessExtensionDefinitionInput,
  HarnessHook,
  HarnessHookApi,
  HarnessHookHandlers,
  HarnessHookKind,
  HarnessInboxEventDocument,
  HarnessInterruptAction,
  HarnessLeaseSettings,
  HarnessMemo,
  HarnessMemoDocument,
  HarnessMessageDocument,
  HarnessMessagePart,
  HarnessMessageRole,
  HarnessModelRef,
  HarnessModelRequest,
  HarnessModelResolver,
  HarnessOutcome,
  HarnessPhaseCommit,
  HarnessPhaseDefinition,
  HarnessReplayPolicy,
  HarnessResolveAction,
  HarnessResolveInterruptedOptions,
  HarnessRetryPolicy,
  HarnessRunAgentOptions,
  HarnessRunnableTask,
  HarnessRunner,
  HarnessRunnerContext,
  HarnessRunTaskOptions,
  HarnessSection,
  HarnessSectionInput,
  HarnessSendEventOptions,
  HarnessSendOptions,
  HarnessStreamingOptions,
  HarnessSubmitDisposition,
  HarnessSubmitOptions,
  HarnessSubmitResult,
  HarnessSystemPromptPart,
  HarnessTaskDefinition,
  HarnessTaskDefinitionInput,
  HarnessTaskDocument,
  HarnessTaskRuntime,
  HarnessTaskSpanKind,
  HarnessTaskStatus,
  HarnessTaskView,
  HarnessTerminalCommit,
  HarnessTestHooks,
  HarnessTextPart,
  HarnessToolApi,
  HarnessToolCall,
  HarnessToolCallPart,
  HarnessToolDefinition,
  HarnessToolDefinitionInput,
  HarnessToolHookApi,
  HarnessToolResultPart,
  HarnessToolWrap,
  HarnessTurnResult,
  HarnessWaitCall,
  HarnessWaitForOptions,
  HarnessWaitForTasksOptions,
  HarnessWaiting,
  HarnessWaitKind,
  HarnessWaitPolicy,
  HarnessWaitResolution,
  HarnessWhenBusy,
} from "../types/harness";
export {
  HARNESS_AGENT_DEFAULT_MAX_STEPS,
  HARNESS_APPROVAL_STATUSES,
  HARNESS_CONVERSATION_STATUSES,
  HARNESS_EVENT_TYPES,
  HARNESS_HOOK_KINDS,
  HARNESS_INTERRUPT_ACTIONS,
  HARNESS_MESSAGE_ROLES,
  HARNESS_MODEL_RETRY_DEFAULTS,
  HARNESS_RESOLVE_ACTIONS,
  HARNESS_RETRY_DEFAULTS,
  HARNESS_SUBMIT_DISPOSITIONS,
  HARNESS_TASK_STATUSES,
  HARNESS_WAIT_KINDS,
  HARNESS_WAIT_POLICIES,
  HARNESS_WAIT_RESOLUTIONS,
  HARNESS_WHEN_BUSY,
} from "../types/harness";
export {AI_HARNESS_GROUP, HARNESS_APPROVALS_SCREEN, harnessAdminScreens} from "./adminScreens";
export {AGENT_TOOL_TASK_NAME, AGENT_TURN_TASK_NAME} from "./agentTaskNames";
export {
  type ApprovalGateOptions,
  approvalGate,
  approvalTaskInput,
  HARNESS_DEFAULT_APPROVERS,
  HarnessApprovalConflictError,
} from "./approvals";
export {HarnessCommitConflictError} from "./commit";
export {
  HarnessConversationBusyError,
  HarnessConversationHandle,
  HarnessConversationOwnedError,
} from "./conversation";
export {defineAgent} from "./defineAgent";
export {defineTask} from "./defineTask";
export {defineTool} from "./defineTool";
export {HarnessDefinitionError} from "./definitionError";
export {HARNESS_ERRORS, type HarnessErrorKind, type HarnessErrorKindName} from "./errors";
export type {
  ExecutionEnv,
  ExecutionEnvCallOptions,
  ExecutionEnvExecOptions,
  ExecutionEnvExecResult,
} from "./executionEnv";
export {
  defineExtension,
  HarnessExtensionError,
  hook,
  section,
  wrapTool,
} from "./extensions";
export {HarnessApp, type HarnessAppOptions} from "./harnessApp";
export {
  HarnessModelCallError,
  isRetryableModelError,
  type ModelCallAttempt,
} from "./modelCall";
export type {AnyHarnessTaskDefinition, HarnessRegistryEntry} from "./registry";
export {
  IN_PROCESS_RUNNER_ROLES,
  InProcessRunner,
  type InProcessRunnerOptions,
  type InProcessRunnerRole,
} from "./runners/inProcessRunner";
export {HarnessSubagentError} from "./subagent";

export interface HarnessOpenOptions {
  /** Handed to phases as `rt.env` and to tools as `api.env` (interface only in Phase 1). */
  env?: ExecutionEnv;
  /**
   * Turns an agent's `{provider, modelId}` into a Vercel AI SDK `LanguageModel`. Required
   * when the registry lists an agent.
   */
  models?: HarnessModelResolver;
  /**
   * Per-model token prices for LLM span `usage.costUsd`. Defaults to the registered
   * `ObservabilityApp`'s `priceMap`.
   */
  priceMap?: Record<string, ModelPrice>;
  /**
   * Every task definition (and version) this process may create or resume, every agent
   * (`defineAgent`) its conversations may use, and every extension (`defineExtension`)
   * those agents and conversations name.
   */
  registry: ReadonlyArray<HarnessRegistryEntry>;
  /** Defaults to a new `InProcessRunner`. */
  runner?: HarnessRunner;
  /** How streamed model text is coalesced into `delta` events. */
  streaming?: HarnessStreamingOptions;
  /** Test-only seams; never set in production code. */
  testHooks?: HarnessTestHooks;
}

export interface HarnessWaitOptions {
  pollInterval?: DurationLike;
  timeout?: DurationLike;
}

/** How often an idle owner looks for queued submissions stranded by a crash. */
const QUEUE_SWEEP_INTERVAL = Duration.fromObject({seconds: 1});

const assertReplicaSet = async (): Promise<void> => {
  const db = mongoose.connection.db;
  if (!db) {
    throw harnessError({
      detail: "Harness.open requires a connected mongoose default connection",
      kind: "configInvalid",
    });
  }
  const hello = await db.command({hello: 1});
  // Replica set members report setName; mongos ("isdbgrid") also supports transactions.
  const isReplicaSet = typeof hello.setName === "string" && hello.setName.length > 0;
  if (!isReplicaSet && hello.msg !== "isdbgrid") {
    throw harnessError({
      detail:
        "Harness.open requires a MongoDB replica set: checkpoints and audit spans commit in one transaction",
      kind: "replicaSetRequired",
    });
  }
};

const resolveObservabilityModels = (): {span: ObsSpanModel; trace: ObsTraceModel} => {
  const span = mongoose.models.ObsSpan as ObsSpanModel | undefined;
  const trace = mongoose.models.ObsTrace as ObsTraceModel | undefined;
  if (!span || !trace) {
    throw harnessError({
      detail:
        "Harness.open requires the local observability plugin: call createLocalObservabilityPlugin() (or register ObservabilityApp with it) before opening the harness",
      kind: "configInvalid",
    });
  }
  return {span, trace};
};

/**
 * Durable task engine. Owns the registry and Mongo storage; a pluggable runner decides
 * who executes runnable tasks.
 */
export class Harness {
  private readonly agents: Map<string, HarnessAgentDefinition>;
  private readonly agentTasks: AgentTasks;
  private readonly definitions: Map<string, HarnessTaskDefinition>;
  private readonly engine: HarnessEngine;
  private readonly extensions: Map<string, HarnessExtensionDefinition>;
  private isStarted = false;
  private nextQueueSweepAt = DateTime.fromMillis(0);
  private readonly models: HarnessModels;
  private readonly runner: HarnessRunner;
  private readonly testHooks: HarnessTestHooks | undefined;

  private constructor({
    agents,
    agentTasks,
    definitions,
    env,
    extensions,
    models,
    runner,
    testHooks,
  }: {
    agents: Map<string, HarnessAgentDefinition>;
    agentTasks: AgentTasks;
    definitions: Map<string, HarnessTaskDefinition>;
    env?: ExecutionEnv;
    extensions: Map<string, HarnessExtensionDefinition>;
    models: HarnessModels;
    runner: HarnessRunner;
    testHooks?: HarnessTestHooks;
  }) {
    this.agents = agents;
    this.agentTasks = agentTasks;
    this.definitions = definitions;
    this.extensions = extensions;
    this.models = models;
    this.runner = runner;
    this.testHooks = testHooks;
    this.engine = {
      agents,
      controllers: new Map(),
      definitions,
      env,
      extensions,
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
    const {agents, extensions, tasks} = splitRegistry(options.registry);
    if (agents.size > 0 && !options.models) {
      throw harnessError({
        detail: "Harness.open: the registry lists agents; pass `models` to resolve them",
        kind: "configInvalid",
      });
    }
    const models: HarnessModels = {
      approval: registerHarnessApproval(),
      conversation: registerHarnessConversation(),
      event: registerHarnessEvent(),
      eventStream: registerHarnessEventStream(),
      inbox: registerHarnessInboxEvent(),
      memo: registerHarnessMemo(),
      message: registerHarnessMessage(),
      owner: registerHarnessOwner(),
      span,
      task: registerHarnessTask(),
      trace,
    };
    const agentTasks = createAgentTasks({
      agents,
      extensions,
      models,
      priceMap: () => options.priceMap ?? getObservabilityApp()?.priceMap,
      random: options.testHooks?.random,
      resolveModel: options.models,
      streaming: resolveStreamingOptions(options.streaming),
    });
    // The built-in agent tasks are always registered, so in-flight turns resume anywhere.
    const definitions = buildTaskRegistry([
      ...tasks,
      agentTasks.turn as unknown as AnyHarnessTaskDefinition,
      agentTasks.tool as unknown as AnyHarnessTaskDefinition,
    ]);
    // Transactions cannot create collections or indexes on every server version.
    await Promise.all(Object.values(models).map((model) => model.init()));
    return new Harness({
      agents,
      agentTasks,
      definitions,
      env: options.env,
      extensions,
      models,
      runner: options.runner ?? new InProcessRunner(),
      testHooks: options.testHooks,
    });
  }

  /**
   * Begin executing runnable tasks. First throws, claiming nothing, when any non-terminal
   * task is pinned to a `name@version` missing from the registry. The runner recovers
   * tasks whose lease expired once it owns execution (immediately, or on takeover when
   * another owner holds the lease).
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      throw harnessError({detail: "Harness is already started", kind: "alreadyStarted"});
    }
    // Claimed before the first await so overlapping start() calls cannot both start the runner.
    this.isStarted = true;
    const {definitions, engine, models, testHooks} = this;
    try {
      await assertInFlightVersionsRegistered({definitions, models});
    } catch (error: unknown) {
      this.isStarted = false;
      throw error;
    }
    await this.runner.start({
      acquireOwnerLease: (lease) => acquireOwnerLease({lease, models, testHooks}),
      claimNext: (lease) => this.claimNextOrSweep(lease),
      claimTask: (taskId, lease) => claimTaskById({definitions, lease, models, taskId}),
      listRunnable: (limit) => listRunnableTasks({definitions, limit, models}),
      recoverExpired: () => recoverExpiredTasks(engine),
      releaseOwnerLease: (lease) => releaseOwnerLease({lease, models}),
      runTask: (task, lease, options) =>
        runClaimedTask({engine, lease, maxPhases: options?.maxPhases, task}),
    });
  }

  /**
   * Claim the next runnable task. When there is none, at most once per
   * `QUEUE_SWEEP_INTERVAL`, start queued submissions stranded on idle conversations (a
   * process died between a turn's end and starting the next queued turn) and claim again.
   */
  private async claimNextOrSweep(lease: HarnessLeaseSettings): Promise<HarnessTaskDocument | null> {
    const {definitions, engine, models} = this;
    const task = await claimNextTask({definitions, lease, models});
    if (task || DateTime.now() < this.nextQueueSweepAt) {
      return task;
    }
    this.nextQueueSweepAt = DateTime.now().plus(QUEUE_SWEEP_INTERVAL);
    if ((await sweepQueuedConversations(engine)) === 0) {
      return null;
    }
    return claimNextTask({definitions, lease, models});
  }

  /** Stop claiming work and wait for every phase in flight to settle. */
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
      throw harnessError({
        detail: `${definition.key} is not in this harness registry`,
        kind: "notRegistered",
      });
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
      throw harnessError({detail: "abort requires a reason", kind: "invalidRequest"});
    }
    const task = await this.models.task.findExactlyOne({_id: taskId});
    if (HARNESS_TERMINAL_STATUSES.has(task.status)) {
      throw harnessError({
        detail: `Task ${taskId} is already ${task.status}`,
        kind: "taskTerminal",
      });
    }
    return abortTaskTree({
      engine: this.engine,
      reason: options.reason,
      top: task,
      userId: options.userId === undefined ? undefined : String(options.userId),
    });
  }

  /**
   * Send `event` with `payload` to a task. The event is stored durably first, so it is
   * never lost: a task already waiting on `event` (`rt.waitFor`) goes back to `pending`
   * and its `waitFor` returns `payload`; otherwise the event stays buffered until a
   * `rt.waitFor(event)` takes it. Works while no runner is up. Delivery is FIFO per event
   * name. With `requestId` (unique per task), a repeated send returns the event sent
   * first. Throws when the task is terminal or `event` is blank.
   */
  async sendEvent(
    taskId: mongoose.Types.ObjectId | string,
    event: string,
    payload?: unknown,
    options: HarnessSendEventOptions = {}
  ): Promise<HarnessInboxEventDocument> {
    if (typeof event !== "string" || !event.trim()) {
      throw harnessError({detail: "sendEvent requires an event name", kind: "invalidRequest"});
    }
    if (event.startsWith(HARNESS_RESERVED_EVENT_PREFIX)) {
      throw harnessError({
        detail: `sendEvent: event names starting with "${HARNESS_RESERVED_EVENT_PREFIX}" are reserved for the harness (approval decisions use decideApproval)`,
        kind: "invalidRequest",
      });
    }
    const sent = await sendEventRecords({
      event,
      models: this.models,
      payload,
      requestId: options.requestId,
      taskId,
    });
    if (sent.isWoken) {
      this.runner.wake();
    }
    return sent.event;
  }

  /**
   * Approve or reject a pending approval as `userId`, without checking approvers (the
   * `HarnessApp` routes check them first). In one transaction: the approval's status,
   * `decidedBy`, `decidedAt`, `reason`; the event that wakes the waiting `rt.approval`;
   * and the `approval:<key>` audit span. Throws `HarnessApprovalConflictError` when it is
   * already decided or expired, or its task ended.
   */
  async decideApproval(
    approvalId: mongoose.Types.ObjectId | string,
    options: HarnessDecideApprovalOptions
  ): Promise<HarnessApprovalDocument> {
    if (typeof options?.approved !== "boolean") {
      throw harnessError({
        detail: "decideApproval requires approved: true or false",
        kind: "invalidRequest",
      });
    }
    if (!options.approved && !options.reason?.trim()) {
      throw harnessError({
        detail: "decideApproval: a rejection requires a reason",
        kind: "invalidRequest",
      });
    }
    const {approval, isWoken} = await decideApprovalRecords({
      approvalId,
      models: this.models,
      options,
    });
    if (isWoken) {
      this.runner.wake();
    }
    return approval;
  }

  /**
   * Whether `user` passes every approver of `approval` (its definition's or extension's
   * `approvals[key]`, default `[Permissions.IsAdmin]`), called with `method`. False when
   * this registry lacks the approval's `name@version` or extension.
   */
  async mayApprove({
    approval,
    method = "update",
    user,
  }: {
    approval: HarnessApprovalDocument;
    method?: RESTMethod;
    user?: User;
  }): Promise<boolean> {
    return userMayApprove({approval, method, registry: this.approvalRegistry(), user});
  }

  /** Pending, unexpired approvals of live tasks that `user` may approve, oldest first. */
  async approvableApprovals({user}: {user?: User}): Promise<HarnessApprovalDocument[]> {
    return listApprovableApprovals({models: this.models, registry: this.approvalRegistry(), user});
  }

  private approvalRegistry(): ApprovalRegistry {
    return {definitions: this.definitions, extensions: this.extensions};
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
      throw harnessError({
        detail: `resolveInterrupted action must be one of ${Object.values(HARNESS_RESOLVE_ACTIONS).join(", ")}`,
        kind: "invalidRequest",
      });
    }
    if (typeof options.reason !== "string" || !options.reason.trim()) {
      throw harnessError({detail: "resolveInterrupted requires a reason", kind: "invalidRequest"});
    }
    const task = await this.models.task.findExactlyOne({_id: taskId});
    if (task.status !== HARNESS_TASK_STATUSES.interrupted) {
      throw harnessError({
        detail: `Task ${taskId} is ${task.status}, not interrupted`,
        kind: "taskNotInterrupted",
      });
    }
    if (options.action === HARNESS_RESOLVE_ACTIONS.retry && task.abortRequested?.at) {
      throw harnessError({
        detail: `Task ${taskId} is being aborted; resolve it with abort, not retry`,
        kind: "taskAborting",
      });
    }
    if (
      options.action === HARNESS_RESOLVE_ACTIONS.retry &&
      !this.definitions.has(taskDefinitionKey(task))
    ) {
      throw harnessError({
        detail: `${taskDefinitionKey(task)} is not in this harness registry; register it before retrying`,
        kind: "notRegistered",
      });
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

  /**
   * Start a conversation with a registered agent. Its config (model, instructions,
   * extension names, the tool names they resolve to, fallbacks, `maxSteps`) is
   * snapshotted onto the conversation. `extensions` replaces the agent's extension list
   * for this conversation; each must be registered.
   */
  async createConversation({
    agent,
    extensions,
    userId,
  }: {
    agent: HarnessAgentDefinition;
    extensions?: ReadonlyArray<HarnessExtensionDefinition | string>;
    userId?: mongoose.Types.ObjectId | string;
  }): Promise<HarnessConversationHandle> {
    if (this.agents.get(agent?.name) !== agent) {
      throw harnessError({
        detail: `Agent "${agent?.name}" is not in this harness registry`,
        kind: "notRegistered",
      });
    }
    const extensionNames = extensions?.map((entry) => extensionName("createConversation", entry));
    if (extensionNames && new Set(extensionNames).size !== extensionNames.length) {
      throw harnessError({
        detail: "createConversation: an extension is listed more than once",
        kind: "invalidRequest",
      });
    }
    for (const name of extensionNames ?? []) {
      if (!this.extensions.has(name)) {
        throw harnessError({
          detail: `Extension "${name}" is not in this harness registry`,
          kind: "notRegistered",
        });
      }
    }
    const document = await this.models.conversation.create({
      agent: conversationAgentSnapshot({agent, extensionNames, extensions: this.extensions}),
      ownership: {kind: "root"},
      userId,
    });
    return new HarnessConversationHandle(this.conversationContext(), document);
  }

  /** Load a conversation. Throws when it does not exist. */
  async conversation(
    conversationId: mongoose.Types.ObjectId | string
  ): Promise<HarnessConversationHandle> {
    const document = await this.models.conversation.findExactlyOne({_id: conversationId});
    return new HarnessConversationHandle(this.conversationContext(), document);
  }

  private conversationContext(): ConversationContext {
    return {
      models: this.models,
      turn: this.agentTasks.turn as unknown as HarnessTaskDefinition,
      wake: () => this.runner.wake(),
    };
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
        throw harnessError({
          detail: `Timed out waiting for task ${taskId} (${taskDefinitionKey(task)}) in status ${task.status}`,
          kind: "waitTimedOut",
        });
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}
