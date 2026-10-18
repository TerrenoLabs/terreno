import type http from "node:http";
import * as Sentry from "@sentry/bun";
import type express from "express";
import {Server, type Socket} from "socket.io";

import type {User} from "../auth";
import {APIError} from "../errors";
import {logger} from "../logger";
import {canSubscribeRealtime} from "../rbac/realtimeAccess";
import {warnOnSyncScopesWithoutUserModel} from "../sync/registry";
import {installSyncSocketHandlers} from "../sync/socketHandlers";
import {getSyncAppOptions} from "../sync/syncApp";
import type {TerrenoPlugin} from "../terrenoPlugin";
import {startChangeStreamWatcher, stopChangeStreamWatcher} from "./changeStreamWatcher";
import {
  addQuerySubscription,
  computeQueryId,
  removeAllSocketQueries,
  removeQuerySubscription,
} from "./queryStore";
import {findRegistryEntryByRoutePath, type RealtimeRegistryEntry} from "./registry";
import {
  loadFullUserForSocket,
  type SessionRevalidationHandle,
  startSessionRevalidationSweep,
} from "./sessionRevalidation";
import {createSocketAuthMiddleware} from "./socketAuth";
import {getSocketUser, type SocketDataBag, type SocketWithDecodedToken} from "./socketUser";
import type {DocumentSubscription, QuerySubscription, RealtimeAppOptions} from "./types";

/**
 * Caps on per-socket subscriptions. Prevents a malicious or buggy client from
 * exhausting server memory by opening unbounded subscriptions.
 */
export const MAX_MODEL_SUBSCRIPTIONS = 50;
export const MAX_DOCUMENT_SUBSCRIPTIONS = 500;
export const MAX_QUERY_SUBSCRIPTIONS = 100;

/**
 * Replace any userinfo (`user:password@`) component in a URL with `***@` so the
 * credentials are not written to logs. Falls back to a regex when the string
 * isn't a valid URL the standard `URL` parser can read.
 *
 * Exported for testing.
 */
/** @internal */
export const redactCredentials = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
      // URL serialization drops the empty userinfo; reinsert a sentinel so logs make it
      // obvious credentials were stripped rather than silently absent from the source URL.
      return parsed.toString().replace(`${parsed.protocol}//`, `${parsed.protocol}//***@`);
    }
    return parsed.toString();
  } catch {
    return url.replace(/^(\w+):\/\/[^@/]*@/, "$1://***@");
  }
};

/**
 * Minimal shape this module requires from a Socket.io socket. Lets tests pass a
 * mock without standing up a real server.
 */
export interface RealtimeSocketLike extends SocketWithDecodedToken {
  id: string;
  join: (room: string) => Promise<void> | void;
  leave: (room: string) => Promise<void> | void;
  emit: (event: string, payload: unknown) => void;
  on: (event: string, handler: (...args: never[]) => void | Promise<void>) => void;
}

const canSubscribe = async (
  entry: RealtimeRegistryEntry,
  method: "list" | "read",
  user?: User
): Promise<boolean> => canSubscribeRealtime(entry, method, user);

const getAuthorizedQuery = async (
  entry: RealtimeRegistryEntry,
  query: Record<string, unknown>,
  user?: User
): Promise<Record<string, unknown> | null> => {
  if (!(await canSubscribe(entry, "list", user))) {
    return null;
  }

  if (!entry.options.queryFilter) {
    return query;
  }

  let filteredQuery: Record<string, unknown> | null;
  try {
    filteredQuery = await entry.options.queryFilter(user, query);
  } catch (error) {
    logger.error(
      `[realtime] queryFilter threw for ${entry.modelName}/list: ${error}. Denying query subscription.`
    );
    Sentry.captureException(error);
    return null;
  }

  if (filteredQuery === null) {
    return null;
  }

  return {...query, ...filteredQuery};
};

