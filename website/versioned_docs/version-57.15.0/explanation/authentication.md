# Authentication Architecture

Understanding how authentication works in @terreno/api — Better Auth sessions for new apps, with JWT/Passport documented for legacy consumers.

## Overview

**Better Auth is the default path** for new Terreno apps. It provides session-based authentication with MongoDB storage, built-in social OAuth (Google, GitHub, Apple), and clean integration with `@terreno/syncdb` (`betterAuthAdapter`, `RealtimeApp` socket sessions).

Set `AUTH_PROVIDER=better-auth` and register `BetterAuthApp` on the server. On the client, use `createBetterAuthClient` + `generateBetterAuthSlice` from `@terreno/rtk` for session Redux state, then wire `betterAuthAdapter` into `createSyncDb`.

**JWT/Passport (legacy)** remains supported through the current major release line for existing deployments. It uses stateless tokens, Passport strategies (email/password, GitHub OAuth, anonymous), and manual token refresh via `@terreno/rtk`. New projects should not start on JWT unless they have a specific requirement (custom token contracts, non-cookie clients, or a phased migration).

Both systems can run in parallel during migration (`AUTH_PROVIDER` selects the primary path; legacy JWT routes stay available).

**MCP service tokens** are a third, opt-in credential. They authenticate the consumer app's `POST /mcp` only. They are not Better Auth sessions, not JWTs, and not a REST personal-access-token. Enable them with `mcpServiceTokens` on `TerrenoApp`. Operator steps: [Connect an MCP client with a service token](../how-to/connect-mcp-service-token.md).

## When to choose which

| Choose Better Auth | Stay on JWT (legacy) |
|--------------------|----------------------|
| New app or greenfield screen | Existing production JWT deployment |
| Social login (Google, GitHub, Apple) | Custom JWT payload requirements |
| `@terreno/syncdb` local-first data | Non-cookie API clients only |
| Socket sessions via `RealtimeApp` | Gradual migration in progress |

**Setup:** [Configure Better Auth](../how-to/configure-better-auth.md). **Data layer:** migrate auth before or with syncdb — see [Migrate from RTK to syncdb](../how-to/migrate-rtk-to-syncdb.md) §7.

## Authentication Strategies

### Better Auth (default)

Modern session-based authentication with built-in social OAuth support.

**Flow:**
1. Configure Better Auth with `AUTH_PROVIDER=better-auth` and register `BetterAuthApp`
2. User chooses social provider (Google, GitHub, Apple) or email/password
3. Backend redirects to OAuth provider or validates credentials
4. Better Auth creates session in MongoDB
5. Frontend receives session cookie (web) or bearer session token (native)
6. On the first authenticated request, session middleware looks up the app `User` by `betterAuthId` and creates it if missing (`syncBetterAuthUser`)
7. `req.user` is that app document for subsequent `modelRouter` permissions

Email/password create omits `oauthProvider`. Apps that never use social login can keep `strict: "throw"` without declaring that field. OAuth create sets `oauthProvider` and the User schema must declare it.

**Key properties:**
- Session-based (cookies / bearer session) vs. stateless JWT
- Built-in OAuth providers with PKCE
- `betterAuthAdapter` for syncdb socket auth
- `sync:auth-expired` socket event when the session is no longer valid

**Endpoints (when enabled):**
- `POST /api/auth/signup/email` — Email/password signup
- `POST /api/auth/signin/email` — Email/password signin
- `GET /api/auth/signin/{provider}` — Initiate OAuth flow (google, github, apple)
- `GET /api/auth/callback/{provider}` — OAuth callback handler
- `POST /api/auth/signout` — Sign out session
- `GET /api/auth/session` — Get current session

**Learn more:** [Configure Better Auth](../how-to/configure-better-auth.md)

### Email/Password (JWT / Local Strategy — legacy)

Traditional username/password authentication using `passport-local-mongoose`.

