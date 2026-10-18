# Modular API Implementation Plan

**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1084  
**Status:** Complete

## Overview

This document outlines the implementation plan for a new modular API design in `@terreno/api`. The goal is to create a `TerrenoApp` class that provides a cleaner, more flexible interface for building APIs while maintaining backward compatibility with the existing `setupServer` function.

## Goals

1. **Fluent Builder API**: `const app = TerrenoApp.create({...}).addModelRouter(...).addRoute(...)`
2. **Comprehensive Hooks**: Lifecycle hooks at every stage of server initialization and request handling
3. **Configuration over Environment**: All settings passed via options, not env vars
4. **Toggleable Middleware**: Every default middleware can be enabled/disabled
5. **Health Checks**: Built-in `/health` endpoint with optional custom health check function
6. **Breaking Change**: This replaces `setupServer` - no backward compatibility layer

---

## Architecture

### File Structure

```
api/src/
├── TerrenoApp.ts              # Main TerrenoApp class (NEW)
├── TerrenoAppOptions.ts       # Types and defaults (NEW)
├── TerrenoAppMiddleware.ts    # Built-in middleware configurations (NEW)
├── TerrenoAppHooks.ts         # Hook type definitions and runner (NEW)
├── expressServer.ts           # DEPRECATED - to be removed in future version
├── api.ts                     # Existing - unchanged
└── index.ts                   # Export TerrenoApp, remove setupServer exports
```

### Core Classes

```typescript
// TerrenoApp.ts
class TerrenoApp {
  static create(options: TerrenoAppOptions): TerrenoApp;

  // Fluent configuration
  addModelRouter<T>(path: string, model: Model<T>, options: ModelRouterOptions<T>): this;
  addModelRouter<T>(path: string, model: Model<T>, permissions: RESTPermissions<T>): this;  // Shorthand
  addRoute(path: string, router: Router | AddRoutesCallback, options?: AddRouteOptions): this;
  addMiddleware(middleware: RequestHandler, options?: MiddlewareOptions): this;
  addErrorHandlingMiddleware(middleware: ErrorRequestHandler): this;

  // WebSocket
  enableWebSocket(options?: WebSocketOptions): this;

  // Lifecycle
  build(): Express;  // Returns configured Express app without starting
  start(): Promise<{ app: Express; server: Server; wss?: WebSocketServer }>;  // Build + listen

  // Access
  getExpressApp(): Express;
  getServer(): Server | null;
  getWebSocketServer(): WebSocketServer | null;

  // Shutdown
  shutdown(): Promise<void>;  // Graceful shutdown
}
```

---

## Configuration Options

### TerrenoAppOptions Interface

```typescript
interface TerrenoAppOptions {
  // === Authentication ===
  auth: AuthOptions;

  // === Server ===
  server?: ServerOptions;

  // === Logging ===
  logging?: LoggingOptions;

  // === Middleware ===
  middleware?: MiddlewareOptions;

  // === Health Check ===
  health?: HealthOptions;

  // === OpenAPI / Swagger ===
  openApi?: OpenApiOptions;

  // === Error Handling ===
  errors?: ErrorOptions;

  // === WebSocket ===
  webSocket?: WebSocketOptions;

  // === Graceful Shutdown ===
  shutdown?: ShutdownOptions;

  // === Hooks ===
  hooks?: AppHooks;
}
```

### Detailed Option Types

#### AuthOptions

```typescript
interface AuthOptions {
  // User model for authentication (required)
  userModel: Model<any>;

  // Token configuration (replaces env vars)
  token: {
    issuer: string;                    // TOKEN_ISSUER
    secret: string;                    // TOKEN_SECRET
    expiresIn?: string;                // TOKEN_EXPIRES_IN (default: '1h')
  };

  refreshToken?: {
    secret: string;                    // REFRESH_TOKEN_SECRET
    expiresIn?: string;                // REFRESH_TOKEN_EXPIRES_IN (default: '7d')
  };

  session?: {
    secret: string;                    // SESSION_SECRET
  };

  // Auth scheme customization
  scheme?: 'jwt' | 'custom';

  // Custom token generation (existing authOptions.generateToken)
  generateToken?: (user: any) => TokenPayload;

  // Enable/disable built-in auth routes (/auth/login, /auth/signup, etc.)
  enableAuthRoutes?: boolean;          // default: true

  // Enable/disable /me route
  enableMeRoute?: boolean;             // default: true
}
```

#### ServerOptions

```typescript
interface ServerOptions {
  port?: number;                       // default: 9000
  skipListen?: boolean;                // default: false (for testing)
  trustProxy?: boolean | string;       // Express trust proxy setting
}
```

