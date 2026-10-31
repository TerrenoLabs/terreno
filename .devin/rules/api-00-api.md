---
trigger: always_on
---
# @terreno/api

Express/Mongoose REST API framework styled after Django REST Framework. This is a **backend-only** package — no React, no UI components, no frontend code.

## Commands

```bash
bun run compile          # Compile TypeScript
bun run dev              # Watch mode
bun run test             # Run tests
bun run lint             # Lint code
bun run lint:fix         # Fix lint issues
```

## Architecture

### File Structure

```
src/
  index.ts               # All package exports
  api.ts                 # modelRouter core (~1000 lines)
  auth.ts                # JWT/Passport authentication
  betterAuth.ts          # Better Auth types and configuration
  betterAuthSetup.ts     # Better Auth initialization with MongoDB
  betterAuthApp.ts       # Better Auth TerrenoPlugin
  permissions.ts         # Permission system
  errors.ts              # APIError and error middleware
  expressServer.ts       # setupServer and middleware stack
  terrenoApp.ts          # TerrenoApp class with register pattern
  rateLimit/             # Opt-in HTTP rate limiting (memory / redis / mongo)
  audit/                 # Opt-in AuditApp, AuditEvent factory, recorder (no barrel)
  terrenoPlugin.ts       # TerrenoPlugin interface for extensibility
  openApiBuilder.ts      # Fluent OpenAPI middleware builder
  openApi.ts             # OpenAPI spec generation
  logger.ts              # Winston-based logging
  plugins.ts             # Mongoose schema plugins
  populate.ts            # Population and OpenAPI schema generation
  transformers.ts        # Data serialization (deprecated, use hooks)
  utils.ts               # isValidObjectId, checkModelsStrict
  notifiers/             # Slack, Google Chat, Zoom integrations
  webhooks/              # WebhooksApp, rawBody, verifiers, idempotency
  tests.ts               # Test models and helpers
  tests/bunSetup.ts      # Test environment setup
```

## Server Setup

### TerrenoApp (Recommended)

Fluent API with a register pattern:

```typescript
import {TerrenoApp, modelRouter} from "@terreno/api";

const todoRouter = modelRouter("/todos", Todo, {
  permissions: {...},
  queryFilter: OwnerQueryFilter,
});

const app = new TerrenoApp({userModel: User})
  .register(todoRouter)
  .register(userRouter)
  .start();
```

Methods:
- `register(registration)` — Register `ModelRouterRegistration` or `TerrenoPlugin`
- `addMiddleware(fn)` — Add Express middleware
- `build()` — Build Express app without listening
- `start()` — Build and start server

`rateLimit` on `TerrenoApp` is **opt-in**. Omit it to leave HTTP unlimited (Terreno 58 defaults on). Empty `{}` enables memory buckets: auth 20 / 15 min (login, signup, refresh, GitHub OAuth, Better Auth sign-in / sign-up / reset-password / OAuth callback); api 600 / 15 min. Paths ignore a trailing slash. JWT login/signup/refresh skip expired access tokens. `store: "redis"` needs `VALKEY_URL` then `REDIS_URL`. `store: "mongo"` uses `rateLimitHits`. The framework does **not** read `RATE_LIMIT_ENABLED`. Operator guide: `docs/how-to/rate-limiting.md`.

Inbound HTTP callbacks use `WebhooksApp` (`webhooks.route` then `app.register(webhooks)`).
Verify `req.rawBody` with `hmacSignature` / `stripeSignature` / `twilioSignature` /
`sendgridEventSignature`. Do not `JSON.stringify(req.body)`. Do not put webhook POSTs in
OpenAPI or behind JWT. Do not skip rate-limit paths. Operator guide:
`docs/how-to/inbound-webhooks.md`.

