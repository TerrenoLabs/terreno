import type {FindExactlyOnePlugin, FindOneOrNonePlugin, PermissionMethod, z} from "@terreno/api";
import type {LanguageModel, ModelMessage} from "ai";
import type {Duration, DurationLike} from "luxon";
import type mongoose from "mongoose";

import type {ExecutionEnv} from "../harness/executionEnv";

/** Every lifecycle status a harness task can hold. */
export const HARNESS_TASK_STATUSES = {
  aborted: "aborted",
  completed: "completed",
  failed: "failed",
  interrupted: "interrupted",
  pending: "pending",
  running: "running",
  waiting: "waiting",
} as const;

export type HarnessTaskStatus = (typeof HARNESS_TASK_STATUSES)[keyof typeof HARNESS_TASK_STATUSES];

/** Statuses after which a task never runs again. */
export const HARNESS_TERMINAL_STATUSES: ReadonlySet<HarnessTaskStatus> = new Set([
  HARNESS_TASK_STATUSES.aborted,
  HARNESS_TASK_STATUSES.completed,
  HARNESS_TASK_STATUSES.failed,
]);

export type HarnessTerminalStatus = "aborted" | "completed" | "failed";

/** Whether a phase (or tool) may re-run after it was interrupted mid-flight. */
export type HarnessReplayPolicy = "never" | "safe";

/** What an interrupted `replay: "never"` phase does; see `onInterrupt` on `defineTask`. */
export const HARNESS_INTERRUPT_ACTIONS = {
  fail: "fail",
  park: "park",
} as const;

export type HarnessInterruptAction =
  (typeof HARNESS_INTERRUPT_ACTIONS)[keyof typeof HARNESS_INTERRUPT_ACTIONS];

/** Span kinds a task's own audit span may take. */
export type HarnessTaskSpanKind = "AGENT" | "CHAIN" | "TOOL";

export type HarnessOwnershipKind = "conversation" | "root" | "task";

export interface HarnessOwnership {
  id?: mongoose.Types.ObjectId;
  kind: HarnessOwnershipKind;
}

/** How a thrown phase is retried. Every field is optional; see `HARNESS_RETRY_DEFAULTS`. */
export interface HarnessRetryPolicy {
  /** Base delay before the first retry; doubles on every later failure. */
  backoffMs?: number;
  /** Runs allowed per phase visit (first run included) before the task fails. */
  maxAttempts?: number;
  /** Upper bound on any single retry delay, before jitter. */
  maxBackoffMs?: number;
}

/** Retry policy applied to fields a task definition leaves out. */
export const HARNESS_RETRY_DEFAULTS = {
  backoffMs: 1000,
  maxAttempts: 3,
  maxBackoffMs: 60_000,
} as const;

export interface HarnessLease {
  acquiredAt?: Date;
  expiresAt?: Date;
  owner?: string;
  token?: string;
}

/** What a `waiting` task is blocked on. */
export const HARNESS_WAIT_KINDS = {
  event: "event",
  sleep: "sleep",
  tasks: "tasks",
} as const;

export type HarnessWaitKind = (typeof HARNESS_WAIT_KINDS)[keyof typeof HARNESS_WAIT_KINDS];

/** How `rt.waitForTasks` resolves: when every child settles, or at the first failure. */
export const HARNESS_WAIT_POLICIES = {
  all: "all",
  failFast: "failFast",
} as const;

export type HarnessWaitPolicy = (typeof HARNESS_WAIT_POLICIES)[keyof typeof HARNESS_WAIT_POLICIES];

/** How one `rt.waitFor` / `rt.sleep` call resolved. */
export const HARNESS_WAIT_RESOLUTIONS = {
  /** A sleep reached its `timeoutAt`. */
  elapsed: "elapsed",
  /** An event was delivered. */
  event: "event",
  /** An event wait reached its `timeoutAt` first. */
  timeout: "timeout",
} as const;

export type HarnessWaitResolution =
  (typeof HARNESS_WAIT_RESOLUTIONS)[keyof typeof HARNESS_WAIT_RESOLUTIONS];

/**
 * Durable record of one `rt.waitFor` / `rt.sleep` call, stored on the task under
 * `waits["<step>:<call index>"]` so a re-run of the same phase visit returns what the
 * call returned the first time.
 */
export interface HarnessWaitCall {
  /** Event id delivered to the call (`resolution: "event"`). */
  eventId?: mongoose.Types.ObjectId;
  /** Event name for an event wait. */
  key?: string;
  kind: "event" | "sleep";
  resolution?: HarnessWaitResolution;
  resolvedAt?: Date;
  /** When the call first ran; the resume span starts here. */
  startedAt: Date;
  timeoutAt?: Date;
}

export interface HarnessWaiting {
  key?: string;
  kind?: HarnessWaitKind;
  policy?: HarnessWaitPolicy;
  taskIds?: mongoose.Types.ObjectId[];
  timeoutAt?: Date;
}

/** Recorded by `harness.abort` before any handler runs; blocks new claims of the task. */
export interface HarnessAbortRequest {
  at: Date;
  /** Until when one aborter holds the right to run the handler and commit the abort. */
  handlerClaimExpiresAt?: Date;
  reason: string;
  userId?: mongoose.Types.ObjectId;
}

