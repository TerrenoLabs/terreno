import type express from "express";
import type {Server} from "socket.io";

import type {User} from "../auth";
import {logger} from "../logger";
import {ORGANIZATION_ID_HEADER} from "../orgs/orgContext";
import {checkPermissions} from "../permissions";
import {awaitSocketFullUser, type SocketWithDecodedToken} from "../realtime/socketUser";
import {canListAdminBroadcastScope, getAdminBroadcastScope} from "./adminBroadcastScope";
import {canUseAdminBroadcastWindow} from "./adminWindowAccess";
import type {SyncMutationOutcome} from "./mutationHandler";
import {findSyncEntryByCollectionTag, type SyncRegistryEntry} from "./registry";
import type {SyncAppOptions} from "./routes";
import {
  adminBroadcastStream,
  MissingScopeResolverError,
  resolveUserStreamsForEntry,
} from "./streams";
import {runSyncBatch, runSyncMutation} from "./syncBatch";
import type {
  SyncMutateBatchRequest,
  SyncMutateBatchResponse,
  SyncMutateRequest,
  SyncNack,
} from "./types";

const requestFromOrganizationId = ({
  organizationId,
  user,
}: {
  organizationId?: string;
  user: User;
}): express.Request => {
  const trimmed = organizationId?.trim();
  if (!trimmed) {
    return {user} as unknown as express.Request;
  }
  return {
    header: (name: string): string | undefined => {
      return String(name).toLowerCase() === ORGANIZATION_ID_HEADER ? trimmed : undefined;
    },
    user,
  } as unknown as express.Request;
};

const organizationIdFromPayload = (payload: unknown): string | undefined => {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const organizationId = (payload as {organizationId?: unknown}).organizationId;
  return typeof organizationId === "string" ? organizationId : undefined;
};

/**
 * Socket handlers for the SyncDB local-first protocol:
 *
 * - `sync:subscribe {collections, mode?}` / `sync:unsubscribe {collections}` — resolves the
 *   caller's streams from the sync registry scope config and joins/leaves `sync:{stream}`
 *   rooms. Owner scopes always use the socket's own userId (never a client-supplied one);
 *   tenant and custom scopes resolve stream values via `SyncAppOptions.getUserScopes`.
 *   `mode: "window"` joins `{collection}|admin` only (requires `adminBroadcast` and
 *   admin panel access: `admin:access` when `SyncApp` has `accessControl`, else
 *   `user.admin`). When AdminApp has registered a broadcast scope, list
 *   permission for that model is required as well. Confirms with
 *   `sync:subscribed {mode: "window"}` without dumping snapshot pages.
 *   Sync deltas fan out through these dedicated `sync:{stream}` rooms rather than the
 *   per-user rooms joined at connect.
 * - `sync:mutate` — applies a mutation through `applySyncMutation` and replies with
 *   `sync:ack {mutationId, id, seq}` or `sync:nack {mutationId, code, ...}`; when the
 *   client supplied a Socket.io ack callback it also receives `{ack}` / `{nack}`.
 * - `sync:error {collection, message}` — emitted for per-collection subscribe failures
 *   (unknown collection, permission denied, non-admin window subscribe, missing scope
 *   resolver, cap exceeded).
 *
 * ## Wiring
 *
 * `RealtimeApp` installs these handlers on every connection with the `SyncAppOptions`
 * attached to the same Express application, so multiple app instances stay isolated.
 */

/** Maximum distinct collection subscriptions per socket (DoS protection). */
export const MAX_SYNC_COLLECTION_SUBSCRIPTIONS = 50;

/**
 * C8: maximum entries accepted in a single `sync:subscribe`/`sync:unsubscribe`
 * `collections` array — checked BEFORE iterating so an oversized array is rejected
 * with no per-entry work.
 */
export const MAX_SYNC_SUBSCRIBE_ARRAY_LENGTH = 100;

/** The Socket.io room a sync stream fans out through. */
export const syncRoomForStream = (stream: string): string => `sync:${stream}`;

/**
 * Minimal shape this module requires from a Socket.io socket. Matches
 * `RealtimeSocketLike` structurally so tests can drive handlers with a mock socket.
 */
export interface SyncSocketLike extends SocketWithDecodedToken {
  id: string;
  join: (room: string) => Promise<void> | void;
  leave: (room: string) => Promise<void> | void;
  emit: (event: string, payload: unknown) => void;
  on: (event: string, handler: (...args: never[]) => void | Promise<void>) => void;
}

/**
 * Resolve the streams a user may subscribe to for a collection. Returns null (after
 * emitting `sync:error`) when the scope cannot be resolved for this user/server config.
 */
const resolveUserStreams = async ({
  entry,
  user,
  options,
  socket,
}: {
  entry: SyncRegistryEntry;
  user: User;
  options: SyncAppOptions;
  socket: SyncSocketLike;
}): Promise<string[] | null> => {
  const collection = entry.collectionTag;
  const emitError = (message: string): void => {
    socket.emit("sync:error", {collection, message});
  };
  try {
    return await resolveUserStreamsForEntry({
      entry,
      getUserScopes: options.getUserScopes,
      user,
    });
  } catch (error: unknown) {
    if (error instanceof MissingScopeResolverError) {
      emitError(error.message);
      return null;
    }
    logger.error(`[sync] getUserScopes threw for ${collection}: ${error}`);
    emitError(`Failed to resolve scopes for ${collection}`);
    return null;
  }
};

