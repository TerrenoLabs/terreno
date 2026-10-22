import * as Sentry from "@sentry/bun";
import type express from "express";
import type {ChangeStream, ChangeStreamDocument, ChangeStreamOptions} from "mongodb";
import mongoose from "mongoose";
import type {Server, Socket} from "socket.io";

import type {User} from "../auth";
import {APIError} from "../errors";
import {logger} from "../logger";
import type {PermissionMethod} from "../permissions";
import {canReadDocumentRealtime} from "../rbac/realtimeAccess";
import {
  authorizeAdminBroadcastDocument,
  isAdminBroadcastSocketRoom,
} from "../sync/adminBroadcastScope";
import {computeStableFrontier, SyncScopeMove} from "../sync/models";
import {findSyncEntryByCollectionName, type SyncRegistryEntry} from "../sync/registry";
import {serializeSyncPayload} from "../sync/serialize";
import {syncRoomForStream} from "../sync/socketHandlers";
import {adminBroadcastStream, resolveStreamForDoc} from "../sync/streams";
import type {SyncDelta, SyncMutationOperation, SyncResyncHint} from "../sync/types";
import {awaitSocketFullUser, type SocketWithDecodedToken} from "./socketUser";
import type {ChangeStreamConfig} from "./types";

/**
 * The subset of ChangeStreamDocument variants this watcher actually processes.
 * The pipeline filters for ["insert", "update", "replace", "delete"], so we never
 * see drop / rename / invalidate / index events at runtime.
 */
type WatchedChange = Extract<
  ChangeStreamDocument,
  {operationType: "insert" | "update" | "replace" | "delete"}
>;

let changeWatcher: ChangeStream | null = null;

/**
 * Task 9.16: restart state for the single process-wide watcher.
 *
 * The watcher used to only LOG on `error`/`close`: a replica-set election, a network blip,
 * or a dropped cursor permanently killed every realtime event and every `sync:delta` until
 * the process was restarted — online clients silently stopped receiving data while looking
 * perfectly connected. The stream is now re-created with backoff, resuming from the last
 * observed resume token so no events in the gap are missed.
 */
/** Resume token of the last change seen, replayed via `resumeAfter` on restart. */
let lastResumeToken: unknown;

/** Bumped on every open/stop so callbacks from a replaced stream are ignored. */
let watcherGeneration = 0;

/** True between `stopChangeStreamWatcher()` and the next `startChangeStreamWatcher()`. */
let watcherStopped = true;

/** Consecutive failed opens, driving the backoff delay. Reset on a successful change. */
let restartAttempts = 0;

let restartTimer: ReturnType<typeof setTimeout> | null = null;

/** First restart delay; doubles per consecutive attempt up to the max. */
const CHANGE_STREAM_RESTART_BASE_DELAY_MS = 250;

/** Ceiling for the restart backoff — a long outage retries once every 30s, forever. */
const CHANGE_STREAM_RESTART_MAX_DELAY_MS = 30_000;

/**
 * Socket event telling clients their cached cursors may have gaps and they must
 * re-bootstrap. Emitted when the change stream's oplog history is gone
 * (`ChangeStreamHistoryLost`), which is the one failure a resume token cannot repair.
 * Payload: {@link SyncResyncHint}.
 */
/** @internal */
export const SYNC_RESYNC_EVENT = "sync:resync-required";

/** MongoDB error code / codeName for an unresumable change stream (oplog rolled past). */
const CHANGE_STREAM_HISTORY_LOST_CODE = 286;

/** True when the error means the resume token can no longer be used. */
const isHistoryLostError = (error: unknown): boolean => {
  const {code, codeName, message} = (error ?? {}) as {
    code?: unknown;
    codeName?: string;
    message?: string;
  };
  return (
    code === CHANGE_STREAM_HISTORY_LOST_CODE ||
    codeName === "ChangeStreamHistoryLost" ||
    Boolean(message?.includes("ChangeStreamHistoryLost")) ||
    Boolean(message?.includes("resume point may no longer be in the oplog"))
  );
};