export interface HarnessOutcome {
  error?: string;
  result?: unknown;
  status: HarnessTerminalStatus;
}

export interface HarnessTaskDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  abortRequested?: HarnessAbortRequest;
  /** Owning tasks from the root down to the parent; empty for a root task. */
  ancestorIds?: mongoose.Types.ObjectId[];
  attempt: number;
  background: boolean;
  /** Times a runner claimed the task; numbers each runnable visit for job dispatch. */
  claims?: number;
  created: Date;
  deleted: boolean;
  input?: unknown;
  lease?: HarnessLease;
  name: string;
  outcome?: HarnessOutcome;
  ownership: HarnessOwnership;
  phase: string;
  requestId?: string;
  retry?: HarnessRetryPolicy;
  rootSpanId: mongoose.Types.ObjectId;
  rootTaskId: mongoose.Types.ObjectId;
  runAt?: Date;
  state?: unknown;
  status: HarnessTaskStatus;
  /** Events received by `harness.sendEvent`; orders the task's inbox. */
  eventSeq: number;
  /** Phase commits so far; identifies the current phase visit. */
  step: number;
  traceId: mongoose.Types.ObjectId;
  updated: Date;
  userId?: mongoose.Types.ObjectId;
  version: number;
  waiting?: HarnessWaiting;
  /** `rt.waitFor` / `rt.sleep` calls of the current phase visit, by `<step>:<call index>`. */
  waits?: Record<string, HarnessWaitCall>;
}

export interface HarnessTaskStatics
  extends FindExactlyOnePlugin<HarnessTaskDocument>,
    FindOneOrNonePlugin<HarnessTaskDocument> {}

export interface HarnessTaskModel extends mongoose.Model<HarnessTaskDocument>, HarnessTaskStatics {}

/** Singleton lease that decides which `InProcessRunner` drains tasks. */
export interface HarnessOwnerDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  created: Date;
  expiresAt: Date;
  key: string;
  owner: string;
  updated: Date;
}

export interface HarnessOwnerModel
  extends mongoose.Model<HarnessOwnerDocument>,
    FindExactlyOnePlugin<HarnessOwnerDocument>,
    FindOneOrNonePlugin<HarnessOwnerDocument> {}

/** Read-only view of a task handed to each phase. */
export interface HarnessTaskView<In, State> {
  attempt: number;
  id: string;
  input: In;
  name: string;
  phase: string;
  state: State;
  userId?: string;
  version: number;
}

/** Move to another phase, optionally replacing state (omitted state is kept). */
export interface HarnessPhaseCommit<State> {
  phase: string;
  state?: State;
}

export type HarnessTerminalCommit<Out> =
  | {terminal: {result?: Out; status: "completed"}}
  | {terminal: {error: string; status: "failed"}};

export type HarnessCommit<State, Out> = HarnessPhaseCommit<State> | HarnessTerminalCommit<Out>;

/** Options for `rt.createTask`. */
export interface HarnessChildTaskOptions {
  /**
   * Stored on the child. A background task belongs to its owner but not to the owner's
   * current conversation turn (turn-abort semantics ship with conversations).
   */
  background?: boolean;
  /**
   * Stable name for this child within the current attempt of the current phase visit.
   * Defaults to the call's position (`0`, `1`, ...). A re-run of the same attempt (wake,
   * crash replay) gets the child created first instead of a duplicate; a retry creates a
   * fresh child.
   */
  key?: string;
}

/** Settled child as returned by `rt.waitForTasks`, in the order of the ids passed. */
export interface HarnessChildOutcome {
  error?: string;
  id: string;
  name: string;
  result?: unknown;
  status: HarnessTerminalStatus;
}

export interface HarnessWaitForOptions {
  /** Resolve with `undefined` when no event arrives within this long. Default: wait forever. */
  timeout?: DurationLike;
}

export interface HarnessSendEventOptions {
  /** Idempotency key, unique per task: a repeated send returns the event sent first. */
  requestId?: string;
}

/** An event sent to a task by `harness.sendEvent`, buffered until a `rt.waitFor` takes it. */
export interface HarnessInboxEventDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  /** `<step>:<call index>` of the `rt.waitFor` call that received it. */
  consumedKey?: string;
  consumedAt?: Date;
  created: Date;
  name: string;
  payload?: unknown;
  requestId?: string;
  /** Position in the task's inbox (1, 2, ...); delivery is FIFO per event name. */
  seq: number;
  taskId: mongoose.Types.ObjectId;
  updated: Date;
}

export interface HarnessInboxEventModel
  extends mongoose.Model<HarnessInboxEventDocument>,
    FindExactlyOnePlugin<HarnessInboxEventDocument>,
    FindOneOrNonePlugin<HarnessInboxEventDocument> {}

export interface HarnessWaitForTasksOptions {
  /** Default `all`. */
  policy?: HarnessWaitPolicy;
}

