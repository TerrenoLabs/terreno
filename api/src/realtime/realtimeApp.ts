import type http from "node:http";
import * as Sentry from "@sentry/bun";
import type express from "express";
import {Server, type Socket} from "socket.io";

import type {UserModel} from "../auth";
import {findBetterAuthProvider, getProvidedBetterAuth} from "../betterAuthApp";
import {APIError} from "../errors";
import {logger} from "../logger";
import {warnOnSyncScopesWithoutUserModel} from "../sync/registry";
import {installSyncSocketHandlers} from "../sync/socketHandlers";
import {getSyncAppOptions} from "../sync/syncApp";
import type {TerrenoApp} from "../terrenoApp";
import type {TerrenoPlugin} from "../terrenoPlugin";
import {startChangeStreamWatcher, stopChangeStreamWatcher} from "./changeStreamWatcher";
import {
  loadFullUserForSocket,
  type SessionRevalidationHandle,
  startSessionRevalidationSweep,
} from "./sessionRevalidation";
import {type BetterAuthSocketOptions, createSocketAuthMiddleware} from "./socketAuth";
import type {SocketDataBag, SocketWithDecodedToken} from "./socketUser";
import type {RealtimeAppOptions} from "./types";

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

/**
 * Install the base socket handlers on a single socket: join the per-user, `authenticated`,
 * and (for admins) `admin` rooms, and log disconnects. Extracted from the RealtimeApp
 * connection handler so it can be unit-tested with a mock socket (no real Socket.io /
 * HTTP server / JWT handshake required).
 *
 * Collection subscriptions go through the sync protocol (`sync:subscribe`), installed
 * separately by `installSyncSocketHandlers`.
 */
export const installRealtimeSocketHandlers = (
  socket: RealtimeSocketLike,
  options: {logInfo?: (msg: string) => void} = {}
): void => {
  const logInfo = options.logInfo ?? ((): void => {});
  const userId = socket.decodedToken?.id;
  const isAdmin = socket.decodedToken?.admin === true;

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

  socket.on("disconnect", () => {
    logInfo(`[realtime] User ${userId} disconnected`);
  });
};

/**
 * TerrenoPlugin that hosts Socket.io and the MongoDB change stream watcher for
 * `@terreno/syncdb`.
 *
 * Attaches a Socket.io server to the HTTP server created by TerrenoApp.start(),
 * sets up JWT and/or Better Auth authentication for socket connections, installs the
 * sync protocol handlers (`sync:subscribe` / `sync:mutate`), and starts a change stream
 * watcher that emits `sync:delta` events for models registered with `sync`.
 *
 * @example
 * ```typescript
 * const app = new TerrenoApp({
 *   userModel: User,
 *   realtime: { debug: true },
 * })
 *   .register(todoRouter)   // todoRouter has a `sync` config
 *   .register(new SyncApp())
 *   .start();
 * ```
 */
export class RealtimeApp implements TerrenoPlugin {
  private app: express.Application | null = null;
  private io: Server | null = null;
  private config: RealtimeAppOptions;
  private sessionRevalidation: SessionRevalidationHandle | null = null;
  private terrenoApp: TerrenoApp | undefined;

  constructor(config: RealtimeAppOptions = {}) {
    this.config = config;
  }

  /**
   * Register routes and middleware. Adds a /realtime/health endpoint.
   */
  register(app: express.Application, _openApi?: unknown, terrenoApp?: TerrenoApp): void {
    this.app = app;
    this.terrenoApp = terrenoApp;
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
   * This RealtimeApp's `userModel`, else the TerrenoApp's, matching what `TerrenoApp({realtime})`
   * passes to the RealtimeApp it registers.
   */
  private resolveUserModel(): UserModel | undefined {
    return this.config.userModel ?? (this.terrenoApp?.getUserModel() as UserModel | undefined);
  }

  /**
   * The Better Auth instance for socket sessions: the explicit `betterAuth` option, else the
   * one from a Better Auth plugin (such as BetterAuthApp) registered on the same TerrenoApp,
   * so apps do not have to build the instance early and pass it to both plugins. The socket
   * validator falls back to the resolved `userModel`, so the handshake and the revalidation
   * sweep resolve the same users.
   */
  private resolveBetterAuth(): BetterAuthSocketOptions | undefined {
    const userModel = this.resolveUserModel();
    if (this.config.betterAuth) {
      return {...this.config.betterAuth, userModel: this.config.betterAuth.userModel ?? userModel};
    }
    const auth = getProvidedBetterAuth(findBetterAuthProvider(this.terrenoApp?.getPlugins() ?? []));
    if (!auth) {
      return undefined;
    }
    return {auth, userModel};
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
      const userModel = this.resolveUserModel();
      const betterAuth = this.resolveBetterAuth();
      if (!tokenSecret && !betterAuth) {
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
          betterAuth,
          issuer: resolveTokenIssuer,
          tokenSecret,
          userModel,
        })
      );

      const authKinds = [tokenSecret ? "JWT" : null, betterAuth ? "Better Auth" : null]
        .filter(Boolean)
        .join(" + ");
      logInfo(`[realtime] Socket auth middleware added (${authKinds})`);

      // Task 9.21: tenant/custom sync scopes can only be resolved from the full user
      // document, so warn loudly here (once, at startup) rather than silently serving
      // empty tenant streams for the life of the process.
      warnOnSyncScopesWithoutUserModel({userModel});

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
            userModel
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
        betterAuth,
        intervalMs: this.config.sessionRevalidationIntervalMs,
        logInfo,
        sync: this.config.sync ?? (this.app ? getSyncAppOptions(this.app) : undefined),
        userModel,
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
