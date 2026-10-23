import {EventEmitter} from "node:events";
import {createServer, type Server as HttpServer} from "node:http";
import * as Sentry from "@sentry/bun";
import cors from "cors";
import express from "express";
import mongoose from "mongoose";
import qs from "qs";
import {AccountSecurityApp} from "./accountSecurity/accountSecurityApp";
import type {AdminChangeEvent, TerrenoAppAdminEvent} from "./adminTypes";
import type {ModelRouterRegistration} from "./api";
import {addAuthRoutes, addMeRoutes, setupAuth, type UserModel as UserMongooseModel} from "./auth";
import {findBetterAuthProvider, getProvidedBetterAuth} from "./betterAuthApp";
import {
  applyJwtPasswordResetToBetterAuth,
  createBetterAuthSessionMiddleware,
} from "./betterAuthSetup";
import {addTerrenoDevBrowserLogsRoute} from "./browserLogsRoute";
import {
  ConfigurationApp,
  type ConfigurationAppOptions,
  type ConfigurationModelLike,
} from "./configurationApp";
import {
  APIError,
  apiErrorMiddleware,
  apiFallthroughErrorMiddleware,
  apiUnauthorizedMiddleware,
} from "./errors";
import {type AddRoutes, type AuthOptions, logRequests} from "./expressServer";
import {addGitHubAuthRoutes, type GitHubAuthOptions, setupGitHubAuth} from "./githubAuth";
import {type LoggingOptions, logger, setupLogging} from "./logger";
import {addMcpOAuthRoutes} from "./mcp/oauth";
import {type McpOAuthAppOption, resolveMcpOAuthOption} from "./mcp/oauthMetadata";
import {mountMCPServer} from "./mcp/server";
import {
  addMcpServiceTokenRoutes,
  type McpServiceTokensAppOption,
  resolveMcpServiceTokensOption,
} from "./mcp/serviceTokens";
import {jsonResponseRequestIdMiddleware} from "./middleware";
import {runStartupMigrations, type StartupMigrationsOption} from "./migrations/runner";
import {openApiCompatMiddleware, patchAppUse} from "./openApiCompat";
import {openApiEtagMiddleware} from "./openApiEtag";
import {OrgsApp, type OrgsAppOptions} from "./orgs/orgsApp";
import {applyRateLimitTrustProxy} from "./rateLimit/applyTrustProxy";
import {createRateLimitStore} from "./rateLimit/createStore";
import {createRateLimitMiddleware} from "./rateLimit/middleware";
import type {RateLimitOptions} from "./rateLimit/types";
import {RealtimeApp} from "./realtime/realtimeApp";
import type {RealtimeAppOptions} from "./realtime/types";
import {
  getCurrentRequestContext,
  requestContextMiddleware,
  updateRequestContextFromRequest,
} from "./requestContext";
import {ensureSyncIndexes} from "./sync/registry";
import type {TerrenoPlugin} from "./terrenoPlugin";
import openapi from "./vendor/wesleytodd-openapi/index";
import {jsonBodyParserOptions, urlencodedBodyParserOptions} from "./webhooks/rawBody";

type CorsOrigin =
  | string
  | boolean
  | RegExp
  | Array<boolean | string | RegExp>
  | ((
      requestOrigin: string | undefined,
      callback: (
        err: Error | null,
        origin?: boolean | string | RegExp | Array<boolean | string | RegExp>
      ) => void
    ) => void);

/**
 * Configuration options for TerrenoApp.
 */
