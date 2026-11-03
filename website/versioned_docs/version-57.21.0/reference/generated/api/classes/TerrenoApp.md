Fluent API for building Express applications with Terreno framework.

TerrenoApp is the supported way to assemble the Terreno Express stack.
Build applications by registering model routers and plugins (and/or
`configureApp`), then calling `start()` to listen.

The middleware stack is configured in this order:
1. CORS
2. Optional `beforeJsonSetup` (configure the app before JSON parsing)
3. Custom middleware (via addMiddleware)
4. JSON and urlencoded body parsers (stash `req.rawBody`)
5. Auth routes (/auth/login, /auth/signup, etc.)
6. JWT authentication setup
7. Request logging
8. Sentry scopes
9. OpenAPI middleware (including JSON `requestId` on object responses)
10. GitHub OAuth routes (if enabled)
11. Configuration app (if any)
12. Registered model routers and plugins
13. Optional `configureApp` callback
14. /auth/me routes
15. Error handling middleware

## Examples

```typescript
// Basic usage with model routers
const todoRouter = modelRouter("/todos", Todo, {
  permissions: { list: [Permissions.IsAuthenticated], ... },
});

const app = new TerrenoApp({ userModel: User })
  .register(todoRouter)
  .register(new HealthApp())
  .start();
```

```typescript
// With custom middleware
const app = new TerrenoApp({
  userModel: User,
  corsOrigin: ["https://app.example.com"],
  loggingOptions: { logRequests: true },
  githubAuth: {
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    callbackURL: process.env.GITHUB_CALLBACK_URL!,
  },
})
  .addMiddleware((req, res, next) => {
    res.setHeader("X-Custom-Header", "value");
    next();
  })
  .register(todoRouter)
  .register(userRouter)
  .start();
```

## See

 - TerrenoPlugin for creating reusable plugins
 - modelRouter for creating CRUD route registrations

## Constructors

### Constructor

> **new TerrenoApp**(`options`): `TerrenoApp`

Create a new TerrenoApp builder.

#### Parameters

##### options

[`TerrenoAppOptions`](../interfaces/TerrenoAppOptions.md)

Application configuration options including user model and auth settings

#### Returns

`TerrenoApp`

## Methods

### addMiddleware()

> **addMiddleware**(`fn`): `this`

Add custom Express middleware to the application.

Middleware is added BEFORE JSON body parsing and authentication setup,
allowing you to modify incoming requests early in the middleware stack.

#### Parameters

##### fn

`RequestHandler`\<`ParamsDictionary`, `any`, `any`, `ParsedQs`, `Record`\<`string`, `any`\>\> \| ((`app`) => `void`)

Express middleware function or a function that configures the app

#### Returns

`this`

This TerrenoApp instance for method chaining

#### Example

```typescript
app.addMiddleware((req, res, next) => {
  res.setHeader("X-Request-ID", req.id);
  next();
});
```

***

### build()

> **build**(): `Application`

Build the Express application without starting the server.

Configures the complete middleware stack including:
- CORS, JSON parsing, JWT decode, optional HTTP rate limiting, auth routes
- Better Auth session (when BetterAuthApp is registered) before the limiter
- Logging, Sentry, OpenAPI, model routers and plugins
- Error handling middleware

Use this method when you need the Express app instance for testing
or custom server setup. For normal use, call `start()` instead.

#### Returns

`Application`

Configured Express application instance

#### Example

```typescript
const app = new TerrenoApp({ userModel: User })
  .register(todoRouter)
  .build();

// Use app for testing with supertest
await request(app).get("/todos").expect(200);
```

***

### configure()

> **configure**(`model`, `options?`): `this`

Register a configuration model with the application.

Adds configuration management endpoints that expose the model's schema
as metadata, and provide GET/PATCH endpoints for reading and updating
the singleton configuration document. Nested subschemas become separate
sections in the admin UI.

All configuration endpoints require admin authentication.