/** Runtime surface handed to phases. */
export interface HarnessTaskRuntime<State, Out> {
  /**
   * Ask a human to approve. Creates a `HarnessApproval` (once per call per phase visit) in
   * the same transaction that parks the task `waiting` on the approval's own event, then
   * returns the decision once a permitted user approves or rejects it, or
   * `{approved: false, expired: true}` once `timeout` passes. Who may decide comes from the
   * definition's `approvals[key].approvers` (default `[Permissions.IsAdmin]`).
   */
  approval: HarnessApprovalRequest;
  /** Persist the checkpoint (or terminal outcome) and its audit span in one transaction. */
  commit: (next: HarnessCommit<State, Out>) => Promise<void>;
  /** Create a child task owned by this task, in the same trace. Returns the child id. */
  createTask: <ChildIn, ChildState, ChildOut>(
    definition: HarnessTaskDefinition<ChildIn, ChildState, ChildOut>,
    input: ChildIn,
    options?: HarnessChildTaskOptions
  ) => Promise<string>;
  /**
   * Execution environment from `Harness.open({env})`, when one was given. Phase 1 ships the
   * `ExecutionEnv` interface only; implementations land with coding agents.
   */
  env?: ExecutionEnv;
  /**
   * Run `agent` as a subagent: a conversation owned by this task whose turn is a child
   * task, nested under this task's span as an `AGENT` span. Returns the final assistant
   * text, or, when `output` (or the agent's own `output`) is set, the parsed object.
   * Until the turn settles the task commits `waiting` and the phase stops; it re-runs
   * when the turn ends, and this call then finds the same conversation and returns.
   * Call it sequentially; for parallel fan-out use `createTask` + `waitForTasks`.
   * Throws `HarnessSubagentError` when the turn fails, is aborted, or its output does not
   * match the schema.
   */
  runAgent: <Result = string>(
    agent: HarnessAgentDefinition,
    options: HarnessRunAgentOptions<Result>
  ) => Promise<Result>;
  /**
   * Durable decision storage scoped to this task. `rt.memo(key)` reads the stored value
   * (`undefined` when unset); `rt.memo(key, value)` stores `value` unless the key is
   * already set, and returns whichever value is stored: the first write wins, across
   * concurrent calls, replays, and restarts.
   */
  memo: HarnessMemo;
  /**
   * Append `text` to the task's event stream as an `output` event (permanent). A phase
   * that re-runs (replay, retry) sends its output again.
   */
  output: (text: string) => Promise<void>;
  /** Aborted when the task is aborted or this run loses its lease; stop work promptly. */
  signal: AbortSignal;
  /**
   * Return once `duration` has passed. Until then the task commits `waiting` (kind
   * `sleep`), gives up its lease, and the phase stops; it re-runs at `timeoutAt`, and this
   * call then returns.
   */
  sleep: (duration: DurationLike) => Promise<void>;
  taskId: string;
  /**
   * Return the payload of the oldest undelivered `event` sent to this task with
   * `harness.sendEvent`, or `undefined` once `timeout` passes first. Until then the task
   * commits `waiting` (kind `event`), gives up its lease, and the phase stops; it re-runs
   * when the event arrives or the timeout passes. A re-run of the same phase visit gets
   * the same result from the same call.
   */
  waitFor: <T = unknown>(event: string, options?: HarnessWaitForOptions) => Promise<T | undefined>;
  /**
   * Return child outcomes once they settle under `policy`. Until then the task commits
   * `waiting`, gives up its lease, and the phase stops; it re-runs from its checkpoint
   * when the children settle, and this call then returns the outcomes.
   */
  waitForTasks: (
    ids: ReadonlyArray<mongoose.Types.ObjectId | string>,
    options?: HarnessWaitForTasksOptions
  ) => Promise<HarnessChildOutcome[]>;
}

/**
 * Read or first-write a durable memo. Values must be JSON-serializable; `undefined` as the
 * value means "read".
 */
export interface HarnessMemo {
  <T = unknown>(key: string): Promise<T | undefined>;
  <T>(key: string, value: T): Promise<T>;
}

/** Options for `rt.runAgent`. */
export interface HarnessRunAgentOptions<Result> {
  /** The subagent's user message. A non-string value is sent as JSON. */
  input: unknown;
  /** Replaces the agent's instructions for this subagent conversation only. */
  instructions?: string;
  /**
   * Structured output schema; defaults to the agent's own `output`. Requested through the
   * AI SDK's `Output.object`, then validated with this schema before it is returned.
   */
  output?: z.ZodType<Result>;
}

/** Runtime handed to a task's `abort` handler. */
export interface HarnessAbortRuntime {
  /** Why the task is being aborted. */
  reason: string;
  taskId: string;
  /** Who requested the abort, when known. */
  userId?: string;
}

export interface HarnessPhaseDefinition<In, State, Out> {
  /** Defaults to `never`: an interrupted phase is parked, not re-run. */
  replay?: HarnessReplayPolicy;
  run(task: HarnessTaskView<In, State>, rt: HarnessTaskRuntime<State, Out>): Promise<void>;
}

