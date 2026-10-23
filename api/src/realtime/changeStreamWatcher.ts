import * as Sentry from "@sentry/bun";
import type express from "express";
import {DateTime} from "luxon";
import type {ChangeStream, ChangeStreamDocument, ChangeStreamOptions} from "mongodb";
import mongoose from "mongoose";
import type {Server, Socket} from "socket.io";

import type {User} from "../auth";
import {APIError} from "../errors";
import {logger} from "../logger";
import type {PermissionMethod} from "../permissions";
import {canReadDocumentRealtime, maskRealtimeDocument} from "../rbac/realtimeAccess";
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
import {matchesQuery} from "./queryMatcher";
import {getQuerySubscriptionsForCollection} from "./queryStore";
import {findRegistryEntryByCollection, type RealtimeRegistryEntry} from "./registry";
import {awaitSocketFullUser, type SocketWithDecodedToken} from "./socketUser";
import type {ChangeStreamConfig, RealtimeEvent} from "./types";

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
 * Soft deletes (an `update` that sets `deleted: true`) are reclassified as
 * `"delete"` only when the model has `"delete"` enabled in its realtime
 * methods. Otherwise they fall back to `"update"` so models that subscribe
 * to updates (but not deletes) still see the change — without this fallback,
 * a model configured with `methods: ["create", "update"]` would silently
 * drop soft-delete events.
 *
 * Exported for testing.
 */