`AuditApp` is **opt-in**. Register `new AuditApp()` (optional `{retentionDays: n}` for
`n > 0` TTL on `created`). Importing `@terreno/api` does **not** register `AuditEvent`
on the default connection — use `createAuditEventModel(connection)` or the plugin.
Set `audit: true` or `audit: {redact: ["ssn"]}` on `modelRouter` after successful HTTP
CRUD and array mutations. AdminApp auto-writes when the plugin is registered.
RBAC uses `persistRbacAuditToAuditEvent` as `createAccess({auditSink})`. HTTP handlers do not await persist. Diffs still run inline. Optional `enqueue` (Cloud Tasks when `GCP_TASKS_AUDIT_QUEUE` and `AUDIT_TASKS_URL` are set) writes Mongo off the request process via `POST /internal/audit-events`. Empty CUD perms are **405**. Never audit
`AuditEvent`. Writes are best-effort. Default retain forever. Operator guide:
`docs/how-to/audit-log.md`.

### setupServer (Legacy)

Callback-based pattern:

```typescript
import {setupServer, modelRouter} from "@terreno/api";

setupServer({
  userModel: User,
  addRoutes: (router) => {
    router.use("/todos", modelRouter(Todo, options));
  },
});
```

Both patterns create the same middleware stack (CORS, auth, logging, OpenAPI).

## modelRouter

Auto-generates RESTful CRUD APIs for Mongoose models with permissions, population, filtering, and lifecycle hooks.

**Two signatures:**

```typescript
// 1. Router signature (for setupServer):
router.use("/todos", modelRouter(Todo, options));

// 2. Registration signature (for TerrenoApp):
const todoRouter = modelRouter("/todos", Todo, options);
app.register(todoRouter);
```

### Generated Endpoints

| Method | HTTP | Path | Description |
|--------|------|------|-------------|
| Create | POST | `/` | Create document |
| List | GET | `/` | List with pagination |
| Read | GET | `/:id` | Get single document |
| Update | PATCH | `/:id` | Update document |
| Delete | DELETE | `/:id` | Delete/soft-delete |
| Array Push | POST | `/:id/:field` | Push to array field |
| Array Update | PATCH | `/:id/:field/:itemId` | Update array item |
| Array Remove | DELETE | `/:id/:field/:itemId` | Remove array item |

### All Options

```typescript
modelRouter(Model, {
  // Permissions (required) — empty array [] disables the method
  permissions: {
    create: [Permissions.IsAuthenticated],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsOwner],
    update: [Permissions.IsOwner],
    delete: [],  // Disabled
  },

  // Query & Filtering
  queryFields: ["_id", "type", "status"],       // Allowed query params
  queryFilter: (user, query) => ({ownerId: user?.id}),  // Filter/validate queries
  defaultQueryParams: {status: "active"},        // Default constraints
  sort: "-created",                              // Default sort order
  defaultLimit: 100,                             // Default page size
  maxLimit: 500,                                 // Maximum page size
  allowAnonymous: false,                         // Allow unauthenticated access

  // Population
  populatePaths: [{path: "user", fields: ["name", "email"]}],

  // Lifecycle Hooks
  preCreate: (body, req) => ({...body, ownerId: req.user._id}),
  preUpdate: (body, req) => body,
  preDelete: (obj, req) => obj,
  postCreate: (obj, req) => {},
  postUpdate: (obj, cleanedBody, req, prevValue) => {},
  postDelete: (req, obj) => {},

  // Response Handling
  responseHandler: (value, method, req, options) => serializedValue,

  // Audit log (requires AuditApp; omit to skip)
  audit: true, // or {redact: ["ssn"]}

  // Custom Routes (registered before CRUD)
  endpoints: (router) => { router.get("/custom", handler); },

  // OpenAPI
  openApiOverwrite: {get: {...}, list: {...}},
  openApiExtraModelProperties: {...},
});
```

### Query Features

- Pagination: `?limit=20&page=2` — response includes `{data, limit, more, page, total}`
- Sorting: `?sort=-created` or as object `{field: 'ascending'}`
- Field queries: `?name=test&status=active` (must be in queryFields)
- Complex queries: `?$and=[{...}]`, `?$or=[{...}]`

## Authentication

JWT + Passport-based auth with multiple strategies: Email/Password, GitHub OAuth, and Anonymous.

### Email/Password Authentication

Key functions:

- `setupAuth(app, userModel)` — Configures Passport (JWT, Local, Anonymous strategies)
- `addAuthRoutes(app, userModel, authOptions?)` — POST `/auth/login`, `/auth/signup`, `/auth/refresh_token`, `/auth/forgotPassword`, `/auth/resetPassword`, `/auth/sendVerification`, `/auth/verifyEmail`
- `addMeRoutes(app, userModel)` — GET/PATCH `/auth/me`
- `authenticateMiddleware(anonymous?)` — Returns auth middleware
- `signupUser(userModel, email, password, body?)` — Register user
- `generateTokens(user, authOptions?)` — Sign JWT tokens

Endpoints:
- `POST /auth/signup` — User registration
- `POST /auth/login` — Authenticate with email/password
- `POST /auth/refresh_token` — Refresh access token
- `POST /auth/forgotPassword` — Always 202; mails a reset link when the user exists
- `POST /auth/resetPassword` — Consume a one-time token; also `POST /resetPassword`
- `POST /auth/sendVerification` — Authenticated re-send of the verify link
- `POST /auth/verifyEmail` — `{token}` sets `emailVerified`
- `GET /auth/me` — Get current user profile
- `PATCH /auth/me` — Update current user profile

### GitHub OAuth Authentication

Add GitHub OAuth login to your API:

```typescript
import {githubUserPlugin, setupServer} from "@terreno/api";

// Add GitHub fields to user schema
userSchema.plugin(githubUserPlugin);

setupServer({
  userModel: User,
  githubAuth: {
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    callbackURL: process.env.GITHUB_CALLBACK_URL!,
  },
});
```

Key exports:
- `githubUserPlugin` — Adds GitHub fields to user schema (githubId, githubUsername, githubProfileUrl, githubAvatarUrl)
- `setupGitHubAuth(app, userModel, options)` — Configures GitHub OAuth strategy
- `addGitHubAuthRoutes(app, userModel, authOptions, githubOptions)` — Adds GitHub OAuth routes

GitHub OAuth endpoints:
- `GET /auth/github` — Initiates GitHub OAuth flow
- `GET /auth/github/callback` — GitHub OAuth callback
- `POST /auth/github/link` — Link GitHub to existing account (requires authentication)
- `DELETE /auth/github/unlink` — Unlink GitHub from account (requires authentication)

### Better Auth Authentication

Better Auth is an optional, modern authentication provider supporting social OAuth (Google, GitHub, Apple) and email/password. Use it alongside or instead of JWT/Passport.

Add Better Auth to your API:

```typescript
import {BetterAuthApp, type BetterAuthConfig, TerrenoApp} from "@terreno/api";

const betterAuthConfig: BetterAuthConfig = {
  enabled: true,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: "/api/auth",  // Optional, default
  trustedOrigins: ["terreno://", "exp://"],  // For mobile deep links
  googleOAuth: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  },
  githubOAuth: {
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  },
  appleOAuth: {
    clientId: process.env.APPLE_CLIENT_ID!,
    clientSecret: process.env.APPLE_CLIENT_SECRET!,
  },
};

const app = new TerrenoApp({
  userModel: User,
  plugins: [
    new BetterAuthApp({config: betterAuthConfig, userModel: User}),
  ],
});
```

Key exports:
- `BetterAuthApp` — TerrenoPlugin for registering Better Auth
- `BetterAuthConfig` interface — Configuration options
- `createBetterAuth(options)` — Initialize Better Auth instance
- `createBetterAuthSessionMiddleware(auth, userModel)` — Session extraction middleware
- `syncBetterAuthUser(userModel, betterAuthUser)` — Sync Better Auth user to app User model

Better Auth automatically:
- Creates OAuth routes at `{basePath}/{provider}` (e.g., `/api/auth/google`)
- Extracts sessions from requests and populates `req.user`
- Syncs Better Auth users to your Mongoose User model (requires `betterAuthId` field)
- Supports email/password signup and login
- Serves public `GET {basePath}/terreno/methods` (enabled providers, email/password, sign-up,
  linking mode); login screens read it with rtk `useAuthMethods(authClient)` instead of
  hard-coding providers

