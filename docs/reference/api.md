# @terreno/api

REST API framework built on Express and Mongoose. Provides modelRouter (CRUD endpoints), JWT auth, permissions, and OpenAPI generation.

## Table of Contents

- [Server Setup](#server-setup)
- [MCP tools](#mcp-tools)
- [Authentication](#authentication)
- [Model Schema Conventions](#model-schema-conventions)
- [Mongoose Plugins](#mongoose-plugins)
- [Organizations](#organizations)
- [Request Validation](#request-validation)
- [Middleware](#middleware)
- [Logging & Tracing](#logging--tracing)
- [Extensibility](#extensibility)
- [In-app notifications](#in-app-notifications)
- [Webhooks & Notifications](#webhooks--notifications)
- [HTTP Client](#http-client)
- [Utilities](#utilities)
- [Script Helpers](#script-helpers)
- [Migrations](#migrations)

## Key exports

- `TerrenoApp`, `setupServer`, `modelRouter`, `Permissions`, `OwnerQueryFilter`
- Organizations: `Organization`, `Membership`, `OrgsApp`, `orgScopedPlugin`,
  `orgContextMiddleware`, `getOrgContext`, `OrgQueryFilter`,
  `Permissions.IsOrganizationMember`, `organizationSlugFromName`
- `AuditApp`, `createAuditEventModel`, `persistRbacAuditToAuditEvent`
- `registerMCPTool`, `getMCPRegistry`
- `APIError`, `logger`, `asyncHandler`, `authenticateMiddleware`
- Logging: `logger`, `createScopedLogger`, `createFeatureFlaggedLogger`, `setupLogging`, `formatLogContextSuffix`
- Correlation: `runWithRequestContext`, `getCurrentLogContext`, `requestContextMiddleware`, `REQUEST_CONTEXT_ATTRIBUTE_NAMES`
- `createOpenApiBuilder`
- Seeds: `runSeeds`, `runSeedCli`, `seedBetterAuthUser`
- Migrations: `assertMigrationsAllowed`, `runMigrations`, `runDownMigrations`, `checkMigrationFiles`, `resolveMigrationDir`, `exerciseReversibleMigrations`, `MIGRATIONS_COLLECTION` (`terreno-migrate` bin)
- `githubUserPlugin`, `setupGitHubAuth`, `addGitHubAuthRoutes`
- `AuthToken`, `AUTH_TOKEN_TTL` (hashed single-use password-reset / email-verification tokens)
- Mongoose plugins: `findExactlyOne`, `findOneOrNone`, `upsertPlugin`, `DateOnly`, `emailVerificationPlugin`
- Validation: `configureOpenApiValidator`, `validateRequestBody`, `validateQueryParams`, `createValidator`
- Middleware: `openApiEtagMiddleware`, `sentryAppVersionMiddleware`
- Extensibility: `TerrenoPlugin` interface
- Notifiers: `sendToSlack`, `formatSlackUserMention`, `lookupSlackUserIdByEmail`, `sendToGoogleChat`, `sendToZoom`
- HTTP client: `createAuthenticatedClient`, `withApiErrorHandling`, `normalizeApiError`, `markRetryUnsafe`

## Server Setup

Two patterns for building Terreno APIs:

### Deprecated: modelRouter `realtime`

`modelRouter({ realtime })` (RTK cache-patching websocket events) is **deprecated** and **will be removed in Terreno 58**. Use `sync` with [`@terreno/syncdb`](syncdb.md). See [Migrate from RTK to syncdb](../how-to/migrate-rtk-to-syncdb.md).

`RealtimeApp` is **not** deprecated. It still hosts Socket.io, change streams, and `sync:delta`.

Keep `admin.realtime` when you want admin `admin:model.changed` events.

### TerrenoApp (Recommended)

Fluent API with a register pattern:

``````typescript
import {TerrenoApp, modelRouter} from "@terreno/api";
import {User, Todo} from "./models";

const todoRouter = modelRouter("/todos", Todo, {
  permissions: {
    list: [Permissions.IsAuthenticated],
    create: [Permissions.IsAuthenticated],
    read: [Permissions.IsOwner],
    update: [Permissions.IsOwner],
    delete: [Permissions.IsOwner],
  },
  queryFilter: OwnerQueryFilter,
});

const app = new TerrenoApp({userModel: User})
  .register(todoRouter)
  .register(userRouter)
  .start();
``````

**Methods:**
- `register(registration)` — Register `ModelRouterRegistration` or `TerrenoPlugin`
- `addMiddleware(fn)` — Add Express middleware
- `build()` — Build Express app without listening
`start()` — Build and start server. Pass `httpServer` to attach to an already-listening `http.Server` instead of binding a new port (Cloud Run: bind `PORT` before MongoDB connect).

`migrations.runOnStart` defaults to **false**. When `true`, `start()` binds listen first, then runs `ensureSyncIndexes`, then wet `up`. Production still requires `ALLOW_MIGRATIONS=true` (boot counts as `--force`). Omitted `migrations` never reads `terreno_migrations`.

```typescript
new TerrenoApp({
  userModel: User,
  migrations: {dir: "./migrations", runOnStart: true},
});
```

### HTTP rate limiting

Opt-in. Pass `rateLimit: {}` on `TerrenoApp` to enable (omitted = off; Terreno 58 defaults on).

```typescript
new TerrenoApp({
  userModel: User,
  rateLimit: process.env.RATE_LIMIT_ENABLED === "true" ? {store: "memory"} : undefined,
});
```

| Option | Default | Meaning |
|--------|---------|---------|
| `store` | `"memory"` | `"memory"` \| `"redis"` \| `"mongo"` |
| `limits.authMax` | 20 / 15 min | login, signup, refresh, OTP, GitHub OAuth, Better Auth sign-in / sign-up / password reset / OAuth callback |
| `betterAuthBasePath` | `BetterAuthApp` `config.basePath` or `/api/auth` | Prefix used to classify Better Auth credential routes |
| `limits.apiMax` | 600 / 15 min | modelRouter and other HTTP |
| `trustProxy` | `false` | Express `trust proxy`. Use `1` on Cloud Run. Unauthenticated key is `req.ip` |

Skip: `GET /health`, `/healthz`, `/openapi.json`, `/swagger` (trailing slashes and letter case ignored). 429 is `APIError` `code: "rate-limit-exceeded"` with `Retry-After` and `RateLimit` / `RateLimit-Policy`. JWT login/signup/refresh ignore a stale access token. Operator guide: [Rate limiting](../how-to/rate-limiting.md).

### MCP service tokens

Opt-in. Omitted or `enabled: false` leaves `/mcp/service-tokens` unmounted and ignores `mcp_` Bearer credentials on `/mcp`.

```typescript
new TerrenoApp({
  userModel: User,
  mcpServiceTokens: {
    enabled: true,
    publicMcpUrl: process.env.PUBLIC_API_URL,
  },
});
```

`mcpServiceTokens: true` is `{enabled: true}`. When enabled, TerrenoApp mounts the self-serve routes (passing its OpenAPI bundle) and sets `mcpServiceTokens` on MCP auth. Operator steps: [Connect an MCP client with a service token](../how-to/connect-mcp-service-token.md).

### Audit log (`AuditApp`)

Opt-in append-only log. Register the plugin; importing `@terreno/api` does **not** compile `AuditEvent` onto the default mongoose connection. The compiled Mongoose name is `TerrenoAuditEvent` on collection `auditevents`. Admin UI and RBAC keep `AuditEvent` / `adminAuditEvent`.

```typescript
import {
  AuditApp,
  persistRbacAuditToAuditEvent,
  TerrenoApp,
  modelRouter,
} from "@terreno/api";

new TerrenoApp({userModel: User})
  .register(new AuditApp()) // optional {retentionDays: 90}
  .register(
    modelRouter("/todos", Todo, {
      audit: true, // or {redact: ["ssn"]}
      permissions: {/* ... */},
    })
  )
  .start();
```

| Surface | How it writes |
| --- | --- |
| `modelRouter` | `audit: true` or `{redact?: string[]}` after successful HTTP create/update/delete and array push/update/remove |
| `AdminApp` | Auto when `AuditApp` is registered (`source: "admin"`). `onAdminAudit` is extra |
| RBAC | `createAccess({auditSink: persistRbacAuditToAuditEvent})` (`source: "rbac"`) |

HTTP is list+read only: `GET /audit-events` with `Permissions.IsAdmin`. Empty create/update/delete permission arrays mean POST/PATCH/DELETE return **405**, including `/admin/audit-events` (`admin.adminPermissions`). Non-admin list is also **405** (`permissionMiddleware`). There is no `isDeletedPlugin`; rows are not soft-deleted.

`createAuditEventModel(connection, {retentionDays?})` is the factory for tests and scripts. Never audit `AuditEvent` itself. Diffs run on the request; persist is fire-and-forget (the HTTP handler does not await Mongo). Recorder failures (including serialization) log and leave the mutation 2xx. Secret field names (`password`, `hash`, `salt`, `token`, `secret`, `refreshToken`) are stripped at every object and array depth, including compound keys such as `tokenHash`. AdminApp diffs also omit `hiddenFields` and `excludeFields`.

When `GCP_TASKS_AUDIT_QUEUE`, `AUDIT_TASKS_URL`, `GCP_PROJECT`, `GCP_LOCATION`, and `AUDIT_TASKS_SECRET` are set, `AuditApp` enqueues the write with Cloud Tasks (`@google-cloud/tasks` optional install) instead of writing Mongo in-process, and mounts `POST /internal/audit-events` (header `X-Terreno-Audit-Secret`) so the worker persists. Pass `enqueue` yourself to use any other queue. Default retention is forever (no TTL index). `new AuditApp({retentionDays: n})` for `n > 0` replaces the plugin `{created: 1}` index with `{created: 1, expireAfterSeconds: n * 86400}`. Drop that index yourself if you later remove TTL. Operator steps: [Enable the framework audit log](../how-to/audit-log.md).

### setupServer (Legacy)

Callback-based pattern:

``````typescript
import {setupServer, modelRouter} from "@terreno/api";

setupServer({
  userModel: User,
  addRoutes: (router) => {
    router.use("/todos", modelRouter(Todo, options));
  },
});
``````

Both patterns create the same middleware stack (CORS, auth, logging, OpenAPI). HTTP rate limiting is a `TerrenoApp` option only — migrate from `setupServer` to `TerrenoApp` to enable it.

## Collection catalog

`modelRouter("/path", Model, options)` writes one catalog record per route path. MCP, realtime, and sync surfaces read that record; TerrenoApp calls `replaceCollectionOptions` once when access control is injected. Test helpers `clearMCPRegistry`, `clearRealtimeRegistry`, and `clearSyncRegistry` clear the entire catalog.

## modelRouter actions

Named GET/POST operations on a collection or document. Use these instead of `app.get` /
`app.post` / `router.get` / `router.post` for application APIs.

See [modelRouter actions](../explanation/model-router-actions.md). Example:

```typescript
export const todoRouter = modelRouter("/todos", Todo, {
  collectionActions: {
    bulkComplete: {
      method: "POST",
      permissions: [Permissions.IsAuthenticated],
      body: z.object({ids: z.array(z.string()).min(1)}).strict(),
      handler: async ({body, user}) => {
        return {matched: 0, modified: 0};
      },
    },
  },
  instanceActions: {
    markComplete: {
      method: "POST",
      permissions: [Permissions.IsOwner],
      handler: async ({doc}) => {
        return doc;
      },
    },
  },
  permissions: { /* CRUD */ },
});
```

Do not add `endpoints: (router) => { router.get(...) }` when an action fits.
Action config supports `allowAnonymous: true` as a per-action override; it does not change authentication for CRUD or sibling actions.

## modelRouter array operations

When a model has at least one array field, `modelRouter` provides subroutes for adding,
updating, and removing array items:

| Method | Path | Operation |
| --- | --- | --- |
| `POST` | `/:id/:field` | Append an item |
| `PATCH` | `/:id/:field/:itemId` | Replace or merge an item |
| `DELETE` | `/:id/:field/:itemId` | Remove an item |

The `field` path must resolve to an array on the document. Requests for scalar, object,
or unknown fields run the normal update transform and `preUpdate` hook first so consumer
authorization remains authoritative, then return `400` with code
`array-operation-field-not-array` if the hook allows the request.

## MCP tools

Opt a model into Model Context Protocol tools with `mcp` on `modelRouter`. `TerrenoApp` mounts `POST /mcp` when any model has `mcp` or a custom tool is registered.

```typescript
const todoRouter = modelRouter("/todos", Todo, {
  mcp: {
    excludeFields: ["ownerId"],
    methods: ["list", "read", "create", "update", "delete"],
  },
  permissions: { /* same as REST */ },
});
```

Cross-model tools use `registerMCPTool` (see the example backend's `users_todo_statuses`). How-to: [Expose MCP tools](../how-to/expose-mcp-tools.md). In-process Vercel AI SDK wrappers: `getMCPTools` from `@terreno/ai`.

Create, update, and delete tools share REST permission, hook, and persistence semantics: they call the same `executeCreate` / `executeUpdate` / `executeDelete` pipeline. MCP error results use `APIError.title` (for example `Create not allowed`, `preCreate hook error`). User-role stripping for RBAC User writes happens in the executor after hooks; MCP supplies the registry `modelName` for that check. List and read stay MCP handlers. `excludeFields` and `mcpResponseHandler` still apply after the executor returns. Invalid ids on instance writes 404 only when the document `_id` cannot be cast, not when a populate ref fails.

### MCP service token model

`McpServiceToken` stores the hashed credential records used by the optional MCP service-token feature. It is not a `modelRouter` model: consumer-facing create, list, and revoke routes are registered only when `mcpServiceTokens` is enabled on `TerrenoApp`.

```typescript
import {McpServiceToken} from "@terreno/api";

const {mcpServiceToken, token} = await McpServiceToken.issueFor(
  {_id: user._id},
  {name: "Perplexity"}
);
// Store or show `token` once. Only its SHA-256 hash is persisted.
```

The token begins with `mcp_` followed by 32 random bytes encoded as hex. `verify(token)` returns `null` for unknown, expired, or revoked tokens. `revokeForUser(user, tokenId)` records `revokedAt`, and `countActiveForUser(userId)` excludes expired or revoked records. Document `deleteOne` (admin DELETE) also sets `revokedAt` and leaves the row for audit. Never return or log `tokenHash` or the plaintext token outside the initial issue result.

Self-serve HTTP routes live at `/mcp/service-tokens`. `TerrenoApp` mounts them when `mcpServiceTokens` is enabled, passing its OpenAPI bundle. You can also call `addMcpServiceTokenRoutes(app, {publicMcpUrl, openApi})` yourself. They require session or JWT auth and **reject** `Authorization: Bearer mcp_…` so a service token cannot mint or list tokens.

| Method | Path | Body / params | Response |
| --- | --- | --- | --- |
| POST | `/mcp/service-tokens` | `{name, expiresAt?}` | `{data: {id, name, token, tokenPrefix, mcpUrl, expiresAt, created}}` |
| GET | `/mcp/service-tokens` | `?page&limit` | `{data, page, limit, total, more}` — no `token` or `tokenHash` |
| DELETE | `/mcp/service-tokens/:id` | — | `{data: {id, revokedAt}}` — owner only |

`expiresAt` is an optional ISO-8601 datetime (Luxon `DateTime.fromISO`). Omit it for a token that does not expire. Create returns `mcpUrl` from `publicMcpUrl`, else `BETTER_AUTH_URL`, else the request host, with `/mcp` appended when missing. An 11th **active** token for the same user is `400`. Revoke and cross-owner access are `404`. List includes revoked rows for the owner so the UI can show history. Default page size is 100 (maximum 100).

## Authentication

@terreno/api includes built-in authentication with multiple strategies:

### Email/Password Authentication

JWT-based authentication using `passport-local-mongoose`:

``````typescript
import {setupServer} from "@terreno/api";

setupServer({
  userModel: User,
  authOptions: {
    generateJWTPayload: (user) => ({
      sub: user._id,
      admin: user.admin,
    }),
  },
});
``````

**Endpoints:**
- `POST /auth/signup` — Create user account
- `POST /auth/login` — Authenticate with email/password
- `POST /auth/refresh_token` — Refresh access token
- `POST /auth/forgotPassword` — Always 202; mails a reset link only when the email exists
- `POST /auth/resetPassword` — `{token, password}`; also aliased at `POST /resetPassword` for the RTK client
- `POST /auth/sendVerification` — Authenticated; 202 only after delivery succeeds; mails a verification link when `emailVerified` is not true
- `POST /auth/verifyEmail` — `{token}` sets `emailVerified` true
- `GET /auth/me` — Get current user profile
- `PATCH /auth/me` — Update current user profile

JWT recovery routes default on. In `authOptions`, set `passwordReset: false` to omit
forgot-password and both token-reset paths, `emailVerification: false` to omit send/verify
email, or `legacyResetPasswordRoute: false` to omit only the deprecated
`POST /resetPassword` alias while retaining `POST /auth/resetPassword`.

Signup and `PATCH /auth/me` drop privileged fields: `admin`, `roles`, `organizationIds`,
`emailVerified`, and `tokenEpoch`. Request logs redact `password`, `newPassword`,
`oldPassword`, `token`, and `refreshToken` in request bodies and in URL query strings. Changing the mailbox through `PATCH /auth/me`
invalidates unused `passwordReset` AuthTokens for that user even when the schema has no
`emailVerified` field. When the schema uses `emailVerificationPlugin`, mailbox change also
sets `emailVerified` to false and invalidates unused `emailVerification` tokens; changing letter
casing alone does not.

**AuthToken (password reset / email verification):** hashed single-use tokens live in a separate
`AuthToken` collection, not on User. `AuthToken.issueFor(user, type)` invalidates other
unused, unexpired tokens of that type for the same user, then returns a 32-byte hex
plaintext once and stores only the SHA-256 hash. `AuthToken.consume(token, type)` atomically
marks one unused, unexpired row. TTL is 1 hour for `passwordReset` and 24 hours for
`emailVerification` (`AUTH_TOKEN_TTL`). Mongo also TTL-indexes `expiresAt`.

Wire `authOptions.publicAppUrl` and `authOptions.sendMail` (typically
`getCommsService().sendMail`) so forgot-password can deliver the link
`${publicAppUrl}/resetPassword?token=...`. Forgot-password skips issuing a token when
`publicAppUrl` is missing. Authenticated `POST /auth/sendVerification` returns 501 in that
case instead of 202. Email lookup is case-insensitive. Successful reset calls `setPassword`, increments
`tokenEpoch` so outstanding **refresh** tokens fail, and returns new JWT tokens. When
`BetterAuthApp` is registered, JWT reset also updates that user's Better Auth password
and deletes Better Auth sessions. Better Auth password reset updates the JWT password
and `tokenEpoch` for the matching app User. Access
tokens stay valid until expiry (default 15m). `POST /resetPassword`
matches the `@terreno/rtk` `resetPassword` mutation path (`password` or `newPassword`).

Add `tokenEpoch` (number, default 0) on the User schema so epoch bumps persist under
`strict: "throw"`. See `example-backend` User. Opt in to `emailVerified` with
`emailVerificationPlugin`. Set `authOptions.requireEmailVerification` to reject login
with 403 `email-not-verified` until `POST /auth/verifyEmail`. Signup still returns JWTs
and sends `${publicAppUrl}/verifyEmail?token=...` so the user can complete verification.

**Environment variables:**
- `TOKEN_SECRET` — JWT signing secret (required)
- `TOKEN_ISSUER` — JWT issuer claim (required)
- `REFRESH_TOKEN_SECRET` — Refresh token secret (required)
- `SESSION_SECRET` — Express session secret (required)
- `TOKEN_EXPIRES_IN` — Token expiration (default: `15m`)
- `REFRESH_TOKEN_EXPIRES_IN` — Refresh token expiration (default: `30d`)
- `SIGNUP_DISABLED` — Set to `"true"` to disable user signup endpoint

### GitHub OAuth Authentication

Add GitHub OAuth login to your API:

``````typescript
import {githubUserPlugin, setupServer} from "@terreno/api";

// Add GitHub fields to user schema
userSchema.plugin(githubUserPlugin);

setupServer({
  userModel: User,
  githubAuth: {
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    callbackURL: process.env.GITHUB_CALLBACK_URL!,
    scope: ["user:email"],
    allowAccountLinking: true,
  },
});
``````

**Endpoints (when configured):**
- `GET /auth/github` — Initiate OAuth flow
- `GET /auth/github/callback` — OAuth callback handler
- `GET /auth/github/link` — Link GitHub to authenticated user (requires JWT)
- `DELETE /auth/github/unlink` — Unlink GitHub from account (requires JWT)

**Learn more:** [Add GitHub OAuth authentication](../how-to/add-github-oauth.md)

### Better Auth Authentication

Add Better Auth as an alternative authentication system with built-in social OAuth:

``````typescript
import {BetterAuthApp, TerrenoApp} from "@terreno/api";

const betterAuthConfig = {
  enabled: true,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: ["yourapp://", "exp://"],
  googleOAuth: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  },
  githubOAuth: {
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  },
};

const app = new TerrenoApp({userModel: User});
app.register(new BetterAuthApp({config: betterAuthConfig, userModel: User}));
const server = app.start();
``````

Set `publicAppUrl`, `sendMail`, and `renderAuthMail` (from `@terreno/comms`) so Better Auth
`sendResetPassword` / `sendVerificationEmail` use the same templates as JWT recovery mail.
Those hooks throw 501 and do not send when `publicAppUrl` is missing, so links are never
relative. Password reset also sets `revokeSessionsOnPasswordReset`, so existing Better Auth sessions
are deleted when that reset path succeeds. JWT `POST /auth/resetPassword` updates the
Better Auth password and deletes those sessions when `BetterAuthApp` is registered.
Optional `authMailTemplates` overrides
subject/text/html per template id.

In-process seed helpers (for example `seedBetterAuthUserInProcess`) should pass
`disableRateLimit: true` on that throwaway Better Auth instance. Better Auth
turns its built-in limiter on when `NODE_ENV=production`, so seeding six demo
users during a preview smoke test otherwise 429s on the fourth signup. Do not
set this on the public `BetterAuthApp`.

**Endpoints (when enabled):**
- `POST /api/auth/signup/email` — Email/password signup
- `POST /api/auth/signin/email` — Email/password signin
- `GET /api/auth/signin/{provider}` — Initiate OAuth (google, github, apple)
- `GET /api/auth/callback/{provider}` — OAuth callback
- `POST /api/auth/signout` — Sign out
- `GET /api/auth/session` — Get session

**Environment variables:**
- `AUTH_PROVIDER` — Set to `"better-auth"` to enable (default: `"jwt"`)
- `BETTER_AUTH_SECRET` — Session encryption secret (required)
- `BETTER_AUTH_URL` — Base URL for auth server (required)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth (optional)
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — GitHub OAuth (optional)
- `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET` — Apple Sign In (optional)

**Learn more:** [Configure Better Auth](../how-to/configure-better-auth.md)

## Model Schema Conventions

### Required field descriptions

**Every field in a Mongoose schema must include a `description` property.** Descriptions are extracted by `mongoose-to-swagger` and included in the generated OpenAPI specification, making your API documentation and auto-generated SDK significantly more useful.

``````typescript
const schema = new mongoose.Schema<Document, Model>({
  title: {
    description: "The title of the item",
    type: String,
    required: true,
  },
  status: {
    description: "Current processing status",
    type: String,
    enum: ["pending", "active", "completed"],
    default: "pending",
  },
  ownerId: {
    description: "The user who owns this item",
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
});
``````

### Writing good descriptions

- Keep them concise (one sentence is usually enough)
- Explain the field's purpose, not its type
- Use active voice: "The user who owns..." not "Owner of..."
- Include important constraints: "Email address (must be unique)"

### Benefits

Field descriptions appear in:
- OpenAPI spec at `/openapi.json`
- Generated SDK type definitions
- API documentation (Swagger UI if enabled)
- IDE autocomplete hints when using the SDK

## Mongoose Plugins

@terreno/api provides several Mongoose plugins to extend model functionality with common patterns.

### orgScopedPlugin

Adds a required indexed `organizationId` (ref `Organization`) to consumer schemas. Save fails
without an organization. Use this on tenant-scoped models; query scoping lands with org context.
After creation, `organizationId` is immutable — REST PATCH, admin writes, sync updates, and
direct `doc.save()` / `updateOne()` attempts to retarget another organization return HTTP 400
with title `organizationId cannot be changed`.

``````typescript
import {orgScopedPlugin} from "@terreno/api";

projectSchema.plugin(orgScopedPlugin);
``````

### findExactlyOne & findOneOrNone

**Critical:** Never use `Model.findOne` directly. Use these plugins instead to prevent ambiguous queries.

``````typescript
import {findExactlyOne, findOneOrNone} from "@terreno/api";

// In your schema
todoSchema.plugin(findExactlyOne);
todoSchema.plugin(findOneOrNone);

// Usage
const todo = await Todo.findExactlyOne({_id: id}); // Throws if 0 or multiple found
const maybeUser = await User.findOneOrNone({email}); // Returns null if none, throws if multiple
``````

**Why these matter:**
- `findOne()` returns a **random document** if multiple match (non-deterministic)
- `findExactlyOne()` throws `APIError` (404) if none found, (500) if multiple found
- `findOneOrNone()` returns `null` if none found, throws (500) if multiple found

### upsertPlugin

Create or update a document atomically.

``````typescript
import {upsertPlugin, type HasUpsert} from "@terreno/api";

todoSchema.plugin(upsertPlugin);

// TypeScript: Extend your model interface
interface TodoModel extends DefaultModel<TodoDocument>, HasUpsert<TodoDocument> {}

// Usage
const todo = await Todo.upsert(
  {userId: user._id, taskId: task.id}, // Conditions
  {status: "completed", completedAt: new Date()} // Update
);
// Creates new if none exists, updates if found, throws if multiple match
``````

### DateOnly Schema Type

Custom Mongoose type for date-only fields (no time component).

``````typescript
import {Schema} from "mongoose";
import {DateOnly} from "@terreno/api";

// IMPORTANT: Register early in your app entry point (before models are loaded)
(Schema.Types as any).DateOnly = DateOnly;

// Then use in schemas
const eventSchema = new Schema({
  eventDate: {
    type: Schema.Types.DateOnly,
    description: "Date of the event (no time component)",
  },
});

// Automatically strips time when setting or fetching
event.eventDate = new Date("2026-02-15T14:30:00Z");
console.log(event.eventDate); // 2026-02-15T00:00:00.000Z
``````

**Features:**
- Automatically converts to UTC midnight
- Supports comparison operators (`$gt`, `$gte`, `$lt`, `$lte`)
- Throws `CastError` for invalid dates

### createdUpdatedPlugin

Adds `created` and `updated` timestamp fields with automatic management.

``````typescript
import {createdUpdatedPlugin} from "@terreno/api";

schema.plugin(createdUpdatedPlugin);

// Adds two fields:
// - created: Date (set on first save)
// - updated: Date (set on every save/update)

// Disable for specific saves
doc.disableCreatedUpdatedPlugin = true;
await doc.save();
``````

### isDeletedPlugin

Soft delete support with automatic query filtering.

``````typescript
import {isDeletedPlugin, type IsDeleted} from "@terreno/api";

schema.plugin(isDeletedPlugin, false); // Default: not deleted

// Adds:
// - deleted: boolean (default: false)
// - Automatic filtering in find() and findOne() queries

// Normal queries exclude deleted docs
const todos = await Todo.find({}); // Only non-deleted

// Explicitly query deleted docs
const deleted = await Todo.find({deleted: true});

// Soft delete
todo.deleted = true;
await todo.save();
``````

### isDisabledPlugin

Disable user accounts (returns 401 for disabled users).

``````typescript
import {isDisabledPlugin} from "@terreno/api";

userSchema.plugin(isDisabledPlugin, false);

// Adds disabled: boolean field
user.disabled = true;
await user.save();
// User will receive 401 on authentication attempts
``````

### baseUserPlugin

Base fields for user models.

``````typescript
import {baseUserPlugin, type BaseUser} from "@terreno/api";

userSchema.plugin(baseUserPlugin);

// Adds:
// - email: string (indexed)
// - admin: boolean (default: false)
``````

### emailVerificationPlugin

Opt-in `emailVerified` boolean for user schemas. Defaults to `false` so existing users stay
unverified until they complete the verification flow. Apply this plugin; do not add the
field by hand.

``````typescript
import {emailVerificationPlugin, type EmailVerified} from "@terreno/api";

userSchema.plugin(emailVerificationPlugin);

// Adds:
// - emailVerified: boolean (default: false)
``````

### firebaseJWTPlugin

Firebase authentication integration.

``````typescript
import {firebaseJWTPlugin} from "@terreno/api";

userSchema.plugin(firebaseJWTPlugin);

// Adds:
// - firebaseId: string (indexed)
``````

### Default Plugin Bundle

Many schemas use these together:

``````typescript
import {createdUpdatedPlugin, isDeletedPlugin, findExactlyOne, findOneOrNone} from "@terreno/api";

export const addDefaultPlugins = (schema) => {
  schema.plugin(createdUpdatedPlugin);
  schema.plugin(isDeletedPlugin);
  schema.plugin(findExactlyOne);
  schema.plugin(findOneOrNone);
};

// Apply to all schemas
todoSchema.plugin(addDefaultPlugins);
``````

## Organizations

Organizations are **opt-in**. Existing and single-tenant apps omit them: do not pass
`organizations: true` to `createAccess` or `TerrenoApp`, and do not register `OrgsApp`.
New apps from `create-terreno-app` enable organizations by default.

| App kind | What to do |
| --- | --- |
| Existing / single-tenant | Leave `createAccess` and `TerrenoApp` without `organizations`. No `operator` seed, no membership grants, no `/orgs` routes. |
| New app (bootstrap) | Generated `backend/src/access.ts` uses `createAccess({ organizations: true })`. `TerrenoApp({ organizations: true, accessControl: access })` mounts `OrgsApp`. Seed creates a default org and makes `admin@example.com` an `operator` and `org-admin`. |
| Existing app adopting orgs | `createAccess({ organizations: true })`, `await access.roles.seedDefaults()`, and `TerrenoApp({ organizations: true, accessControl })` or `.register(new OrgsApp({ access, userModel }))`. |

`Organization` and `Membership` models register on first use, not when you import `@terreno/api`.

Native `Organization` and `Membership` models live in `@terreno/api`.

| Model | Fields |
| --- | --- |
| `Organization` | `name` (required), `slug` (unique, generated from name), `ownerId`, `settings` (app-defined; Mixed until you register a nested schema), `disabled` |
| `Membership` | `organizationId`, `userId`, `roleName` (`org-admin` \| `member`, default `member`), `status` (`active` \| `suspended`) |

Compound unique index: `(organizationId, userId)`. Duplicate memberships throw a Mongo duplicate-key error.

`Membership` statics: `findActiveForUser`, `isOrgAdmin`, `isMember` (active rows only). Per-org
`org-admin` is stored on Membership, not on `user.roles`.

### Organization.settings

Do not add top-level fields to the native `Organization` model. Extend `settings`:

| Helper | Role |
| --- | --- |
| `createOrganizationSettingsSchema(definition)` | Nested schema with `_id: false` and `strict: "throw"` |
| `registerOrganizationSettings(schema)` | Validate settings on create/save/PATCH. Call with no argument to clear |
| `organizationSettingsOf(organization)` | Type-safe read; defaults to `{}` |
| `OrganizationSettings` | Empty interface for `declare module "@terreno/api"` merging |

Pass `settingsSchema` on `TerrenoApp({ organizations: { settingsSchema } })` or `new OrgsApp({ settingsSchema })`. Keep settings fields optional or defaulted so existing documents still save. See [Add organizations](../how-to/add-organizations.md#3-type-organization-settings).

### OrgsApp routes

| Method | Path | Required access |
| --- | --- | --- |
| `POST` | `/orgs` | `organization:create` |
| `GET` | `/orgs` | `organization:list` |
| `GET` | `/orgs/mine` | Active org-admin membership, operator, or superadmin (disabled orgs omitted) |
| `GET` | `/orgs/:id` | `organization:read` in that org |
| `PATCH` | `/orgs/:id` | `organization:update`; disabling also requires `organization:disable` |
| `DELETE` | `/orgs/:id` | `organization:delete` |
| `GET` / `POST` | `/orgs/:id/members` | `organization:manageMembers` |
| `PATCH` / `DELETE` | `/orgs/:id/members/:memberId` | `organization:manageMembers`; cannot remove or demote the last org-admin |

Creating an organization does not create a membership automatically. Member
attach accepts an existing `userId` or email (case-insensitive); it does not send
an invitation. Disabling or deleting an organization suspends its memberships.
Member attach, update, and remove routes reject disabled organizations with 403.
Operators may still `GET` and `PATCH /orgs/:id` on a disabled organization to
re-enable it; `GET /orgs` continues to list disabled organizations.

### Request organization context

Tenant-scoped routes run `orgContextMiddleware({required: true})` after auth, then
`queryFilter: OrgQueryFilter`.

| Condition | Result |
| --- | --- |
| `X-Organization-Id` present, organization disabled | 403 `Organization is disabled` |
| `X-Organization-Id` present, caller is `operator`/`superadmin` or an active member, org enabled | `req.organization` set |
| `X-Organization-Id` present, caller is not a member and not a platform org actor | 403 |
| Tenant-scoped route, `operator`/`superadmin`, header omitted | 400 |
| Caller is `org-admin` of exactly one enabled org, header omitted | that org is inferred |
| Caller is `org-admin` of many orgs, header omitted | 400 |
| Otherwise on tenant-scoped routes | 403 |

`OrgQueryFilter` always ANDs `{organizationId: context.id}`. Client `organizationId` query params
and `$or` cannot list another org.

`user.admin` is not operator. Platform org actors are `user.roles` containing `operator` or
`superadmin`.

Use `Permissions.IsOrganizationMember` on read, update, and delete methods for
tenant models. It requires the object's `organizationId` to match the active
request organization context (AsyncLocalStorage from `orgContextMiddleware`, and
from `X-Organization-Id` on `POST /sync/mutate`) for every caller. Platform actors (`operator` / `superadmin`) then pass; members
must also hold an active Membership in that organization. Direct `GET` / `PATCH`
by document id does not apply `OrgQueryFilter`, so this object-level check is
what blocks cross-tenant reads and writes. `getOrgContext()` exposes the
resolved organization to create hooks so they can overwrite client-provided
organization ids. Duplicate organization names that generate the same slug,
including slugs still held by soft-deleted organizations, return **409**
`Organization name already in use` on `POST /orgs` and on rename
via `PATCH /orgs/:id`. See [Add organizations](../how-to/add-organizations.md)
for complete route wiring.

### Organization RBAC

`terrenoStatements.organization` actions: `create`, `list`, `read`, `update`, `delete`,
`manageMembers`, `disable`.

| Role | Where it lives | Organization grants |
| --- | --- | --- |
| `superadmin` | `user.roles` | `*` (includes every organization action) |
| `operator` | seeded locked `user.roles` when `createAccess({ organizations: true })` | all `organization` actions, plus `admin:access` and `user:list\|read\|update` |
| `org-admin` | `Membership.roleName` in the current org context | `organization:read\|update\|manageMembers` and `admin:access` |
| `admin` | `user.roles` | none of `organization:*` |

`createAccess({ organizations: true })` prepends a membership permission source (`ttlMs: 0`) and
seeds the locked `operator` role. Without that flag, membership `org-admin` grants nothing extra
and `operator` is not seeded. Putting `org-admin` on `user.roles` does not grant those permissions.
Permission cache keys include the current organization id and membership role so org-admin grants
do not leak across orgs.

``````typescript
import {createAccess, Membership, Organization, terrenoStatements} from "@terreno/api";

const access = createAccess({
  connection: mongoose.connection,
  organizations: true,
  statements: terrenoStatements,
  userModel: User,
});

const org = await Organization.create({name: "Acme Corp", ownerId: user._id});
// org.slug === "acme-corp"

await Membership.create({
  organizationId: org._id,
  roleName: "org-admin",
  userId: user._id,
});
``````

## Request Validation

@terreno/api provides runtime validation of incoming requests against OpenAPI schemas using [AJV](https://ajv.js.org/). Validation is opt-in and can be enabled globally or per-route.

### Enabling Validation

Call `configureOpenApiValidator()` at server startup to enable validation:

``````typescript
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
``````

**Configuration options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `validateRequests` | boolean | `true` | Enable request body validation |
| `validateResponses` | boolean | `false` | Enable response validation (performance cost) |
| `coerceTypes` | boolean | `true` | Convert types (e.g., `"123"` → `123`) |
| `removeAdditional` | boolean | `true` | Strip properties not in schema |
| `logValidationErrors` | boolean | `true` | Log validation failures |
| `onValidationError` | function | throws APIError | Custom error handler |
| `onAdditionalPropertiesRemoved` | function | undefined | Callback when props are stripped |

### Using with modelRouter

When validation is enabled globally, modelRouter automatically validates create and update requests.

Create (POST) enforces Mongoose required fields. Update (PATCH) is partial: present fields are type-checked, but omitted required fields are allowed so a client can send `{completed: true}` without repeating `title`.

``````typescript
import {modelRouter, Permissions} from "@terreno/api";

router.use("/todos", modelRouter(Todo, {
  permissions: {
    create: [Permissions.IsAuthenticated],
    update: [Permissions.IsOwner],
  },
  // Validation happens automatically based on Mongoose schema
}));
``````

### Builder validation

Call `.withValidation()` before `.build()` so body and query checks run in the same handler that documents the route. `build()` still returns one Express `RequestHandler`, so callers can nest it in a middleware array. OpenAPI metadata stays on that handler, so the route remains in `/openapi.json`.

### Manual Validation

For custom routes, use validation middleware directly:

``````typescript
import {validateRequestBody, validateQueryParams, createOpenApiBuilder} from "@terreno/api";

router.post("/search", [
  createOpenApiBuilder()
    .withRequestBody({
      query: {type: "string", required: true},
      filters: {type: "object"},
    })
    .build(),
  validateRequestBody({
    query: {type: "string", required: true},
    filters: {type: "object"},
  }),
  asyncHandler(async (req, res) => {
    // req.body is validated and coerced
    const {query, filters} = req.body;
    return res.json({results: []});
  }),
]);
``````

### Validating Query Parameters

``````typescript
import {validateQueryParams} from "@terreno/api";

router.get("/items", [
  validateQueryParams({
    limit: {type: "number"},
    status: {type: "string", enum: ["active", "inactive"]},
  }),
  asyncHandler(async (req, res) => {
    // req.query is validated and type-coerced
    const {limit, status} = req.query;
    return res.json({items: []});
  }),
]);
``````

### Combined Validation

Validate both body and query in a single middleware:

``````typescript
import {createValidator} from "@terreno/api";

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
``````

### Model-based Validation

Generate validators directly from Mongoose models:

``````typescript
import {validateModelRequestBody, getSchemaFromModel} from "@terreno/api";

// Use model schema for validation
router.post("/todos", [
  authenticateMiddleware(),
  validateModelRequestBody(Todo),
  asyncHandler(async (req, res) => {
    // req.body validated against Todo schema
    const todo = await Todo.create(req.body);
    return res.json({data: todo});
  }),
]);
``````

### Validation Behavior

**When `removeAdditional: true`:**
- Extra properties are silently removed from request body
- `onAdditionalPropertiesRemoved` callback fires if configured
- Useful for preventing client-side injection of unexpected fields

**When `coerceTypes: true`:**
- Query strings are converted to correct types (`"10"` → `10`)
- Request body values are coerced when possible
- Reduces type mismatch errors from URL parameters

**Error response format:**
``````json
{
  "errors": [{
    "status": "400",
    "title": "Request validation failed",
    "detail": "/body/email: must be a valid email",
    "source": {"pointer": "/body"},
    "meta": {
      "validationErrors": "[{\"path\":\"/email\",\"message\":\"must be a valid email\"}]"
    }
  }]
}
``````

**Performance considerations:**
- Validators are compiled once and cached
- Minimal overhead after first request (~1-2ms for typical schemas)
- Response validation is disabled by default due to performance cost
- Use in development/staging to catch API contract violations

**Learn more:** See `api/src/openApiValidator.ts` for advanced usage and `api/src/api.ts` for modelRouter integration.

## describeModel

Walk a Mongoose model once and get a canonical field graph (`ModelDescription`). OpenAPI, admin config, and MCP Zod tools format that graph instead of re-walking `schema.paths`.

``````typescript
import {
  describeModel,
  describeModelForRouter,
  modelDescriptionToOpenApiSpec,
  modelDescriptionToAdminFields,
  fieldDescriptionToZodType,
} from "@terreno/api";

const description = describeModel(Todo);
const openApi = modelDescriptionToOpenApiSpec(description);
const adminFields = modelDescriptionToAdminFields(description);
``````

### Field kinds

| Kind | Description |
|------|-------------|
| `string` | String (optional `enum`) |
| `number` | Number |
| `boolean` | Boolean |
| `date` | Date (OpenAPI `date-time`) |
| `dateOnly` | Terreno DateOnly type |
| `objectId` | ObjectId with optional `ref` |
| `embedded` | Subdocument or array of subdocuments |
| `mixed` | Schema.Types.Mixed |
| `map` | Map type (`item` is the `of` kind; omitted `of` is `mixed`) |

Each field includes `required`, optional `description`, `isArray`, nested `item` / `fields`, and `system` for `_id`, `__v`, `created`, `updated`, `deleted`.

`describeModelForRouter(model, options)` adds `writableOnCreate` and `writableOnUpdate` using the same rules as MCP system-field exclusions and router validation / field views.

`getOpenApiSpecForModel` builds HTTP body schemas from `ModelDescription`; populate merging for referenced models is unchanged.

See [Schema metadata explanation](../explanation/schema-metadata.md).

## Middleware

### openApiEtagMiddleware

Adds ETag support to the `/openapi.json` endpoint for efficient caching.

``````typescript
import {openApiEtagMiddleware} from "@terreno/api";

// Add before OpenAPI middleware in setupServer
app.use(openApiEtagMiddleware);
``````

**Features:**
- Generates SHA-256 ETag from OpenAPI spec content
- Returns `304 Not Modified` when spec hasn't changed
- Reduces bandwidth for clients polling OpenAPI spec
- Automatically included in `setupServer()`

**Benefits:**
- SDK code generation tools can skip regeneration if spec unchanged
- Faster frontend builds in CI/CD pipelines
- Reduced server load for large OpenAPI specs

### sentryAppVersionMiddleware

Captures app version from request headers and adds to Sentry scope for error filtering.

``````typescript
import {sentryAppVersionMiddleware} from "@terreno/api";

app.use(sentryAppVersionMiddleware);
``````

**Expected header:** `App-Version: 1.2.3`

**Sentry tag:** `app_version: 1.2.3`

**Use case:** Filter Sentry errors by app version to identify version-specific bugs.

## Logging & Tracing

@terreno/api ships a Winston-based logger plus two helpers — **scoped loggers** and
**feature-flagged loggers** — and automatic **request correlation** so a single request or
background job can be followed across many log lines, both in plain-text consoles and in structured
transports (Google Cloud Logging, Sentry).

> Never use `console.log` for permanent server logs — use `logger` or a scoped logger. Request
> logging already redacts `password` on bodies; never log secrets, full auth tokens, or raw
> passwords.

### Quick reference

| Export | Purpose |
|--------|---------|
| `logger` | Global logger: `debug` / `info` / `warn` / `error` / `catch`. |
| `createScopedLogger(options)` | Logger that prepends a `prefix` and/or attaches `labels` to every line. |
| `createFeatureFlaggedLogger(options)` | Wraps a logger behind an `isEnabled()` gate (feature flags, env, etc.). |
| `setupLogging(options)` | Configures transports and levels (console/file + custom transports). |
| `formatLogContextSuffix(fields)` | Builds the trailing ` key=value` suffix (for custom formatters/tests). |
| `runWithRequestContext(ctx, cb)` | Opens a correlation scope for jobs/scripts (HTTP gets one automatically). |
| `getCurrentLogContext()` | Reads the active correlation fields as a plain object. |
| `REQUEST_CONTEXT_ATTRIBUTE_NAMES` | Header names for propagating correlation to other services. |

### The global logger

``````typescript
import {logger} from "@terreno/api";

logger.info("Server started", {port: 4000});
logger.warn("Slow query", {ms: 500});
logger.error("Failed to process", {error});
logger.debug("Request details", {body: req.body});

// `.catch` logs and captures the exception — handy as a promise handler:
await chargeCard(id).catch(logger.catch);
``````

Each method writes through Winston (console/file transports) and, when `USE_SENTRY_LOGGING=true`,
mirrors the line to Sentry with the active request context attached.

### Scoped loggers

Use **`createScopedLogger`** when a handler, job, or service runs multiple steps and you want a
consistent prefix and/or extra dimensions on every line. Create the logger once and reuse the same
instance for the whole operation so every line shares identifiers.

``````typescript
import {createScopedLogger} from "@terreno/api";

const log = createScopedLogger({
  prefix: "[InvoicePay]",
  labels: {invoiceId: invoice._id.toString(), attempt: String(attemptNumber)},
});

log.info("Starting capture");
log.warn("Stripe rate limited, backing off");
await capture(invoice).catch(log.catch);
``````

This produces lines like:

``````text
info: [InvoicePay] Starting capture invoiceId=665f… attempt=1 requestId=…
``````

- **`prefix`** — prepended to the human-readable message (easy grep / Log Explorer text search) and
  also stored as the Winston metadata field **`terrenoLogPrefix`** so structured transports get it
  as its own field, not only embedded in `message`.
- **`labels`** — normalized to strings and stored as the Winston metadata field **`terrenoLabels`**.
  They appear in the same ` key=value` suffix as request fields and are emitted as discrete fields
  for structured transports (for example `@google-cloud/logging-winston`).

**Reserved keys:** do not use label keys that collide with framework metadata — `requestId`,
`jobId`, `sessionId`, `userId`, `traceId`, `spanId`, `terrenoLogPrefix`, `terrenoRequestLog`,
`terrenoLabels`. Prefer domain names: `invoiceId`, `syncBatchId`, `webhookDeliveryId`.

If both `prefix` and `labels` are empty, `createScopedLogger({})` returns the global `logger` (the
same object).

### Feature-flagged (toggle) logging

Use **`createFeatureFlaggedLogger`** to keep verbose diagnostics in the code but silent until a
flag turns them on — no redeploy required. All `debug` / `info` / `warn` / `error` calls are
dropped while `isEnabled()` returns false.

`isEnabled` is evaluated on **every** call, so flags can flip without a process restart. Wire it to
any source: an environment variable, a cached/remote flag map, or a call into a feature-flag service
from your app.

``````typescript
import {createFeatureFlaggedLogger, createScopedLogger} from "@terreno/api";

const jobLog = createFeatureFlaggedLogger({
  isEnabled: () => process.env.JOB_TRACE_LOGS === "true",
  target: createScopedLogger({prefix: "[Job]", labels: {jobName: "nightly-sync"}}),
});

jobLog.info("step 1"); // silent unless JOB_TRACE_LOGS=true
``````

Driving it from a feature-flag service in app code:

``````typescript
const debugLog = createFeatureFlaggedLogger({
  isEnabled: () => flags.isEnabled("debug.billing"),
  target: createScopedLogger({prefix: "[Billing]"}),
  gateCatch: true, // also silence `catch` while the flag is off
});
``````

Options:

| Option | Default | Description |
|--------|---------|-------------|
| `isEnabled` | — (required) | `() => boolean` predicate; checked on every log call. |
| `target` | global `logger` | The `ScopedLogger` (or `logger`) that receives forwarded lines. |
| `gateCatch` | `false` | When `false`, `catch` still records errors while disabled (so `promise.catch(log.catch)` keeps working). Set `true` to silence `catch` too. |

> `@terreno/api` deliberately does **not** import a feature-flags package — you pass the predicate.
> This avoids a package cycle and lets the gate read from anywhere.

### How loggers correlate

While a request or job scope is active, **every** log line — from `logger`, a scoped logger, or a
feature-flagged logger — is automatically enriched with correlation fields. You never thread them
through function arguments. This is built on Node's `AsyncLocalStorage` (see `requestContext.ts`).

What you get:

- **HTTP requests**: `requestContextMiddleware` (mounted early by `TerrenoApp` / `setupServer`)
  resolves a `requestId` from incoming headers (`x-request-id`, `x-correlation-id`,
  `x-cloud-trace-context`, W3C `traceparent`, …) or generates one, echoes it back as the
  `X-Request-ID` response header, and runs the request inside the scope. After auth runs, `userId`
  and `sessionId` are added.
- **Correlation fields**: `requestId`, `jobId`, `sessionId`, `userId`, `traceId`, `spanId` (when
  available) are merged onto every line as top-level Winston metadata.
- **Structured object**: every line also carries **`terrenoRequestLog`**: `{requestId, userId}`
  (with `userId: null` for anonymous requests) so Log Explorer and BigQuery can always filter on a
  single nested object. This object is structured metadata only — it is not repeated in the
  plain-text suffix.
- **Plain-text suffix**: console/file lines append a ` key=value` suffix built by
  `formatLogContextSuffix`, including `logPrefix=…` and any scoped `labels`.

Correlating background jobs, cron tasks, and scripts — wrap the work in `runWithRequestContext` so
it gets the same treatment as an HTTP request:

``````typescript
import {createScopedLogger, runWithRequestContext} from "@terreno/api";

await runWithRequestContext({jobId: "nightly-sync"}, async () => {
  const log = createScopedLogger({prefix: "[NightlySync]"});
  log.info("started"); // every line includes jobId + a generated requestId
  await sync();
});
``````

Propagating correlation to other services (so the same `requestId` / `traceId` follows the call):

``````typescript
import {getCurrentRequestContextAttributes} from "@terreno/api";

await fetch(downstreamUrl, {headers: getCurrentRequestContextAttributes()});
``````

### Configuring transports

`setupLogging` is called for you by `TerrenoApp` / `setupServer` (pass `loggingOptions`). Console
and file transports are enabled by default; add custom transports (such as Google Cloud Logging) to
forward the structured metadata above:

``````typescript
import {setupLogging} from "@terreno/api";
import {LoggingWinston} from "@google-cloud/logging-winston";

setupLogging({
  level: "info",
  disableFileLogging: isDeployed,
  disableConsoleColors: isDeployed,
  transports: isDeployed ? [new LoggingWinston()] : [],
});
``````

When deployed, Winston metadata (`terrenoRequestLog`, `terrenoLabels`, `terrenoLogPrefix`, and the
top-level request fields) flows into Google Cloud Logging `jsonPayload` for Log Explorer filtering.
To correlate with Cloud Trace, ensure clients or load balancers send `x-cloud-trace-context` or W3C
`traceparent`.

### Development browser-log ingestion

`TerrenoApp` mounts `POST /__terreno/browser-logs` only when `NODE_ENV=development`, or when
`TERRENO_BROWSER_LOGS=true` in another non-production environment. Production always returns 404;
set `TERRENO_BROWSER_LOGS=false` to disable the route in development.

The route accepts loopback requests for local browser development. Non-loopback clients must
authenticate through the app's normal JWT or Better Auth middleware. `TerrenoApp` mounts the route
after its optional rate limiter, so configured API limits also apply to ingestion.

The request body is `{entries: Array<{level?, message?, stack?, timestamp?}>}`. Batches are capped
at 100 entries and 256 kB. Accepted rows are truncated to bounded field lengths and appended as
mode-`0600` JSONL under `<backend cwd>/.terreno/logs/browser.log`. The file restarts with the latest
batch before it would exceed 5 MB. The local MCP `read_logs` / `last_error` tools and
`terreno logs --sources browser` consume that file.

### Message style

- Start with what happened, then optional detail: `User export finished`, not `finished`.
- Use **low-cardinality** prefixes in brackets (`[WebhookStripe]`, `[NightlyJob]`); put unique IDs
  in `labels`, not in the prefix.
- Keep the first ~80 characters useful for grouping; push highly variable data to the end or into
  splat args.

## Extensibility

### TerrenoPlugin Interface

The `TerrenoPlugin` interface provides a standard way to extend Terreno applications with reusable functionality.

``````typescript
import type {TerrenoPlugin} from "@terreno/api";
import type express from "express";

export interface TerrenoPlugin {
  register(app: express.Application): void;
}
``````

**Creating a plugin:**

``````typescript
import type {TerrenoPlugin} from "@terreno/api";
import type express from "express";

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
``````

**Using a plugin:**

``````typescript
import {setupServer} from "@terreno/api";
import {MyPlugin} from "./plugins/myPlugin";

const myPlugin = new MyPlugin({enabled: true});

setupServer({
  userModel: User,
  addRoutes: (router) => {
    // Register the plugin
    myPlugin.register(router as any);
  },
});
``````

**Example: Health Check Plugin**

See `@terreno/api-health` for a complete plugin implementation:

``````typescript
import {HealthApp} from "@terreno/api-health";

const healthCheck = new HealthApp({
  enabled: true,
  path: "/health",
  check: async () => {
    const dbConnected = await checkDatabaseConnection();
    return {
      healthy: dbConnected,
      details: {database: dbConnected ? "connected" : "disconnected"},
    };
  },
});

setupServer({
  userModel: User,
  addRoutes: (router) => {
    healthCheck.register(router as any);
  },
});
``````

**Plugin patterns:**
- **Conditional registration:** Check options to enable/disable functionality
- **Route registration:** Add custom endpoints (health checks, admin panels, webhooks)
- **Middleware injection:** Add request/response interceptors
- **Service initialization:** Connect to external services (monitoring, analytics)

**Benefits:**
- Reusable across multiple Terreno projects
- Testable in isolation
- Optional/configurable functionality
- Clean separation of concerns

## In-app notifications

Owner-scoped inbox and channel preferences via `NotificationsApp` (`ConsentApp` pattern).
This is separate from inbound webhooks and outbound Slack/Chat/Zoom notifiers below.

### Register

```typescript
import {NotificationsApp, getNotificationService, notificationsBeforeSend} from "@terreno/api";

new TerrenoApp({userModel: User}).register(
  new NotificationsApp({
    getComms: getCommsService, // optional; duck-typed, no @terreno/comms import in api
    retainDays: 0,
    userModel: User,
  })
);
```

### Collections

| Model | Route | Sync | Client create |
|---|---|---|---|
| `Notification` | `/notifications` | owner | **No** (`create: []`) |
| `NotificationPreference` | `/notification-preferences` | owner | Yes (lazy defaults) |

The exported models use collision-resistant Mongoose names
`TerrenoInboxNotification` and `TerrenoNotificationPreference`, while retaining the
existing `notifications` and `notificationpreferences` MongoDB collections.

`Notification` fields: `ownerId`, `title`, `body`, `href?`, `kind?`, `readAt?` (null = unread),
`archivedAt?` (null = active inbox).
Index: `{ownerId: 1, created: -1}`.

`NotificationPreference` fields: `ownerId` (unique among non-deleted rows), `inapp`, `mail`,
`push`, `sms` (default `true`). Missing preference row = all channels on. Preference updates
accept only the four channel booleans; `ownerId` is immutable. Soft-deleting a preference
row does not block a later create for the same owner.

`notify()` comms fan-out isolates mail, SMS, and push: a rejection from one provider is
logged and does not skip later channels.

### `notify(input)`

Server-only seam. Writes the inbox when `inapp` is on, then optionally calls
`getComms().sendMail` / `sendSms` / `sendPushToUser` when that channel is on and a
destination exists. Comms errors after the inbox write are logged and do not fail `notify()`.

### HTTP

| Method | Path | Notes |
|---|---|---|
| GET/PATCH/DELETE | `/notifications/:id` + list | Owner-scoped; **create disabled** |
| POST | `/notifications/mark-all-read` | Sets `readAt` on caller's unread rows |
| CRUD | `/notification-preferences` | Owner-scoped sync |

PATCH on notifications: `readAt` (ISO date or `null` to unread) and `archivedAt` (ISO date
or `null`). Other keys are stripped. Dismiss sets `archivedAt` via syncdb update so the
row stays in the snapshot. DELETE remains a retention tombstone (`isDeletedPlugin`), not
the inbox archive path.

The example backend uses todo router lifecycle hooks to call `notify()`: create emits
`Todo added`, the first incomplete-to-complete update emits `Todo completed`, and delete
emits `Todo deleted`.

### `notificationsBeforeSend`

Duck-typed hook for `CommsApp({beforeSend})`. Cancels when the user's preference for that
channel is `false`. Never cancels `verification`.

### Retention

`retainDays` default `0` (no sweep). When `retainDays > 0`, `sweepExpired()` tombstones rows
with `created` older than N days. No Mongo TTL index.

How-to: [In-app notifications](../how-to/in-app-notifications.md).

## Webhooks & Notifications

JSON and `application/x-www-form-urlencoded` parsers on `TerrenoApp` copy the original
bytes onto `req.rawBody` (`Buffer`) so inbound webhook signatures can be verified
without re-serializing `req.body`.

Register inbound routes on `WebhooksApp`. Helpers: `hmacSignature`, `stripeSignature`,
`twilioSignature`, `sendgridEventSignature`. Timestamped HMAC, Stripe, and SendGrid
reject timestamps outside a 300s window by default. Idempotency is `memory` or `mongo`
(`webhookReceipts`). Paths are not added to `/openapi.json` and do not use JWT.

```typescript
import {hmacSignature, TerrenoApp, WebhooksApp} from "@terreno/api";

const webhooks = new WebhooksApp({idempotency: {store: "mongo"}});
webhooks.route({
  path: "/webhooks/example",
  source: "example",
  verify: hmacSignature({secret: process.env.WEBHOOK_SECRET!, header: "X-Webhook-Signature"}),
  eventId: (req) => String((req.body as {id?: string})?.id ?? ""),
  handler: async () => {
    // process event
  },
});

new TerrenoApp({userModel: User}).register(webhooks).start();
```

Call `webhooks.claim` / `webhooks.release` from a handler when one HTTP body contains
nested ids (SendGrid `sg_event_id`). Operator guide: [Receive inbound webhooks](../how-to/inbound-webhooks.md).

### Slack Notifications

Incoming webhooks only notify a person when the text contains their **Slack
member ID** as `<@U012ABCDEF>` (Enterprise Grid ids start with `W`). Putting a
display name or email in the message does not mention them.

Store `slackUserId` on the staff/user record. Resolve it once with
`lookupSlackUserIdByEmail` (needs a bot token with `users:read.email`) and pass
the id on every send:

``````typescript
import {formatSlackUserMention, lookupSlackUserIdByEmail, sendToSlack} from "@terreno/api";

const slackUserId =
  staff.slackUserId ??
  (await lookupSlackUserIdByEmail({email: staff.email, token: process.env.SLACK_BOT_TOKEN}));

await sendToSlack("Please review this case", {
  url: process.env.SLACK_WEBHOOK_URL,
  mentionUserIds: slackUserId ? [slackUserId] : [],
});

// Or embed the token yourself:
await sendToSlack(`${formatSlackUserMention("U012ABCDEF")} Deployment complete`, {
  url: process.env.SLACK_WEBHOOK_URL,
});
``````

### Google Chat Notifications

``````typescript
import {sendGoogleChatMessage} from "@terreno/api";

await sendGoogleChatMessage({
  webhookUrl: process.env.GOOGLE_CHAT_WEBHOOK_URL,
  message: "Build failed",
  sections: [
    {
      header: "Build Status",
      widgets: [{textParagraph: {text: "Branch: main\nStatus: Failed"}}],
    },
  ],
});
``````

### Zoom Notifications

``````typescript
import {sendZoomMessage} from "@terreno/api";

await sendZoomMessage({
  webhookUrl: process.env.ZOOM_WEBHOOK_URL,
  message: "Server health alert",
});
``````

**Common use cases:**
- CI/CD pipeline notifications
- Error alerts
- Deployment confirmations
- Health check failures

## HTTP Client

Utilities for calling **external** third-party APIs with consistent auth, retry, and error handling. See the how-to guide: [Call external APIs](../how-to/call-external-apis.md).

### createAuthenticatedClient

Axios instance factory with a pluggable auth strategy, lazy token caching, and a retry policy for transient failures.

``````typescript
import {createAuthenticatedClient} from "@terreno/api";

const client = createAuthenticatedClient({
  apiName: "widgetService",
  auth: {getToken: async () => fetchServiceToken(), type: "bearer"},
  baseURL: "https://api.widgets.example/v2",
  retry: {maxAttempts: 3}, // optional; shown with defaults below
});

const response = await client.axios.get("/widgets/123");
client.invalidateToken(); // drop the cached token; next request re-authenticates
``````

**Auth strategies** (`auth` option):
- `{type: "bearer", getToken}` — caller-supplied async token fetcher, cached until invalidated
- `{type: "oauth2", tokenUrl, credentials, refreshOn401}` — client-credentials grant handled internally; `refreshOn401: true` refreshes and retries exactly once on a 401
- `{type: "apiKey", header, getKey}` — key sent on the named header

**Retry policy** (`retry` option, all fields optional):

| Field | Default | Meaning |
|---|---|---|
| `maxAttempts` | `3` | Total attempts including the first request |
| `retryOn` | `["rateLimited", "server", "network"]` | Failure classifications to retry |
| `baseDelayMs` | `250` | Base for exponential backoff with jitter |
| `maxDelayMs` | `30000` | Ceiling for any single delay, including `Retry-After` values |

Only idempotent methods (GET/HEAD/OPTIONS) are retried by default. Opt a request in with `markRetryUnsafe(config?)` when the operation is safe to repeat and its body is replayable.

**Why:** external integrations otherwise duplicate token plumbing and diverge on retry behavior; centralizing them makes rate-limit handling and credential rotation consistent, and makes non-idempotent retries an explicit, reviewable choice.

### normalizeApiError

Pure function converting any thrown value into a stable, log-safe shape.

``````typescript
import {normalizeApiError} from "@terreno/api";

const normalized = normalizeApiError(error, {apiName: "widgetService", operation: "getWidget"});
// {isAxios, statusCode, messages, classification, apiName, operation}
``````

`classification` is one of `"rateLimited" | "unauthorized" | "notFound" | "validation" | "server" | "network" | "unknown"`. Messages are extracted only from recognized body fields (`{message}`, JSONAPI `{errors: [{title, detail}]}`, plain strings truncated to 500 chars) — raw payload bodies never reach the normalized shape.

### withApiErrorHandling

Call-site wrapper: normalize → optional `redactError` hook → log exactly once → rethrow.

``````typescript
import {withApiErrorHandling} from "@terreno/api";

const response = await withApiErrorHandling(() => client.axios.get(`/widgets/${id}`), {
  apiName: "widgetService",
  operation: "getWidget",
  rethrowAs: "apiError", // optional; default "raw" rethrows the original error
});
``````

With `rethrowAs: "apiError"` the failure is converted to a terreno `APIError` (stable title, per-occurrence `detail`, classification in `meta`) suitable for route handlers. Works with SDK-based integrations too — it does not require `createAuthenticatedClient`.

## Utilities

### checkModelsStrict

Validates all registered Mongoose models use strict mode and virtual settings.

``````typescript
import {checkModelsStrict} from "@terreno/api";

// Run in non-production environments at startup
if (process.env.NODE_ENV !== "production") {
  checkModelsStrict();
}
``````

**Checks:**
- `strict: "throw"` or `strict: true` (prevents accidental field additions)
- `toJSON: {virtuals: true}` (includes virtual fields in JSON output)
- `toObject: {virtuals: true}` (includes virtual fields in plain objects)

**Throws:** Detailed error listing all non-compliant models

**Why:** Prevents subtle bugs from schema misconfigurations that only appear in production.

### isValidObjectId

Better ObjectId validation than Mongoose's built-in validator.

``````typescript
import {isValidObjectId} from "@terreno/api";

// Mongoose's isValidObjectId has false positives
console.log(mongoose.isValidObjectId("123456789012")); // true (wrong!)

// @terreno/api's version correctly validates
console.log(isValidObjectId("123456789012")); // false (correct)
console.log(isValidObjectId("507f1f77bcf86cd799439011")); // true
``````

**Fix:** Checks length is exactly 24 hex characters, not just 12+ characters.

### timeout

Promise-based timeout utility.

``````typescript
import {timeout} from "@terreno/api";

// Wait 1 second
await timeout(1000);

// Use in retry logic
for (let i = 0; i < 3; i++) {
  try {
    await someOperation();
    break;
  } catch (error) {
    if (i < 2) await timeout(1000 * Math.pow(2, i)); // Exponential backoff
  }
}
``````

## Migrations

`runMigrations({migrations, dryRun, connection, mongoose})` applies pending versioned `up` functions in array order. Dry-run calls `up({dryRun: true})` and does **not** write history. Wet runs insert `{id, checksum, appliedAt}` into Mongo collection `terreno_migrations`. Already-applied ids are skipped; a checksum change after apply throws `Migration checksum mismatch` (409). Apply is serialized with a lock document `_id: "_lock"` in the same collection: wait, heartbeat, steal after **10 minutes**.

`runDownMigrations({migrations, dryRun, connection, mongoose, steps})` rolls back the last `steps` applied files (default 1 via the CLI). Dry-run calls `down({dryRun: true})` and leaves history in place. Wet deletes the history row after `down`. Missing `down` throws `Migration has no down` (400) and does not change history.

Files are `migrations/<YYYYMMDDHHmmss>-<slug>.ts`. `checkMigrationFiles({dir})` (alias `loadMigrations`) loads them in filename order without connecting to Mongo; the exported `id` must match the filename stem. Optional `down` is allowed. Duplicate ids and invalid names fail with 400 `APIError`. A missing directory fails with 404 `Migration directory not found`. Paths on Bun's compile-time virtual FS (`$bunfs`) are remapped with `resolveMigrationDir` to `MIGRATIONS_DIR` or `<cwd>/migrations`. `exerciseReversibleMigrations({dir, connect})` applies every file on a connected database, then rolls back in reverse until a file without `down` stops the chain (that id is recorded; earlier files stay applied).

`assertMigrationsAllowed({isProduction, allowEnv, force, dryRun})` gates wet apply. Dry-run is always allowed. Production wet requires `ALLOW_MIGRATIONS=true` and `--force` (or a later boot/admin Apply equivalent).

`buildSchemaCatalog({models})` snapshots Mongoose paths, required/unique flags, and indexes. `diffSchemaCatalog({before, after})` marks optional fields and non-unique index adds as safe, and required fields, unique indexes, same-type rename heuristics, removed paths, and same-path type changes as unsafe (fail-closed generate stubs). Mixed diffs still throw, and keep safe index calls as comments in the stub.

The `@terreno/api` bin `terreno-migrate` runs `check`, `generate`, `status`, `up`, and `down`. See [Run MongoDB migrations](../how-to/run-mongodb-migrations.md).

## Script Helpers

### runSeeds and runSeedCli

Define ordered `SeedStep` entries and run them in the default `sync` mode or in
`reset` mode. The `SeedContext` provides:

- `upsert(model, key, values)` — creates, updates, or reports unchanged data. Nested values ignore generated `_id`s. `Map` payloads compare as plain objects. Soft-deleted matches are restored instead of duplicated. Duplicate key matches keep the first document and remove the extras.
- `deleteMany(model, filter?)` — reset helper with dry-run support
- `mode`, `dryRun`, and structured `changes`

`runSeedCli` adds `--dry-run`, `--reset`, repeatable `--only`, `--force`, and
`--help`. It returns an exit code instead of terminating the process; seed CLIs
should `process.exit` after `disconnect` so leftover Better Auth handles cannot
keep the event loop open. Production resets require both `--force` and an
approving `allowProductionReset` option.
See [Seed a database](../how-to/seed-a-database.md).

`seedBetterAuthUser` provisions a credential account and reconciles the
application user model without requiring a running HTTP server.

### wrapScript

Error handling wrapper for scripts and cron jobs.

``````typescript
import {wrapScript} from "@terreno/api";

wrapScript(async () => {
  // Your script logic
  await processData();
  logger.info("Script completed successfully");
});
``````

**Features:**
- Catches and logs exceptions via `logger.catch()`
- Sends errors to Sentry
- Exits with code 1 on error, 0 on success
- Ensures process doesn't hang on uncaught errors

### cronjob

Schedule recurring tasks with error handling.

``````typescript
import {cronjob} from "@terreno/api";

// Run every hour
cronjob("0 * * * *", async () => {
  await cleanupOldData();
}, {
  name: "Cleanup Job",
  runOnInit: false, // Run immediately on start?
});
``````

**Features:**
- Uses `node-cron` syntax
- Automatic error logging
- Named jobs for monitoring
- Optional immediate execution

**Cron syntax:** `"minute hour day month weekday"`
- `"*/5 * * * *"` — Every 5 minutes
- `"0 0 * * *"` — Daily at midnight
- `"0 */6 * * *"` — Every 6 hours

**Process-local only:** `cronjob()` runs inside the current Node process. It does not
persist work, retry across crashes, or share state between API and worker replicas. For
durable queues, retries, dead-lettering, cron schedules stored in MongoDB, and admin
visibility, use [`@terreno/jobs`](jobs.md) — see
[Durable background jobs](../how-to/background-jobs.md). Use `wrapScript` (above) for
one-shot CLI entrypoints, not queued work.

## Deprecations

### transformer (modelRouter option)

**Deprecated:** Use lifecycle hooks instead (`preCreate`, `postCreate`, etc.)

``````typescript
// Old (deprecated)
modelRouter(Model, {
  transformer: (doc) => ({...doc, computed: true}),
});

// New (use responseHandler)
modelRouter(Model, {
  responseHandler: (doc, method) => ({...doc, computed: true}),
});
``````

### responseSerializer (modelRouter option)

**Deprecated:** Use `responseHandler` instead.

``````typescript
// Old (deprecated)
modelRouter(Model, {
  responseSerializer: (doc) => serialize(doc),
});

// New
modelRouter(Model, {
  responseHandler: (doc, method) => serialize(doc),
});
``````

## Environment Variables

Complete reference of environment variables used by @terreno/api:

### Authentication

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TOKEN_SECRET` | Yes | — | JWT signing secret (use long random string) |
| `TOKEN_ISSUER` | Yes | — | JWT issuer claim (e.g., "your-app-name") |
| `REFRESH_TOKEN_SECRET` | Yes | — | Refresh token secret (different from TOKEN_SECRET) |
| `SESSION_SECRET` | Yes | — | Express session secret |
| `TOKEN_EXPIRES_IN` | No | `15m` | Access token expiration (e.g., "15m", "1h") |
| `REFRESH_TOKEN_EXPIRES_IN` | No | `30d` | Refresh token expiration (e.g., "7d", "30d") |
| `SIGNUP_DISABLED` | No | — | Set to `"true"` to disable POST /auth/signup endpoint |

### Server Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | Environment: `development`, `production`, `test` |
| `MONGO_URI` or `MONGO_CONNECTION` | Yes | — | MongoDB connection string |
| `ALLOW_MIGRATIONS` | No | unset | Set to `"true"` plus CLI `--force` for production wet `up`/`down` |
| `ENABLE_SWAGGER` | No | — | Set to `"true"` to enable Swagger UI at `/docs` |
| `WEBSOCKET_PORT` | No | `PORT + 1` | Socket.io server port (if using WebSockets) |

### Logging & Monitoring

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `USE_SENTRY_LOGGING` | No | — | Set to `"true"` to enable Sentry error tracking |
| `SENTRY_DSN` | No | — | Sentry Data Source Name (required if USE_SENTRY_LOGGING=true) |
| `TERRENO_BROWSER_LOGS` | No | enabled in development | Set `"false"` to disable dev ingestion or `"true"` to opt in outside development; production stays disabled and non-loopback clients must authenticate |
| `SENTRY_TRACES_SAMPLE_RATE` | No | `0.1` | Sentry trace sampling rate (0.0 to 1.0) |
| `DISABLE_LOG_ALL_REQUESTS` | No | — | Set to `"true"` to disable request logging |
| `SLOW_REQUEST_THRESHOLD_MS` | No | `3000` | Log warning for requests slower than this (milliseconds) |
| `SLOW_DB_QUERY_THRESHOLD_MS` | No | `1000` | Log warning for database queries slower than this |

### Webhooks & Notifications

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SLACK_WEBHOOKS` | No | — | JSON object mapping names to Slack webhook URLs: `{"default":"https://..."}` |
| `SLACK_BOT_TOKEN` | No | — | Bot token (`xoxb-…`) with `users:read.email` for `lookupSlackUserIdByEmail` |
| `GOOGLE_CHAT_WEBHOOKS` | No | — | JSON object mapping names to Google Chat webhook URLs |
| `ZOOM_CHAT_WEBHOOKS` | No | — | JSON object mapping names to Zoom webhook URLs |
| `WEBHOOK_SECRET` | No | — | Secret for validating incoming webhook signatures |

### Google Cloud Platform (Optional)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GCP_PROJECT` | No | — | Google Cloud project ID (for Cloud Tasks, etc.) |
| `GCP_LOCATION` | No | — | GCP region (e.g., "us-central1") |
| `GCP_SERVICE_ACCOUNT_EMAIL` | No | — | Service account email for authentication |
| `GCP_TASKS_NOTIFICATIONS_QUEUE` | No | — | Legacy name in docs/tests only — **not** read by `@terreno/api` or `@terreno/jobs` |
| `GCP_TASK_PROCESSOR_QUEUE` | No | — | Legacy name in docs/tests only — configure Cloud Tasks via `GcpCloudTasksRunner` options |
| `GCP_TASKS_AUDIT_QUEUE` | No | — | Cloud Tasks queue name for off-process `AuditEvent` writes |
| `AUDIT_TASKS_URL` | No | — | Worker URL Cloud Tasks POSTs audit writes to |
| `AUDIT_TASKS_SECRET` | No | — | Shared secret for `X-Terreno-Audit-Secret` on the audit worker route |

### Other

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VALKEY_URL` | No | — | Valkey/Redis connection URL (for caching) |
| `GEMINI_API_KEY` | No | — | Google Gemini API key (if using AI features) |

**Example `.env` file:**

``````env
# Required
TOKEN_SECRET=your-long-random-secret-here
TOKEN_ISSUER=my-app
REFRESH_TOKEN_SECRET=different-long-random-secret
SESSION_SECRET=session-secret-here
MONGO_URI=mongodb://localhost:27017/myapp

# Optional
NODE_ENV=development
PORT=4000
ENABLE_SWAGGER=true
USE_SENTRY_LOGGING=true
SENTRY_DSN=https://...@sentry.io/...
``````

## Learn more

- [Enable the framework audit log](../how-to/audit-log.md)
- [How to create a model](../how-to/create-a-model.md)
- [Add GitHub OAuth](../how-to/add-github-oauth.md)
- [Authentication architecture](../explanation/authentication.md)
- [API package source](https://github.com/TerrenoLabs/terreno/tree/master/api/src)