export interface HarnessTaskDefinitionInput<In, State, Out> {
  /**
   * Who may decide each `rt.approval(key)` of this definition, by key. A key left out
   * defaults to `[Permissions.IsAdmin]`. Kept in code, never stored: the HTTP routes look
   * the policy up by the approval's `name@version` and `key` at request time.
   */
  approvals?: Readonly<Record<string, HarnessApprovalPolicy>>;
  /**
   * Compensation handler run before the task is marked `aborted`, after every task it
   * owns is already aborted. A throw is recorded on the abort span; the abort proceeds.
   */
  abort?(task: HarnessTaskView<In, State>, rt: HarnessAbortRuntime): Promise<void>;
  initial(input: In): {phase: string; state?: State};
  name: string;
  /**
   * What an interrupted `replay: "never"` phase does. `park` (default) sets `interrupted`
   * and waits for `resolveInterrupted`; `fail` ends the task `failed` with an
   * "Interrupted, not retried" error so a waiting owner can carry on (agent tool calls).
   */
  onInterrupt?: HarnessInterruptAction;
  phases: Record<string, HarnessPhaseDefinition<In, State, Out>>;
  retry?: HarnessRetryPolicy;
  /** Kind of the task's own audit span. Default `CHAIN`. */
  spanKind?: HarnessTaskSpanKind;
  /** Name of the task's own audit span. Default `name@version`. */
  spanName?: (input: In) => string;
  version: number;
}

export interface HarnessTaskDefinition<In = unknown, State = unknown, Out = unknown>
  extends HarnessTaskDefinitionInput<In, State, Out> {
  key: string;
  kind: "task";
}

/** Options for `harness.abort`. */
export interface HarnessAbortOptions {
  /** Why the task is aborted; required and recorded in each abort span and outcome. */
  reason: string;
  /** Who requested the abort; recorded as `abortedBy`. */
  userId?: mongoose.Types.ObjectId | string;
}

export interface HarnessCreateTaskOptions {
  /** Idempotency key: a second create with the same id returns the existing task. */
  requestId?: string;
  userId?: mongoose.Types.ObjectId | string;
}

/** How an interrupted task is resolved by an operator. */
export const HARNESS_RESOLVE_ACTIONS = {
  abort: "abort",
  complete: "complete",
  retry: "retry",
} as const;

export type HarnessResolveAction =
  (typeof HARNESS_RESOLVE_ACTIONS)[keyof typeof HARNESS_RESOLVE_ACTIONS];

export interface HarnessResolveInterruptedOptions {
  action: HarnessResolveAction;
  /** Why the operator chose this action; required and recorded in the audit span. */
  reason: string;
  /** Result stored on the task for `complete`. */
  result?: unknown;
  /** Operator who resolved the task; recorded as `decidedBy`. */
  userId?: mongoose.Types.ObjectId | string;
}

export interface HarnessTestHooks {
  /** Runs inside the commit transaction after every write, before it commits. */
  beforeCommitEnd?: (context: {
    phase: string;
    session: mongoose.ClientSession;
    taskId: string;
  }) => Promise<void> | void;
  /**
   * While it returns true every lease renewal (owner and task) is skipped and owner
   * acquisition fails, as if the process had frozen. Simulates a crash in tests.
   */
  isHeartbeatSuspended?: () => boolean;
  /** Replaces `Math.random` for retry jitter so backoff delays are deterministic. */
  random?: () => number;
}

/** Lease settings a runner applies to the owner lease and every task lease it takes. */
export interface HarnessLeaseSettings {
  /** How long a lease lives without a renewal. */
  duration: Duration;
  /** How often the holder renews; must be shorter than `duration`. */
  heartbeat: Duration;
  /** Runner instance id written into every lease it holds. */
  owner: string;
}

/** A task a runner may claim now, as listed for dispatch. */
export interface HarnessRunnableTask {
  attempt: number;
  /** Claims so far; changes every time the task becomes runnable again after a claim. */
  claims: number;
  phase: string;
  taskId: string;
}

export interface HarnessRunTaskOptions {
  /** Stop after this many phases and hand a still-running task back as `pending`. */
  maxPhases?: number;
}

/**
 * What the harness hands a runner: hold the owner lease, recover tasks whose lease
 * expired, claim one runnable task, then run it to a stop.
 */
export interface HarnessRunnerContext {
  /** Take or renew the singleton `HarnessOwner` lease; false when another owner holds it. */
  acquireOwnerLease: (lease: HarnessLeaseSettings) => Promise<boolean>;
  claimNext: (lease: HarnessLeaseSettings) => Promise<HarnessTaskDocument | null>;
  /** Claim one task by id when it is runnable now; null when it is not (or another runner won). */
  claimTask: (taskId: string, lease: HarnessLeaseSettings) => Promise<HarnessTaskDocument | null>;
  /** Oldest runnable tasks first, at most `limit`, without claiming them. */
  listRunnable: (limit: number) => Promise<HarnessRunnableTask[]>;
  /**
   * Resume or park every `running` task whose lease expired. Returns how many were made
   * runnable again.
   */
  recoverExpired: () => Promise<number>;
  /** Give up the owner lease so a standby can take over without waiting for expiry. */
  releaseOwnerLease: (lease: HarnessLeaseSettings) => Promise<void>;
  runTask: (
    task: HarnessTaskDocument,
    lease: HarnessLeaseSettings,
    options?: HarnessRunTaskOptions
  ) => Promise<void>;
}

/** Decides who executes runnable tasks and when. */
export interface HarnessRunner {
  start: (context: HarnessRunnerContext) => Promise<void>;
  stop: () => Promise<void>;
  /** Hint that new work may be runnable now. */
  wake: () => void;
}

// ---------------------------------------------------------------------------------------
// Agents, tools, conversations
// ---------------------------------------------------------------------------------------