export interface TerrenoAppOptions {
  /** Mongoose User model with passport-local-mongoose plugin */
  userModel: UserMongooseModel;
  /** CORS origin configuration (default: "*") */
  corsOrigin?: CorsOrigin;
  /** Logging configuration options */
  loggingOptions?: LoggingOptions;
  /** Authentication configuration options */
  authOptions?: AuthOptions;
  /** GitHub OAuth configuration (enables GitHub authentication if provided) */
  githubAuth?: GitHubAuthOptions;
  /** Skip calling app.listen() in start() method (useful for testing) */
  skipListen?: boolean;
  /**
   * Already-listening HTTP server. `start()` attaches the Express app to it
   * instead of creating and binding a new server, so Cloud Run can see PORT
   * before MongoDB connect and plugin registration finish.
   */
  httpServer?: HttpServer;
  /** Sentry configuration options */
  sentryOptions?: Sentry.BunOptions;
  /** Maximum number of array items in query parameters (default: 200) */
  arrayLimit?: number;
  /** Whether to log all incoming requests (default: true) */
  logRequests?: boolean;
  /**
   * Real-time sync configuration. When provided, Socket.io and MongoDB change streams
   * are set up automatically — no need to register RealtimeApp as a separate plugin.
   *
   * Set to `true` for defaults, or pass a RealtimeAppOptions object for full control.
   */
  realtime?: boolean | RealtimeAppOptions;
  /**
   * RBAC access controller injected into model routers and `/auth/me` enrichment.
   */
  accessControl?: import("./rbac/types").AnyTerrenoAccess;
  /**
   * Multi-tenant organizations. Default off so existing single-tenant apps stay unchanged.
   * New apps from `terreno_bootstrap_app` pass `true`. Requires `accessControl` from
   * `createAccess({ organizations: true })`. Pass `{ settingsSchema }` to type and
   * validate `Organization.settings`.
   */
  organizations?: boolean | Omit<OrgsAppOptions, "access" | "userModel">;
  /**
   * Runs after CORS and before the `addMiddleware` chain and JSON body parsing.
   * Use to attach early middleware via `app.use(...)` before JSON parsing.
   */
  beforeJsonSetup?: (app: express.Application) => void;
  /**
   * Invoked after registered plugins/model routers and before `/auth/me`.
   * Receives the Express app and OpenAPI bundle for `modelRouter` / `createOpenApiBuilder` wiring.
   */
  configureApp?: AddRoutes;
  /**
   * Optional HTTP rate limiting. Omitted or `undefined` leaves the limiter off
   * (Terreno 58 will default it on). Pass `{}` or `{store, limits, trustProxy}`
   * to enable. See [Rate limiting](../how-to/rate-limiting.md).
   */
  rateLimit?: RateLimitOptions;
  /**
   * Opt-in personal MCP service tokens. `true` is `{enabled: true}`. When enabled,
   * mounts `/mcp/service-tokens` and accepts `Authorization: Bearer mcp_…` on `/mcp`.
   */
  mcpServiceTokens?: McpServiceTokensAppOption;
  /**
   * Opt-in OAuth 2.1 authorization server for `/mcp`, so remote MCP clients (Claude.ai
   * connectors, ChatGPT apps) can connect to a JWT-auth app. Off unless `enabled: true`. Mounts
   * RFC 9728 / RFC 8414 discovery, authorize + consent, token, and revocation endpoints, and makes
   * `/mcp` answer credential-less requests with a 401 challenge. Dynamic client registration is a
   * second opt-in (`dynamicClientRegistration: true`). See
   * [Enable MCP OAuth](../how-to/enable-mcp-oauth.md).
   */
  mcpOAuth?: McpOAuthAppOption;
  /**
   * Versioned MongoDB migrations. `runOnStart` defaults to false. When true, wet `up`
   * runs after listen and `ensureSyncIndexes`. Production still requires
   * `ALLOW_MIGRATIONS=true`.
   */
  migrations?: StartupMigrationsOption;
}

