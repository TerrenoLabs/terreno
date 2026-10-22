# Rate limiting

`TerrenoApp` turns on HTTP rate limiting by default (Terreno 58 and later). Omitting `rateLimit` mounts the limiter with the memory store and the default limits. The framework does **not** read `RATE_LIMIT_ENABLED`.

## Default (memory)

```typescript
new TerrenoApp({userModel: User});
```

That is the same as `rateLimit: {}` or `rateLimit: {store: "memory"}`: auth 20 / 15 min, api 600 / 15 min, one bucket per Node process.

## Cloud Run

Cloud Run sits behind one Google Front End hop. Without `trustProxy`, every unauthenticated request shares the front end's address, so all users share one auth bucket (20 logins per 15 minutes for the whole service). Pass `trustProxy: 1`:

```typescript
new TerrenoApp({
  userModel: User,
  rateLimit: {trustProxy: 1},
});
```

The limiter sets Express `trust proxy` from `rateLimit.trustProxy` when it mounts. Set it there, not with `app.set("trust proxy", …)` before `build()`.

## Turn it off

Pass `false`:

```typescript
new TerrenoApp({
  userModel: User,
  rateLimit: false,
});
```

Apps that want an env toggle own it:

```typescript
new TerrenoApp({
  userModel: User,
  rateLimit: process.env.RATE_LIMIT_DISABLED === "true" ? false : {trustProxy: 1},
});
```

## Tests

Each `build()` creates a fresh memory store, so most suites never reach a limit. A suite that logs in more than 20 times or sends more than 600 requests against one app instance should pass `rateLimit: false` in its shared app helper, or raise `limits`.

## Redis on Cloud Run

1. Add a Valkey or Redis instance (Memorystore or equivalent).
2. Set `VALKEY_URL` (preferred) or `REDIS_URL` on the Cloud Run service. Same URL as realtime Redis.
3. Pass `store: "redis"`:

```typescript
new TerrenoApp({
  userModel: User,
  rateLimit: {store: "redis", trustProxy: 1},
});
```

4. Install `ioredis` in the app that runs `@terreno/api` if it is not already a dependency.
5. Missing `VALKEY_URL` / `REDIS_URL` fails **startup** when `store: "redis"` (clear `APIError`).

## Stores

| `store` | When to use | Config |
| --- | --- | --- |
| `memory` (default) | Single process | none |
| `redis` | Shared bucket across replicas | `VALKEY_URL` then `REDIS_URL` |
| `mongo` | Shared bucket without Redis | Open mongoose connection; collection `rateLimitHits` with TTL on `expiresAt` |

## Mongo

Pass `{store: "mongo"}`. Hits live in `rateLimitHits` on the same mongoose connection as the app. A TTL index on `expiresAt` expires windows. This collection is not a `modelRouter` resource.

Unauthenticated keys use `req.ip`. Express `trust proxy` defaults to **off** so a client cannot rotate `X-Forwarded-For` to bypass the auth bucket. On Cloud Run (one hop via GFE), pass `trustProxy: 1` (see [Cloud Run](#cloud-run)). Extra proxies: hop count or a subnet list. `trustProxy: false` is the same as the default.

## Limit one route

Use `createRouteRateLimitMiddleware` for a stricter limit on one expensive route. It works with or without the global limiter.

```typescript
import {createRouteRateLimitMiddleware} from "@terreno/api";

const uploadLimit = createRouteRateLimitMiddleware({
  name: "uploads",
  max: 1,
  windowMs: 60_000,
  store: "mongo",
});
```

`DocumentStorageApp` takes the same options as `uploadRateLimit`. The example backend allows one upload per IP per minute and sets `trust proxy` to `1` on Cloud Run so the key is the real client IP.

## Auth vs API buckets

| Path | Bucket |
| --- | --- |
| `POST /auth/login`, `/auth/signup`, `/auth/refresh_token` | auth (20 / 15 min) |
| `POST /auth/forgotPassword`, `/auth/resetPassword`, `/resetPassword` | auth |
| `POST /auth/sendVerification`, `/auth/verifyEmail` | auth |
| `GET /auth/github`, `/auth/github/callback` | auth |
| `{betterAuthBasePath}/sign-in/*`, `sign-up/*`, `forget-password`, `request-password-reset`, `reset-password`, `send-verification-email`, `verify-email`, `callback/*`, `oauth-handoff/*`, `one-time-token/*` | auth |
| Trailing slash on those paths (`/auth/login/`) | same bucket as the unsuffixed path |
| `GET`/`PATCH /auth/me` | api (600 / 15 min) |
| modelRouter, admin, AI HTTP, `POST /mcp`, `POST /sync/mutate` | api |
| `GET /health`, `/healthz`, `/openapi.json`, `/swagger` | skip |

`rateLimit.skip` adds extra skips. Health/openapi/swagger always skip. Paths use Express `req.path` (not the raw request-target), without a trailing slash.

JWT login/signup/refresh and password-reset paths skip access-token verification so a stale `Authorization` header cannot block credential exchange. Other routes still 401 on an expired JWT. Path matching uses Express `req.path` and ignores trailing slashes and letter case.

Auth-bucket keys are always the client IP, even if a Better Auth session already set `req.user`. API traffic still keys by user when authenticated.

When `BetterAuthApp` is registered, TerrenoApp copies its `config.basePath` into the limiter unless you set `rateLimit.betterAuthBasePath`.