**Flow:**
1. User signs up with email and password
2. Password is hashed with pbkdf2 (via passport-local-mongoose)
3. User logs in with credentials
4. Backend validates password and issues JWT tokens
5. Frontend includes JWT in `Authorization` header for subsequent requests

**Endpoints:**
- `POST /auth/signup` — Create new user account
- `POST /auth/login` — Authenticate and receive tokens

### GitHub OAuth Strategy (JWT — legacy)

OAuth 2.0 authentication with GitHub.

**Flow:**
1. User clicks "Sign in with GitHub"
2. Frontend redirects to `GET /auth/github?returnTo=<url>`
3. Backend redirects to GitHub authorization page
4. User grants permissions on GitHub
5. GitHub redirects back to `GET /auth/github/callback`
6. Backend verifies authorization code with GitHub
7. Backend finds/creates user, issues JWT tokens
8. Backend redirects to `returnTo` URL with tokens as query params

**Account Linking:**
- Authenticated users can link their GitHub account via `GET /auth/github/link`
- Multiple authentication methods can be attached to one user account
- Users must have a password set before unlinking GitHub

**Learn more:** [How to add GitHub OAuth](../how-to/add-github-oauth.md)

### MCP service tokens (opt-in, `/mcp` only)

Personal `mcp_` keys for remote MCP clients (Perplexity, Cursor JSON config) that cannot hold a session cookie. `TerrenoApp` must set `mcpServiceTokens`. Users mint keys from `POST /mcp/service-tokens` or **Profile → MCP connections**. The plaintext secret is returned **once**; the database stores SHA-256 `tokenHash`.

`extractUserFromHeaders` on `/mcp` tries a `mcp_` Bearer first, then Better Auth, then JWT. A match loads the owning `User` and updates `lastUsedAt`. Revoked, expired, or disabled-user keys resolve to no user. The same Bearer is ignored on REST, sync, admin, and on the mint/list/revoke routes (a key cannot mint another key).

This is not OAuth 2.1. Interactive MCP clients that cannot send a static key wait for the app MCP OAuth work ([app MCP server](../implementationPlans/app-mcp-server.md)). It is also not the hosted `@terreno/mcp` codegen server ([MCP server reference](../reference/mcp-server.md)).

**Learn more:** [Connect an MCP client with a service token](../how-to/connect-mcp-service-token.md)

### Anonymous Strategy (JWT — legacy)

Allows limited access without authentication.

**Use case:** Public read access to certain resources while requiring authentication for writes.

``````typescript
import {Permissions} from "@terreno/api";

modelRouter(Model, {
  permissions: {
    list: [Permissions.IsAuthenticatedOrReadOnly],
    read: [Permissions.IsAuthenticatedOrReadOnly],
    create: [Permissions.IsAuthenticated],
  },
});
``````

## JWT Token System (legacy)

> JWT/Passport auth is **legacy**. It remains supported through the current major line but is not the recommended path for new apps. Prefer Better Auth above.

### Token Types

**Access Token (short-lived)**
- Default expiration: 15 minutes (`TOKEN_EXPIRES_IN`)
- Used for API requests
- Included in `Authorization: Bearer <token>` header
- Contains user ID and permissions in payload

**Refresh Token (long-lived)**
- Default expiration: 30 days (`REFRESH_TOKEN_EXPIRES_IN`)
- Used only to obtain new access tokens
- Stored securely on client
- Cannot be used for API requests

### Token Payload

Access tokens contain:

``````json
{
  "sub": "507f1f77bcf86cd799439011",  // User ID
  "admin": false,                      // Admin status
  "iat": 1709000000,                   // Issued at (timestamp)
  "exp": 1709000900,                   // Expires at (timestamp)
  "iss": "your-app-name"               // Issuer (from TOKEN_ISSUER env var)
}
``````

Customize the payload with `authOptions.generateJWTPayload`:

``````typescript
setupServer({
  authOptions: {
    generateJWTPayload: (user) => ({
      sub: user._id,
      admin: user.admin,
      role: user.role,  // Custom field
    }),
  },
});
``````

### Token Refresh Flow

1. Access token expires (after 15 minutes)
2. API request returns `401 Unauthorized`
3. Frontend middleware detects 401
4. Frontend calls `POST /auth/refresh_token` with refresh token
5. Backend validates refresh token
6. Backend issues new access token and refresh token
7. Frontend retries original request with new token

This is handled automatically by @terreno/rtk's `emptyApi` configuration.

## Frontend Integration

### Redux Store Setup (with @terreno/rtk)

``````typescript
import {generateAuthSlice} from "@terreno/rtk";
import {configureStore} from "@reduxjs/toolkit";
import {openapi} from "./openApiSdk";

const {authReducer, middleware, logout} = generateAuthSlice(openapi);

export const store = configureStore({
  reducer: {
    auth: authReducer,
    [openapi.reducerPath]: openapi.reducer,
  },
  middleware: (getDefault) =>
    getDefault().concat(openapi.middleware, ...middleware),
});
``````

**What this provides:**
- Automatic token storage (SecureStore on mobile, AsyncStorage on web)
- Token refresh middleware
- Login/logout state management
- Auth header injection for all API requests

### Token Storage

**Mobile (iOS/Android):**
- Uses `expo-secure-store` for encrypted storage
- Tokens stored in device keychain

**Web:**
- Uses `@react-native-async-storage/async-storage`
- Falls back to localStorage
- SSR-safe (checks `typeof window`)

**Storage keys:**
- `AUTH_TOKEN` — Access token
- `REFRESH_TOKEN` — Refresh token

## Permission System

Permissions control access to modelRouter endpoints.

### Built-in Permissions

| Permission | Description |
|-----------|-------------|
| `IsAny` | Always allows (public access) |
| `IsAuthenticated` | Requires valid JWT (non-anonymous) |
| `IsAdmin` | Requires `user.admin === true` |
| `IsOwner` | Requires admin or `obj.ownerId === user.id` |
| `IsAuthenticatedOrReadOnly` | Auth required for writes, anyone can read |
| `IsOwnerOrReadOnly` | Owner or admin for writes, anyone can read |

### Permission Evaluation

Permissions are evaluated as an **AND** operation — all permissions in the array must return `true`:

``````typescript
permissions: {
  update: [Permissions.IsAuthenticated, Permissions.IsOwner],
  // Both conditions must be true
}
``````

### Custom Permissions

Create custom permission functions:

``````typescript
const IsPremiumUser = (user, obj, method) => {
  return user?.subscription === "premium";
};

modelRouter(Model, {
  permissions: {
    create: [Permissions.IsAuthenticated, IsPremiumUser],
  },
});
``````

## Security Best Practices

### Backend

✅ **Do:**
- Use environment variables for secrets (`TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`)
- Set strong, unique secrets in production (at least 32 characters)
- Use HTTPS in production
- Validate token issuer (`TOKEN_ISSUER`)
- Set appropriate token expiration times
- Enable `TerrenoApp` `rateLimit` so login/signup/refresh use the stricter `auth` bucket (20 / 15 min). See [Rate limiting](../how-to/rate-limiting.md).
- Keep login/signup/refresh reachable when the client still sends an expired access JWT. Those three routes skip JWT verification; `/auth/me` and other APIs still 401.
- Log authentication failures