/**
 * Fluent API for building Express applications with Terreno framework.
 *
 * TerrenoApp is the supported way to assemble the Terreno Express stack.
 * Build applications by registering model routers and plugins (and/or
 * `configureApp`), then calling `start()` to listen.
 *
 * The middleware stack is configured in this order:
 * 1. CORS
 * 2. Optional `beforeJsonSetup` (configure the app before JSON parsing)
 * 3. Custom middleware (via addMiddleware)
 * 4. JSON and urlencoded body parsers (stash `req.rawBody`)
 * 5. Auth routes (/auth/login, /auth/signup, etc.)
 * 6. JWT authentication setup
 * 7. Request logging
 * 8. Sentry scopes
 * 9. OpenAPI middleware (including JSON `requestId` on object responses)
 * 10. GitHub OAuth routes (if enabled)
 * 11. Configuration app (if any)
 * 12. Registered model routers and plugins
 * 13. Optional `configureApp` callback
 * 14. /auth/me routes
 * 15. Error handling middleware
 *
 * @example
 * ```typescript
 * // Basic usage with model routers
 * const todoRouter = modelRouter("/todos", Todo, {
 *   permissions: { list: [Permissions.IsAuthenticated], ... },
 * });
 *
 * const app = new TerrenoApp({ userModel: User })
 *   .register(todoRouter)
 *   .register(new HealthApp())
 *   .start();
 * ```
 *
 * @example
 * ```typescript
 * // With custom middleware
 * const app = new TerrenoApp({
 *   userModel: User,
 *   corsOrigin: ["https://app.example.com"],
 *   loggingOptions: { logRequests: true },
 *   githubAuth: {
 *     clientId: process.env.GITHUB_CLIENT_ID!,
 *     clientSecret: process.env.GITHUB_CLIENT_SECRET!,
 *     callbackURL: process.env.GITHUB_CALLBACK_URL!,
 *   },
 * })
 *   .addMiddleware((req, res, next) => {
 *     res.setHeader("X-Custom-Header", "value");
 *     next();
 *   })
 *   .register(todoRouter)
 *   .register(userRouter)
 *   .start();
 * ```
 *
 * @see TerrenoPlugin for creating reusable plugins
 * @see modelRouter for creating CRUD route registrations
 */
export class TerrenoApp {
  private options: TerrenoAppOptions;
  private registrations: (ModelRouterRegistration | TerrenoPlugin)[] = [];
  private middlewareFns: (express.RequestHandler | ((app: express.Application) => void))[] = [];
  private configurationApp: ConfigurationApp | null = null;
  private readonly adminEvents = new EventEmitter();
  private bootPromise: Promise<void> = Promise.resolve();

  /**
   * Create a new TerrenoApp builder.
   *
   * @param options - Application configuration options including user model and auth settings
   */
  constructor(options: TerrenoAppOptions) {
    this.options = options;
    this.adminEvents.setMaxListeners(50);
  }

  /**
   * Register a model router or plugin with the application.
   *
   * Model routers are created with `modelRouter("/path", Model, options)` and
   * provide CRUD endpoints. Plugins implement `TerrenoPlugin` interface and
   * can register custom routes and middleware.
   *
   * Registrations are mounted in the order they are added.
   *
   * @param registration - A ModelRouterRegistration from modelRouter() or a TerrenoPlugin instance
   * @returns This TerrenoApp instance for method chaining
   *
   * @example
   * ```typescript
   * const todoRouter = modelRouter("/todos", Todo, options);
   * const healthPlugin = new HealthApp({ path: "/health" });
   *
   * app.register(todoRouter).register(healthPlugin);
   * ```
   */
  register(registration: ModelRouterRegistration | TerrenoPlugin): this {
    this.registrations.push(registration);
    return this;
  }

  /**
   * Returns registered model routers and plugins in mount order.
   */
  getRegistrations(): readonly (ModelRouterRegistration | TerrenoPlugin)[] {
    return this.registrations;
  }

  /**
   * The RBAC access control passed as `accessControl`, if any.
   */
  getAccessControl(): TerrenoAppOptions["accessControl"] {
    return this.options.accessControl;
  }

  /**
   * The application user model this app authenticates against.
   */
  getUserModel(): TerrenoAppOptions["userModel"] {
    return this.options.userModel;
  }

  /**
   * Returns only TerrenoPlugin registrations (excludes model routers).
   */
  getPlugins(): TerrenoPlugin[] {
    return this.registrations.filter(
      (registration): registration is TerrenoPlugin => !this.isModelRouterRegistration(registration)
    );
  }

  on(event: TerrenoAppAdminEvent, listener: (payload: AdminChangeEvent) => void): this {
    this.adminEvents.on(event, listener);
    return this;
  }

  off(event: TerrenoAppAdminEvent, listener: (payload: AdminChangeEvent) => void): this {
    this.adminEvents.off(event, listener);
    return this;
  }

  /** @internal Emits scrubbed admin model change events from modelRouter hooks. */
  emitAdminModelChanged(payload: AdminChangeEvent): void {
    this.adminEvents.emit("admin:model.changed", payload);
  }