#### Parameters

##### model

[`ConfigurationModelLike`](../interfaces/ConfigurationModelLike.md)

Mongoose model with configurationPlugin applied

##### options?

`Omit`\<[`ConfigurationAppOptions`](../interfaces/ConfigurationAppOptions.md), `"model"`\>

Optional configuration (basePath, fieldOverrides)

#### Returns

`this`

This TerrenoApp instance for method chaining

#### Example

```typescript
const app = new TerrenoApp({ userModel: User })
  .configure(AppConfig)
  .register(todoRouter)
  .start();
```

***

### getAccessControl()

> **getAccessControl**(): [`AnyTerrenoAccess`](../type-aliases/AnyTerrenoAccess.md) \| `undefined`

The RBAC access control passed as `accessControl`, if any.

#### Returns

[`AnyTerrenoAccess`](../type-aliases/AnyTerrenoAccess.md) \| `undefined`

***

### getPlugins()

> **getPlugins**(): [`TerrenoPlugin`](../interfaces/TerrenoPlugin.md)[]

Returns only TerrenoPlugin registrations (excludes model routers).

#### Returns

[`TerrenoPlugin`](../interfaces/TerrenoPlugin.md)[]

***

### getRegistrations()

> **getRegistrations**(): readonly ([`TerrenoPlugin`](../interfaces/TerrenoPlugin.md) \| [`ModelRouterRegistration`](../interfaces/ModelRouterRegistration.md))[]

Returns registered model routers and plugins in mount order.

#### Returns

readonly ([`TerrenoPlugin`](../interfaces/TerrenoPlugin.md) \| [`ModelRouterRegistration`](../interfaces/ModelRouterRegistration.md))[]

***

### getUserModel()

> **getUserModel**(): [`UserModel`](../interfaces/UserModel.md)

The application user model this app authenticates against.

#### Returns

[`UserModel`](../interfaces/UserModel.md)

***

### off()

> **off**(`event`, `listener`): `this`

#### Parameters

##### event

`"admin:model.changed"`

##### listener

(`payload`) => `void`

#### Returns

`this`

***

### on()

> **on**(`event`, `listener`): `this`

#### Parameters

##### event

`"admin:model.changed"`

##### listener

(`payload`) => `void`

#### Returns

`this`

***

### register()

> **register**(`registration`): `this`

Register a model router or plugin with the application.

Model routers are created with `modelRouter("/path", Model, options)` and
provide CRUD endpoints. Plugins implement `TerrenoPlugin` interface and
can register custom routes and middleware.

Registrations are mounted in the order they are added.

#### Parameters

##### registration

[`TerrenoPlugin`](../interfaces/TerrenoPlugin.md) \| [`ModelRouterRegistration`](../interfaces/ModelRouterRegistration.md)

A ModelRouterRegistration from modelRouter() or a TerrenoPlugin instance

#### Returns

`this`

This TerrenoApp instance for method chaining

#### Example

```typescript
const todoRouter = modelRouter("/todos", Todo, options);
const healthPlugin = new HealthApp({ path: "/health" });

app.register(todoRouter).register(healthPlugin);
```

***

### start()

> **start**(): `Application`

Build the Express application and start listening on the configured port.

Calls `build()` to configure the application, then starts an HTTP server
listening on the port specified by the `PORT` environment variable (default: 9000).
If `skipListen` option is true, the app is built but the server is not started.

#### Returns

`Application`

Configured Express application instance

#### Throws

Process exits with code 1 if the server fails to start

#### Example

```typescript
// Start server on port 3000
process.env.PORT = "3000";
const app = new TerrenoApp({ userModel: User })
  .register(todoRouter)
  .start();
```

***

### whenReady()

> **whenReady**(): `Promise`\<`void`\>

Resolves after startup migrations (and listen, unless `skipListen`).
Tests with `skipListen` should await this instead of assuming `start()` is idle.

#### Returns

`Promise`\<`void`\>