❌ **Don't:**
- Commit secrets to version control
- Use the same secret for tokens and refresh tokens
- Store sensitive data in JWT payload (it's base64, not encrypted)
- Allow infinite token lifetimes

### Frontend

✅ **Do:**
- Use SecureStore on mobile for token storage
- Clear tokens on logout
- Handle token expiration gracefully
- Show user feedback during auth flows
- Validate tokens before making authenticated requests

❌ **Don't:**
- Store tokens in localStorage on web (use httpOnly cookies in production)
- Log tokens to console
- Send tokens in URL query parameters (MCP service tokens included)
- Ignore token refresh failures

## Environment Variables

Required for authentication:

``````bash
# JWT Configuration
TOKEN_SECRET=your-secret-key-min-32-chars
TOKEN_ISSUER=your-app-name
REFRESH_TOKEN_SECRET=different-secret-key-min-32-chars
SESSION_SECRET=session-secret-min-32-chars

# Optional: Custom expiration times
TOKEN_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=30d

# GitHub OAuth (if using)
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:4000/auth/github/callback

# Optional: Disable user registration
SIGNUP_DISABLED=false
``````

## Authentication Middleware

### Protecting Routes

Use `authenticateMiddleware()` to require authentication:

``````typescript
import {authenticateMiddleware, asyncHandler} from "@terreno/api";

router.get("/protected", [
  authenticateMiddleware(),
  asyncHandler(async (req, res) => {
    // req.user is populated with authenticated user
    const userId = req.user?._id;
    return res.json({userId});
  }),
]);
``````

### Anonymous Access

Allow unauthenticated requests but populate `req.user` if token is present:

``````typescript
router.get("/public", [
  authenticateMiddleware({anonymous: true}),
  asyncHandler(async (req, res) => {
    // req.user is populated if token provided, undefined otherwise
    const isLoggedIn = !!req.user;
    return res.json({isLoggedIn});
  }),
]);
``````

## Troubleshooting

### "Invalid token"

- Token has expired — frontend should refresh
- Token signature invalid — check `TOKEN_SECRET` matches
- Token issuer mismatch — verify `TOKEN_ISSUER` is correct

### "No auth token provided"

- Missing `Authorization` header
- Header format incorrect (should be `Bearer <token>`)

### Token refresh fails

- Refresh token expired — user must log in again
- `REFRESH_TOKEN_SECRET` mismatch between token creation and validation
- Refresh token revoked (user logged out)

### User logged out unexpectedly

- Access token expired and refresh failed
- Backend `TOKEN_SECRET` changed (invalidates all tokens)
- Token storage cleared (app reinstall, cache clear)

## Advanced Topics

### Custom User Fields in Token

Add custom fields to JWT payload:

``````typescript
setupServer({
  authOptions: {
    generateJWTPayload: (user) => ({
      sub: user._id,
      admin: user.admin,
      organizationId: user.organizationId,
      roles: user.roles,
    }),
  },
});
``````

### Multi-Tenant Authentication

Scope users to organizations:

``````typescript
const queryFilter = (user, _query) => ({
  organizationId: user?.organizationId,
});

modelRouter(Model, {
  permissions: {list: [Permissions.IsAuthenticated]},
  queryFilter,
});
``````

### Webhook Authentication

Verify signatures on `WebhooksApp` using `req.rawBody`. Do not `JSON.stringify(req.body)`
and do not put webhook POSTs in OpenAPI.

```typescript
import {hmacSignature, TerrenoApp, WebhooksApp} from "@terreno/api";

const webhooks = new WebhooksApp({idempotency: {store: "mongo"}});
webhooks.route({
  path: "/webhooks/example",
  source: "example",
  verify: hmacSignature({secret: process.env.WEBHOOK_SECRET!, header: "X-Webhook-Signature"}),
  eventId: (req) => String((req.body as {id?: string})?.id ?? ""),
  handler: async () => undefined,
});

new TerrenoApp({userModel: User}).register(webhooks).start();
```

See [Receive inbound webhooks](../how-to/inbound-webhooks.md).

## Learn More

- [Receive inbound webhooks](../how-to/inbound-webhooks.md)
- [Add GitHub OAuth](../how-to/add-github-oauth.md)
- [Create a model](../how-to/create-a-model.md)
- [API reference](../reference/api.md)
- [@terreno/rtk reference (legacy)](../reference/legacy/rtk.md)