#### LoggingOptions

```typescript
interface LoggingOptions {
  // Request logging
  requests?: {
    enabled?: boolean;                 // default: true
    maskFields?: string[];             // Fields to mask (default: ['password'])
  };

  // Slow request logging
  slowRequests?: {
    enabled?: boolean;                 // default: false
    readThresholdMs?: number;          // default: 200
    writeThresholdMs?: number;         // default: 500
  };

  // Logger configuration
  logger?: {
    level?: 'debug' | 'info' | 'warn' | 'error';
    format?: 'json' | 'pretty';
  };
}
```

#### MiddlewareOptions

```typescript
interface MiddlewareOptions {
  // CORS
  cors?: {
    enabled?: boolean;                 // default: true
    origin?: string | string[] | RegExp | boolean;
    credentials?: boolean;
  } | false;                           // false to disable

  // JSON body parsing
  json?: {
    enabled?: boolean;                 // default: true
    limit?: string;                    // default: '100kb'
  } | false;

  // Query string parsing
  queryParser?: {
    enabled?: boolean;                 // default: true
    arrayLimit?: number;               // default: 200
  } | false;

  // Helmet security headers
  helmet?: {
    enabled?: boolean;                 // default: false (opt-in)
    options?: HelmetOptions;
  } | false;

  // Rate limiting
  rateLimit?: {
    enabled?: boolean;                 // default: false (opt-in)
    windowMs?: number;
    max?: number;
  } | false;

  // Compression
  compression?: {
    enabled?: boolean;                 // default: false (opt-in)
  } | false;
}
```

#### HealthOptions

```typescript
interface HealthOptions {
  enabled?: boolean;                   // default: true
  path?: string;                       // default: '/health'

  // Optional custom health check function
  // Return { healthy: boolean, details?: any } or throw to indicate unhealthy
  check?: () => Promise<HealthCheckResult> | HealthCheckResult;
}

interface HealthCheckResult {
  healthy: boolean;
  details?: Record<string, any>;
}
```

#### OpenApiOptions

```typescript
interface OpenApiOptions {
  enabled?: boolean;                   // default: true
  path?: string;                       // default: '/openapi.json'

  // Swagger UI
  swagger?: {
    enabled?: boolean;                 // default: false
    path?: string;                     // default: '/swagger'
  };

  // OpenAPI spec metadata
  info?: {
    title?: string;
    version?: string;
    description?: string;
  };
}
```

#### ErrorOptions

```typescript
interface ErrorOptions {
  // Sentry integration
  sentry?: {
    enabled?: boolean;
    dsn?: string;
    environment?: string;
    options?: SentryOptions;
  } | false;

  // Include stack traces in error responses
  includeStackTrace?: boolean;         // default: false (true in dev)
}
```

#### WebSocketOptions

```typescript
interface WebSocketOptions {
  enabled?: boolean;                   // default: false

  // Path for WebSocket upgrades (default: use same server)
  path?: string;                       // e.g., '/ws'

  // Authentication for WebSocket connections
  authenticate?: (request: IncomingMessage) => Promise<any | null> | any | null;

  // Called when a new connection is established
  onConnection?: (ws: WebSocket, user: any | null) => void;

  // Called when a message is received
  onMessage?: (ws: WebSocket, message: Buffer, user: any | null) => void;

  // Called when a connection is closed
  onClose?: (ws: WebSocket, code: number, reason: string, user: any | null) => void;

  // Called on WebSocket error
  onError?: (ws: WebSocket, error: Error, user: any | null) => void;

  // ws library options
  wsOptions?: WebSocketServerOptions;
}
```

#### ShutdownOptions

```typescript
interface ShutdownOptions {
  // Enable automatic SIGTERM/SIGINT handling (default: true)
  handleSignals?: boolean;

  // Timeout for graceful shutdown in ms (default: 30000)
  timeout?: number;

  // Called before shutdown begins
  onShutdown?: () => void | Promise<void>;
}
```

---

## Hooks System

### AppHooks Interface