/**
 * Install the realtime subscription handlers on a single socket. Extracted from the
 * RealtimeApp connection handler so this logic can be unit-tested with a mock socket
 * (no real Socket.io / HTTP server / JWT handshake required).
 *
 * Enforces:
 *   - per-socket subscription caps (DoS protection)
 *   - registry membership (only realtime-enabled collections can be subscribed)
 *   - owner-strategy isolation (non-admin users cannot subscribe to other users' rooms)
 *   - server-side queryId computation (clients can't hijack queries by colliding ids)
 */
export const installRealtimeSocketHandlers = (
  socket: RealtimeSocketLike,
  options: {logInfo?: (msg: string) => void} = {}
): void => {
  const logInfo = options.logInfo ?? ((): void => {});
  const userId = socket.decodedToken?.id;
  const isAdmin = socket.decodedToken?.admin === true;
  // D2: re-derive per event rather than capturing once at install time, so a
  // handshake-time-loaded full user (or one refreshed by D1's sweep) is always used.
  const currentUser = (): User | undefined => getSocketUser(socket);

  const counts = {document: 0, model: 0, query: 0};

  const joinUserRooms = async (): Promise<void> => {
    if (userId) {
      await socket.join(`user:${userId}`);
      await socket.join("authenticated");
      logInfo(`[realtime] User ${userId} connected`);
    }
    if (isAdmin) {
      await socket.join("admin");
      logInfo(`[realtime] Admin user ${userId} joined admin room`);
    }
  };

  // Fire-and-forget — there is nothing useful for the caller to await.
  void joinUserRooms();

  socket.on("subscribe:model", async (modelName: string): Promise<void> => {
    if (typeof modelName !== "string" || modelName.length === 0) {
      return;
    }
    if (counts.model >= MAX_MODEL_SUBSCRIPTIONS) {
      logInfo(`[realtime] User ${userId} hit model subscription limit`);
      return;
    }

    const entry = findRegistryEntryByRoutePath(modelName);
    if (!entry) {
      logInfo(
        `[realtime] User ${userId} denied model subscription: collection "${modelName}" not registered`
      );
      return;
    }

    // Owner-strategy models fan out via user:{ownerId} — there is no shared model room
    // that should be open to all users. Owners receive events through their user room
    // automatically; admins can use the admin room to see everything.
    if (entry.config.roomStrategy === "owner" && !isAdmin) {
      logInfo(
        `[realtime] User ${userId} denied model subscription for ${modelName}: ` +
          "owner strategy restricts model room to admins"
      );
      return;
    }

    if (!(await canSubscribe(entry, "list", currentUser()))) {
      logInfo(
        `[realtime] User ${userId} denied model subscription for ${modelName}: list permission denied`
      );
      return;
    }

    counts.model += 1;
    await socket.join(`model:${modelName}`);
    logInfo(`[realtime] User ${userId} subscribed to model:${modelName}`);
  });

  socket.on("unsubscribe:model", async (modelName: string): Promise<void> => {
    if (typeof modelName === "string" && modelName.length > 0) {
      await socket.leave(`model:${modelName}`);
      counts.model = Math.max(0, counts.model - 1);
      logInfo(`[realtime] User ${userId} unsubscribed from model:${modelName}`);
    }
  });

  socket.on("subscribe:document", async (payload: DocumentSubscription): Promise<void> => {
    if (
      !payload?.collection ||
      !payload?.id ||
      typeof payload.collection !== "string" ||
      typeof payload.id !== "string"
    ) {
      return;
    }
    if (counts.document >= MAX_DOCUMENT_SUBSCRIPTIONS) {
      logInfo(`[realtime] User ${userId} hit document subscription limit`);
      return;
    }

    const entry = findRegistryEntryByRoutePath(payload.collection);
    if (!entry) {
      logInfo(
        `[realtime] User ${userId} denied document subscription: ` +
          `collection "${payload.collection}" not registered`
      );
      return;
    }

    if (!(await canSubscribe(entry, "read", currentUser()))) {
      logInfo(
        `[realtime] User ${userId} denied document subscription for ` +
          `${payload.collection}/${payload.id}: read permission denied`
      );
      return;
    }

    if (entry.config.roomStrategy === "owner" && !isAdmin) {
      logInfo(
        `[realtime] User ${userId} denied document subscription for ` +
          `${payload.collection}/${payload.id}: owner strategy requires admin`
      );
      return;
    }

    counts.document += 1;
    const room = `document:${payload.collection}:${payload.id}`;
    await socket.join(room);
    logInfo(`[realtime] User ${userId} subscribed to ${room}`);
  });

  socket.on("unsubscribe:document", async (payload: DocumentSubscription): Promise<void> => {
    if (payload?.collection && payload?.id) {
      const room = `document:${payload.collection}:${payload.id}`;
      await socket.leave(room);
      counts.document = Math.max(0, counts.document - 1);
      logInfo(`[realtime] User ${userId} unsubscribed from ${room}`);
    }
  });

  socket.on("subscribe:query", async (payload: QuerySubscription): Promise<void> => {
    if (
      !payload?.collection ||
      !payload?.query ||
      typeof payload.collection !== "string" ||
      typeof payload.query !== "object" ||
      Array.isArray(payload.query)
    ) {
      return;
    }
    if (counts.query >= MAX_QUERY_SUBSCRIPTIONS) {
      logInfo(`[realtime] User ${userId} hit query subscription limit`);
      return;
    }

    const entry = findRegistryEntryByRoutePath(payload.collection);
    if (!entry) {
      logInfo(
        `[realtime] User ${userId} denied query subscription: ` +
          `collection "${payload.collection}" not registered`
      );
      return;
    }

    let query = await getAuthorizedQuery(entry, {...payload.query}, currentUser());
    if (!query) {
      logInfo(
        `[realtime] User ${userId} denied query subscription for ${payload.collection}: ` +
          "list permission or query filter denied"
      );
      return;
    }

    if (entry.config.roomStrategy === "owner" && !isAdmin) {
      if (!userId) {
        return;
      }
      query = {...query, ownerId: userId};
    }

    const queryId = computeQueryId(payload.collection, query);

    addQuerySubscription(socket.id, payload.collection, query, queryId);
    counts.query += 1;
    await socket.join(`query:${queryId}`);
    socket.emit("query:subscribed", {
      clientQueryId: payload.queryId,
      collection: payload.collection,
      queryId,
    });
    logInfo(`[realtime] User ${userId} subscribed to query:${queryId} on ${payload.collection}`);
  });

  socket.on("unsubscribe:query", async (payload: {queryId: string}): Promise<void> => {
    if (payload?.queryId) {
      removeQuerySubscription(socket.id, payload.queryId);
      await socket.leave(`query:${payload.queryId}`);
      counts.query = Math.max(0, counts.query - 1);
      logInfo(`[realtime] User ${userId} unsubscribed from query:${payload.queryId}`);
    }
  });

  socket.on("disconnect", () => {
    removeAllSocketQueries(socket.id);
    logInfo(`[realtime] User ${userId} disconnected`);
  });
};