/** Names a model; `Harness.open({models})` turns it into a `LanguageModel`. */
export interface HarnessModelRef {
  modelId: string;
  provider: string;
}

/** Resolves a model reference to a Vercel AI SDK `LanguageModel`. */
export type HarnessModelResolver = (ref: HarnessModelRef) => LanguageModel;

/** Defaults for an agent's model-call retries (per model, before fallbacks). */
export const HARNESS_MODEL_RETRY_DEFAULTS = {
  backoffMs: 500,
  maxAttempts: 3,
  maxBackoffMs: 8000,
} as const;

/** Model requests one turn may make when an agent leaves `maxSteps` out. */
export const HARNESS_AGENT_DEFAULT_MAX_STEPS = 10;

/** What a tool's `execute` receives besides its arguments. */
export interface HarnessToolApi {
  conversationId: string;
  /** Execution environment from `Harness.open({env})`, when one was given. */
  env?: ExecutionEnv;
  /** Append progress text; recorded on the tool's span (`output.streamedOutput`). */
  output: (text: string) => void;
  /** Aborted when the turn is aborted or this run loses its lease. */
  signal: AbortSignal;
  /** The tool call's own task id. */
  taskId: string;
}

export interface HarnessToolDefinitionInput<Args, Result> {
  description: string;
  execute: (args: Args, api: HarnessToolApi) => Promise<Result>;
  /** Letters, digits, `_` and `-`, at most 64 characters (provider limit). */
  name: string;
  /** Zod schema for the arguments. Sent to the model and checked before `execute`. */
  parameters: z.ZodType<Args>;
  /** Default `never`: an interrupted call is reported to the model, not re-run. */
  replay?: HarnessReplayPolicy;
}

export interface HarnessToolDefinition<Args = unknown, Result = unknown>
  extends HarnessToolDefinitionInput<Args, Result> {
  kind: "tool";
  replay: HarnessReplayPolicy;
}

/**
 * Any tool, whatever its argument and result types. `execute` arguments are contravariant, so
 * `never` accepts every tool in heterogeneous lists without an explicit `any`.
 */
export type AnyHarnessToolDefinition = HarnessToolDefinition<never, unknown>;

export interface HarnessAgentDefinitionInput {
  /** Tried in order once the primary model's retryable failures exhaust `modelRetry`. */
  fallbackModels?: HarnessModelRef[];
  /** System prompt for every request. */
  instructions: string;
  /** Model requests one turn may make. Default `HARNESS_AGENT_DEFAULT_MAX_STEPS`. */
  maxSteps?: number;
  model: HarnessModelRef;
  /** Retries per model for 429 / 5xx / network errors. See `HARNESS_MODEL_RETRY_DEFAULTS`. */
  modelRetry?: HarnessRetryPolicy;
  /** Unique within a harness registry. */
  name: string;
  /**
   * Extensions every conversation with this agent uses, in order, by name or definition.
   * Each must be listed in the harness registry.
   */
  extensions?: ReadonlyArray<HarnessExtensionDefinition | string>;
  /** When set, the final answer is parsed as JSON and validated; the turn result carries it. */
  output?: z.ZodType;
  tools?: ReadonlyArray<AnyHarnessToolDefinition>;
}

export interface HarnessAgentDefinition extends Omit<HarnessAgentDefinitionInput, "extensions"> {
  /** Extension names, in order. */
  extensions: ReadonlyArray<string>;
  kind: "agent";
  maxSteps: number;
  tools: ReadonlyArray<AnyHarnessToolDefinition>;
}

// ---------------------------------------------------------------------------------------
// Extensions, hooks, wraps
// ---------------------------------------------------------------------------------------

/** What every hook and section receives besides its own arguments. */
export interface HarnessHookApi {
  conversationId: string;
  /**
   * Durable memo scoped to the turn task (also from tool hooks, which run in the tool
   * call's task), so a decision survives a re-run of the request or the tool call.
   */
  memo: HarnessMemo;
  /** Aborted when the turn is aborted or this run loses its lease. */
  signal: AbortSignal;
  /** The task running the hook: the turn for sections and `beforeModelRequest`, the tool call for tool hooks. */
  taskId: string;
  /** The turn task. Memo keys are scoped to it. */
  turnTaskId: string;
}

/** What a `beforeTool` hook receives: the hook api plus approvals. */
export interface HarnessToolHookApi extends HarnessHookApi {
  /**
   * `rt.approval` of the tool call's task. Approvers come from the hook's own extension
   * (`approvals[key]`, default `[Permissions.IsAdmin]`). Until the decision the tool call
   * waits; the call (and this hook) re-runs from the top once it is decided, so memoize
   * the decision by `toolCallId`.
   */
  approval: HarnessApprovalRequest;
}

/** The request a `beforeModelRequest` hook may rewrite. */
export interface HarnessModelRequest {
  /** AI SDK messages built from the transcript. */
  messages: ModelMessage[];
  /** Effective system prompt: agent instructions plus extension sections. */
  system: string;
}

/** A tool call as tool hooks see it. */
export interface HarnessToolCall {
  /** Arguments, already validated against the tool's `parameters`. */
  args: unknown;
  toolCallId: string;
  toolName: string;
}