/**
 * C8: per-entity serialized dispatch. The change-stream `"change"` handler is async and
 * multiple events can be in flight at once; without ordering, two events for the SAME
 * document could emit their deltas out of order (a client would then see LWW-by-seq
 * violated within an entity). This keeps a promise chain PER entity key
 * (`{collection}:{docId}`) so same-entity deltas dispatch strictly in change-stream
 * order, while different entities still run concurrently. Chains self-clean when idle.
 */
const entityDispatchChains = new Map<string, Promise<void>>();

const serializePerEntity = (key: string, task: () => Promise<void>): void => {
  const prior = entityDispatchChains.get(key) ?? Promise.resolve();
  const next = prior.then(task, task);
  entityDispatchChains.set(key, next);
  void next.finally(() => {
    // Drop the chain once this was the last queued task, so the map does not grow.
    if (entityDispatchChains.get(key) === next) {
      entityDispatchChains.delete(key);
    }
  });
};

/**
 * C7: the sync bookkeeping collections must never drive fan-out — their own change
 * events are internal (counters/ledger/markers/keys), and processing them would emit
 * spurious deltas or reprocess scope-move markers. Exported for testing.
 */
/** @internal */
export const DEFAULT_IGNORED_COLLECTIONS = [
  "socketio",
  "sessions",
  "synccounters",
  "syncmutations",
  "syncscopemoves",
  "synckeys",
];

/**
 * Map MongoDB change stream operation types to our method names.
 *
 * Soft deletes (an `update` that sets `deleted: true`) are reclassified as `"delete"`.
 *
 * Exported for testing.
 */
/** @internal */
export const mapOperationType = (
  operationType: string,
  change: ChangeStreamDocument
): "create" | "update" | "delete" | null => {
  if (operationType === "insert") {
    return "create";
  }
  if (operationType === "update" || operationType === "replace") {
    // Soft delete on an update event: the document was patched with deleted=true.
    // `change` is typed as the full union (without operationType narrowing) because
    // callers/tests pass change objects without setting `operationType` on the change.
    const updateChange = change as Extract<ChangeStreamDocument, {operationType: "update"}>;
    const isSoftDelete =
      operationType === "update" && updateChange.updateDescription?.updatedFields?.deleted === true;
    if (isSoftDelete) {
      return "delete";
    }
    return "update";
  }
  if (operationType === "delete") {
    return "delete";
  }
  return null;
};

/**
 * Get the collection tag from a route path (strips leading "/").
 * E.g. "/todos" -> "todos"
 */
const getCollectionTag = (routePath: string): string => routePath.replace(/^\//, "");

type RealtimeSocketWithAuth = Socket & SocketWithDecodedToken;

const getSocketsInRoom = (io: Server, room: string): RealtimeSocketWithAuth[] => {
  const socketIds = io.sockets.adapter.rooms.get(room);
  if (!socketIds) {
    return [];
  }

  const sockets: RealtimeSocketWithAuth[] = [];
  for (const socketId of socketIds) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      sockets.push(socket as RealtimeSocketWithAuth);
    }
  }
  return sockets;
};

/**
 * The minimal registry-entry shape the authorized-room emitter needs.
 * `SyncRegistryEntry` satisfies it structurally.
 */
export interface AuthorizedEmitEntry {
  collectionTag?: string;
  modelName: string;
  options: {permissions: {read: PermissionMethod<unknown>[]}};
  routePath?: string;
}

const emitCollectionTag = (entry: AuthorizedEmitEntry): string | undefined =>
  entry.collectionTag ?? (entry.routePath ? getCollectionTag(entry.routePath) : undefined);

/**
 * The change-stream post-image as the model document REST permission checks receive, so
 * virtuals resolve: `Permissions.IsOwner` reads `ownerId`, which models owned through another
 * field (GptHistory's `userId`) only have as a virtual. Falls back to the raw image when the
 * model is not registered or the image does not hydrate.
 */
const toPermissionDocument = (
  modelName: string,
  doc?: Record<string, unknown>
): Record<string, unknown> | undefined => {
  if (!doc || Object.keys(doc).length === 0 || !mongoose.modelNames().includes(modelName)) {
    return doc;
  }
  try {
    return mongoose.model(modelName).hydrate(doc) as unknown as Record<string, unknown>;
  } catch (error) {
    logger.warn(`[realtime] Could not hydrate ${modelName} for a read check: ${error}`);
    return doc;
  }
};