/** @internal */
export const mapOperationType = (
  operationType: string,
  change: ChangeStreamDocument,
  enabledMethods: ReadonlyArray<"create" | "update" | "delete"> = ["create", "update", "delete"]
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
    if (isSoftDelete && enabledMethods.includes("delete")) {
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
 * The minimal registry-entry shape the authorized-room emitters need. Both
 * `RealtimeRegistryEntry` and `SyncRegistryEntry` satisfy it structurally.
 */
export interface AuthorizedEmitEntry {
  collectionTag?: string;
  modelName: string;
  options: {permissions: {read: PermissionMethod<unknown>[]}};
  routePath?: string;
}

const emitCollectionTag = (entry: AuthorizedEmitEntry): string | undefined =>
  entry.collectionTag ?? (entry.routePath ? getCollectionTag(entry.routePath) : undefined);

const canReadDocument = async (
  entry: AuthorizedEmitEntry,
  user?: User,
  doc?: Record<string, unknown>
): Promise<boolean> => canReadDocumentRealtime(entry, user, doc);

/**
 * Determine which Socket.io rooms to emit to based on the room strategy.
 * Exported for testing.
 */
/** @internal */
export const resolveRooms = (
  entry: RealtimeRegistryEntry,
  doc: Record<string, unknown>,
  method: string
): string[] => {
  const {roomStrategy} = entry.config;
  // Use the collection tag (e.g. "todos") for model rooms, matching what the frontend subscribes to
  const collectionTag = getCollectionTag(entry.routePath);

  if (typeof roomStrategy === "function") {
    // Custom room resolver — pass a minimal pseudo-request. The strategy only inspects
    // doc/method; we never read fields off req here, so an empty cast is safe.
    return roomStrategy(doc, method, {} as unknown as express.Request);
  }

  switch (roomStrategy) {
    case "owner": {
      const ownerId = doc?.ownerId != null ? String(doc.ownerId) : undefined;
      if (ownerId) {
        return [`user:${ownerId}`];
      }
      // If no ownerId, fall back to model room
      return [`model:${collectionTag}`];
    }
    case "model":
      return [`model:${collectionTag}`];
    case "broadcast":
      return ["authenticated"];
    default:
      return [`model:${collectionTag}`];
  }
};

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
 * Serialize a document for emission.
 *
 * Precedence:
 *   1. `realtimeResponseHandler` if provided (full control over what's emitted).
 *   2. modelRouter `responseHandler` if provided — invoked with a synthetic request
 *      so the same stripping logic used for REST responses (e.g. removing `hash`/`salt`)
 *      applies to realtime events. This prevents accidental leaks when an app only
 *      configures sanitization in the REST `responseHandler`.
 *   3. `toJSON()` fallback.
 *
 * If a user-supplied handler throws, we re-throw so the caller's outer try/catch
 * records the failure and the event is dropped. Falling back to `toJSON()` here
 * would risk leaking unsanitized fields (e.g. `hash`/`salt`) that the handler
 * was supposed to strip.
 */
/** @internal */
export const serializeDoc = async (
  entry: RealtimeRegistryEntry,
  doc: Record<string, unknown>,
  method: "create" | "update" | "delete",
  user?: User
): Promise<unknown> => {
  if (entry.config.realtimeResponseHandler) {
    try {
      return ensureApiId(await entry.config.realtimeResponseHandler(doc, method));
    } catch (error) {
      logger.error(
        `[realtime] realtimeResponseHandler threw for ${entry.modelName}/${method}: ${error}. ` +
          "Dropping event to avoid leaking unsanitized data."
      );
      throw error;
    }
  }

  const responseHandler = entry.options?.responseHandler;
  if (responseHandler) {
    try {
      // The REST responseHandler signature expects a "list" | "create" | "read" | "update" method.
      // Map "delete" → "read" so handlers that branch on method receive a sane value.
      const restMethod = method === "delete" ? "read" : method;
      // Synthesize the minimal request shape responseHandlers commonly inspect.
      const syntheticReq = {params: {}, query: {}, user} as unknown as express.Request;
      const serialized = await responseHandler(
        doc as unknown as mongoose.Document<unknown, unknown, unknown>,
        restMethod,
        syntheticReq,
        entry.options
      );
      const masked = await maskRealtimeDocument(entry, user, serialized, restMethod);
      return ensureApiId(masked);
    } catch (error) {
      logger.error(
        `[realtime] modelRouter responseHandler threw during realtime serialization for ` +
          `${entry.modelName}/${method}: ${error}. Dropping event to avoid leaking unsanitized data.`
      );
      throw error;
    }
  }

  const fallback =
    typeof doc.toJSON === "function" ? (doc as {toJSON: () => unknown}).toJSON() : doc;
  const maskedFallback = await maskRealtimeDocument(
    entry,
    user,
    fallback,
    method === "delete" ? "read" : method
  );
  return ensureApiId(maskedFallback);
};

/** Returned by a `buildPayload` callback to send nothing to that socket. */
const SKIP_EMISSION = Symbol("skipEmission");

/**
 * Generalized authorized-room emitter: iterates the sockets in `room`, runs the per-socket
 * read-permission check against `fullDocument`, builds the payload per socket (so
 * responseHandlers can tailor output to the receiving user), and emits `eventName`.
 *
 * `emitToAuthorizedRoom` (legacy "sync" events) and the sync layer's `sync:delta`
 * emission both delegate here.
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
  /**
   * Build the per-socket payload; a throw drops the emission for that socket only, and
   * returning SKIP_EMISSION sends nothing to it.
   */
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
          const adminPayload = await buildPayload(user);
          if (adminPayload !== SKIP_EMISSION) {
            socket.emit(eventName, adminPayload);
          }
          continue;
        }
      }
      const canRead = await canReadDocument(entry, user, permissionDocument);
      if (!canRead) {
        logDebug(`[realtime] Skipped ${room} for ${socket.id}: read permission denied`);
        continue;
      }

      const payload = await buildPayload(user);
      if (payload === SKIP_EMISSION) {
        continue;
      }
      socket.emit(eventName, payload);
    } catch (error) {
      logger.error(
        `[realtime] Failed to emit ${eventName} for ${entry.modelName} to socket ${socket.id}: ${error}`
      );
      Sentry.captureException(error);
    }
  }
};

/** @internal */
export const emitToAuthorizedRoom = async (
  io: Server,
  room: string,
  event: RealtimeEvent,
  entry: RealtimeRegistryEntry,
  fullDocument: Record<string, unknown> | undefined,
  logDebug: (msg: string) => void
): Promise<void> =>
  emitPayloadToAuthorizedRoom({
    buildPayload: async (user) => {
      if (!fullDocument) {
        return event;
      }
      const data = await serializeDoc(entry, fullDocument, event.method, user);
      return {...event, data};
    },
    entry,
    eventName: "sync",
    fullDocument,
    io,
    logDebug,
    room,
  });