  /**
   * Add custom Express middleware to the application.
   *
   * Middleware is added BEFORE JSON body parsing and authentication setup,
   * allowing you to modify incoming requests early in the middleware stack.
   *
   * @param fn - Express middleware function or a function that configures the app
   * @returns This TerrenoApp instance for method chaining
   *
   * @example
   * ```typescript
   * app.addMiddleware((req, res, next) => {
   *   res.setHeader("X-Request-ID", req.id);
   *   next();
   * });
   * ```
   */
  addMiddleware(fn: express.RequestHandler | ((app: express.Application) => void)): this {
    this.middlewareFns.push(fn);
    return this;
  }

  /**
   * Register a configuration model with the application.
   *
   * Adds configuration management endpoints that expose the model's schema
   * as metadata, and provide GET/PATCH endpoints for reading and updating
   * the singleton configuration document. Nested subschemas become separate
   * sections in the admin UI.
   *
   * All configuration endpoints require admin authentication.
   *
   * @param model - Mongoose model with configurationPlugin applied
   * @param options - Optional configuration (basePath, fieldOverrides)
   * @returns This TerrenoApp instance for method chaining
   *
   * @example
   * ```typescript
   * const app = new TerrenoApp({ userModel: User })
   *   .configure(AppConfig)
   *   .register(todoRouter)
   *   .start();
   * ```
   */
  configure(model: ConfigurationModelLike, options?: Omit<ConfigurationAppOptions, "model">): this {
    this.configurationApp = new ConfigurationApp({model, ...options});
    return this;
  }