/**
 * Install the sync socket handlers on a single socket. Wired into RealtimeApp's
 * connection handler alongside `installRealtimeSocketHandlers`.
 *
 * The `_io` server parameter is accepted for signature symmetry with future fan-out
 * needs; the current handlers only act on the connecting socket.
 */
export const installSyncSocketHandlers = (
  _io: Server | null,
  socket: SyncSocketLike,
  options: SyncAppOptions = {},
  handlerOptions: {logInfo?: (msg: string) => void} = {}
): void => {
  const logInfo = handlerOptions.logInfo ?? ((): void => {});
  const userId = socket.decodedToken?.id;

  // D2: re-derive the authorizing user on every event rather than capturing it once
  // at install time — `socket.data.fullUser` is loaded at handshake and refreshed by
  // D1's sweep, so a mutation sent after a refresh (e.g. after `organizationIds`
  // changed) sees the current full user, not a handshake-time snapshot.
  //
  // Task 9.21: awaits the handshake load when it is still in flight, closing the window
  // where an event arriving first was authorized against the synthetic JWT-claim user
  // (no membership fields — tenant scopes resolved to nothing).
  const currentUser = (): Promise<User | undefined> => awaitSocketFullUser(socket);

  // collection tag -> joined sync rooms, for unsubscribe/disconnect cleanup and D4's
  // sweep-time re-resolution. Exposed on socket.data (when present — real sockets
  // always have it; minimal test doubles may not) so the sweep, which runs outside
  // this closure, can read and mutate it directly.
  const subscriptions: Map<string, Set<string>> = socket.data?.syncSubscriptions ?? new Map();
  if (socket.data) {
    socket.data.syncSubscriptions = subscriptions;
  }

  socket.on(
    "sync:subscribe",
    async (payload: {collections?: unknown; mode?: unknown}): Promise<void> => {
      const collections = Array.isArray(payload?.collections) ? payload.collections : null;
      const isWindow = payload?.mode === "window";
      if (!collections) {
        return;
      }
      // C8: reject an oversized array up front (length check before iterating).
      if (collections.length > MAX_SYNC_SUBSCRIBE_ARRAY_LENGTH) {
        logInfo(`[sync] User ${userId} sent an oversized sync:subscribe array`);
        socket.emit("sync:error", {
          collection: "",
          message: `sync:subscribe accepts at most ${MAX_SYNC_SUBSCRIBE_ARRAY_LENGTH} collections`,
        });
        return;
      }
      for (const collection of collections) {
        if (typeof collection !== "string" || collection.length === 0) {
          continue;
        }
        if (subscriptions.has(collection)) {
          // Already subscribed — idempotent.
          continue;
        }
        if (subscriptions.size >= MAX_SYNC_COLLECTION_SUBSCRIPTIONS) {
          logInfo(`[sync] User ${userId} hit sync collection subscription limit`);
          socket.emit("sync:error", {
            collection,
            message: `Sync subscription limit of ${MAX_SYNC_COLLECTION_SUBSCRIPTIONS} collections reached`,
          });
          continue;
        }
        const entry = findSyncEntryByCollectionTag(collection);
        if (!entry) {
          socket.emit("sync:error", {
            collection,
            message: `Unknown sync collection: ${collection}`,
          });
          continue;
        }
        const user = await currentUser();
        if (!user) {
          socket.emit("sync:error", {collection, message: "Authentication required"});
          continue;
        }
        if (!(await checkPermissions("list", entry.options.permissions.list, user))) {
          logInfo(`[sync] User ${userId} denied sync subscription for ${collection}`);
          socket.emit("sync:error", {
            collection,
            message: `Access to sync collection ${collection} denied`,
          });
          continue;
        }
        if (isWindow && entry.config.adminBroadcast !== true) {
          socket.emit("sync:error", {
            collection,
            message: `Window subscribe requires adminBroadcast on ${collection}`,
          });
          continue;
        }
        if (
          isWindow &&
          !(await canUseAdminBroadcastWindow({
            accessControl: options.accessControl,
            canOpenAdminWindow: options.canOpenAdminWindow,
            user,
          }))
        ) {
          logInfo(`[sync] User ${userId} denied window subscribe for ${collection}`);
          socket.emit("sync:error", {
            collection,
            message: `Window subscribe requires admin panel access for ${collection}`,
          });
          continue;
        }
        if (isWindow) {
          const adminScope = getAdminBroadcastScope(entry.modelName);
          if (adminScope && !(await canListAdminBroadcastScope({scope: adminScope, user}))) {
            logInfo(`[sync] User ${userId} denied window subscribe list for ${collection}`);
            socket.emit("sync:error", {
              collection,
              message: `Window subscribe requires admin collection access for ${collection}`,
            });
            continue;
          }
        }
        const streams = isWindow
          ? [adminBroadcastStream(collection)]
          : await resolveUserStreams({entry, options, socket, user});
        if (!streams) {
          continue;
        }
        const rooms = new Set(streams.map(syncRoomForStream));
        for (const room of rooms) {
          await socket.join(room);
        }
        subscriptions.set(collection, rooms);
        socket.emit(
          "sync:subscribed",
          isWindow ? {collection, mode: "window", streams} : {collection, streams}
        );
        logInfo(`[sync] User ${userId} subscribed to ${collection}: ${streams.join(", ")}`);
      }
    }
  );

  socket.on("sync:unsubscribe", async (payload: {collections?: unknown}): Promise<void> => {
    const collections = Array.isArray(payload?.collections) ? payload.collections : null;
    if (!collections) {
      return;
    }
    for (const collection of collections) {
      if (typeof collection !== "string") {
        continue;
      }
      const rooms = subscriptions.get(collection);
      if (!rooms) {
        continue;
      }
      for (const room of rooms) {
        await socket.leave(room);
      }
      subscriptions.delete(collection);
      logInfo(`[sync] User ${userId} unsubscribed from ${collection}`);
    }
  });

  socket.on(
    "sync:mutate",
    async (payload: SyncMutateRequest, ack?: (response: unknown) => void): Promise<void> => {
      const respond = (outcome: SyncMutationOutcome): void => {
        if (outcome.type === "ack") {
          socket.emit("sync:ack", outcome.ack);
        } else {
          socket.emit("sync:nack", outcome.nack);
        }
        if (typeof ack === "function") {
          ack(outcome.type === "ack" ? {ack: outcome.ack} : {nack: outcome.nack});
        }
      };
      const nack = (partial: Omit<SyncNack, "mutationId">): void => {
        respond({
          nack: {
            mutationId: typeof payload?.mutationId === "string" ? payload.mutationId : "",
            ...partial,
          },
          type: "nack",
        });
      };

      const user = await currentUser();
      if (!user) {
        nack({code: "unauthorized", message: "Authentication required"});
        return;
      }

      try {
        // Task 9.20: the rate limit is charged inside the shared runner against this
        // USER's window, so opening more sockets no longer multiplies the budget.
        const {outcome, stage} = await runSyncMutation({
          mutation: payload,
          req: requestFromOrganizationId({
            organizationId: organizationIdFromPayload(payload),
            user,
          }),
          scopeResolver: options.getUserScopes,
          syncOptions: options,
          user,
        });
        if (stage === "rate_limited") {
          logInfo(`[sync] User ${userId} hit the sync:mutate rate limit`);
        }
        respond(outcome);
      } catch (error: unknown) {
        logger.error(`[sync] sync:mutate failed for socket ${socket.id}: ${error}`);
        nack({code: "error", message: "Internal error applying mutation"});
      }
    }
  );

  socket.on(
    "sync:mutateBatch",
    async (payload: SyncMutateBatchRequest, ack?: (response: unknown) => void): Promise<void> => {
      // FIX 5: emit the receipt IMMEDIATELY, before any processing (including
      // rate-limit/auth checks) — this is what lets the client distinguish
      // "no sync:mutateBatch handler at all" (silence past the grace period)
      // from "the server is just slow finishing this batch" (a receipt
      // arrived; the client then waits the full batch timeout instead of
      // falling back to single sends and possibly double-processing).
      if (typeof payload?.batchId === "string" && payload.batchId.length > 0) {
        socket.emit("sync:batchReceived", {batchId: payload.batchId});
      }

      const respondBatch = (response: SyncMutateBatchResponse): void => {
        if (typeof ack === "function") {
          ack(response);
        }
      };
      const singleNackBatch = (partial: Omit<SyncNack, "mutationId">, mutationId = ""): void => {
        respondBatch({results: [{nack: {mutationId, ...partial}, type: "nack"}]});
      };

      const mutations = Array.isArray(payload?.mutations) ? payload.mutations : [];

      const user = await currentUser();
      if (!user) {
        singleNackBatch({code: "unauthorized", message: "Authentication required"});
        return;
      }

      try {
        // Task 9.20: validate -> rate limit -> apply, shared with POST /sync/mutate/batch.
        const {response, stage} = await runSyncBatch({
          mutations,
          req: requestFromOrganizationId({
            organizationId: organizationIdFromPayload(payload),
            user,
          }),
          scopeResolver: options.getUserScopes,
          syncOptions: options,
          user,
        });
        if (stage === "rate_limited") {
          logInfo(`[sync] User ${userId} hit the sync:mutateBatch rate limit`);
        }
        respondBatch(response);
      } catch (error: unknown) {
        logger.error(`[sync] sync:mutateBatch failed for socket ${socket.id}: ${error}`);
        singleNackBatch({code: "error", message: "Internal error applying batch"});
      }
    }
  );

  socket.on("disconnect", () => {
    subscriptions.clear();
  });
};