const canReadDocument = async (
  entry: AuthorizedEmitEntry,
  user?: User,
  doc?: Record<string, unknown>
): Promise<boolean> =>
  canReadDocumentRealtime(entry, user, toPermissionDocument(entry.modelName, doc));

/**
 * Ensure serialized documents include `id` to match REST API responses.
 * Change stream fullDocument payloads are raw BSON objects with `_id` only.
 */
/** @internal */
export const ensureApiId = (data: unknown): unknown => {
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    return data;
  }
  const serialized = data as Record<string, unknown>;
  if (serialized._id != null && serialized.id == null) {
    return {...serialized, id: serialized._id};
  }
  return data;
};

/**
 * Generalized authorized-room emitter: iterates the sockets in `room`, runs the per-socket
 * read-permission check against `fullDocument`, builds the payload per socket (so
 * responseHandlers can tailor output to the receiving user), and emits `eventName`.
 *
 * The sync layer's `sync:delta` emission delegates here.
 */
export const emitPayloadToAuthorizedRoom = async ({
  io,
  room,
  eventName,
  entry,
  fullDocument,
  buildPayload,
  logDebug,
}: {
  io: Server;
  room: string;
  eventName: string;
  entry: AuthorizedEmitEntry;
  fullDocument: Record<string, unknown> | undefined;
  /** Build the per-socket payload; a throw drops the emission for that socket only. */
  buildPayload: (user: User | undefined) => Promise<unknown> | unknown;
  logDebug: (msg: string) => void;
}): Promise<void> => {
  const sockets = getSocketsInRoom(io, room);
  for (const socket of sockets) {
    const user = await awaitSocketFullUser(socket);
    try {
      // Hard deletes have no document context; use an empty object so object-scoped
      // permission helpers fail closed instead of treating the check as preflight.
      const permissionDocument = fullDocument ?? {};
      const collectionTag = emitCollectionTag(entry);
      if (collectionTag && isAdminBroadcastSocketRoom(room, collectionTag)) {
        const adminDecision = await authorizeAdminBroadcastDocument({
          doc: fullDocument,
          modelName: entry.modelName,
          user,
        });
        if (adminDecision === "deny") {
          logDebug(`[realtime] Skipped ${room} for ${socket.id}: admin broadcast scope denied`);
          continue;
        }
        if (adminDecision === "allow") {
          socket.emit(eventName, await buildPayload(user));
          continue;
        }
      }
      const canRead = await canReadDocument(entry, user, permissionDocument);
      if (!canRead) {
        logDebug(`[realtime] Skipped ${room} for ${socket.id}: read permission denied`);
        continue;
      }

      socket.emit(eventName, await buildPayload(user));
    } catch (error) {
      logger.error(
        `[realtime] Failed to emit ${eventName} for ${entry.modelName} to socket ${socket.id}: ${error}`
      );
      Sentry.captureException(error);
    }
  }
};

/**
 * Emit `sync:delta` events for a change on a sync-registered collection.
 *
 * Deltas fan out to the dedicated `sync:{stream}` rooms joined via `sync:subscribe`
 * with per-socket read-permission checks. `seq` and `stream` come from the post-image: the `syncPlugin`
 * stamps `_syncSeq` on every synced write and the watcher runs `updateLookup`.
 *
 * Soft deletes (an update setting `deleted: true`, reclassified by `mapOperationType`)
 * produce a `method: "delete"` delta with `deleted: true` and the tombstone data intact.
 *
 * Scope moves (C4): the old-stream tombstone is derived from durable `SyncScopeMove`
 * markers (written by `syncPlugin` in the same op-scope as the move), NOT from the racy
 * `_syncPrevStream` post-image — a second write racing this event's processing can reset
 * `_syncPrevStream`, but it cannot erase the durable marker. For each marker on this
 * document, a data-less tombstone is emitted to the marker's `fromStream` (carrying the
 * marker's old-stream seq), and the new-stream delta is reported as `method: "create"`.
 * Client tombstone application is idempotent by seq, so re-emitting a marker on a later
 * change of the same doc is harmless.
 *
 * Every emitted delta carries `frontierSeq` (the emitting stream's stable frontier at
 * emit time, C1); the client advances its cursor to `min(delta.seq, delta.frontierSeq)`
 * so a delta observed out of commit order never advances a cursor past an uncommitted hole.
 *
 * Exported for testing.
 */