/**
 * Query-room fan-out for routers with RBAC field views. Each recipient's match is evaluated
 * against the document as masked for that recipient, so a field hidden from them cannot
 * decide whether they receive a create, update, or delete.
 */
const emitMaskedQueryRoomEvent = async ({
  io,
  queryRoom,
  event,
  entry,
  fullDocument,
  query,
  logDebug,
}: {
  io: Server;
  queryRoom: string;
  event: RealtimeEvent;
  entry: RealtimeRegistryEntry;
  fullDocument: Record<string, unknown>;
  query: Record<string, unknown>;
  logDebug: (msg: string) => void;
}): Promise<void> =>
  emitPayloadToAuthorizedRoom({
    buildPayload: async (user) => {
      const masked = await maskRealtimeDocument(entry, user, fullDocument, "read");
      const matches =
        typeof masked === "object" &&
        masked !== null &&
        !Array.isArray(masked) &&
        matchesQuery(masked as Record<string, unknown>, query);
      let method: RealtimeEvent["method"] | undefined;
      if (event.method === "update") {
        method = matches ? "update" : "delete";
      } else if (matches) {
        method = event.method;
      }
      if (!method) {
        return SKIP_EMISSION;
      }
      const data = await serializeDoc(entry, fullDocument, method, user);
      return {...event, data, method};
    },
    entry,
    eventName: "sync",
    fullDocument,
    io,
    logDebug,
    room: queryRoom,
  });

/** Fan one change out to one query room. */
const emitToQueryRoom = async ({
  io,
  queryRoom,
  query,
  event,
  fullDocument,
  entry,
  hasFieldViews,
  isOwnerStrategy,
  logDebug,
}: {
  io: Server;
  queryRoom: string;
  query: Record<string, unknown>;
  event: RealtimeEvent;
  fullDocument: Record<string, unknown> | undefined;
  entry?: RealtimeRegistryEntry;
  hasFieldViews: boolean;
  isOwnerStrategy: boolean;
  logDebug: (msg: string) => void;
}): Promise<void> => {
  if (event.method === "delete") {
    if (!fullDocument) {
      // Hard delete with no document context. For owner-strategy collections we can't
      // tell which query rooms belong to the owner without leaking activity to others,
      // so skip query fanout entirely — subscribers will reconcile on next fetch.
      if (isOwnerStrategy) {
        logDebug(
          `[realtime] Skipping hard delete fanout to ${queryRoom} (owner strategy, no fullDocument)`
        );
        return;
      }
      if (entry) {
        await emitToAuthorizedRoom(io, queryRoom, event, entry, fullDocument, logDebug);
      } else {
        io.to(queryRoom).emit("sync", event);
      }
      logDebug(`[realtime] Emitted hard delete to ${queryRoom}`);
      return;
    }

    if (entry && hasFieldViews) {
      await emitMaskedQueryRoomEvent({
        entry,
        event,
        fullDocument,
        io,
        logDebug,
        query,
        queryRoom,
      });
      return;
    }

    // Soft delete: only forward to query rooms whose filter the document satisfies.
    if (matchesQuery(fullDocument, query)) {
      if (entry) {
        await emitToAuthorizedRoom(io, queryRoom, event, entry, fullDocument, logDebug);
      } else {
        io.to(queryRoom).emit("sync", event);
      }
      logDebug(`[realtime] Emitted soft delete to ${queryRoom} (query matched)`);
    }
    return;
  }

  if (!fullDocument) {
    return;
  }

  if (entry && hasFieldViews) {
    await emitMaskedQueryRoomEvent({entry, event, fullDocument, io, logDebug, query, queryRoom});
    return;
  }

  const docMatches = matchesQuery(fullDocument, query);

  if (event.method === "create" && docMatches) {
    // New document matches the query — send create event
    if (entry) {
      await emitToAuthorizedRoom(io, queryRoom, event, entry, fullDocument, logDebug);
    } else {
      io.to(queryRoom).emit("sync", event);
    }
    logDebug(`[realtime] Emitted create to ${queryRoom} (query matched)`);
  } else if (event.method === "update") {
    if (docMatches) {
      // Document still matches (or newly matches) — send update event
      if (entry) {
        await emitToAuthorizedRoom(io, queryRoom, event, entry, fullDocument, logDebug);
      } else {
        io.to(queryRoom).emit("sync", event);
      }
      logDebug(`[realtime] Emitted update to ${queryRoom} (query matched)`);
    } else {
      // Document no longer matches the query — send delete event so client removes it
      const removeEvent: RealtimeEvent = {
        ...event,
        method: "delete",
      };
      if (entry) {
        await emitToAuthorizedRoom(io, queryRoom, removeEvent, entry, fullDocument, logDebug);
      } else {
        io.to(queryRoom).emit("sync", removeEvent);
      }
      logDebug(`[realtime] Emitted delete to ${queryRoom} (query no longer matched)`);
    }
  }
};