  /**
   * Build the Express application without starting the server.
   *
   * Configures the complete middleware stack including:
   * - CORS, JSON parsing, JWT decode, optional HTTP rate limiting, auth routes
   * - Better Auth session (when BetterAuthApp is registered) before the limiter
   * - Logging, Sentry, OpenAPI, model routers and plugins
   * - Error handling middleware
   *
   * Use this method when you need the Express app instance for testing
   * or custom server setup. For normal use, call `start()` instead.
   *
   * @returns Configured Express application instance
   *
   * @example
   * ```typescript
   * const app = new TerrenoApp({ userModel: User })
   *   .register(todoRouter)
   *   .build();
   *
   * // Use app for testing with supertest
   * await request(app).get("/todos").expect(200);
   * ```
   */
  build(): express.Application {
    setupLogging(this.options.loggingOptions);

    const app = express();
    const options = this.options;
    // A BetterAuthApp registered without its own userModel uses the app's, before its Better Auth
    // instance exists, so the app User guard and sync are installed with it.
    findBetterAuthProvider(this.registrations)?.adoptUserModel?.(options.userModel);
    // Resolve first so a misconfigured issuer or consent URL fails at boot.
    const mcpOAuth = resolveMcpOAuthOption(options.mcpOAuth);

    // Record mount paths on layers for Express 5 → OpenAPI compat
    patchAppUse(app);

    app.set("query parser", (str: string) =>
      qs.parse(str, {arrayLimit: options.arrayLimit ?? 200})
    );

    app.use(requestContextMiddleware);

    app.use(cors({credentials: true, origin: options.corsOrigin ?? "*"}));

    if (options.beforeJsonSetup) {
      options.beforeJsonSetup(app);
    }

    // Apply custom middleware before JSON parsing
    for (const fn of this.middlewareFns) {
      if (fn.length <= 3) {
        // express.RequestHandler (req, res, next)
        app.use(fn as express.RequestHandler);
      } else {
        // Function that receives the app
        (fn as (app: express.Application) => void)(app);
      }
    }

    app.use(express.json(jsonBodyParserOptions));
    app.use(express.urlencoded(urlencodedBodyParserOptions) as unknown as express.RequestHandler);

    // JWT decode before rate limiting so authenticated keys use userId.
    // Auth routes mount after the limiter so login is in the auth bucket.
    setupAuth(app, options.userModel);
    app.use((req, res, next) => {
      updateRequestContextFromRequest(req, res);
      next();
    });

    const betterAuthForLimiter = findBetterAuthProvider(this.registrations);
    if (betterAuthForLimiter?.ensureAuth) {
      const auth = betterAuthForLimiter.ensureAuth();
      app.use(createBetterAuthSessionMiddleware(auth, options.userModel));
      betterAuthForLimiter.markSessionMiddlewareMounted?.();
    }

    if (options.rateLimit) {
      const betterAuthBasePath =
        options.rateLimit.betterAuthBasePath ?? betterAuthForLimiter?.getBetterAuthBasePath?.();
      const rateLimit = {
        ...options.rateLimit,
        ...(betterAuthBasePath ? {betterAuthBasePath} : {}),
      };
      applyRateLimitTrustProxy(app, rateLimit);
      const store = createRateLimitStore(rateLimit);
      app.use(createRateLimitMiddleware(store, rateLimit));
    }

    addTerrenoDevBrowserLogsRoute(app);

    if (!options.authOptions) {
      options.authOptions = {};
    }
    const authOptions = options.authOptions;
    addAuthRoutes(app, options.userModel, authOptions);

    if (options.logRequests !== false) {
      app.use(logRequests);
    }

    // Store logging options on the response locals
    app.use((_req, res, next) => {
      res.locals.loggingOptions = options.loggingOptions;
      next();
    });

    // Sentry scopes
    app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const context = getCurrentRequestContext();
      const transactionId = req.header("X-Transaction-ID");
      const sessionId = context?.sessionId ?? req.header("X-Session-ID");
      if (context?.requestId) {
        Sentry.getCurrentScope().setTag("request_id", context.requestId);
      }
      if (transactionId) {
        Sentry.getCurrentScope().setTag("transaction_id", transactionId);
      }
      if (sessionId) {
        Sentry.getCurrentScope().setTag("session_id", sessionId);
      }
      if (req.user?._id) {
        Sentry.getCurrentScope().setTag("user", String(req.user._id));
      }
      next();
    });

    // OpenAPI
    app.use(openApiCompatMiddleware);
    app.use(openApiEtagMiddleware);
    app.use(jsonResponseRequestIdMiddleware);
    const oapi = openapi({
      info: {
        description: "Generated docs from an Express api",
        title: "Express Application",
        version: "1.0.0",
      },
      openapi: "3.0.0",
    });
    app.use(oapi);

    if (process.env.ENABLE_SWAGGER === "true") {
      app.use("/swagger", oapi.swaggerui());
    }

    // GitHub OAuth
    if (options.githubAuth) {
      setupGitHubAuth(app, options.userModel, options.githubAuth);
      addGitHubAuthRoutes(app, options.userModel, options.githubAuth, options.authOptions);
    }

    // Mount configuration app if configured
    if (this.configurationApp) {
      this.configurationApp.register(app);
    }

    // Mount registered model routers and plugins
    for (const registration of this.registrations) {
      if (this.isModelRouterRegistration(registration)) {
        const router = registration._buildWithContext({
          accessControl: options.accessControl,
          openApi: oapi,
          routePath: registration.path,
          terrenoApp: this,
        });
        app.use(registration.path, router);
      } else {
        registration.register(app, oapi, this);
      }
    }

    // Mount MCP at POST /mcp when any model opted in or a custom tool was registered.
    const betterAuth = getProvidedBetterAuth(findBetterAuthProvider(this.registrations));
    if (betterAuth) {
      authOptions.syncPasswordResetToBetterAuth = async (user, password): Promise<void> => {
        await applyJwtPasswordResetToBetterAuth(betterAuth, user, password);
      };
    }
    const mcpServiceTokens = resolveMcpServiceTokensOption(options.mcpServiceTokens);
    if (mcpServiceTokens.enabled) {
      addMcpServiceTokenRoutes(app, {
        openApi: oapi,
        publicMcpUrl: mcpServiceTokens.publicMcpUrl,
      });
    }
    if (mcpOAuth) {
      addMcpOAuthRoutes(app, {oauth: mcpOAuth, openApi: oapi, userModel: options.userModel});
    }
    mountMCPServer(app, {
      betterAuth,
      mcpOAuth,
      mcpServiceTokens: mcpServiceTokens.enabled,
      userModel: options.userModel,
    });

    if (options.configureApp) {
      options.configureApp(app, {openApi: oapi});
    }

    // /auth/me must be registered after plugins so that session middleware
    // (e.g. Better Auth) has a chance to populate req.user first.
    addMeRoutes(app, options.userModel, options.authOptions, options.accessControl);

    Sentry.setupExpressErrorHandler(app);

    // Error middleware
    app.use(apiUnauthorizedMiddleware);
    app.use(apiErrorMiddleware);

    app.use(apiFallthroughErrorMiddleware);

    return app;
  }

  /**
   * Build the Express application and start listening on the configured port.
   *
   * Calls `build()` to configure the application, then starts an HTTP server
   * listening on the port specified by the `PORT` environment variable (default: 9000).
   * If `skipListen` option is true, the app is built but the server is not started.
   *
   * @returns Configured Express application instance
   *
   * @throws Process exits with code 1 if the server fails to start
   *
   * @example
   * ```typescript
   * // Start server on port 3000
   * process.env.PORT = "3000";
   * const app = new TerrenoApp({ userModel: User })
   *   .register(todoRouter)
   *   .start();
   * ```
   */
  start(): express.Application {
    if (this.options.organizations) {
      if (!this.options.accessControl) {
        throw new APIError({
          status: 500,
          title:
            "TerrenoApp organizations requires accessControl from createAccess({ organizations: true })",
        });
      }
      const hasOrgsPlugin = this.registrations.some(
        (registration) =>
          !this.isModelRouterRegistration(registration) && registration instanceof OrgsApp
      );
      if (!hasOrgsPlugin) {
        const orgConfig =
          typeof this.options.organizations === "object" ? this.options.organizations : {};
        // Org-admins get member recovery routes only when the app registered AccountSecurityApp.
        const accountSecurity =
          orgConfig.accountSecurity ??
          this.registrations.find(
            (registration): registration is AccountSecurityApp =>
              !this.isModelRouterRegistration(registration) &&
              registration instanceof AccountSecurityApp
          );
        this.register(
          new OrgsApp({
            ...orgConfig,
            access: this.options.accessControl,
            accountSecurity,
            userModel: this.options.userModel,
          })
        );
      }
    }

    // If realtime option is set, auto-register the RealtimeApp plugin
    if (this.options.realtime) {
      const hasRealtimePlugin = this.registrations.some(
        (r) => !this.isModelRouterRegistration(r) && r instanceof RealtimeApp
      );
      if (!hasRealtimePlugin) {
        const realtimeConfig =
          typeof this.options.realtime === "object" ? this.options.realtime : {};
        this.register(
          new RealtimeApp({
            ...realtimeConfig,
            // Task 9.21 (D2): default the socket full-user load to this app's own user
            // model. Without it socket authorization falls back to the synthetic
            // JWT-claim user, which trusts the token's `admin` over the database and
            // carries no membership fields for tenant-scoped sync.
            userModel: realtimeConfig.userModel ?? (this.options.userModel as never),
          })
        );
      }
    }

    const app = this.build();
    this.bootPromise = this.completeStart(app);
    if (!this.options.skipListen) {
      void this.bootPromise.catch((error: unknown) => {
        const stack = error instanceof Error ? error.stack : String(error);
        logger.error(`Error trying to start HTTP server: ${error}\n${stack}`);
        process.exit(1);
      });
    }
    return app;
  }

  /**
   * Resolves after startup migrations (and listen, unless `skipListen`).
   * Tests with `skipListen` should await this instead of assuming `start()` is idle.
   */
  whenReady(): Promise<void> {
    return this.bootPromise;
  }

  private completeStart = async (app: express.Application): Promise<void> => {
    if (!this.options.skipListen) {
      const port = process.env.PORT || "9000";
      const existingServer = this.options.httpServer;
      const server = existingServer ?? createServer(app);
      if (existingServer) {
        existingServer.removeAllListeners("request");
        existingServer.on("request", app);
      }
      for (const reg of this.registrations) {
        if (!this.isModelRouterRegistration(reg) && typeof reg.onServerCreated === "function") {
          reg.onServerCreated(server);
        }
      }
      // Bind PORT before index/migration work so Cloud Run's startup probe can
      // succeed while `ensureSyncIndexes` still runs. whenReady() still waits.
      if (!existingServer) {
        server.listen(port, () => {
          logger.info(`Listening on port ${port}`);
        });
      } else {
        logger.info(`Listening on port ${port}`);
      }
      await ensureSyncIndexes();
    }
    await runStartupMigrations({
      migrations: this.options.migrations,
      mongoose,
    });
  };

  private isModelRouterRegistration(
    registration: ModelRouterRegistration | TerrenoPlugin
  ): registration is ModelRouterRegistration {
    return (registration as ModelRouterRegistration).__type === "modelRouter";
  }
}
