import {DateTime} from "luxon";
import type {Server, Socket} from "socket.io";

import type {TerrenoUserModel} from "../auth";
import {logger} from "../logger";
import {findOneOrNoneFor} from "../plugins";
import {findSyncEntryByCollectionTag} from "../sync/registry";
import type {SyncAppOptions} from "../sync/routes";
import {syncRoomForStream} from "../sync/socketHandlers";
import {streamForScopeValue} from "../sync/streams";
import type {BetterAuthSocketOptions} from "./socketAuth";
import {getSocketUser, type SocketDataBag, type SocketWithDecodedToken} from "./socketUser";

/**
 * Default interval for the periodic socket session re-validation sweep (D1): 60
 * seconds. Sockets authenticate once at handshake; without a sweep, a revoked
 * session, an expired token, or a user subsequently disabled keeps streaming deltas
 * (including PHI) indefinitely.
 */
export const DEFAULT_SESSION_REVALIDATION_INTERVAL_MS = 60_000;

/** Minimal socket shape the sweep needs. Lets tests drive it with a mock. */
export interface RevalidatableSocket extends SocketWithDecodedToken {
  id: string;
  encodedToken?: string;
  data?: SocketDataBag;
  emit: (event: string, payload?: unknown) => void;
  disconnect: (close?: boolean) => void;
  join: (room: string) => Promise<void> | void;
  leave: (room: string) => Promise<void> | void;
}

export interface SessionRevalidationOptions {
  /** Application user model, for reloading the full user and its `disabled` flag. */
  userModel?: TerrenoUserModel;
  /** Enables re-validating Better Auth-authenticated sockets. */
  betterAuth?: BetterAuthSocketOptions;
  /** Active SyncAppOptions (for `getUserScopes`), used by D4's room re-resolution. */
  sync?: SyncAppOptions;
  logInfo?: (message: string) => void;
}

/** Result of re-validating a single socket, for tests/observability. */
export type RevalidationOutcome = "valid" | "expired" | "disabled" | "invalid-session";

/**
 * Re-run the cheap parts of the auth validator for an already-connected socket:
 * - JWT sockets (`decodedToken.authKind === "jwt"`): verify `exp` locally (no
 *   signature re-check — a stolen-but-still-valid token is not this sweep's job;
 *   revocation-by-expiry and disablement are).
 * - Better Auth sockets (`decodedToken.authKind === "better-auth"`): re-run
 *   `auth.api.getSession` for the retained session token.
 * Also reloads the user's `disabled` flag (and the full user document, refreshing
 * `socket.data.fullUser` for D2) when a `userModel` is configured.
 */
export const revalidateSocketSession = async (
  socket: RevalidatableSocket,
  options: SessionRevalidationOptions
): Promise<RevalidationOutcome> => {
  const {authKind, id: userId, exp} = socket.decodedToken ?? {};

  if (authKind === "jwt") {
    if (typeof exp === "number" && exp <= DateTime.now().toSeconds()) {
      return "expired";
    }
  } else if (authKind === "better-auth") {
    if (!options.betterAuth || !socket.encodedToken) {
      return "invalid-session";
    }
    const session = await options.betterAuth.auth.api.getSession({
      headers: {authorization: `Bearer ${socket.encodedToken}`} as Record<string, string>,
    });
    if (!session?.user?.id) {
      return "invalid-session";
    }
  }

  if (options.userModel && userId) {
    const fullUser = await findOneOrNoneFor(options.userModel, {_id: userId});
    if (!fullUser) {
      return "invalid-session";
    }
    if ((fullUser as unknown as {disabled?: boolean}).disabled === true) {
      return "disabled";
    }
    // D2: refresh the cached full user so subsequent authorization checks (and the
    // next sweep tick's stream re-resolution below) see current fields — e.g. a
    // membership change to `organizationIds` takes effect without a reconnect.
    if (socket.data) {
      socket.data.fullUser = fullUser;
    }
  }

  return "valid";
};

/**
 * D4: re-resolve the streams the socket's user currently belongs to for every
 * subscribed collection, and `socket.leave()` any previously-joined sync room the
 * user no longer holds (e.g. a revoked organization membership). Joins any newly
 * granted rooms too, mirroring what a fresh `sync:subscribe` would do, so a
 * membership grant also takes effect without a reconnect.
 */
export const reresolveSyncRoomsForSocket = async (
  socket: RevalidatableSocket,
  options: SessionRevalidationOptions
): Promise<void> => {
  const subscriptions = socket.data?.syncSubscriptions;
  if (!subscriptions || subscriptions.size === 0) {
    return;
  }
  const user = getSocketUser(socket);
  if (!user) {
    return;
  }

  for (const [collection, currentRooms] of subscriptions) {
    const entry = findSyncEntryByCollectionTag(collection);
    if (!entry) {
      continue;
    }
    const {scope} = entry.config;
    let streams: string[];
    if (typeof scope !== "function" && scope.type === "broadcast") {
      streams = [streamForScopeValue({collectionTag: collection, scope, scopeValue: null})];
    } else if (typeof scope !== "function" && scope.type === "owner") {
      streams = [streamForScopeValue({collectionTag: collection, scope, scopeValue: user.id})];
    } else if (options.sync?.getUserScopes) {
      let scopeValues: string[];
      try {
        scopeValues = await options.sync.getUserScopes(user, entry);
      } catch (error: unknown) {
        logger.error(`[realtime] getUserScopes threw during session revalidation: ${error}`);
        continue;
      }
      streams = scopeValues.map((scopeValue) =>
        streamForScopeValue({collectionTag: collection, scope, scopeValue})
      );
    } else {
      continue;
    }

    const nextRooms = new Set(streams.map(syncRoomForStream));
    for (const room of currentRooms) {
      if (!nextRooms.has(room)) {
        await socket.leave(room);
      }
    }
    for (const room of nextRooms) {
      if (!currentRooms.has(room)) {
        await socket.join(room);
      }
    }
    subscriptions.set(collection, nextRooms);
  }
};