/** `beforeTool` outcome: keep going, refuse the call, or replace its arguments. */
export type HarnessBeforeToolResult = {args: unknown} | {block: string} | undefined;

type MaybePromise<T> = Promise<T> | T;

export interface HarnessHookHandlers {
  /** Return a replacement result, or `undefined` to keep it. Runs only after `execute` returns. */
  afterTool: (call: HarnessToolCall, result: unknown, api: HarnessHookApi) => MaybePromise<unknown>;
  /** Return a replacement request, or `undefined` to keep it. */
  beforeModelRequest: (
    request: HarnessModelRequest,
    api: HarnessHookApi
  ) => MaybePromise<HarnessModelRequest | undefined>;
  /** `{block}` refuses the call (the reason is the model's error result); `{args}` rewrites. */
  beforeTool: (
    call: HarnessToolCall,
    api: HarnessToolHookApi
  ) => MaybePromise<HarnessBeforeToolResult>;
}

export const HARNESS_HOOK_KINDS = {
  afterTool: "afterTool",
  beforeModelRequest: "beforeModelRequest",
  beforeTool: "beforeTool",
} as const;

export type HarnessHookKind = keyof HarnessHookHandlers;

/** One hook, made by `hook(kind, fn)`. */
export type HarnessHook = {
  [K in HarnessHookKind]: {hook: K; kind: "hook"; run: HarnessHookHandlers[K]};
}[HarnessHookKind];

/** What a section builder receives about the request it contributes to. */
export interface HarnessSectionInput {
  agentName: string;
  conversationId: string;
  /** Messages about to be sent (before `beforeModelRequest` hooks). */
  messages: ReadonlyArray<ModelMessage>;
  /** 1 for the turn's first model request, 2 for the next, ... */
  step: number;
}

/** A named piece of the system prompt, rebuilt before every model request. */
export interface HarnessSection {
  build: (input: HarnessSectionInput, api: HarnessHookApi) => MaybePromise<string | undefined>;
  kind: "section";
  name: string;
}

/** Replaces the winning tool of `toolName` with a decorated tool, made by `wrapTool`. */
export interface HarnessToolWrap {
  kind: "wrap";
  toolName: string;
  wrap: (tool: AnyHarnessToolDefinition) => AnyHarnessToolDefinition;
}

export interface HarnessExtensionDefinitionInput {
  /** Who may decide each `api.approval(key)` this extension's `beforeTool` hooks request. */
  approvals?: Readonly<Record<string, HarnessApprovalPolicy>>;
  hooks?: ReadonlyArray<HarnessHook>;
  /** Unique within a harness registry; agents and conversations reference it by name. */
  name: string;
  sections?: ReadonlyArray<HarnessSection>;
  /** Added to the agent's tools; a later tool with the same name replaces an earlier one. */
  tools?: ReadonlyArray<AnyHarnessToolDefinition>;
  wraps?: ReadonlyArray<HarnessToolWrap>;
}

export interface HarnessExtensionDefinition {
  approvals: Readonly<Record<string, HarnessApprovalPolicy>>;
  hooks: ReadonlyArray<HarnessHook>;
  kind: "extension";
  name: string;
  sections: ReadonlyArray<HarnessSection>;
  tools: ReadonlyArray<AnyHarnessToolDefinition>;
  wraps: ReadonlyArray<HarnessToolWrap>;
}

/** Durable memo row; unique per `(taskId, key)`. */
export interface HarnessMemoDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  created: Date;
  key: string;
  taskId: mongoose.Types.ObjectId;
  updated: Date;
  value?: unknown;
}

export interface HarnessMemoModel
  extends mongoose.Model<HarnessMemoDocument>,
    FindExactlyOnePlugin<HarnessMemoDocument>,
    FindOneOrNonePlugin<HarnessMemoDocument> {}

export const HARNESS_CONVERSATION_STATUSES = {
  busy: "busy",
  idle: "idle",
} as const;

export type HarnessConversationStatus =
  (typeof HARNESS_CONVERSATION_STATUSES)[keyof typeof HARNESS_CONVERSATION_STATUSES];

export const HARNESS_MESSAGE_ROLES = {
  assistant: "assistant",
  system: "system",
  tool: "tool",
  user: "user",
} as const;

export type HarnessMessageRole = (typeof HARNESS_MESSAGE_ROLES)[keyof typeof HARNESS_MESSAGE_ROLES];

export interface HarnessTextPart {
  text: string;
  type: "text";
}

export interface HarnessToolCallPart {
  input: unknown;
  toolCallId: string;
  toolName: string;
  type: "tool-call";
}

/**
 * The effective system prompt of a model request, recorded on a `system` message when it
 * differs from the last one recorded. Never sent to the model as a message.
 */
export interface HarnessSystemPromptPart {
  /** sha256 of `text`. */
  hash: string;
  /** Extension sections that contributed, in prompt order. */
  sections: Array<{extension: string; name: string}>;
  text: string;
  type: "system-prompt";
}

export interface HarnessToolResultPart {
  isError: boolean;
  output: unknown;
  toolCallId: string;
  toolName: string;
  type: "tool-result";
}

export type HarnessMessagePart =
  | HarnessSystemPromptPart
  | HarnessTextPart
  | HarnessToolCallPart
  | HarnessToolResultPart;