Auth features are config fields, not hand-added plugins: `accountLinking`, `twoFactor`,
`passkey`, `signUp: {mode: "closed"}`, `lastLoginMethod`, `multiSession`, `oauthProxy`,
`nativeApps`, and the key form of `appleOAuth` (`betterAuthFeatures.ts`). All are off by
default. Feature plugins go after `terreno-methods` and before `config.plugins`; closed sign-up
adds `terreno-sign-up-closed` after `config.plugins`. Table:
`docs/how-to/configure-better-auth.md#auth-features`.

`oauthHandoff: {webOrigins, callbackPaths?}` (opt-in) lets a bearer-mode web client on another
site finish social sign-in without cookies. It adds `GET {basePath}/oauth-handoff/start` (a
top-level navigation; 400 unless `callbackURL` is one of `callbackPaths` on one of `webOrigins`,
the optional `errorCallbackURL` is on one of `webOrigins`, and `trustedOrigins` allows both; 400
too when `Sec-Fetch-Dest` is set and is not `document`) and
`POST {basePath}/one-time-token/verify` (`{token}` -> session + `set-auth-token`). Keep loopback
origins out of production `webOrigins`. Full rules: `docs/reference/api.md` (Better Auth) and
`docs/how-to/configure-better-auth.md#social-sign-in-in-bearer-mode`.

### In-app notifications (`NotificationsApp`)

Register `NotificationsApp` for owner-scoped inbox + preference collections. Only
`getNotificationService().notify()` inserts inbox rows (`create: []` on the notification router).
Compose `notificationsBeforeSend` into `CommsApp({beforeSend})` for channel toggles.
`@terreno/api` does not import `@terreno/comms` — pass `getComms` when fan-out is needed.

User model fields for Better Auth:
```typescript
{
  betterAuthId: {type: String, index: true},  // Required — Better Auth user ID
  oauthProvider: {type: String},               // Only when using social OAuth
}
```

`syncBetterAuthUser` writes `oauthProvider` only when a provider string is passed. Email/password create omits the key so `strict: "throw"` schemas without the field succeed.

### Environment Variables

Email/Password (JWT):
- `TOKEN_SECRET` — JWT signing secret (required)
- `TOKEN_ISSUER` — JWT issuer claim (required)
- `REFRESH_TOKEN_SECRET` — Refresh token secret (required)
- `SESSION_SECRET` — Express session secret (required)
- `TOKEN_EXPIRES_IN` — Token TTL (default: 15m)
- `REFRESH_TOKEN_EXPIRES_IN` — Refresh token TTL (default: 30d)
- `SIGNUP_DISABLED` — Disable user registration