/**
 * TerrenoPlugin that provides real-time sync via Socket.io and MongoDB change streams.
 *
 * Attaches a Socket.io server to the HTTP server created by TerrenoApp.start(),
 * sets up JWT and/or Better Auth authentication for socket connections, manages room subscriptions
 * (model, document, and query rooms), and starts a change stream watcher that
 * emits events to connected clients.
 *
 * ## Subscription types
 *
 * - **Model rooms**: `subscribe:model` / `unsubscribe:model` — receive all events for a collection
 * - **Document rooms**: `subscribe:document` / `unsubscribe:document` — receive events for a single document
 * - **Query rooms**: `subscribe:query` / `unsubscribe:query` — receive events matching a MongoDB query
 *
 * @example
 * ```typescript
 * const app = new TerrenoApp({
 *   userModel: User,
 *   realtime: { debug: true },
 * })
 *   .register(todoRouter)   // todoRouter has realtime config
 *   .start();
 * ```
 */
export class RealtimeApp implements TerrenoPlugin {
  private app: express.Application | null = null;
  private io: Server | null = null;
  private config: RealtimeAppOptions;
  private sessionRevalidation: SessionRevalidationHandle | null = null;

  constructor(config: RealtimeAppOptions = {}) {
    this.config = config;
  }

  /**
   * Register routes and middleware. Adds a /realtime/health endpoint.
   */
  register(app: express.Application): void {
    this.app = app;
    app.get("/realtime/health", (_req, res) => {
      const connected = this.io?.engine?.clientsCount ?? 0;
      res.json({
        clients: connected,
        debug: this.config.debug ?? false,
        status: this.io ? "running" : "not_started",
      });
    });
  }

