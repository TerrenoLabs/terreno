import {DateTime, Duration, type DurationLike} from "luxon";
import type mongoose from "mongoose";
import type {ClientSession} from "mongoose";

import type {
  HarnessInboxEventDocument,
  HarnessLeaseSettings,
  HarnessTaskDocument,
  HarnessTestHooks,
  HarnessWaitCall,
} from "../types/harness";
import {
  HARNESS_TASK_STATUSES,
  HARNESS_TERMINAL_STATUSES,
  HARNESS_WAIT_KINDS,
  HARNESS_WAIT_RESOLUTIONS,
} from "../types/harness";
import {
  commitWaitResolution,
  HarnessCommitConflictError,
  type HarnessCommitWrites,
  type HarnessModels,
  inTransaction,
  isDuplicateKeyError,
} from "./commit";
import {HarnessDefinitionError} from "./definitionError";

/** Most object keys a resume span lists for a delivered payload. */
const PAYLOAD_SUMMARY_KEYS = 20;

/** One `rt.waitFor` or `rt.sleep` call. */
export interface WaitRequest {
  /** Sleep length, or the event wait's timeout. */
  duration?: Duration;
  /** Event name; absent for a sleep. */
  event?: string;
  kind: "event" | "sleep";
  /**
   * Extra writes committed with a timeout resolution. Throw `HarnessWaitRaceError` from
   * them when an event that should win landed concurrently: the call then resolves again.
   */
  timeoutWrites?: HarnessCommitWrites;
}

/**
 * Thrown from `WaitRequest.timeoutWrites` when the timeout lost a race with a matching
 * event; the timeout transaction rolls back and the call is resolved again.
 */
export class HarnessWaitRaceError extends Error {
  constructor() {
    super("A matching event raced the wait's timeout");
    this.name = "HarnessWaitRaceError";
  }
}

/** Times a call re-resolves after losing a timeout race before giving up. */
const MAX_WAIT_RACE_RETRIES = 3;

/** What one wait call needs: its request, plus writes and work around parking on it. */
export interface WaitCallPlan {
  /** Runs after the waiting commit, before the phase stops. */
  afterPark?: () => Promise<void>;
  /** Extra rows committed with the waiting commit. */
  onPark?: HarnessCommitWrites;
  request: WaitRequest;
}

/** A wait call either has its result, or must park the task on `entry`. */
export type WaitCallResult =
  | {isResolved: true; payload?: unknown}
  | {entry: HarnessWaitCall; isResolved: false};

/** Names one wait call of the current phase visit: `<step>:<call index>`. */
export const waitCallKey = ({index, task}: {index: number; task: HarnessTaskDocument}): string =>
  `${task.step ?? 0}:${index}`;