GitHub OAuth (JWT auth, optional):
- `GITHUB_CLIENT_ID` — GitHub OAuth app client ID
- `GITHUB_CLIENT_SECRET` — GitHub OAuth app client secret
- `GITHUB_CALLBACK_URL` — GitHub OAuth callback URL (e.g., https://yourapp.com/auth/github/callback)

Better Auth (optional):
- `AUTH_PROVIDER` — "jwt" (default) or "better-auth"
- `BETTER_AUTH_SECRET` — Session encryption secret (required if using Better Auth)
- `BETTER_AUTH_URL` — Base URL for auth server (required if using Better Auth)
- `GOOGLE_CLIENT_ID` — Google OAuth client ID (optional)
- `GOOGLE_CLIENT_SECRET` — Google OAuth client secret (optional)
- `APPLE_CLIENT_ID` — Apple OAuth client ID (optional)
- `APPLE_CLIENT_SECRET` — Apple OAuth client secret (optional)
- GitHub OAuth with Better Auth uses same `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`

## Permissions

All permission methods in the array must return true (AND logic).

| Permission | Description |
|-----------|-------------|
| `Permissions.IsAdmin` | User has `admin: true` |
| `Permissions.IsAny` | Always allows |
| `Permissions.IsAuthenticated` | Logged in, non-anonymous |
| `Permissions.IsAuthenticatedOrReadOnly` | Auth for writes, anyone for reads |
| `Permissions.IsOwner` | Admin or `obj.ownerId === user.id` |
| `Permissions.IsOwnerOrReadOnly` | Owner for writes, anyone for reads |

### OwnerQueryFilter

Restricts list queries to documents owned by the current user:

```typescript
import {OwnerQueryFilter} from "@terreno/api";
// queryFilter: OwnerQueryFilter
// Produces: {ownerId: user.id}
```

## Request Validation

Runtime validation of incoming requests against OpenAPI schemas using AJV. Validation is opt-in and can be enabled globally or per-route.

### Enabling Validation

```typescript
import {configureOpenApiValidator, setupServer} from "@terreno/api";

// Enable validation before setting up the server
configureOpenApiValidator({
  removeAdditional: true,
  coerceTypes: true,
  logValidationErrors: true,
  onAdditionalPropertiesRemoved: (props, req) => {
    logger.warn(`Stripped properties: ${props.join(", ")} on ${req.method} ${req.path}`);
  },
});

setupServer({
  userModel: User,
  addRoutes: (router) => {
    // Routes will automatically validate when enabled
  },
});
```

Options: `validateRequests` (default: true), `validateResponses` (default: false), `coerceTypes` (default: true), `removeAdditional` (default: true), `logValidationErrors` (default: true).

### Using with modelRouter

When validation is enabled globally, modelRouter automatically validates create and update requests based on the Mongoose schema.

### Manual Validation

For custom routes:

```typescript
import {validateRequestBody, validateQueryParams, createValidator} from "@terreno/api";

// Validate request body
router.post("/search", [
  validateRequestBody({
    query: {type: "string", required: true},
    filters: {type: "object"},
  }),
  asyncHandler(async (req, res) => {
    const {query, filters} = req.body;  // Validated and type-coerced
    return res.json({results: []});
  }),
]);

// Validate query parameters
router.get("/items", [
  validateQueryParams({
    limit: {type: "number"},
    status: {type: "string", enum: ["active", "inactive"]},
  }),
  asyncHandler(async (req, res) => {
    const {limit, status} = req.query;  // Validated and type-coerced
    return res.json({items: []});
  }),
]);

// Validate both body and query
router.post("/search", [
  createValidator({
    body: {query: {type: "string", required: true}},
    query: {limit: {type: "number"}, page: {type: "number"}},
  }),
  asyncHandler(async (req, res) => {
    // Both req.body and req.query are validated
    return res.json({results: []});
  }),
]);
```

Validation errors throw `APIError` with field-level details.

## Custom endpoints — modelRouter actions

Do **not** use `app.get` / `router.post` for application APIs. Use
`collectionActions` / `instanceActions` (see `docs/explanation/model-router-actions.md`).

```typescript
collectionActions: {
  bulkComplete: {
    method: "POST",
    permissions: [Permissions.IsAuthenticated],
    handler: async ({body, user}) => ({matched: 0, modified: 0}),
  },
},
```

`createOpenApiBuilder` is last-resort for paths that cannot be `/{action}` or
`/:id/{action}` (not webhooks — those use `WebhooksApp`).

Builder methods when you must use it: `withTags`, `withSummary`, `withDescription`, `withRequestBody`, `withResponse`, `withArrayResponse`, `withQueryParameter`, `withPathParameter`.

## Error Handling

`APIError` uses the standard `Error` fields the way external tools (Sentry, log explorers) expect: `message` is exactly `title` (a stable summary of the problem type), `name` is derived from the subclass, `code`, or `status` (e.g. a 404 becomes `NotFoundError`), and the wrapped original error goes in the standard `cause`.

```typescript
import {APIError, ForbiddenError, NotFoundError} from "@terreno/api";

// Throw with status and title (required). name becomes "BadRequestError".
throw new APIError({status: 400, title: "Validation failed"});

// Status subclasses (BadRequestError, UnauthorizedError, ForbiddenError, NotFoundError,
// ConflictError, ValidationError, InternalServerError) accept a title string or full options.
throw new NotFoundError("Todo not found");
throw new ForbiddenError({title: "Admins only", detail: "You must be an admin to change that"});

// Wrap an underlying error with the standard `cause` — Sentry shows it as a linked exception.
// A stable `code` drives the error name ("todo-sync-failed" -> TodoSyncFailed) and grouping.
throw new APIError({
  cause: error,
  code: "todo-sync-failed",
  detail: errorMessage(error),
  status: 502,
  title: "Todo sync failed",
});

// With field-level errors
throw new APIError({
  status: 400,
  title: "Validation failed",
  detail: "One or more fields are invalid",
  fields: {email: "Email is required", name: "Name too short"},
});

// Disable Sentry tracking
throw new APIError({status: 404, title: "Not found", disableExternalErrorTracking: true});
```

Rules:

- `title` must be a stable summary of the problem type; put per-occurrence text in `detail` and the wrapped error in `cause` (never concatenate them into `title`).
- Use `isAPIError(error)` to detect APIErrors — never check `error.name`.
- Constructing an APIError does not log. `apiErrorMiddleware` (added automatically by `setupServer`) logs `warn` for 4xx / `error` for 5xx, captures to Sentry with a fingerprint on `name + code + status` (falls back to `name` when `code` is absent), and serializes the JSONAPI body (`disableExternalErrorTracking` is included only when `true`, for client-side Sentry suppression).

## Mongoose Conventions

### Plugins

| Plugin | Adds | Description |
|--------|------|-------------|
| `createdUpdatedPlugin` | `created`, `updated` | Auto-managed timestamps |
| `isDeletedPlugin` | `deleted` | Soft delete (auto-filtered from queries) |
| `isDisabledPlugin` | `disabled` | Returns 401 for disabled users |
| `baseUserPlugin` | `admin`, `email` | Base user fields |
| `emailVerificationPlugin` | `emailVerified` | Opt-in email verification flag (default false) |
| `findExactlyOne` | static method | Throws if 0 or multiple matches |
| `findOneOrNone` | static method | Throws if multiple matches |
| `upsertPlugin` | static method | Create or update atomically |
| `errorsPlugin` | `apiErrors` field | Store JSONAPI errors on documents |

### Critical Rules

- **Never use `Model.findOne`** — use one of:
  - `Model.findExactlyOne` — throws if 0 or >1 match (consumer model with the plugin)
  - `Model.findOneOrNone` — returns null if 0, throws if >1 (consumer model with the plugin)
  - `findOneOrNoneFor(Model, query)` from `./plugins` — same semantics as `findOneOrNone` but works from framework code where the consumer's model may or may not have the plugin applied
- Define methods by direct assignment: `schema.methods = {bar() {}}`
- Define statics by direct assignment: `schema.statics = {baz() {}}`
- All model types live in `src/modelInterfaces.ts` or `src/types/models/`

### Model Type Pattern

```typescript
export type YourModelMethods = {
  customMethod: (this: YourModelDocument, param: string) => Promise<void>;
};
export type YourModelStatics = DefaultStatics<YourModelDocument> & {
  customStatic: (this: YourModelModel, param: string) => Promise<YourModelDocument>;
};
export type YourModelModel = DefaultModel<YourModelDocument> & YourModelStatics;
export type YourModelSchema = mongoose.Schema<YourModelDocument, YourModelModel, YourModelMethods>;
export type YourModelDocument = DefaultDoc & YourModelMethods & {
  fieldName: string;
};
```

### User Type Casting

- In routes: `req.user` is `UserDocument | undefined`
- In @terreno/api callbacks: `const user = u as unknown as UserDocument`
- Never use `as any as UserDocument`

## setupServer

```typescript
import {setupServer} from "@terreno/api";

setupServer({
  userModel: User,
  addRoutes: (router, options) => {
    router.use("/todos", modelRouter(Todo, {...options, ...}));
  },
  corsOrigin: true,
  authOptions: {generateJWTPayload: (user) => ({sub: user._id, admin: user.admin})},
});
```

### Middleware Stack (in order)

1. CORS → 2. JSON parser → 3. Auth setup → 4. Auth routes → 5. Request logging → 6. Sentry → 7. OpenAPI ETag → 8. OpenAPI middleware → 9. Swagger UI (if enabled) → 10. User routes → 11. Error middleware

### Environment Variables

- `ENABLE_SWAGGER=true` — Enable Swagger UI at `/swagger`
- `USE_SENTRY_LOGGING=true` — Send errors to Sentry

## Extensibility

### TerrenoPlugin Interface

The `TerrenoPlugin` interface provides a standard way to extend Terreno applications with reusable functionality:

```typescript
import type {TerrenoPlugin} from "@terreno/api";
import type express from "express";

export interface TerrenoPlugin {
  register(app: express.Application): void;
}
```

**Creating a plugin:**

```typescript
import type {TerrenoPlugin} from "@terreno/api";

export class MyPlugin implements TerrenoPlugin {
  private options: MyPluginOptions;

  constructor(options?: MyPluginOptions) {
    this.options = options ?? {};
  }

  register(app: express.Application): void {
    // Add routes, middleware, or other setup
    app.get("/my-plugin/status", (_req, res) => {
      res.json({status: "ok"});
    });
  }
}
```

**Using a plugin:**

```typescript
import {setupServer} from "@terreno/api";
import {MyPlugin} from "./plugins/myPlugin";

const myPlugin = new MyPlugin({enabled: true});

setupServer({
  userModel: User,
  addRoutes: (router) => {
    myPlugin.register(router as any);
  },
});
```

**Example:** See `@terreno/api-health` for a complete plugin implementation with health check endpoints.

**Common patterns:** Route registration, middleware injection, conditional setup, service initialization.

## Logging

Use the `logger` object, never `console.log`. For multi-step flows and Log Explorer correlation, use **`createScopedLogger`** (prefix + `terrenoLabels` on Winston metadata). Use **`createFeatureFlaggedLogger`** to gate any logger behind `isEnabled()` (feature flags, env, etc.). See **`02-logging-tracing.mdc`** for tracing headers, Google Cloud Logging, and message conventions.

```typescript
import {createFeatureFlaggedLogger, createScopedLogger, logger} from "@terreno/api";

logger.info("Server started", {port: 4000});
logger.warn("Slow query", {ms: 500});
logger.error("Failed to process", {error});
logger.debug("Request details", {body: req.body});
logger.catch(error); // Logs and captures exception

const log = createScopedLogger({
  prefix: "[Billing]",
  labels: {invoiceId: id.toString()},
});
log.info("Capture succeeded");

const noisy = createFeatureFlaggedLogger({
  isEnabled: () => process.env.DEBUG_BILLING === "true",
  target: log,
});
noisy.debug("optional detail");
```

## Testing

- Framework: bun test with expect
- HTTP testing: supertest
- Use existing manual mocks from `src/__mocks__/` (Sentry is mocked)
- **Never mock @terreno/api or models** — test against real functionality
- Test helpers: `getBaseServer()`, `authAsUser(app, "admin" | "notAdmin")`, `setupDb()`
- Field-level error assertions: `expect(res.body.fields.email).toBe("Email required")`

### Test Coverage

- **Every new feature, route, plugin, hook, branch, or fix ships with tests** — no exceptions. Coverage should never go down across a PR.
- When adding a hook (`schema.post("save", ...)`, `schema.post("updateOne", ...)`, etc.), add at least one test per hook variant — the `this` context differs between query and document middleware, so untested wiring is unverified.
- When fixing a bug, add a regression test that fails without the fix.
- Aim for the happy path **and** the edge cases (empty input, missing values, prototype-pollution-style names, partially-valid inputs).

## TypeScript

- **Avoid `any` whenever possible.** Prefer `unknown` (and narrow) or a precise type. Use `as unknown as T` over `as any as T` when a cast is unavoidable.
- The only acceptable `any` uses are at framework/library boundaries where Mongoose's invariant generics force it (e.g. `Schema<any, any, any, any>` to accept arbitrary consumer schemas). Annotate these with a `biome-ignore` comment explaining why.
- Never widen a typed value to `any` for convenience.
- Never use `as any as UserDocument`.