/** Agent config snapshotted onto a conversation when it is created. */
export interface HarnessConversationAgent {
  extensions: string[];
  fallbackModels: HarnessModelRef[];
  instructions: string;
  maxSteps: number;
  model: HarnessModelRef;
  name: string;
  /**
   * JSON Schema (serialized) the final answer must match, requested from the model as
   * structured output. Set by `rt.runAgent` with an `output` schema.
   */
  outputSchema?: string;
  tools: string[];
}

/** What `send` does with a message that arrives while a turn is running. */
export const HARNESS_WHEN_BUSY = {
  /** Run it as its own turn once the active turn (and any earlier queued ones) finish. */
  queue: "queue",
  /** Add it to the active turn: its next model request includes the message. */
  steer: "steer",
} as const;

export type HarnessWhenBusy = (typeof HARNESS_WHEN_BUSY)[keyof typeof HARNESS_WHEN_BUSY];

/** A submission waiting on a conversation: queued for a later turn, or steering the active one. */
export interface HarnessQueuedSubmission {
  content?: unknown;
  requestId?: string;
  submittedAt?: Date;
  whenBusy?: HarnessWhenBusy;
}

export interface HarnessConversationDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  activeTurnTaskId?: mongoose.Types.ObjectId;
  agent: HarnessConversationAgent;
  created: Date;
  deleted: boolean;
  /** Which `rt.runAgent` call of the owning task created this subagent conversation. */
  ownerKey?: string;
  ownership: HarnessOwnership;
  queued: HarnessQueuedSubmission[];
  /** Highest message `seq` handed out so far. */
  seq: number;
  status: HarnessConversationStatus;
  updated: Date;
  userId?: mongoose.Types.ObjectId;
}

export interface HarnessConversationModel
  extends mongoose.Model<HarnessConversationDocument>,
    FindExactlyOnePlugin<HarnessConversationDocument>,
    FindOneOrNonePlugin<HarnessConversationDocument> {}

export interface HarnessMessageDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  aborted: boolean;
  conversationId: mongoose.Types.ObjectId;
  created: Date;
  deleted: boolean;
  parts: HarnessMessagePart[];
  /** Submitter's idempotency key, on user messages that came from `submit` / `send`. */
  requestId?: string;
  role: HarnessMessageRole;
  seq: number;
  status?: "error" | "ok";
  toolCallId?: string;
  toolName?: string;
  turnTaskId?: mongoose.Types.ObjectId;
  updated: Date;
}

export interface HarnessMessageModel
  extends mongoose.Model<HarnessMessageDocument>,
    FindExactlyOnePlugin<HarnessMessageDocument>,
    FindOneOrNonePlugin<HarnessMessageDocument> {}

/** Result of a completed `terreno.agent.turn` task. */
export interface HarnessTurnResult {
  /** `stop` when the model answered without tool calls; `max-steps` when the cap ended it. */
  finishReason: "max-steps" | "stop";
  /** Parsed structured output, when the agent declares `output`. */
  output?: unknown;
  /** Model requests made in the turn. */
  steps: number;
  /** Text of the last assistant message. */
  text: string;
}

export interface HarnessSubmitOptions {
  content: string;
  /** Idempotency key: a repeated submit returns the turn task it started. */
  requestId: string;
}

export interface HarnessSendOptions extends HarnessSubmitOptions {
  /** What to do when a turn is already running. */
  whenBusy: HarnessWhenBusy;
}

/** How `send` handled a submission. */
export const HARNESS_SUBMIT_DISPOSITIONS = {
  /** Waiting for the active turn (and earlier queued submissions) to finish. */
  queued: "queued",
  /** Started a new turn. */
  started: "started",
  /** Joined the active turn; its next model request includes the message. */
  steered: "steered",
} as const;

export type HarnessSubmitDisposition =
  (typeof HARNESS_SUBMIT_DISPOSITIONS)[keyof typeof HARNESS_SUBMIT_DISPOSITIONS];

export interface HarnessSubmitResult {
  conversationId: string;
  disposition: HarnessSubmitDisposition;
  requestId: string;
  /** The turn that runs (or ran) the message; unset while it is queued. */
  turnTaskId?: string;
}

// ---------------------------------------------------------------------------------------
// Event log (SSE source)
// ---------------------------------------------------------------------------------------

/** Every `HarnessEvent` type. Conversation streams and task streams carry different ones. */
export const HARNESS_EVENT_TYPES = {
  /** Task stream: an approval was approved, rejected, or expired. */
  approvalDecided: "approval.decided",
  /** Task stream: `rt.approval` created a pending approval. */
  approvalRequested: "approval.requested",
  /** Conversation stream: coalesced model text while a request streams; expires. */
  delta: "delta",
  /** Conversation stream: a transcript message was committed. */
  messageCreated: "message.created",
  /** Conversation stream: `send` queued a message or added it to the active turn. */
  messageQueued: "message.queued",
  /** Task stream: text a phase sent with `rt.output`. */
  output: "output",
  /** Task stream: a task was created or committed a new status or phase. */
  taskStatus: "task.status",
  /** Conversation stream: a tool call's task ended. */
  toolFinished: "tool.finished",
  /** Conversation stream: a tool call's task was created. */
  toolStarted: "tool.started",
  /** Conversation stream: a turn task ended. */
  turnFinished: "turn.finished",
  /** Conversation stream: a turn task was created. */
  turnStarted: "turn.started",
} as const;

