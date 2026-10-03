import {logger} from "@terreno/api";
import {DateTime, Duration} from "luxon";
import type mongoose from "mongoose";
import type {ClientSession} from "mongoose";

import type {
  HarnessEventDocument,
  HarnessEventType,
  HarnessMessageDocument,
  HarnessStreamingOptions,
  HarnessTaskDocument,
} from "../types/harness";
import {HARNESS_EVENT_TYPES, HARNESS_TERMINAL_STATUSES} from "../types/harness";
import {AGENT_TOOL_TASK_NAME, AGENT_TURN_TASK_NAME} from "./agentTaskNames";
import type {HarnessModels} from "./commit";
import {inTransaction} from "./transaction";

/** One event to append; `seq` and `created` are assigned on write. */
export interface HarnessEventInput {
  expiresAt?: Date;
  payload?: unknown;
  taskId?: mongoose.Types.ObjectId;
  taskPath?: mongoose.Types.ObjectId[];
  type: HarnessEventType;
}

/** Streaming settings with every default applied. */
export interface ResolvedStreamingOptions {
  deltaFlushChars: number;
  deltaFlushInterval: Duration;
  deltaTtl: Duration;
}

export const resolveStreamingOptions = (
  options: HarnessStreamingOptions = {}
): ResolvedStreamingOptions => {
  const resolved = {
    deltaFlushChars: options.deltaFlushChars ?? 200,
    deltaFlushInterval: Duration.fromDurationLike(
      options.deltaFlushInterval ?? {milliseconds: 250}
    ),
    deltaTtl: Duration.fromDurationLike(options.deltaTtl ?? {hours: 1}),
  };
  if (!Number.isInteger(resolved.deltaFlushChars) || resolved.deltaFlushChars < 1) {
    throw new Error("Harness streaming.deltaFlushChars must be a positive integer");
  }
  if (resolved.deltaFlushInterval.toMillis() <= 0 || resolved.deltaTtl.toMillis() <= 0) {
    throw new Error("Harness streaming.deltaFlushInterval and deltaTtl must be positive");
  }
  return resolved;
};

/**
 * Append `events` to `streamId` in order. The stream's counter hands out consecutive
 * `seq`s in the same transaction, so concurrent writers to one stream serialize on it and
 * a stream's events commit in `seq` order: a reader that has seen `seq` n has seen every
 * earlier event. Without `session` the write runs in its own transaction.
 */
export const appendEvents = async ({
  events,
  models,
  session,
  streamId,
}: {
  events: ReadonlyArray<HarnessEventInput>;
  models: HarnessModels;
  session?: ClientSession;
  streamId: mongoose.Types.ObjectId | string;
}): Promise<void> => {
  if (events.length === 0) {
    return;
  }
  const write = async (writeSession: ClientSession): Promise<void> => {
    const counter = await models.eventStream.findOneAndUpdate(
      {_id: streamId},
      {$inc: {seq: events.length}},
      {returnDocument: "after", session: writeSession, upsert: true}
    );
    const first = (counter?.seq ?? events.length) - events.length + 1;
    const created = DateTime.now().toJSDate();
    await models.event.insertMany(
      events.map((event, index) => ({
        created,
        ...(event.expiresAt ? {expiresAt: event.expiresAt} : {}),
        payload: event.payload,
        seq: first + index,
        streamId,
        ...(event.taskId ? {taskId: event.taskId} : {}),
        taskPath: event.taskPath ?? [],
        type: event.type,
      })),
      {ordered: true, session: writeSession}
    );
  };
  if (session) {
    await write(session);
    return;
  }
  await inTransaction(write);
};

/** The stream a task's events go to (its tree's root task) and its path within the tree. */
export const taskStreamOf = (
  task: Pick<HarnessTaskDocument, "_id" | "ancestorIds" | "rootTaskId">
): {streamId: mongoose.Types.ObjectId; taskPath: mongoose.Types.ObjectId[]} => ({
  streamId: task.rootTaskId ?? task._id,
  taskPath: [...(task.ancestorIds ?? []), task._id],
});