export const emitSyncDeltaForChange = async ({
  io,
  entry,
  change,
  docId,
  logDebug,
}: {
  io: Server;
  entry: SyncRegistryEntry;
  change: WatchedChange;
  docId: string;
  logDebug: (msg: string) => void;
}): Promise<void> => {
  if (change.operationType === "delete") {
    // Hard deletes are blocked on synced models by syncPlugin; a direct collection-level
    // delete has no post-image, so neither stream nor seq can be resolved. Clients
    // reconcile via snapshot instead.
    logDebug(
      `[sync] Skipping hard delete for synced collection ${entry.collectionTag}/${docId}: ` +
        "no post-image to resolve stream/seq"
    );
    return;
  }
  const fullDocument = change.fullDocument as Record<string, unknown> | undefined;
  if (!fullDocument) {
    logDebug(`[sync] Skipping ${entry.collectionTag}/${docId}: change has no fullDocument`);
    return;
  }

  const mapped = mapOperationType(change.operationType, change);
  if (!mapped) {
    return;
  }
  let method: SyncMutationOperation = mapped;
  const deleted = fullDocument.deleted === true;
  const seq = typeof fullDocument._syncSeq === "number" ? fullDocument._syncSeq : 0;
  const stream = resolveStreamForDoc({
    collectionTag: entry.collectionTag,
    doc: fullDocument,
    scope: entry.config.scope,
  });

  // C4: emit old-stream tombstones from durable markers, not the racy _syncPrevStream.
  const markers = await SyncScopeMove.find({
    collectionTag: entry.collectionTag,
    entityId: docId,
  }).lean();
  let movedAway = false;
  for (const marker of markers) {
    if (marker.fromStream === stream) {
      continue;
    }
    movedAway = true;
    const markerFrontier = await computeStableFrontier({stream: marker.fromStream});
    const tombstone: SyncDelta = {
      collection: entry.collectionTag,
      deleted: true,
      frontierSeq: markerFrontier,
      id: docId,
      method: "delete",
      seq: marker.seq,
      stream: marker.fromStream,
    };
    await emitPayloadToAuthorizedRoom({
      buildPayload: () => tombstone,
      entry,
      eventName: "sync:delta",
      fullDocument,
      io,
      logDebug,
      room: syncRoomForStream(marker.fromStream),
    });
    logDebug(
      `[sync] Emitted scope-move tombstone for ${entry.collectionTag}/${docId} to ${marker.fromStream} seq=${marker.seq}`
    );
  }
  // The new stream sees a moved-away doc for the first time: report it as a create
  // (unless the same write also soft-deleted the doc, in which case the tombstone wins).
  if (movedAway && method !== "delete") {
    method = "create";
  }

  const emitLiveDelta = async (targetStream: string): Promise<void> => {
    const frontierSeq = await computeStableFrontier({stream: targetStream});
    const liveDelta: SyncDelta = {
      collection: entry.collectionTag,
      frontierSeq,
      id: docId,
      method,
      seq,
      stream: targetStream,
      ...(deleted ? {deleted: true} : {}),
    };
    await emitPayloadToAuthorizedRoom({
      // C7: tombstone deltas carry no data (only id/seq/deleted); live deltas serialize.
      buildPayload: deleted
        ? () => liveDelta
        : async (user) => {
            const syntheticReq = {params: {}, query: {}, user} as unknown as express.Request;
            const data = ensureApiId(
              await serializeSyncPayload({doc: fullDocument, entry, method, req: syntheticReq})
            );
            return {...liveDelta, data};
          },
      entry,
      eventName: "sync:delta",
      fullDocument,
      io,
      logDebug,
      room: syncRoomForStream(targetStream),
    });
    logDebug(
      `[sync] Emitted sync:delta ${method} for ${entry.collectionTag}/${docId} seq=${seq} stream=${targetStream} frontier=${frontierSeq}`
    );
  };

  await emitLiveDelta(stream);
  if (entry.config.adminBroadcast === true) {
    await emitLiveDelta(adminBroadcastStream(entry.collectionTag));
  }
};