  /**
   * Called after the HTTP server is created. Sets up Socket.io, auth, rooms,
   * and starts the change stream watcher.
   */
  onServerCreated(server: http.Server): void {
    const debug = this.config.debug ?? false;

    const logInfo = (message: string): void => {
      if (debug) {
        logger.info(message);
      }
    };

    try {
      logInfo("[realtime] Setting up Socket.io server...");

      // Prefer an injected Server constructor in tests so callers never need
      // process-wide `mock.module("socket.io")` (which poisons later files).
      const SocketServerCtor = this.config.SocketServer ?? Server;
      this.io = new SocketServerCtor(server, {
        cors: this.config.cors ?? {
          methods: ["GET", "POST"],
          origin: "*",
        },
      });

      // Authentication middleware: legacy JWT first when configured, optionally Better Auth sessions.
      const tokenSecret = this.config.tokenSecret ?? process.env.TOKEN_SECRET;
      if (!tokenSecret && !this.config.betterAuth) {
        throw new APIError({
          status: 500,
          title:
            "[realtime] Socket authentication requires TOKEN_SECRET or Better Auth. " +
            "Set process.env.TOKEN_SECRET, pass tokenSecret, or configure betterAuth.",
        });
      }

      // D1: pass the issuer through for parity with the HTTP JWT path
      // (jwt.verify(token, secret, {issuer})) — without it a validly-signed token
      // issued for a different TOKEN_ISSUER was silently accepted over sockets. A
      // thunk (not a value captured once here) so a later change to
      // process.env.TOKEN_ISSUER — or to an explicitly configured tokenIssuer — is
      // honored on every handshake, matching the HTTP path's per-request env read.
      const resolveTokenIssuer = (): string | undefined =>
        this.config.tokenIssuer ?? process.env.TOKEN_ISSUER;

      this.io.use(
        createSocketAuthMiddleware({
          betterAuth: this.config.betterAuth,
          issuer: resolveTokenIssuer,
          tokenSecret,
        })
      );

      const authKinds = [tokenSecret ? "JWT" : null, this.config.betterAuth ? "Better Auth" : null]
        .filter(Boolean)
        .join(" + ");
      logInfo(`[realtime] Socket auth middleware added (${authKinds})`);

      // Task 9.21: tenant/custom sync scopes can only be resolved from the full user
      // document, so warn loudly here (once, at startup) rather than silently serving
      // empty tenant streams for the life of the process.
      warnOnSyncScopesWithoutUserModel({userModel: this.config.userModel});

      // Configure adapter for multi-instance deployments
      this.setupAdapter(logInfo);

      // Connection handling
      this.io.on("connection", (socket: Socket): void => {
        try {
          // D2: load the full user document once at handshake (by the decoded
          // token's id) and cache it on socket.data.fullUser — getSocketUser prefers
          // it over the synthetic {_id, admin, id} shape for every authorization
          // check below. Fire-and-forget: handlers install synchronously and fall
          // back to the synthetic shape until this resolves.
          void loadFullUserForSocket(
            socket as unknown as Socket & {data: SocketDataBag},
            this.config.userModel
          );
          // The auth middleware adds `decodedToken` at runtime; cast through
          // RealtimeSocketLike (a structural subset) to keep socket handler logic testable.
          installRealtimeSocketHandlers(socket as unknown as RealtimeSocketLike, {logInfo});
          // Sync protocol handlers (sync:subscribe / sync:mutate). Options come from the
          // SyncApp registered on this Express app or an explicit `sync` override here;
          // with neither, the handlers still install and reject unknown collections.
          installSyncSocketHandlers(
            this.io,
            socket as unknown as RealtimeSocketLike,
            this.config.sync ?? (this.app ? getSyncAppOptions(this.app) : undefined) ?? {},
            {logInfo}
          );
        } catch (error) {
          logger.error(`[realtime] Error handling connection: ${error}`);
          Sentry.captureException(error);
        }
      });

      this.io.on("connect_error", (error: Error) => {
        logger.error(`[realtime] Connection error: ${error.message}`);
        Sentry.captureException(error);
      });

      // Start the change stream watcher (injectable for unit tests — see SocketServer).
      const startWatcher = this.config.startChangeStreamWatcher ?? startChangeStreamWatcher;
      startWatcher(this.io, this.config.changeStream, debug);

      // D1: periodic session re-validation sweep — disconnects sockets whose JWT has
      // expired, whose Better Auth session is no longer valid, or whose user has
      // since been disabled; also refreshes socket.data.fullUser (D2) and
      // re-resolves sync room membership (D4) for sockets that remain valid.
      // A thunk (not a snapshot) reads this app's SyncApp options fresh on every sweep.
      this.sessionRevalidation = startSessionRevalidationSweep(this.io, () => ({
        betterAuth: this.config.betterAuth,
        intervalMs: this.config.sessionRevalidationIntervalMs,
        logInfo,
        sync: this.config.sync ?? (this.app ? getSyncAppOptions(this.app) : undefined),
        userModel: this.config.userModel,
      }));

      logInfo("[realtime] Socket.io server setup complete");
    } catch (error) {
      logger.error(`[realtime] Failed to set up Socket.io: ${error}`);
      Sentry.captureException(error);
      throw error;
    }
  }