/** A non-negative Luxon duration, or a definition error naming `label`. */
export const parseWaitDuration = (value: DurationLike, label: string): Duration => {
  let duration: Duration;
  try {
    duration = Duration.fromDurationLike(value);
  } catch (error: unknown) {
    throw new HarnessDefinitionError(
      `${label} must be a Luxon duration: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!duration.isValid || !(duration.toMillis() >= 0)) {
    throw new HarnessDefinitionError(`${label} must be a valid, non-negative duration`);
  }
  return duration;
};

/** Shape of a payload for the resume span, without its values. */
const summarizePayload = (payload: unknown): Record<string, unknown> => {
  if (payload === null) {
    return {type: "null"};
  }
  if (Array.isArray(payload)) {
    return {length: payload.length, type: "array"};
  }
  if (typeof payload === "string") {
    return {length: payload.length, type: "string"};
  }
  if (typeof payload === "object") {
    const keys = Object.keys(payload as Record<string, unknown>);
    return {keyCount: keys.length, keys: keys.slice(0, PAYLOAD_SUMMARY_KEYS), type: "object"};
  }
  return {type: typeof payload};
};

const describeCall = (call: {event?: string; key?: string; kind: string}): string => {
  const event = call.event ?? call.key;
  return call.kind === HARNESS_WAIT_KINDS.event ? `rt.waitFor("${event}")` : "rt.sleep";
};

const resumeSpanName = (request: WaitRequest): string =>
  request.kind === HARNESS_WAIT_KINDS.event ? `wait:${request.event}` : "sleep";

const resumeSpanInput = (entry: HarnessWaitCall): Record<string, unknown> => ({
  ...(entry.key === undefined ? {} : {event: entry.key}),
  kind: entry.kind,
  startedAt: entry.startedAt.toISOString(),
  ...(entry.timeoutAt ? {timeoutAt: entry.timeoutAt.toISOString()} : {}),
});

/**
 * Resolve one wait call. A call this phase visit already resolved returns its recorded
 * result. Otherwise an event wait takes the oldest undelivered event of its name; failing
 * that, a passed `timeoutAt` resolves it (`undefined` for an event, done for a sleep).
 * Each resolution is recorded on the task with a resume span in one fenced transaction.
 * Otherwise returns the record to park the task on.
 */
export const resolveWaitCall = async (
  args: Parameters<typeof resolveWaitCallOnce>[0]
): Promise<WaitCallResult> => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await resolveWaitCallOnce(args);
    } catch (error: unknown) {
      if (!(error instanceof HarnessWaitRaceError) || attempt >= MAX_WAIT_RACE_RETRIES) {
        throw error;
      }
    }
  }
};

const resolveWaitCallOnce = async ({
  callKey,
  label,
  lease,
  models,
  request,
  task,
  testHooks,
}: {
  callKey: string;
  /** Task definition key, for error messages. */
  label: string;
  lease: HarnessLeaseSettings;
  models: HarnessModels;
  request: WaitRequest;
  task: HarnessTaskDocument;
  testHooks?: HarnessTestHooks;
}): Promise<WaitCallResult> => {
  const recorded = task.waits?.[callKey];
  if (recorded && (recorded.kind !== request.kind || recorded.key !== request.event)) {
    throw new HarnessDefinitionError(
      `${label}: wait call ${callKey} was ${describeCall(recorded)} on an earlier run and is ${describeCall(request)} now; run waits in the same order on every run of a phase`
    );
  }
  if (recorded?.resolution) {
    if (recorded.resolution !== HARNESS_WAIT_RESOLUTIONS.event) {
      return {isResolved: true};
    }
    const delivered = await models.inbox.findExactlyOne({_id: recorded.eventId});
    return {isResolved: true, payload: delivered.payload};
  }

  const now = DateTime.now();
  const entry: HarnessWaitCall = recorded ?? {
    kind: request.kind,
    ...(request.event === undefined ? {} : {key: request.event}),
    startedAt: now.toJSDate(),
    ...(request.duration ? {timeoutAt: now.plus(request.duration).toJSDate()} : {}),
  };
  const resolve = (
    resolved: Partial<HarnessWaitCall>,
    output: Record<string, unknown>,
    writes?: Parameters<typeof commitWaitResolution>[0]["writes"]
  ): Promise<void> =>
    commitWaitResolution({
      callKey,
      entry: {...entry, ...resolved, resolvedAt: now.toJSDate()},
      lease,
      models,
      span: {input: resumeSpanInput(entry), name: resumeSpanName(request), output},
      task,
      testHooks,
      writes,
    });

  if (request.kind === HARNESS_WAIT_KINDS.event) {
    const [buffered] = await models.inbox
      .find({consumedKey: {$exists: false}, name: request.event, taskId: task._id})
      .sort({seq: 1})
      .limit(1);
    if (buffered) {
      await resolve(
        {eventId: buffered._id, resolution: HARNESS_WAIT_RESOLUTIONS.event},
        {
          event: request.event,
          eventId: String(buffered._id),
          payload: summarizePayload(buffered.payload),
          seq: buffered.seq,
          timedOut: false,
        },
        async ({session}) => {
          const claimed = await models.inbox.updateOne(
            {_id: buffered._id, consumedKey: {$exists: false}},
            {$set: {consumedAt: now.toJSDate(), consumedKey: callKey}},
            {session}
          );
          if (claimed.matchedCount === 0) {
            throw new HarnessCommitConflictError(String(task._id), task.phase);
          }
        }
      );
      return {isResolved: true, payload: buffered.payload};
    }
  }

  if (entry.timeoutAt && now >= DateTime.fromJSDate(entry.timeoutAt)) {
    const isEvent = request.kind === HARNESS_WAIT_KINDS.event;
    await resolve(
      {resolution: isEvent ? HARNESS_WAIT_RESOLUTIONS.timeout : HARNESS_WAIT_RESOLUTIONS.elapsed},
      isEvent ? {event: request.event, timedOut: true} : {elapsed: true},
      request.timeoutWrites
    );
    return {isResolved: true};
  }
  return {entry, isResolved: false};
};

const assertSameEvent = (
  existing: HarnessInboxEventDocument,
  event: string
): HarnessInboxEventDocument => {
  if (existing.name !== event) {
    throw new Error(
      `requestId "${existing.requestId}" already sent event "${existing.name}" to task ${existing.taskId}, not "${event}"`
    );
  }
  return existing;
};

/**
 * Inside `session`'s transaction: count the event on the task (`eventSeq`), insert it into
 * the task's inbox, and, when the task is waiting on that event name, return it to
 * `pending`. Throws when the task is terminal. Returns whether the task was woken.
 */
export const appendInboxEvent = async ({
  event,
  models,
  payload,
  requestId,
  session,
  taskId,
}: {
  event: string;
  models: HarnessModels;
  payload: unknown;
  requestId?: string;
  session: ClientSession;
  taskId: mongoose.Types.ObjectId;
}): Promise<{event: HarnessInboxEventDocument; isWoken: boolean}> => {
  const counted = await models.task.findOneAndUpdate(
    {_id: taskId, status: {$nin: [...HARNESS_TERMINAL_STATUSES]}},
    {$inc: {eventSeq: 1}},
    {returnDocument: "after", session}
  );
  if (!counted) {
    throw new Error(`Task ${taskId} is already terminal; it cannot receive event "${event}"`);
  }
  const [created] = await models.inbox.create(
    [{name: event, payload, requestId, seq: counted.eventSeq, taskId}],
    {session}
  );
  if (
    counted.status !== HARNESS_TASK_STATUSES.waiting ||
    counted.waiting?.kind !== HARNESS_WAIT_KINDS.event ||
    counted.waiting.key !== event
  ) {
    return {event: created, isWoken: false};
  }
  const woken = await models.task.updateOne(
    {_id: taskId, status: HARNESS_TASK_STATUSES.waiting},
    {$set: {status: HARNESS_TASK_STATUSES.pending}, $unset: {waiting: 1}},
    {session}
  );
  return {event: created, isWoken: woken.modifiedCount > 0};
};

/**
 * Append an event to a task's inbox and, when the task is waiting on that event name,
 * return it to `pending`, in one transaction. The task row is written every time
 * (`eventSeq`), so a concurrent `rt.waitFor` commit and this send conflict and one retries:
 * neither can miss the other. A repeated `requestId` returns the event sent first.
 * Throws when the task is terminal.
 */
export const sendEventRecords = async ({
  event,
  models,
  payload,
  requestId,
  taskId,
}: {
  event: string;
  models: HarnessModels;
  payload: unknown;
  requestId?: string;
  taskId: mongoose.Types.ObjectId | string;
}): Promise<{event: HarnessInboxEventDocument; isWoken: boolean}> => {
  const task = await models.task.findExactlyOne({_id: taskId});
  if (requestId !== undefined) {
    const existing = await models.inbox.findOneOrNone({requestId, taskId: task._id});
    if (existing) {
      return {event: assertSameEvent(existing, event), isWoken: false};
    }
  }
  const terminalError = (status: string): Error =>
    new Error(`Task ${task._id} is already ${status}; it cannot receive event "${event}"`);
  if (HARNESS_TERMINAL_STATUSES.has(task.status)) {
    throw terminalError(task.status);
  }

  try {
    return await inTransaction((session) =>
      appendInboxEvent({event, models, payload, requestId, session, taskId: task._id})
    );
  } catch (error: unknown) {
    // A concurrent send with the same requestId won.
    if (requestId !== undefined && isDuplicateKeyError(error)) {
      const existing = await models.inbox.findExactlyOne({requestId, taskId: task._id});
      return {event: assertSameEvent(existing, event), isWoken: false};
    }
    throw error;
  }
};
