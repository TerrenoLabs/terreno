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

export interface HarnessRetryPolicy {
  backoffMs?: number;
  maxAttempts?: number;
  maxBackoffMs?: number;
}

export interface HarnessLease {
  acquiredAt?: Date;
  expiresAt?: Date;
  owner?: string;
  token?: string;
}

export interface HarnessWaiting {
  key?: string;
  kind?: "event" | "sleep" | "tasks";
  policy?: "all" | "failFast";
  taskIds?: mongoose.Types.ObjectId[];
  timeoutAt?: Date;
}

export interface HarnessOutcome {
  error?: string;
  result?: unknown;
  status: HarnessTerminalStatus;
}

export interface HarnessTaskDocument extends mongoose.Document<mongoose.Types.ObjectId> {
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

/** Runtime surface handed to phases. Later slices add memo, waits, agents, approvals. */
export interface HarnessTaskRuntime<State, Out> {
  /** Persist the checkpoint (or terminal outcome) and its audit span in one transaction. */
  commit: (next: HarnessCommit<State, Out>) => Promise<void>;
  taskId: string;
}

export interface HarnessPhaseDefinition<In, State, Out> {
  /** Defaults to `never`: an interrupted phase is parked, not re-run. */
  replay?: HarnessReplayPolicy;
  run(task: HarnessTaskView<In, State>, rt: HarnessTaskRuntime<State, Out>): Promise<void>;
}

export interface HarnessTaskDefinitionInput<In, State, Out> {
  /** Compensation handler run when the task is aborted. */
  abort?(task: HarnessTaskView<In, State>, rt: HarnessTaskRuntime<State, Out>): Promise<void>;
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