/**
 * Emit a sync event to document-specific and query rooms.
 *
 * Document rooms: `document:{collection}:{docId}` — clients subscribed to a single document.
 * Query rooms: `query:{queryId}` — clients subscribed to a query filter. The change stream
 * watcher evaluates whether the document matches each active query for the collection.
 *
 * For deletes, we are careful not to leak cross-user activity:
 *   - Soft deletes (fullDocument present) are matched against each query like updates so
 *     query subscribers only see deletes for docs that matched their filter.
 *   - Hard deletes (fullDocument absent) on owner-strategy collections are NOT forwarded
 *     to query rooms — subscribers will reconcile on their next fetch. Other strategies
 *     forward the delete because the model/broadcast rooms are not user-scoped.
 *
 * Exported for testing.
 */
/** @internal */
export const emitToDocumentAndQueryRooms = async (
  io: Server,
  collection: string,
  event: RealtimeEvent,
  fullDocument: Record<string, unknown> | undefined,
  logDebug: (msg: string) => void,
  entry?: RealtimeRegistryEntry
): Promise<void> => {
  // Emit to document-specific room
  const docRoom = `document:${collection}:${event.id}`;
  if (entry) {
    await emitToAuthorizedRoom(io, docRoom, event, entry, fullDocument, logDebug);
  } else {
    io.to(docRoom).emit("sync", event);
  }
  logDebug(`[realtime] Emitted ${event.method} to ${docRoom}`);

  const isOwnerStrategy = entry?.config.roomStrategy === "owner";
  const hasFieldViews = Boolean(entry?.options.access && entry?.options.accessControl);

  // Evaluate query subscriptions
  const querySubscriptions = getQuerySubscriptionsForCollection(collection);
  for (const subscription of querySubscriptions) {
    try {
      await emitToQueryRoom({
        entry,
        event,
        fullDocument,
        hasFieldViews,
        io,
        isOwnerStrategy,
        logDebug,
        query: subscription.query,
        queryRoom: `query:${subscription.queryId}`,
      });
    } catch (error) {
      // One subscription's failure must not stop the others or the change's sync:delta.
      logger.warn(
        `[realtime] Query subscription ${subscription.queryId} failed to evaluate; skipping it: ${error}`
      );
    }
  }
};

/**
 * Emit legacy realtime "sync" events for a change on a realtime-registered collection.
 * Extracted verbatim from the change handler so sync-delta emission (which is keyed off
 * the independent sync registry) runs even when the realtime path skips the change.
 */
