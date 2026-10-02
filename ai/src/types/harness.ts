import type {FindExactlyOnePlugin, FindOneOrNonePlugin} from "@terreno/api";
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

export interface HarnessTestHooks {
  /** Runs inside the commit transaction after every write, before it commits. */
  beforeCommitEnd?: (context: {
    phase: string;
    session: mongoose.ClientSession;
    taskId: string;
  }) => Promise<void> | void;
}

/** What the harness hands a runner: claim one runnable task, then run it to a stop. */
export interface HarnessRunnerContext {
  claimNext: () => Promise<HarnessTaskDocument | null>;
  runTask: (task: HarnessTaskDocument) => Promise<void>;
}

/** Decides who executes runnable tasks and when. */
export interface HarnessRunner {
  start: (context: HarnessRunnerContext) => Promise<void>;
  stop: () => Promise<void>;
  /** Hint that new work may be runnable now. */
  wake: () => void;
}