export type HarnessEventType = (typeof HARNESS_EVENT_TYPES)[keyof typeof HARNESS_EVENT_TYPES];

/** One entry of a conversation's or task tree's event log. */
export interface HarnessEventDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  created: Date;
  /** Set on `delta` events only; Mongo deletes the row after it. */
  expiresAt?: Date;
  payload?: unknown;
  /** Position in the stream: strictly increasing from 1, unique per stream. */
  seq: number;
  /** Conversation id, or root task id for a task tree. */
  streamId: mongoose.Types.ObjectId;
  /** Task the event is about, when there is one. */
  taskId?: mongoose.Types.ObjectId;
  /** On task-stream events: the task and every task above it. */
  taskPath: mongoose.Types.ObjectId[];
  type: HarnessEventType;
}

export interface HarnessEventModel extends mongoose.Model<HarnessEventDocument> {}

/** Hands out a stream's event `seq`s. */
export interface HarnessEventStreamDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  seq: number;
}

export interface HarnessEventStreamModel extends mongoose.Model<HarnessEventStreamDocument> {}

/** How a streaming model request is written to the event log. */
export interface HarnessStreamingOptions {
  /** Flush a delta once this many characters are buffered. Default 200. */
  deltaFlushChars?: number;
  /** Flush buffered text at least this often while a request streams. Default 250 ms. */
  deltaFlushInterval?: DurationLike;
  /** How long `delta` events are kept. Default 1 hour. */
  deltaTtl?: DurationLike;
}

// ---------------------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------------------

/** Lifecycle of a `HarnessApproval`. */
export const HARNESS_APPROVAL_STATUSES = {
  approved: "approved",
  expired: "expired",
  pending: "pending",
  rejected: "rejected",
} as const;

export type HarnessApprovalStatus =
  (typeof HARNESS_APPROVAL_STATUSES)[keyof typeof HARNESS_APPROVAL_STATUSES];

/** A human decision requested by `rt.approval` (or a `beforeTool` hook's `api.approval`). */
export interface HarnessApprovalDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  /** `<step>:<n>` of the wait call that requested it; unique per task. */
  callKey: string;
  created: Date;
  decidedAt?: Date;
  decidedBy?: mongoose.Types.ObjectId;
  /** `name@version:key` of the requesting task definition and approval key. */
  definitionKey: string;
  /** Inbox event the decision sends to the task. */
  event: string;
  expiresAt?: Date;
  /** Extension whose `approvals` hold the approvers (hook approvals only). */
  extension?: string;
  /** Approval key; selects the approvers policy. */
  key: string;
  payload?: unknown;
  reason?: string;
  rootTaskId: mongoose.Types.ObjectId;
  status: HarnessApprovalStatus;
  summary?: string;
  taskId: mongoose.Types.ObjectId;
  title: string;
  traceId: mongoose.Types.ObjectId;
  updated: Date;
}

export interface HarnessApprovalModel
  extends mongoose.Model<HarnessApprovalDocument>,
    FindExactlyOnePlugin<HarnessApprovalDocument>,
    FindOneOrNonePlugin<HarnessApprovalDocument> {}

/**
 * One approver check, in the `@terreno/api` permission shape: `(method, user, approval)`.
 * `method` is `list`, `read`, or `update` (approve / reject). Every check of a policy must
 * pass (AND), like modelRouter permissions.
 */
export type HarnessApprover = PermissionMethod<HarnessApprovalDocument>;

/** Who may decide one approval key. An empty `approvers` list means nobody (over HTTP). */
export interface HarnessApprovalPolicy {
  approvers: ReadonlyArray<HarnessApprover>;
}

/** Options for `rt.approval` / `api.approval`. */
export interface HarnessApprovalOptions {
  /**
   * Called once, after the approval is first stored, with the stored document (send an
   * email or push with `@terreno/comms`). Best-effort: a throw is logged and ignored, and a
   * crash right after the commit skips it.
   */
  notify?: (approval: HarnessApprovalDocument) => Promise<void> | void;
  /** What the approver reviews (JSON). */
  payload?: unknown;
  /** Short explanation shown under the title. */
  summary?: string;
  /** Expire the approval when nobody decides within this long. Must be positive. */
  timeout?: DurationLike;
  title: string;
}

/** What `rt.approval` returns. */
export interface HarnessApprovalResult {
  approvalId: string;
  approved: boolean;
  /** ISO time of the decision; unset when expired. */
  decidedAt?: string;
  /** User id of the decider; unset when expired or decided without a user. */
  decidedBy?: string;
  /** True when `timeout` passed before a decision. */
  expired?: boolean;
  reason?: string;
}

export type HarnessApprovalRequest = (
  key: string,
  options: HarnessApprovalOptions
) => Promise<HarnessApprovalResult>;

/** Options for `harness.decideApproval`. */
export interface HarnessDecideApprovalOptions {
  approved: boolean;
  /** Why; recorded on the approval and its span. */
  reason?: string;
  /** Who decided; recorded as `decidedBy`. */
  userId?: mongoose.Types.ObjectId | string;
}