const processRealtimeChange = async ({
  io,
  entry,
  change,
  docId,
  logDebug,
  logInfo,
}: {
  io: Server;
  entry: RealtimeRegistryEntry;
  change: WatchedChange;
  docId: string;
  logDebug: (msg: string) => void;
  logInfo: (msg: string) => void;
}): Promise<void> => {
  // Map to our method type. Pass enabledMethods so soft deletes only
  // remap to "delete" when the model actually subscribes to deletes —
  // otherwise the change is kept as "update" so update subscribers
  // still receive it.
  const method = mapOperationType(change.operationType, change, entry.config.methods);
  if (!method) {
    return;
  }

  // Check if this method is enabled for this model
  if (!entry.config.methods.includes(method)) {
    logDebug(`[realtime] Method ${method} not enabled for ${entry.modelName}`);
    return;
  }

  // fullDocument is present on insert/update/replace; absent on delete.
  const fullDocument = change.operationType === "delete" ? undefined : change.fullDocument;

  // For hard deletes, we don't have the full document
  const isHardDelete = method === "delete" && !fullDocument;

  // Determine target rooms
  let rooms: string[];
  if (isHardDelete) {
    // Hard delete: no fullDocument, so we can't resolve owner/custom rooms.
    // For owner strategy we cannot safely fan out to a model room without
    // leaking deletes across users — admins still receive the event via the
    // admin room and any document-specific subscribers via document rooms.
    if (entry.config.roomStrategy === "owner") {
      rooms = ["admin"];
    } else if (entry.config.roomStrategy === "broadcast") {
      rooms = ["authenticated"];
    } else {
      const collectionTag = getCollectionTag(entry.routePath);
      rooms = [`model:${collectionTag}`];
    }
  } else {
    rooms = resolveRooms(entry, fullDocument ?? {}, method);
  }

  const collection = getCollectionTag(entry.routePath);

  const event: RealtimeEvent = {
    collection,
    id: docId,
    method,
    model: entry.modelName,
    timestamp: DateTime.now().toMillis(),
    ...(change.operationType === "update" && change.updateDescription?.updatedFields
      ? {updatedFields: Object.keys(change.updateDescription.updatedFields)}
      : {}),
  };

  // Emit to strategy-based rooms (model/owner/broadcast)
  for (const room of rooms) {
    await emitToAuthorizedRoom(io, room, event, entry, fullDocument, logDebug);
  }

  // Emit to document-specific and query rooms
  await emitToDocumentAndQueryRooms(io, collection, event, fullDocument, logDebug, entry);

  logDebug(
    `[realtime] Emitted ${method} for ${entry.modelName}/${docId} to rooms: ${rooms.join(", ")}`
  );
  // Log only metadata — never the document payload, which may contain sensitive fields.
  const metadata: Record<string, unknown> = {
    collection: event.collection,
    id: event.id,
    method: event.method,
    model: event.model,
    timestamp: event.timestamp,
  };
  if (event.updatedFields) {
    metadata.updatedFields = event.updatedFields;
  }
  logInfo(`[realtime] sync event: ${JSON.stringify(metadata)}`);
};

/**
 * Emit `sync:delta` events for a change on a sync-registered collection.
 *
 * Deltas fan out to the dedicated `sync:{stream}` rooms joined via `sync:subscribe`
 * (independent of the legacy realtime rooms), with the same per-socket read-permission
 * checks as legacy events. `seq` and `stream` come from the post-image: the `syncPlugin`
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
 * A model with both `realtime` and `sync` configs emits both the legacy "sync" event and
 * "sync:delta" — distinct event names, no interference (documented as transitional).
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
 * Start watching MongoDB change streams and emitting real-time events.
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

        // Realtime and sync registries are independent: a model may be in either or both.
        // A model with both configs emits both the legacy "sync" event and "sync:delta".
        const entry = findRegistryEntryByCollection(collectionName);
        const syncEntry = findSyncEntryByCollectionName(collectionName);

        if (!entry && !syncEntry) {
          // Not a registered realtime or sync model — skip
          logDebug(`[realtime] No registry entry for collection: ${collectionName}`);
          return;
        }

        if (entry) {
          // A legacy realtime failure must not skip the independent sync:delta emission.
          try {
            await processRealtimeChange({change, docId, entry, io, logDebug, logInfo});
          } catch (error) {
            logger.error(`[realtime] Error processing realtime change: ${error}`);
            Sentry.captureException(error);
          }
        }

        if (syncEntry) {
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
        }
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