/**
 * Start watching MongoDB change streams and emitting `sync:delta` events.
 *
 * Task 9.16: the stream is supervised — an `error`/`close`/`end` schedules a re-open with
 * exponential backoff, resuming from the last seen token. Call
 * {@link stopChangeStreamWatcher} to end supervision.
 */
export const startChangeStreamWatcher = (
  io: Server,
  config: ChangeStreamConfig = {},
  debug = false
): void => {
  watcherStopped = false;
  restartAttempts = 0;
  lastResumeToken = undefined;
  openChangeStream({config, debug, io});
};

/**
 * Task 9.16: schedule a re-open after a stream failure. Silently returns when the watcher
 * was stopped, when a newer stream is already running (a failing stream can fire several
 * terminal events), or when a restart is already pending.
 */
const scheduleChangeStreamRestart = ({
  config,
  debug,
  generation,
  io,
  reason,
}: {
  config: ChangeStreamConfig;
  debug: boolean;
  generation: number;
  io: Server;
  reason: string;
}): void => {
  if (watcherStopped || generation !== watcherGeneration || restartTimer) {
    return;
  }
  restartAttempts += 1;
  const delayMs = Math.min(
    CHANGE_STREAM_RESTART_BASE_DELAY_MS * 2 ** (restartAttempts - 1),
    CHANGE_STREAM_RESTART_MAX_DELAY_MS
  );
  logger.warn(
    `[realtime] Change stream ${reason}; reopening in ${delayMs}ms (attempt ${restartAttempts})`,
    {resumable: lastResumeToken !== undefined}
  );
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (watcherStopped) {
      return;
    }
    openChangeStream({config, debug, io, isReopen: true});
  }, delayMs);
  // Never hold the process open just to retry a watcher.
  restartTimer.unref?.();
};

/**
 * Open (or re-open) the change stream and wire its listeners. Throws only for a
 * configuration-level failure on the FIRST open (no connection, `watch` returned nothing),
 * which must fail startup loudly; a failure while reopening is retried with backoff.
 */
