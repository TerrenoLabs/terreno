import {APIError, errorDetail, isAPIError} from "@terreno/api";

/**
 * Harness error vocabulary. Each kind is one stable problem type: `code` and `title` never
 * change between occurrences; the per-occurrence sentence goes in `detail`.
 */
export interface HarnessErrorKind {
  code: string;
  status: number;
  title: string;
}

export const HARNESS_ERRORS = {
  /** `start` called twice on a harness or runner. */
  alreadyStarted: {code: "harness-already-started", status: 409, title: "Already started"},
  /** Two writers raced on an approval; the loser can no longer decide it. */
  approvalNotPending: {
    code: "harness-approval-not-pending",
    status: 409,
    title: "Approval can no longer be decided",
  },
  /** A commit lost its checkpoint fence (lease taken over, task aborted, or phase moved). */
  commitConflict: {
    code: "harness-commit-conflict",
    status: 409,
    title: "Harness commit lost its checkpoint fence",
  },
  /** Invalid `Harness.open`, `HarnessApp`, runner, or model-resolver configuration. */
  configInvalid: {
    code: "harness-config-invalid",
    status: 500,
    title: "Invalid harness configuration",
  },
  /** A conversation is running a turn and `submit` cannot start another. */
  conversationBusy: {
    code: "harness-conversation-busy",
    status: 409,
    title: "Conversation is busy",
  },
  /** A subagent conversation: only its owning task's `rt.runAgent` runs turns. */
  conversationOwned: {
    code: "harness-conversation-owned",
    status: 409,
    title: "Conversation is run by its owning task",
  },
  /** Misuse of a definition API (`defineTask`, `rt.*`, ...); retrying cannot fix it. */
  definitionInvalid: {
    code: "harness-definition-invalid",
    status: 500,
    title: "Invalid harness definition",
  },
  /** An internal invariant broke; the work is retried or logged. */
  internal: {code: "harness-internal", status: 500, title: "Harness invariant violated"},
  /** A caller passed an invalid argument to a harness method. */
  invalidRequest: {code: "harness-invalid-request", status: 400, title: "Invalid harness request"},
  /** A harness row the call depends on no longer exists. */
  notFound: {code: "harness-not-found", status: 404, title: "Harness record not found"},
  /** A task definition, agent, or extension is not in this harness registry. */
  notRegistered: {
    code: "harness-not-registered",
    status: 404,
    title: "Not registered in this harness",
  },
  /** `Harness.open` on a MongoDB deployment without transactions (not a replica set or mongos). */
  replicaSetRequired: {
    code: "harness-replica-set-required",
    status: 500,
    title: "MongoDB replica set required",
  },
  /** A `requestId` (task or event) is already used for something else. */
  requestIdConflict: {
    code: "harness-request-id-conflict",
    status: 409,
    title: "requestId is already in use",
  },
  /** A `JobsRunner` phase job ran on an instance whose harness is not started. */
  runnerStopped: {
    code: "harness-runner-stopped",
    status: 503,
    title: "Harness runner is not running",
  },
  /** `retry` on a task whose abort is still running. */
  taskAborting: {code: "harness-task-aborting", status: 409, title: "Task is being aborted"},
  /** `resolveInterrupted` on a task that is not interrupted. */
  taskNotInterrupted: {
    code: "harness-task-not-interrupted",
    status: 409,
    title: "Task is not interrupted",
  },
  /** The task already ended, so it cannot be aborted or receive events. */
  taskTerminal: {code: "harness-task-terminal", status: 409, title: "Task already ended"},
  /** `Harness.waitFor` gave up before the task reached the status it waited for. */
  waitTimedOut: {
    code: "harness-wait-timed-out",
    status: 504,
    title: "Timed out waiting for task",
  },
} as const satisfies Record<string, HarnessErrorKind>;

export type HarnessErrorKindName = keyof typeof HARNESS_ERRORS;

/** Build an `APIError` of one harness kind; `detail` is a self-contained sentence. */
export const harnessError = ({
  cause,
  detail,
  kind,
}: {
  cause?: unknown;
  detail: string;
  kind: HarnessErrorKindName;
}): APIError => {
  return new APIError({...HARNESS_ERRORS[kind], cause, detail});
};

/**
 * The text recorded for a failure (task `error`, tool results the model sees, logs). Harness
 * details are self-contained sentences, so they stand alone; other `APIError`s keep their
 * title too, and plain errors use their message.
 */
export const errorMessage = (error: unknown): string => {
  if (isAPIError(error) && error.code?.startsWith("harness-") && error.detail) {
    return error.detail;
  }
  return errorDetail(error);
};
