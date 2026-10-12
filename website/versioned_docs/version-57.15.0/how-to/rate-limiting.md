# Rate limiting

Turn on HTTP rate limiting for `@terreno/api` by passing `rateLimit` on `TerrenoApp`. The framework does **not** read `RATE_LIMIT_ENABLED`.

Terreno 58 will default the limiter **on**. Until then, omit `rateLimit` to leave it off.

## Terreno 58 (not this release)

When Terreno 58 is cut, `TerrenoApp` will enable the limiter by default. Apps that must stay unlimited will pass an explicit off (documented in the 58 upgrade note). Until then, omitted `rateLimit` is unlimited. Stub: [`mcp-server/src/docs/upgrades/58.0.0.md`](../../mcp-server/src/docs/upgrades/58.0.0.md).

## Enable (memory)

```typescript
new TerrenoApp({
  userModel: User,
  rateLimit: process.env.RATE_LIMIT_ENABLED === "true" ? {store: "memory"} : undefined,
});
```

Empty `{}` is the same as `{store: "memory"}`.

## Redis on Cloud Run

1. Add a Valkey or Redis instance (Memorystore or equivalent).
2. Set `VALKEY_URL` (preferred) or `REDIS_URL` on the Cloud Run service. Same URL as realtime Redis.
3. Pass `store: "redis"` only when you intend to enable the limiter:

```typescript
new TerrenoApp({
  userModel: User,
  rateLimit:
    process.env.RATE_LIMIT_ENABLED === "true"
      ? {store: "redis", trustProxy: 1}
      : undefined,
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

Unauthenticated keys use `req.ip`. Express `trust proxy` defaults to **off** so a client cannot rotate `X-Forwarded-For` to bypass the auth bucket. On Cloud Run (one hop via GFE), pass `trustProxy: 1`. Extra proxies: hop count or a subnet list. `trustProxy: false` is the same as the default.

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
| `{betterAuthBasePath}/sign-in/*`, `sign-up/*`, `forget-password`, `request-password-reset`, `reset-password`, `send-verification-email`, `verify-email`, `callback/*` | auth |
| Trailing slash on those paths (`/auth/login/`) | same bucket as the unsuffixed path |
| `GET`/`PATCH /auth/me` | api (600 / 15 min) |
| modelRouter, admin, AI HTTP, `POST /mcp`, `POST /sync/mutate` | api |
| `GET /health`, `/healthz`, `/openapi.json`, `/swagger` | skip |

`rateLimit.skip` adds extra skips. Health/openapi/swagger always skip. Paths use Express `req.path` (not the raw request-target), without a trailing slash.

JWT login/signup/refresh and password-reset paths skip access-token verification so a stale `Authorization` header cannot block credential exchange. Other routes still 401 on an expired JWT. Path matching uses Express `req.path` and ignores trailing slashes and letter case.

Auth-bucket keys are always the client IP, even if a Better Auth session already set `req.user`. API traffic still keys by user when authenticated.

When `BetterAuthApp` is registered, TerrenoApp copies its `config.basePath` into the limiter unless you set `rateLimit.betterAuthBasePath`.