  /**
   * Get the Socket.io server instance.
   */
  getIo(): Server | null {
    return this.io;
  }

  /**
   * Gracefully shut down the real-time server.
   */
  async close(): Promise<void> {
    try {
      this.sessionRevalidation?.stop();
      this.sessionRevalidation = null;
      await stopChangeStreamWatcher();
      if (this.io) {
        await this.io.close();
        this.io = null;
      }
    } catch (error) {
      logger.error(`[realtime] Error closing: ${error}`);
    }
  }

  private setupAdapter(logInfo: (msg: string) => void): void {
    if (!this.io) {
      return;
    }

    const adapter = this.config.adapter ?? "none";

    if (adapter === "redis") {
      const redisUrl = this.config.redisUrl ?? process.env.VALKEY_URL ?? process.env.REDIS_URL;
      if (redisUrl) {
        logInfo(`[realtime] Redis adapter configured with URL: ${redactCredentials(redisUrl)}`);
        // Redis adapter must be configured externally by the consuming app
        // since @socket.io/redis-adapter and ioredis are optional peer dependencies.
        // Use realtimeApp.getIo() to access the Socket.io instance and call
        // io.adapter(createRedisAdapter(pubClient, subClient))
        logger.info(
          "[realtime] To enable Redis adapter, configure it after server creation via getIo(). " +
            "See @socket.io/redis-adapter docs."
        );
      } else {
        logger.warn("[realtime] Redis adapter requested but no VALKEY_URL or REDIS_URL found");
      }
    }
    // 'none' — no adapter, single instance mode
  }
}
