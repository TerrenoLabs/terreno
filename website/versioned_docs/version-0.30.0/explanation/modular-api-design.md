# Modular API Design

**Status**: 🚧 Planned for v2.0.0

## The Problem

As Terreno has grown, the `setupServer()` function has become increasingly difficult to extend and customize. When setting up new backends, several pain points emerge:

1. **Configuration scattered across environment variables and options** — Some settings come from env vars (tokens, secrets), others from the options object, making it unclear what needs to be configured

2. **All-or-nothing middleware** — Built-in middleware (CORS, body parsing, auth) can't be disabled or customized without editing the framework code

3. **Limited extensibility** — Adding features like an admin panel requires touching multiple places in the middleware stack, making installation instructions tedious and error-prone

4. **No lifecycle hooks** — Can't inject custom logic at precise points in server initialization or request handling

5. **Rigid architecture** — Hard to build modular "apps" (like Django apps) that can be installed with a single call

## The Solution: TerrenoApp

The new `TerrenoApp` class addresses these issues with a **fluent builder API** inspired by Django and modern Node.js frameworks:

``````typescript
const app = TerrenoApp.create({
  auth: {
    userModel: User,
    token: {secret: process.env.TOKEN_SECRET!, issuer: "myapp"},
  },
  middleware: {
    cors: {enabled: true, origin: ["https://myapp.com"]},
    helmet: {enabled: true},
    rateLimit: {enabled: true, max: 100},
  },
  health: {
    enabled: true,
    check: async () => ({healthy: true, uptime: process.uptime()}),
  },
})
  .addModelRouter("/todos", Todo, {list: [IsAuthenticated]})
  .addRoute("/webhooks", webhookRouter)
  .enableWebSocket({path: "/ws"})
  .start();
``````

### Key Improvements

#### 1. Configuration over Environment Variables

All settings are explicit options, not env vars. This makes configuration:
- **Discoverable**: TypeScript autocomplete shows all available options
- **Testable**: Easy to swap configurations between environments
- **Documented**: JSDoc on each option explains its purpose

Environment variables can still be used, but they're passed in explicitly:

``````typescript
auth: {
  token: {
    secret: process.env.TOKEN_SECRET!,  // Explicit, not implicit
    issuer: process.env.TOKEN_ISSUER!,
  },
}
``````

#### 2. Toggleable Middleware

Every piece of built-in middleware can be enabled, disabled, or customized:

``````typescript
middleware: {
  cors: false,                    // Disable entirely
  json: {limit: "10mb"},          // Customize
  helmet: {enabled: true},        // Enable with defaults
  rateLimit: {                    // Enable with custom config
    windowMs: 15 * 60 * 1000,
    max: 100,
  },
}
``````

#### 3. Comprehensive Hooks

Hooks allow custom logic at every stage:

``````typescript
hooks: {
  onAppCreated: (app) => {
    // Just after Express app created
  },
  onAuthReady: (app) => {
    // After auth middleware configured, before routes
  },
  onRoutesReady: (app) => {
    // After all routes added, before error handlers
  },
  onReady: (app) => {
    // App fully configured, before listening
  },
  onListening: (server, port) => {
    // Server started
  },
  onRequest: (req, res) => {
    // On every incoming request
  },
  onError: (error, req, res) => {
    // On every error
  },
  onShutdown: async () => {
    // On graceful shutdown
  },
}
``````

These hooks enable advanced use cases like:
- Custom admin-only auth checks inserted after built-in auth
- Request-level metrics and tracing
- Cleanup tasks on shutdown (close DB connections, flush logs)

#### 4. Fluent API

Instead of a single large options object, configuration happens through chained method calls:

``````typescript
TerrenoApp.create({auth, middleware})
  .addModelRouter("/users", User, permissions)
  .addModelRouter("/posts", Post, permissions)
  .addRoute("/webhooks", webhookRouter)
  .addMiddleware(customMiddleware, {path: "/admin"})
  .enableWebSocket({path: "/ws"})
  .start();
``````

This is:
- **More readable**: Each line is a clear intent
- **More flexible**: Add routes and middleware in any order
- **Easier to extend**: New methods can be added without breaking existing code

#### 5. Foundation for Modular Apps

The new architecture enables installable "apps" (like Django's app system):

``````typescript
import {adminApp} from "@terreno/admin";

TerrenoApp.create({auth})
  .install(adminApp({
    models: [User, Post, Todo],
    permissions: [IsAdmin],
  }))
  .start();
``````

This would be nearly impossible with `setupServer()` because installing an app requires:
- Adding routes at a specific point in the stack
- Registering middleware
- Adding hooks for initialization
- Merging OpenAPI specs

With TerrenoApp, an "app" is just a function that receives the `TerrenoApp` instance and calls its methods.

## Design Principles

### 1. Explicit over Implicit

Settings are passed in, not read from global state (env vars). This makes dependencies clear and testing easier.

### 2. Composable over Monolithic

Features are added via method calls, not configured via a mega-options object. This allows fine-grained control.

### 3. Progressive Disclosure

Simple cases are simple:

``````typescript
TerrenoApp.create({auth: {userModel: User, token: {...}}})
  .addModelRouter("/todos", Todo, {list: [IsAuthenticated]})
  .start();
``````

Complex cases are possible:

``````typescript
TerrenoApp.create({auth, middleware, health, logging, hooks})
  .addModelRouter("/todos", Todo, {...})
  .addRoute("/webhooks", webhookRouter, {openapi: {...}})
  .addMiddleware(customMiddleware, {position: "afterAuth"})
  .addErrorHandlingMiddleware(sentryErrorHandler)
  .enableWebSocket({path: "/ws", authenticate, onConnection, onMessage})
  .start();
``````

### 4. Backward Compatibility (Initially)

The implementation plan originally aimed for backward compatibility with `setupServer()`, but the final design makes this a **breaking change**. This is intentional:

- Allows cleaner architecture without maintaining two code paths
- Forces migration to better patterns
- Provides opportunity to fix long-standing API warts

Migration will be supported with:
- Detailed migration guide
- Deprecation warnings in v2.0.0-beta
- `setupServer()` available but deprecated in v2.0.0
- Removal in v3.0.0, giving users time to migrate

## Implementation Status

**Current**: Planning phase (implementation plan merged)

**Next steps**:
1. ✅ Write implementation plan
2. ✅ Gather community feedback
3. 🚧 Implement core TerrenoApp class with tests
4. 🚧 Update example-backend to demonstrate new API
5. 🚧 Write migration guide with real examples
6. 🚧 Publish v2.0.0-beta for testing
7. 🚧 Address feedback and publish v2.0.0

## Learn More

- 📖 [Implementation plan](../implementationPlans/ModularAPI.md) — Full technical specification
- 💬 [GitHub PR #149](https://github.com/TerrenoLabs/terreno/pull/149) — Discussion and feedback

## Related

- [Configuration system](configuration-system.md) — Runtime configuration with database persistence
- [Authentication architecture](authentication.md) — How JWT and OAuth work in Terreno