/** Append task-stream events about `task` (its tree's stream, scoped to its path). */
export const appendTaskEvents = async ({
  events,
  models,
  session,
  task,
}: {
  events: ReadonlyArray<Omit<HarnessEventInput, "taskId" | "taskPath">>;
  models: HarnessModels;
  session?: ClientSession;
  task: Pick<HarnessTaskDocument, "_id" | "ancestorIds" | "rootTaskId">;
}): Promise<void> => {
  const {streamId, taskPath} = taskStreamOf(task);
  await appendEvents({
    events: events.map((event) => ({...event, taskId: task._id, taskPath})),
    models,
    session,
    streamId,
  });
};

const outcomeOf = (task: HarnessTaskDocument): Record<string, unknown> | undefined =>
  task.outcome
    ? {
        error: task.outcome.error,
        result: task.outcome.result,
        status: task.outcome.status,
      }
    : undefined;

const conversationOf = (task: HarnessTaskDocument): string | undefined => {
  const conversationId = (task.input as {conversationId?: unknown} | undefined)?.conversationId;
  return typeof conversationId === "string" ? conversationId : undefined;
};

/** `turn.*` / `tool.*` conversation events for a built-in agent task, if it is one. */
const lifecycleEvent = (
  task: HarnessTaskDocument,
  stage: "finished" | "started"
): {conversationId: string; event: HarnessEventInput} | undefined => {
  const conversationId = conversationOf(task);
  if (!conversationId) {
    return undefined;
  }
  const outcome = stage === "finished" ? outcomeOf(task) : undefined;
  if (task.name === AGENT_TURN_TASK_NAME) {
    return {
      conversationId,
      event: {
        payload: {status: task.status, turnTaskId: String(task._id), ...(outcome ? {outcome} : {})},
        taskId: task._id,
        type:
          stage === "started" ? HARNESS_EVENT_TYPES.turnStarted : HARNESS_EVENT_TYPES.turnFinished,
      },
    };
  }
  if (task.name === AGENT_TOOL_TASK_NAME) {
    const input = task.input as {toolCallId?: string; toolName?: string};
    return {
      conversationId,
      event: {
        payload: {
          status: task.status,
          taskId: String(task._id),
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          turnTaskId: task.ownership?.id ? String(task.ownership.id) : undefined,
          ...(outcome ? {outcome} : {}),
        },
        taskId: task._id,
        type:
          stage === "started" ? HARNESS_EVENT_TYPES.toolStarted : HARNESS_EVENT_TYPES.toolFinished,
      },
    };
  }
  return undefined;
};

/**
 * Events for a committed task write, in the write's transaction: `task.status` when the
 * task was created or its status or phase changed, plus `turn.*` / `tool.*` on the
 * conversation stream when a built-in agent task starts or ends.
 */
export const appendTaskTransitionEvents = async ({
  after,
  before,
  models,
  session,
}: {
  after: HarnessTaskDocument;
  /** The task before the write; omitted for a newly created task. */
  before?: Pick<HarnessTaskDocument, "phase" | "status">;
  models: HarnessModels;
  session: ClientSession;
}): Promise<void> => {
  const isCreated = before === undefined;
  if (!isCreated && before.status === after.status && before.phase === after.phase) {
    return;
  }
  await appendTaskEvents({
    events: [
      {
        payload: {
          name: after.name,
          phase: after.phase,
          status: after.status,
          taskId: String(after._id),
          version: after.version,
          ...(after.ownership?.kind === "task" && after.ownership.id
            ? {parentTaskId: String(after.ownership.id)}
            : {}),
          ...(outcomeOf(after) ? {outcome: outcomeOf(after)} : {}),
        },
        type: HARNESS_EVENT_TYPES.taskStatus,
      },
    ],
    models,
    session,
    task: after,
  });
  const isFinished =
    HARNESS_TERMINAL_STATUSES.has(after.status) &&
    !(before && HARNESS_TERMINAL_STATUSES.has(before.status));
  const stage = isCreated ? "started" : isFinished ? "finished" : undefined;
  const lifecycle = stage ? lifecycleEvent(after, stage) : undefined;
  if (lifecycle) {
    await appendEvents({
      events: [lifecycle.event],
      models,
      session,
      streamId: lifecycle.conversationId,
    });
  }
};

