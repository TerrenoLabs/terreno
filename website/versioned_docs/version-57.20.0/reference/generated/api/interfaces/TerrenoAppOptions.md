Configuration options for TerrenoApp.

## Properties

### accessControl?

> `optional` **accessControl?**: [`AnyTerrenoAccess`](../type-aliases/AnyTerrenoAccess.md)

RBAC access controller injected into model routers and `/auth/me` enrichment.

***

### arrayLimit?

> `optional` **arrayLimit?**: `number`

Maximum number of array items in query parameters (default: 200)

***

### authOptions?

> `optional` **authOptions?**: [`AuthOptions`](AuthOptions.md)

Authentication configuration options

***

### beforeJsonSetup?

> `optional` **beforeJsonSetup?**: (`app`) => `void`

Runs after CORS and before the `addMiddleware` chain and JSON body parsing.
Use to attach early middleware via `app.use(...)` before JSON parsing.

#### Parameters

##### app

`Application`

#### Returns

`void`

***

### configureApp?

> `optional` **configureApp?**: [`AddRoutes`](../type-aliases/AddRoutes.md)

Invoked after registered plugins/model routers and before `/auth/me`.
Receives the Express app and OpenAPI bundle for `modelRouter` / `createOpenApiBuilder` wiring.

***

### corsOrigin?

> `optional` **corsOrigin?**: `CorsOrigin`

CORS origin configuration (default: "*")

***

### githubAuth?

> `optional` **githubAuth?**: [`GitHubAuthOptions`](GitHubAuthOptions.md)

GitHub OAuth configuration (enables GitHub authentication if provided)

***

### httpServer?

> `optional` **httpServer?**: `Server`\<*typeof* `IncomingMessage`, *typeof* `ServerResponse`\>

Already-listening HTTP server. `start()` attaches the Express app to it
instead of creating and binding a new server, so Cloud Run can see PORT
before MongoDB connect and plugin registration finish.

***

### loggingOptions?

> `optional` **loggingOptions?**: [`LoggingOptions`](LoggingOptions.md)

Logging configuration options

***

### logRequests?

> `optional` **logRequests?**: `boolean`

Whether to log all incoming requests (default: true)

***

### mcpOAuth?

> `optional` **mcpOAuth?**: [`McpOAuthOptions`](McpOAuthOptions.md)

Opt-in OAuth 2.1 authorization server for `/mcp`, so remote MCP clients (Claude.ai
connectors, ChatGPT apps) can connect to a JWT-auth app. Off unless `enabled: true`. Mounts
RFC 9728 / RFC 8414 discovery, authorize + consent, token, and revocation endpoints, and makes
`/mcp` answer credential-less requests with a 401 challenge. Dynamic client registration is a
second opt-in (`dynamicClientRegistration: true`). See
[Enable MCP OAuth](../how-to/enable-mcp-oauth.md).

***

### mcpServiceTokens?

> `optional` **mcpServiceTokens?**: [`McpServiceTokensAppOption`](../type-aliases/McpServiceTokensAppOption.md)

Opt-in personal MCP service tokens. `true` is `{enabled: true}`. When enabled,
mounts `/mcp/service-tokens` and accepts `Authorization: Bearer mcp_…` on `/mcp`.

***

### migrations?

> `optional` **migrations?**: [`StartupMigrationsOption`](StartupMigrationsOption.md)

Versioned MongoDB migrations. `runOnStart` defaults to false. When true, wet `up`
runs after listen and `ensureSyncIndexes`. Production still requires
`ALLOW_MIGRATIONS=true`.

***

### organizations?

> `optional` **organizations?**: `boolean` \| `Omit`\<[`OrgsAppOptions`](OrgsAppOptions.md), `"access"` \| `"userModel"`\>

Multi-tenant organizations. Default off so existing single-tenant apps stay unchanged.
New apps from `terreno_bootstrap_app` pass `true`. Requires `accessControl` from
`createAccess({ organizations: true })`. Pass `{ settingsSchema }` to type and
validate `Organization.settings`.

***

### rateLimit?

> `optional` **rateLimit?**: [`RateLimitOptions`](RateLimitOptions.md)

Optional HTTP rate limiting. Omitted or `undefined` leaves the limiter off
(Terreno 58 will default it on). Pass `{}` or `{store, limits, trustProxy}`
to enable. See [Rate limiting](../how-to/rate-limiting.md).

***

### realtime?

> `optional` **realtime?**: `boolean` \| [`RealtimeAppOptions`](RealtimeAppOptions.md)

Real-time sync configuration. When provided, Socket.io and MongoDB change streams
are set up automatically — no need to register RealtimeApp as a separate plugin.

Set to `true` for defaults, or pass a RealtimeAppOptions object for full control.

***

### sentryOptions?

> `optional` **sentryOptions?**: `BunOptions`

Sentry configuration options

***

### skipListen?

> `optional` **skipListen?**: `boolean`

Skip calling app.listen() in start() method (useful for testing)

***

### userModel

> **userModel**: [`UserModel`](UserModel.md)

Mongoose User model with passport-local-mongoose plugin