```typescript
interface AppHooks {
  // === Initialization Hooks ===

  // Called immediately after Express app is created, before any middleware
  onAppCreated?: (app: Express) => void | Promise<void>;

  // Called after core middleware (cors, json, query) but before auth
  onCoreMiddlewareReady?: (app: Express) => void | Promise<void>;

  // Called after auth is configured but before routes
  onAuthReady?: (app: Express) => void | Promise<void>;

  // Called after all routes are registered but before error handlers
  onRoutesReady?: (app: Express) => void | Promise<void>;

  // Called after all middleware and error handlers are set up
  onReady?: (app: Express) => void | Promise<void>;

  // Called after server starts listening
  onListening?: (server: Server, port: number) => void | Promise<void>;

  // Called after WebSocket server is created (if enabled)
  onWebSocketReady?: (wss: WebSocketServer) => void | Promise<void>;

  // === Request Lifecycle Hooks ===

  // Called for every request before any processing
  onRequest?: (req: Request, res: Response) => void | Promise<void>;

  // Called after authentication middleware runs
  onAuthenticated?: (req: Request, res: Response, user: any | null) => void | Promise<void>;

  // Called before sending response
  onResponse?: (req: Request, res: Response, body: any) => void | Promise<void>;

  // Called when an error occurs
  onError?: (error: Error, req: Request, res: Response) => void | Promise<void>;
}
```

### Hook Execution Points

```
┌─────────────────────────────────────────────────────────────────┐
│                    INITIALIZATION PHASE                         │
├─────────────────────────────────────────────────────────────────┤
│  1. Express app created                                         │
│     └── onAppCreated()                                          │
│                                                                 │
│  2. Core middleware: cors, json, queryParser                    │
│     └── onCoreMiddlewareReady()                                 │
│                                                                 │
│  3. Auth: setupAuth(), addAuthRoutes()                          │
│     └── onAuthReady()                                           │
│                                                                 │
│  4. Routes: health, openapi, model routers, custom routes       │
│     └── onRoutesReady()                                         │
│                                                                 │
│  5. Error handling middleware (addErrorHandlingMiddleware)       │
│  6. Built-in error handlers: apiError, fallthrough              │
│     └── onReady()                                               │
│                                                                 │
│  7. Server.listen()                                             │
│     └── onListening()                                           │
│                                                                 │
│  8. WebSocket server created (if enabled)                       │
│     └── onWebSocketReady()                                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     REQUEST PHASE                               │
├─────────────────────────────────────────────────────────────────┤
│  Request arrives                                                │
│     └── onRequest()                                             │
│                                                                 │
│  Authentication runs                                            │
│     └── onAuthenticated()                                       │
│                                                                 │
│  Route handler executes                                         │
│                                                                 │
│  Response sending                                               │
│     └── onResponse()                                            │
│                                                                 │
│  Error (if any)                                                 │
│     └── onError()                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Usage Examples

### Basic Setup

```typescript
import { TerrenoApp } from '@terreno/api';
import { User } from './models/User';

const app = TerrenoApp.create({
  auth: {
    userModel: User,
    token: {
      issuer: 'my-app',
      secret: process.env.TOKEN_SECRET!,
      expiresIn: '2h',
    },
    refreshToken: {
      secret: process.env.REFRESH_TOKEN_SECRET!,
    },
    session: {
      secret: process.env.SESSION_SECRET!,
    },
  },
  server: {
    port: 3000,
  },
});

await app.start();
```

### Adding Model Routers

```typescript
import { TerrenoApp, Permissions, OwnerQueryFilter } from '@terreno/api';
import { User, Post, Comment } from './models';

const app = TerrenoApp.create({ auth: { userModel: User, ... } })
  // Full options
  .addModelRouter('/posts', Post, {
    permissions: {
      create: [Permissions.IsAuthenticated],
      read: [Permissions.IsAny],
      update: [Permissions.IsOwner],
      delete: [Permissions.IsOwner],
      list: [Permissions.IsAny],
    },
    queryFields: ['title', 'authorId'],
    queryFilter: OwnerQueryFilter,
  })
  // Shorthand: just pass permissions object directly
  .addModelRouter('/comments', Comment, {
    create: [Permissions.IsAuthenticated],
    read: [Permissions.IsAny],
    update: [Permissions.IsOwner],
    delete: [Permissions.IsOwner],
    list: [Permissions.IsAny],
  });

await app.start();
```

The shorthand detects when you pass a permissions object directly (has `create`/`read`/`update`/`delete`/`list` keys) vs full ModelRouterOptions (has `permissions` key).

#### Model Router Request Lifecycle

When a request hits a modelRouter endpoint, processing follows this order:

```
1. Express middleware (cors, json, helmet, etc.)
2. Authentication middleware (JWT verification → req.user)
3. onRequest hook fires
4. onAuthenticated hook fires (if user was authenticated)
5. Permission check (e.g., IsAuthenticated, IsOwner)
   └── If denied → 403 response, skip remaining steps