/** A transcript message as handed to `insertMessages`. */
export type HarnessMessageInput = Pick<
  HarnessMessageDocument,
  "conversationId" | "parts" | "role" | "seq"
> &
  Partial<
    Pick<HarnessMessageDocument, "requestId" | "status" | "toolCallId" | "toolName" | "turnTaskId">
  >;

/** Insert transcript messages of one conversation and their `message.created` events. */
export const insertMessages = async ({
  messages,
  models,
  session,
}: {
  messages: ReadonlyArray<HarnessMessageInput>;
  models: HarnessModels;
  session: ClientSession;
}): Promise<HarnessMessageDocument[]> => {
  const first = messages[0];
  if (!first) {
    return [];
  }
  const created = await models.message.create([...messages], {ordered: true, session});
  await appendEvents({
    events: created.map((message) => ({
      payload: {message: message.toJSON()},
      type: HARNESS_EVENT_TYPES.messageCreated,
    })),
    models,
    session,
    streamId: first.conversationId,
  });
  return created;
};

/** Identifies the model request a `delta` belongs to. */
export interface HarnessDeltaSource {
  conversationId: string;
  /** Fresh per model-request attempt: a retry or re-run streams under a new key. */
  requestKey: string;
  step: number;
  turnTaskId: string;
}

/**
 * Coalesces streamed model text into `delta` events: buffered text is written once
 * `deltaFlushChars` characters accumulate or `deltaFlushInterval` passes. Writes run in
 * order, outside any commit, and are best-effort: a failed write is logged and dropped,
 * since the committed message is authoritative.
 */
export class HarnessDeltaWriter {
  private buffer = "";
  private pending: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly context: {
      models: HarnessModels;
      options: ResolvedStreamingOptions;
      source: HarnessDeltaSource;
    }
  ) {}

  push(text: string): void {
    if (!text) {
      return;
    }
    this.buffer += text;
    if (this.buffer.length >= this.context.options.deltaFlushChars) {
      this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(
        () => this.flush(),
        this.context.options.deltaFlushInterval.toMillis()
      );
    }
  }

  /** Write what is buffered and wait for every write so far. */
  async close(): Promise<void> {
    this.flush();
    await this.pending;
  }

  private flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.buffer) {
      return;
    }
    const text = this.buffer;
    this.buffer = "";
    const {models, options, source} = this.context;
    this.pending = this.pending.then(async () => {
      try {
        await appendEvents({
          events: [
            {
              expiresAt: DateTime.now().plus(options.deltaTtl).toJSDate(),
              payload: {
                requestKey: source.requestKey,
                step: source.step,
                text,
                turnTaskId: source.turnTaskId,
              },
              type: HARNESS_EVENT_TYPES.delta,
            },
          ],
          models,
          streamId: source.conversationId,
        });
      } catch (error: unknown) {
        logger.warn(
          `Harness could not write a delta for turn ${source.turnTaskId}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }
}

/** The JSON body of an event as sent over SSE (`data:`). */
export const eventBody = (
  event: Pick<HarnessEventDocument, "created" | "payload" | "seq" | "taskId" | "type">
): Record<string, unknown> => ({
  created: event.created.toISOString(),
  payload: event.payload ?? null,
  seq: event.seq,
  ...(event.taskId ? {taskId: String(event.taskId)} : {}),
  type: event.type,
});
