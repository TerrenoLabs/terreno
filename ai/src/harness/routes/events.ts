import {
  APIError,
  asyncHandler,
  authenticateMiddleware,
  ForbiddenError,
  logger,
  NotFoundError,
  type User,
} from "@terreno/api";
import type express from "express";
import {Duration, type DurationLike} from "luxon";
import mongoose from "mongoose";

import type {HarnessEventDocument} from "../../types/harness";
import type {HarnessEventHub} from "../eventHub";
import {eventBody, taskStreamOf} from "../events";
import {registerHarnessConversation} from "../models/harnessConversation";
import {registerHarnessEvent} from "../models/harnessEvent";
import {registerHarnessTask} from "../models/harnessTask";

/** Events read per replay query. */
const REPLAY_PAGE_SIZE = 500;

/** The event fields an SSE frame needs, as read from Mongo or a change stream. */
type StreamedEvent = Pick<HarnessEventDocument, "created" | "payload" | "seq" | "taskId" | "type">;

/** Whether `user` owns a record (its `userId`) or is an admin. */
export const isOwnerOrAdmin = (
  user: User | undefined,
  record: {userId?: mongoose.Types.ObjectId | string | null}
): boolean =>
  Boolean(user?.admin) ||
  (Boolean(user && record.userId) && String(record.userId) === String(user?.id ?? user?._id));

/**
 * The last event the client has: the `Last-Event-ID` header a reconnecting `EventSource`
 * sends, else the `after` query parameter, else 0 (from the start).
 */
const resumeAfter = (req: express.Request): number => {
  const header = req.get("Last-Event-ID");
  const raw = header !== undefined && header !== "" ? header : req.query.after;
  if (raw === undefined || raw === "") {
    return 0;
  }
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    throw new APIError({
      detail: "Last-Event-ID and after must be a non-negative integer event seq",
      status: 400,
      title: "Invalid event id",
    });
  }
  return Number(raw);
};

const sseFrame = (event: StreamedEvent): string =>
  `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(eventBody(event))}\n\n`;

/** Whether the client is gone; `onClose` runs now when it already is. */
interface ClientConnection {
  readonly isClosed: boolean;
  onClose: (cleanup: () => void) => void;
}

/**
 * Track the client connection from the first middleware on, so a client that leaves
 * during auth or the lookups (before any stream resource exists) is still noticed.
 */
const trackConnection: express.RequestHandler = (req, res, next) => {
  let isClosed = Boolean(req.socket?.destroyed);
  const cleanups: Array<() => void> = [];
  res.on("close", () => {
    isClosed = true;
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
  });
  const connection: ClientConnection = {
    get isClosed() {
      return isClosed;
    },
    onClose: (cleanup) => {
      if (isClosed) {
        cleanup();
        return;
      }
      cleanups.push(cleanup);
    },
  };
  res.locals.harnessConnection = connection;
  next();
};

/**
 * Serve one SSE stream: subscribe to the shared tail, replay stored events after the
 * client's last one, then send what the tail delivered and keeps delivering. Registering
 * before the replay query means every event is in the replay, the tail, or both; frames
 * are deduplicated by `seq`, so the client receives each event once, in order.
 */