6. Query filter applied (e.g., OwnerQueryFilter adds { ownerId: req.user.id } to list queries)
7. Route handler executes (create/read/update/delete/list)
   └── For list: queryFields restrict which fields can be filtered via query params
   └── For update/delete: document is fetched first, then permissions (e.g., IsOwner) are checked against it
8. onResponse hook fires
9. Response sent
```

The `queryFilter` runs **after** authentication but **before** the database query, so it has access to `req.user` and can scope queries accordingly. This is useful for multi-tenant apps where users should only see their own data.

### Adding Custom Routes

```typescript
const app = TerrenoApp.create({ ... })
  // Add route with a router
  .addRoute('/webhooks', webhookRouter)

  // Add route with a callback function
  .addRoute('/custom', (router) => {
    router.get('/ping', (req, res) => res.json({ pong: true }));
    router.post('/echo', (req, res) => res.json(req.body));
  })

  // Add route with OpenAPI spec (merged into generated /openapi.json)
  .addRoute('/custom', (router) => {
    router.get('/ping', (req, res) => res.json({ pong: true }));
  }, {
    openapi: {
      '/ping': {
        get: {
          summary: 'Ping endpoint',
          responses: { '200': { description: 'Pong response' } },
        },
      },
    },
  })

  // Mount at root
  .addRoute('/', (router) => {
    router.get('/version', (req, res) => res.json({ version: '1.0.0' }));
  });
```

### Configuring Middleware

```typescript
const app = TerrenoApp.create({
  auth: { ... },
  middleware: {
    cors: {
      enabled: true,
      origin: ['https://myapp.com', 'https://admin.myapp.com'],
      credentials: true,
    },
    json: {
      limit: '10mb',
    },
    helmet: {
      enabled: true,
    },
    rateLimit: {
      enabled: true,
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100,
    },
  },
});
```

### Custom Health Check

```typescript
const app = TerrenoApp.create({
  auth: { ... },
  health: {
    enabled: true,
    path: '/health',
    check: async () => {
      const dbConnected = mongoose.connection.readyState === 1;
      const redisConnected = await redis.ping().catch(() => false);

      return {
        healthy: dbConnected && redisConnected,
        details: {
          database: dbConnected ? 'connected' : 'disconnected',
          redis: redisConnected ? 'connected' : 'disconnected',
          uptime: process.uptime(),
        },
      };
    },
  },
});
```

### Using Hooks

```typescript
const app = TerrenoApp.create({
  auth: { ... },
  hooks: {
    onAppCreated: (app) => {
      console.log('Express app created');
    },

    onAuthReady: (app) => {
      // Add custom auth middleware after built-in auth
      app.use('/admin', adminAuthMiddleware);
    },

    onRoutesReady: (app) => {
      // Add routes that need to come after model routers
      app.use('/analytics', analyticsRouter);
    },

    onReady: (app) => {
      console.log('App fully configured');
    },

    onListening: (server, port) => {
      console.log(`Server listening on port ${port}`);
    },

    onRequest: (req, res) => {
      req.startTime = Date.now();
    },

    onError: (error, req, res) => {
      // Custom error tracking
      errorTracker.capture(error, { url: req.url, user: req.user?.id });
    },

    onShutdown: async () => {
      await mongoose.disconnect();
      await redis.quit();
    },
  },
});
```

### Adding Custom Middleware

```typescript
const app = TerrenoApp.create({ ... })
  // Add middleware that runs for all routes
  .addMiddleware(requestIdMiddleware)

  // Add middleware with options
  .addMiddleware(customMiddleware, {
    path: '/api',           // Only apply to /api routes
    position: 'afterAuth',  // Insert after auth middleware
  });
```

### Adding Error Handling Middleware

Error handling middleware (4-argument Express handlers) must be mounted **after** all routes. Use `addErrorHandlingMiddleware()` for integrations like Sentry that require this ordering:

```typescript
import * as Sentry from '@sentry/node';

const app = TerrenoApp.create({ ... })
  .addModelRouter('/posts', Post, { ... })
  .addRoute('/webhooks', webhookRouter)

  // Mounted after all routes but before TerrenoApp's built-in error handler
  .addErrorHandlingMiddleware(Sentry.setupExpressErrorHandler)

  // Can add multiple — they run in order
  .addErrorHandlingMiddleware((err, req, res, next) => {
    // Custom error logging
    logger.error('Unhandled error', { error: err, url: req.url });
    next(err);
  });