const openChangeStream = ({
  config,
  debug,
  io,
  isReopen = false,
}: {
  config: ChangeStreamConfig;
  debug: boolean;
  io: Server;
  /** True for a supervised reopen: failures retry with backoff instead of throwing. */
  isReopen?: boolean;
}): void => {
  const logInfo = (message: string): void => {
    if (debug) {
      logger.info(message);
    }
  };

  const logDebug = (message: string): void => {
    if (debug) {
      logger.debug(message);
    }
  };

  const generation = ++watcherGeneration;

  try {
    logInfo("[realtime] Initializing change stream watcher...");

    const ignored = new Set([...DEFAULT_IGNORED_COLLECTIONS, ...(config.ignoredCollections ?? [])]);

    const ignoredOps = new Set(config.ignoredOperations ?? []);

    // Build the change stream pipeline
    const pipeline = [
      {
        $match: {
          "ns.coll": {$nin: Array.from(ignored)},
          operationType: {$in: ["insert", "update", "replace", "delete"]},
        },
      },
      {
        $project: {
          documentKey: 1,
          fullDocument: 1,
          ns: 1,
          operationType: 1,
          updateDescription: 1,
        },
      },
    ];

    const nativeDb = mongoose.connection.db;
    if (!nativeDb) {
      throw new APIError({
        status: 500,
        title: "MongoDB connection not available for change stream",
      });
    }

    const options: ChangeStreamOptions = {
      batchSize: config.batchSize ?? 50,
      fullDocument: config.fullDocument ?? "updateLookup",
      fullDocumentBeforeChange: "off",
      // How long the cursor waits for new events before yielding control.
      // Lower values give more responsive updates at the cost of more frequent driver round-trips.
      maxAwaitTimeMS: 1000,
      // Task 9.16: resume where the previous stream died so events during the outage are
      // delivered rather than lost. Absent on a first open and after history loss.
      ...(lastResumeToken !== undefined ? {resumeAfter: lastResumeToken} : {}),
    };

    const stream = nativeDb.watch(pipeline, options);

    if (!stream) {
      throw new APIError({status: 500, title: "Failed to create change stream watcher"});
    }
    changeWatcher = stream;

    stream.on("change", async (rawChange: ChangeStreamDocument) => {
      try {
        // Task 9.16: record the resume token FIRST, for every change — including ones this
        // watcher ignores. A token only from processed events would rewind the stream to an
        // old position after a restart and re-deliver everything since.
        const token = (rawChange as {_id?: unknown})._id;
        if (token !== undefined) {
          lastResumeToken = token;
        }
        // A stream that is delivering events has recovered; drop the accumulated backoff so
        // the next unrelated failure retries promptly instead of at the previous ceiling.
        restartAttempts = 0;
        // The pipeline restricts operationType to a subset that always has ns/documentKey;
        // narrow once here so downstream code doesn't need repeated casts.
        if (
          rawChange.operationType !== "insert" &&
          rawChange.operationType !== "update" &&
          rawChange.operationType !== "replace" &&
          rawChange.operationType !== "delete"
        ) {
          return;
        }
        const change = rawChange as WatchedChange;
        const collectionName = change.ns?.coll;
        const docId = change.documentKey?._id?.toString();

        if (!collectionName || !docId) {
          return;
        }

        // Check if this operation type is ignored
        if (ignoredOps.has(change.operationType)) {
          return;
        }

        const syncEntry = findSyncEntryByCollectionName(collectionName);
        if (!syncEntry) {
          // Not a sync-registered model — skip
          logDebug(`[realtime] No sync registry entry for collection: ${collectionName}`);
          return;
        }

        // C8: serialize per entity so same-doc deltas emit in change-stream order;
        // different docs still dispatch concurrently. See serializePerEntity + the
        // per-entity LWW-by-seq contract documented in sync/types.ts (SyncDelta).
        serializePerEntity(`${collectionName}:${docId}`, async () => {
          try {
            await emitSyncDeltaForChange({change, docId, entry: syncEntry, io, logDebug});
          } catch (error) {
            logger.error(`[sync] Error emitting sync delta: ${error}`);
            Sentry.captureException(error);
          }
        });
      } catch (error) {
        logger.error(`[realtime] Error processing change event: ${error}`);
        Sentry.captureException(error);
      }
    });

    stream.on("error", (err: Error) => {
      Sentry.captureException(err);
      logger.error(`[realtime] Change stream error: ${err?.message || err}`);
      if (isHistoryLostError(err)) {
        // The oplog no longer contains the resume point, so the gap can never be replayed.
        // Reopen from NOW and tell clients to re-bootstrap: their cursors may sit below
        // changes (including deletions) they will otherwise never hear about.
        lastResumeToken = undefined;
        logger.error(
          "[sync] Change stream history lost; reopening without a resume token and asking " +
            "clients to resync"
        );
        const hint: SyncResyncHint = {reason: "history_lost"};
        io.emit(SYNC_RESYNC_EVENT, hint);
      }
      scheduleChangeStreamRestart({config, debug, generation, io, reason: "errored"});
    });

    stream.on("close", () => {
      logger.warn("[realtime] Change stream closed");
      scheduleChangeStreamRestart({config, debug, generation, io, reason: "closed"});
    });

    stream.on("end", () => {
      logger.warn("[realtime] Change stream ended");
      scheduleChangeStreamRestart({config, debug, generation, io, reason: "ended"});
    });

    logInfo("[realtime] Change stream watcher initialized successfully");
  } catch (error) {
    logger.error(`[realtime] Failed to initialize change stream watcher: ${error}`);
    Sentry.captureException(error);
    // A first open must fail startup loudly; a failed REOPEN (the DB is down mid-flight)
    // has no caller to throw to, so keep retrying with backoff instead.
    if (isReopen && !watcherStopped) {
      scheduleChangeStreamRestart({config, debug, generation, io, reason: "failed to open"});
      return;
    }
    throw error;
  }
};

/**
 * Stop the change stream watcher and end Task 9.16's restart supervision (a pending
 * reopen is cancelled, and terminal events from the closing stream are ignored).
 */
export const stopChangeStreamWatcher = async (): Promise<void> => {
  watcherStopped = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  restartAttempts = 0;
  lastResumeToken = undefined;
  if (changeWatcher) {
    await changeWatcher.close();
    changeWatcher = null;
  }
};