const serveEvents = async ({
  after,
  filter,
  heartbeat,
  hub,
  req,
  res,
  scope,
}: {
  after: number;
  filter: Record<string, unknown>;
  heartbeat: Duration;
  hub: HarnessEventHub;
  req: express.Request;
  res: express.Response;
  scope: {streamId: string; taskId?: string};
}): Promise<void> => {
  const connection = res.locals.harnessConnection as ClientConnection;
  if (connection.isClosed) {
    return;
  }
  const model = registerHarnessEvent();
  let lastSeq = after;
  let isReplaying = true;
  let isStreaming = false;
  let isFailed = false;
  const buffered: StreamedEvent[] = [];
  const send = (event: StreamedEvent): void => {
    if (connection.isClosed || res.writableEnded || event.seq <= lastSeq) {
      return;
    }
    lastSeq = event.seq;
    res.write(sseFrame(event));
  };
  // Ends the stream; the client reconnects with Last-Event-ID and resumes where it stopped.
  const end = (failure: {error: unknown; stage: string}): void => {
    logger.warn(`Harness event stream ${failure.stage} failed; closing: ${String(failure.error)}`);
    isFailed = true;
    if (isStreaming && !res.writableEnded) {
      res.end();
    }
  };
  const unsubscribe = await hub.subscribe({
    ...scope,
    // During the replay, tail events wait in `buffered`.
    deliver: (event) => (isReplaying ? buffered.push(event) : send(event)),
    fail: (error) => end({error, stage: "tail"}),
  });
  connection.onClose(unsubscribe);
  if (connection.isClosed) {
    return;
  }

  req.socket.setTimeout(0);
  res.status(200);
  res.set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  isStreaming = true;
  if (isFailed) {
    res.end();
    return;
  }
  // An ended response (a failed tail) may outlive its timer until the socket closes.
  const timer = setInterval(() => {
    if (!res.writableEnded) {
      res.write(": heartbeat\n\n");
    }
  }, heartbeat.toMillis());
  connection.onClose(() => clearInterval(timer));

  try {
    let page: StreamedEvent[];
    do {
      page = await model
        .find({...filter, seq: {$gt: lastSeq}})
        .sort({seq: 1})
        .limit(REPLAY_PAGE_SIZE)
        .lean<StreamedEvent[]>();
      page.forEach(send);
    } while (page.length === REPLAY_PAGE_SIZE && !connection.isClosed);
  } catch (error: unknown) {
    end({error, stage: "replay"});
    return;
  }
  isReplaying = false;
  buffered.sort((left, right) => left.seq - right.seq);
  buffered.splice(0).forEach(send);
};

/**
 * Mount the SSE routes `GET {basePath}/conversations/:id/events` and
 * `GET {basePath}/tasks/:id/events`. SSE is the listed exception to modelRouter actions:
 * the response is a long-lived stream, not a JSON document.
 */
export const addHarnessEventRoutes = (
  router: express.Application,
  {
    basePath,
    heartbeatInterval,
    hub,
  }: {basePath: string; heartbeatInterval?: DurationLike; hub: HarnessEventHub}
): void => {
  const heartbeat = Duration.fromDurationLike(heartbeatInterval ?? {seconds: 15});
  if (heartbeat.toMillis() <= 0) {
    throw new Error("HarnessApp heartbeatInterval must be positive");
  }

  const loadOr404 = async <T extends {userId?: mongoose.Types.ObjectId}>(
    find: (id: string) => Promise<T | null>,
    id: string | undefined,
    label: string
  ): Promise<T> => {
    const found = id && mongoose.isValidObjectId(id) ? await find(id) : null;
    if (!found) {
      throw new NotFoundError(`${label} not found`);
    }
    return found;
  };

  const assertCanRead = (req: express.Request, record: {userId?: mongoose.Types.ObjectId}) => {
    if (!isOwnerOrAdmin(req.user as User | undefined, record)) {
      throw new ForbiddenError("Only the owner or an admin may read this event stream");
    }
  };

  router.get(`${basePath}/conversations/:id/events`, [
    trackConnection,
    authenticateMiddleware(),
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const conversation = await loadOr404(
        (id) => registerHarnessConversation().findOneOrNone({_id: id}),
        req.params.id as string | undefined,
        "Conversation"
      );
      assertCanRead(req, conversation);
      const after = resumeAfter(req);
      await serveEvents({
        after,
        filter: {streamId: conversation._id},
        heartbeat,
        hub,
        req,
        res,
        scope: {streamId: String(conversation._id)},
      });
    }),
  ]);

  router.get(`${basePath}/tasks/:id/events`, [
    trackConnection,
    authenticateMiddleware(),
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const task = await loadOr404(
        (id) => registerHarnessTask().findOneOrNone({_id: id}),
        req.params.id as string | undefined,
        "Task"
      );
      assertCanRead(req, task);
      const after = resumeAfter(req);
      // The tree's stream, narrowed to this task and the tasks below it.
      const {streamId} = taskStreamOf(task);
      await serveEvents({
        after,
        filter: {streamId, taskPath: task._id},
        heartbeat,
        hub,
        req,
        res,
        scope: {streamId: String(streamId), taskId: String(task._id)},
      });
    }),
  ]);
};