```

During `build()`, the ordering is:
1. Built-in middleware (cors, json, helmet, etc.)
2. Custom middleware via `addMiddleware()`
3. Auth middleware
4. Routes (model routers + custom routes)
5. **Error handling middleware via `addErrorHandlingMiddleware()`** ← inserted here
6. TerrenoApp's built-in error handler (APIError formatting, stack traces)

### WebSocket Support

```typescript
const app = TerrenoApp.create({
  auth: { ... },
  webSocket: {
    enabled: true,
    path: '/ws',

    // Authenticate WebSocket connections using the same JWT system
    authenticate: async (request) => {
      const token = new URL(request.url!, 'http://localhost').searchParams.get('token');
      if (!token) return null;
      return verifyToken(token);  // Returns user or null
    },

    onConnection: (ws, user) => {
      console.log(`User ${user?.id ?? 'anonymous'} connected`);
      ws.send(JSON.stringify({ type: 'welcome', userId: user?.id }));
    },

    onMessage: (ws, message, user) => {
      const data = JSON.parse(message.toString());
      // Handle message...
    },

    onClose: (ws, code, reason, user) => {
      console.log(`User ${user?.id} disconnected: ${code}`);
    },
  },
  hooks: {
    onWebSocketReady: (wss) => {
      // Access the raw WebSocket server for advanced use cases
      console.log('WebSocket server ready');
    },
  },
});

const { app, server, wss } = await app.start();

// Broadcast to all connected clients
wss.clients.forEach((client) => {
  client.send(JSON.stringify({ type: 'broadcast', data: 'Hello everyone!' }));
});
```

### Graceful Shutdown

```typescript
const app = TerrenoApp.create({
  auth: { ... },
  shutdown: {
    handleSignals: true,       // Auto-handle SIGTERM/SIGINT (default: true)
    timeout: 30000,            // 30 second timeout for graceful shutdown

    onShutdown: async () => {
      // Cleanup before shutdown
      await mongoose.disconnect();
      await redis.quit();
      await closeSomeConnections();
    },
  },
});

await app.start();

// Can also trigger shutdown programmatically
process.on('custom-shutdown-event', async () => {
  await app.shutdown();
});
```

When `handleSignals` is true (default), TerrenoApp will:
1. Stop accepting new connections
2. Wait for existing requests to complete (up to `timeout`)
3. Close WebSocket connections gracefully
4. Call `onShutdown` hook
5. Exit process

### Disabling Features

```typescript
const app = TerrenoApp.create({
  auth: {
    userModel: User,
    token: { ... },
    enableAuthRoutes: false,  // Don't add /auth/* routes
    enableMeRoute: false,     // Don't add /me route
  },
  middleware: {
    cors: false,              // Disable CORS entirely
  },
  logging: {
    requests: {
      enabled: false,         // Disable request logging
    },
  },
  openApi: {
    enabled: false,           // Disable OpenAPI generation
  },
  health: {
    enabled: false,           // Disable health endpoint
  },
});
```

### Testing Setup

```typescript
// In tests
const app = TerrenoApp.create({
  auth: { ... },
  server: {
    skipListen: true,  // Don't start HTTP server
  },
  logging: {
    requests: { enabled: false },
  },
});

const expressApp = app.build();  // Get Express app without listening
// Use with supertest
```

---

## Implementation Tasks

### Phase 1: Core Implementation

Implement TerrenoApp with full test coverage. Each feature should be tested as it's built.

**New Files:**
- `TerrenoAppOptions.ts` - Option interfaces, defaults, and validation
- `TerrenoAppHooks.ts` - Hook type definitions and async runner
- `TerrenoApp.ts` - Main class with fluent API

**Features to implement (with tests):**
- `create()`, `build()`, `start()` lifecycle
- `addModelRouter()` with shorthand support
- `addRoute()` and `addMiddleware()`
- All toggleable middleware (cors, json, helmet, etc.)
- Health endpoint with custom check function
- All initialization and request lifecycle hooks
- WebSocket support with authentication
- Graceful shutdown with signal handling

**Update example-backend** to demonstrate the new API.

### Phase 2: Deprecation & Documentation

- Add `@deprecated` JSDoc to `setupServer` and related exports in `expressServer.ts`
- Update `index.ts` to export TerrenoApp as primary API
- Keep setupServer export with deprecation warning
- Write migration guide for users

---

## Breaking Changes

This is a **breaking change** release. Users must migrate from `setupServer` to `TerrenoApp`.

### What's Changing

1. **`setupServer` deprecated** - Marked deprecated, will be removed in next major version
2. **Environment variables no longer used** - All configuration via options (no fallback to env vars)
3. **`modelRouter` unchanged** - Same signature and options, works with TerrenoApp
4. **New primary API** - `TerrenoApp.create()` replaces `setupServer()`
