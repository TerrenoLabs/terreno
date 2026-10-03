import type {FindExactlyOnePlugin, FindOneOrNonePlugin} from "@terreno/api";
import type {Duration} from "luxon";
import type mongoose from "mongoose";

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
  attempt: number;
  background: boolean;
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
  /** Phase commits so far; identifies the current phase visit. */
  step: number;
  traceId: mongoose.Types.ObjectId;
  updated: Date;
  userId?: mongoose.Types.ObjectId;
  version: number;
  waiting?: HarnessWaiting;
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

export interface HarnessWaitForTasksOptions {
  /** Default `all`. */
  policy?: HarnessWaitPolicy;
}

/** Runtime surface handed to phases. Later slices add memo, events, agents, approvals. */
export interface HarnessTaskRuntime<State, Out> {
  /** Persist the checkpoint (or terminal outcome) and its audit span in one transaction. */
  commit: (next: HarnessCommit<State, Out>) => Promise<void>;
  /** Create a child task owned by this task, in the same trace. Returns the child id. */
  createTask: <ChildIn, ChildState, ChildOut>(
    definition: HarnessTaskDefinition<ChildIn, ChildState, ChildOut>,
    input: ChildIn,
    options?: HarnessChildTaskOptions
  ) => Promise<string>;
  /** Aborted when the task is aborted or this run loses its lease; stop work promptly. */
  signal: AbortSignal;
  taskId: string;
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
   * Compensation handler run before the task is marked `aborted`, after every task it
   * owns is already aborted. A throw is recorded on the abort span; the abort proceeds.
   */
  abort?(task: HarnessTaskView<In, State>, rt: HarnessAbortRuntime): Promise<void>;
  initial(input: In): {phase: string; state?: State};
  name: string;
  phases: Record<string, HarnessPhaseDefinition<In, State, Out>>;
  retry?: HarnessRetryPolicy;
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

/**
 * What the harness hands a runner: hold the owner lease, recover tasks whose lease
 * expired, claim one runnable task, then run it to a stop.
 */
export interface HarnessRunnerContext {
  /** Take or renew the singleton `HarnessOwner` lease; false when another owner holds it. */
  acquireOwnerLease: (lease: HarnessLeaseSettings) => Promise<boolean>;
  claimNext: (lease: HarnessLeaseSettings) => Promise<HarnessTaskDocument | null>;
  /**
   * Resume or park every `running` task whose lease expired. Returns how many were made
   * runnable again.
   */
  recoverExpired: () => Promise<number>;
  /** Give up the owner lease so a standby can take over without waiting for expiry. */
  releaseOwnerLease: (lease: HarnessLeaseSettings) => Promise<void>;
  runTask: (task: HarnessTaskDocument, lease: HarnessLeaseSettings) => Promise<void>;
}

/** Decides who executes runnable tasks and when. */
export interface HarnessRunner {
  start: (context: HarnessRunnerContext) => Promise<void>;
  stop: () => Promise<void>;
  /** Hint that new work may be runnable now. */
  wake: () => void;
}