/**
 * Run one sweep pass over every connected socket: re-validate the session (D1),
 * disconnecting (`sync:auth-expired` then `disconnect(true)`) any socket that fails,
 * and re-resolve sync room membership (D4) for sockets that remain valid.
 */
export const runSessionRevalidationSweep = async (
  io: Server,
  options: SessionRevalidationOptions = {}
): Promise<void> => {
  const logInfo = options.logInfo ?? ((): void => {});
  const sockets = [...io.sockets.sockets.values()] as unknown as RevalidatableSocket[];

  await Promise.all(
    sockets.map(async (socket) => {
      try {
        const outcome = await revalidateSocketSession(socket, options);
        if (outcome !== "valid") {
          logInfo(
            `[realtime] Session revalidation sweep disconnecting socket ${socket.id}: ${outcome}`
          );
          socket.emit("sync:auth-expired", {reason: outcome});
          socket.disconnect(true);
          return;
        }
        await reresolveSyncRoomsForSocket(socket, options);
      } catch (error: unknown) {
        logger.error(
          `[realtime] Session revalidation sweep failed for socket ${socket.id}: ${error}`
        );
      }
    })
  );
};

/** Handle returned by {@link startSessionRevalidationSweep}; call to stop the timer. */
export type SessionRevalidationHandle = {stop: () => void};

/**
 * Start the periodic sweep (D1). Returns a handle to stop it (called from
 * `RealtimeApp.close()`). A `intervalMs` of 0 disables the sweep (useful for tests
 * that don't want a background timer).
 *
 * `options` may be a plain object or a thunk resolved fresh on EVERY tick — pass a
 * thunk when any field (notably `sync`, whose `getUserScopes` resolver is published
 * by the `SyncApp` plugin and may not be registered yet, or may change, at the time
 * `RealtimeApp.onServerCreated()` runs) must never go stale for the lifetime of the
 * sweep, mirroring the per-handshake freshness `createLegacyJwtValidator`'s issuer
 * thunk already provides.
 */
export const startSessionRevalidationSweep = (
  io: Server,
  optionsOrThunk:
    | (SessionRevalidationOptions & {intervalMs?: number})
    | (() => SessionRevalidationOptions & {intervalMs?: number}) = {}
): SessionRevalidationHandle => {
  const resolveOptions = (): SessionRevalidationOptions & {intervalMs?: number} =>
    typeof optionsOrThunk === "function" ? optionsOrThunk() : optionsOrThunk;
  const intervalMs = resolveOptions().intervalMs ?? DEFAULT_SESSION_REVALIDATION_INTERVAL_MS;
  if (intervalMs <= 0) {
    return {stop: (): void => {}};
  }
  const timer = setInterval(() => {
    void runSessionRevalidationSweep(io, resolveOptions()).catch((error: unknown) => {
      logger.error(`[realtime] Session revalidation sweep tick failed: ${error}`);
    });
  }, intervalMs);
  return {
    stop: (): void => {
      clearInterval(timer);
    },
  };
};

/**
 * Load the full user document for a just-authenticated socket and cache it on
 * `socket.data.fullUser` (D2). Called once at handshake, right after the auth
 * middleware succeeds; the periodic sweep (D1) refreshes it afterwards. A no-op when
 * no `userModel` is configured (falls back to the synthetic decoded-token shape via
 * `getSocketUser`) or the decoded token carries no id (should not happen for a
 * socket that passed auth, but guarded defensively).
 */
export const loadFullUserForSocket = (
  socket: Socket & {data: SocketDataBag},
  userModel?: TerrenoUserModel
): Promise<void> => {
  const load = loadFullUserIntoSocketData(socket, userModel);
  // Task 9.21: publish the in-flight load so the sync handlers can await it. An event that
  // arrived inside the handshake window would otherwise be authorized against the synthetic
  // JWT-claim user — no `organizationIds`, so a tenant `sync:subscribe` resolved to no
  // streams and the client sat connected but never received data.
  if (socket.data) {
    socket.data.fullUserLoad = load;
  }
  return load;
};

/** The actual load; separated so {@link loadFullUserForSocket} can publish the promise. */
const loadFullUserIntoSocketData = async (
  socket: Socket & {data: SocketDataBag},
  userModel?: TerrenoUserModel
): Promise<void> => {
  const userId = (socket as unknown as SocketWithDecodedToken).decodedToken?.id;
  if (!userModel || !userId) {
    return;
  }
  try {
    const fullUser = await findOneOrNoneFor(userModel, {_id: userId});
    if (fullUser) {
      socket.data.fullUser = fullUser;
    }
  } catch (error: unknown) {
    logger.error(
      `[realtime] Failed to load full user at handshake for socket ${socket.id}: ${error}`
    );
  }
};
