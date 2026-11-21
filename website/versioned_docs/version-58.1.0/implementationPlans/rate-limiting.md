# Implementation Plan: API rate limiting

**Status:** Complete  
**Branch:** `cursor/api-rate-limiting-d03a`  
**Owner:** —  
**Created:** 2026-08-30  
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1187 (this feature **closes** that issue; implementation PRs use `Fixes #1187`)  
**Task list:** [rate-limiting.md](../tasks/rate-limiting.md)  
**Depends on:** —  
**RTK deprecation flag:** None  

## Goal

Opt-in HTTP rate limiting on `TerrenoApp` covering modelRouter and the other framework HTTP surfaces (JWT login/signup/refresh, Better Auth credential routes, GitHub OAuth, admin, AI HTTP, in-process `POST /mcp`, custom OpenAPI routes). Default store is in-process memory. Operators may switch to Redis or Mongo for a shared bucket across replicas. Login uses a stricter `auth` bucket than general CRUD. Terreno **58** flips the default to on (documented now; not this release).

## Non-Goals

- Default-on in this release (Terreno 58).
- Framework auto-read of `RATE_LIMIT_ENABLED` (apps may pass `process.env` into `rateLimit` themselves).
- Per-org keys (`org-management-ui` is not shipped).
- Replacing the existing sync mutation limiter in `api/src/sync/syncBatch.ts` (per-user in-process mutation budget + `rate_limited` nacks).
- Hosted `@terreno/mcp` JSON-RPC rate limiting (`ai-dev-loop-boost` Task 5.3).
- example-frontend / `@terreno/rtk` UI for 429.
- IETF `RateLimit` headers on successful responses.
- Account lockout / captcha.

## Decisions

| Question | Decision |
|----------|----------|
| Default | **Off.** `rateLimit` omitted or `undefined` → no limiter. Terreno 58 defaults to on; record that in how-to + upgrade notes now. |
| Enable API | Object only: `rateLimit: { store?, limits?, trustProxy?, skip? }`. Empty `{}` enables defaults. Framework does **not** read an enable env var. |
| Coverage | Global Express middleware after auth populates `req.user`. Skip `/health`, `/openapi.json`, `/swagger`. Keep sync mutation limiter and realtime subscribe caps as-is. |
| Key | Authenticated `req.user.id` (or `_id`), else Express `req.ip`. |
| Auth vs API | `auth`: 20 requests / 15 min. `api`: 600 / 15 min. Overridable via `rateLimit.limits`. |
| Auth paths | JWT `POST /auth/login`, `/signup`, `/refresh_token`; GitHub OAuth start/callback; Better Auth sign-in/sign-up/forget-password under `basePath` (default `/api/auth`); future password-reset/OTP routes join this list when they land. `/auth/me` is `api`. |
| Proxy | When limiter is enabled, `app.set("trust proxy", 1)` unless `rateLimit.trustProxy` is set (`false` \| hop count \| IP/subnet list). Key unauthenticated traffic with `req.ip` only — never parse `X-Forwarded-For` / `Forwarded` unless trust proxy is on. |
| Stores | `memory` (default, per process) \| `redis` (`VALKEY_URL` then `REDIS_URL`, same as realtime) \| `mongo` (app mongoose connection, `rateLimitHits` collection + TTL). |
| 429 | `APIError` status 429, `code: "rate-limit-exceeded"`, `title: "Too many requests"`. Headers: `Retry-After` plus IETF `RateLimit` / `RateLimit-Policy` (`limit`, `remaining`, `reset`) on the 429 only. |
| Frontend | No client work this slice. |
| Tests | Burst tests enable the limiter in-process. Existing suites stay green because default is off. |

## Architecture

```
TerrenoApp({ rateLimit: { store, limits, trustProxy } })
  → after JWT / Better Auth session middleware
  → skip health / openapi / swagger
  → policy = auth path ? auth : api
  → key = userId || req.ip
  → store.consume(key, policy)
  → next() or APIError 429 + headers
```

Mount **after** `setupAuth` / Better Auth session so authenticated CRUD shares a user bucket. Login has no user yet → IP key (correct for password spray).

Do not add per-route middleware on each `modelRouter` verb. The `TODO add rate limit` on `GET /` in `api/src/api.ts` is deleted once global middleware exists.

### Config shape

```typescript
interface RateLimitLimits {
  windowMs?: number; // default 15 * 60 * 1000
  authMax?: number;  // default 20
  apiMax?: number;   // default 600
}

interface RateLimitOptions {
  store?: "memory" | "redis" | "mongo";
  limits?: RateLimitLimits;
  trustProxy?: boolean | number | string | string[];
  skip?: (req: Request) => boolean; // extra skips; health/openapi/swagger always skipped
}
```

`TerrenoAppOptions.rateLimit?: RateLimitOptions`.

App-owned env example (not implemented inside `@terreno/api`):

```typescript
new TerrenoApp({
  userModel: User,
  rateLimit: process.env.RATE_LIMIT_ENABLED === "true" ? {store: "redis"} : undefined,
});
```

### Stores

| Store | When | Semantics |
|-------|--------|-----------|
| `memory` | default | Per Node process. Document Cloud Run: N instances = N independent buckets. |
| `redis` | `store: "redis"` | Optional peer / lazy import matching realtime (`VALKEY_URL` \|\| `REDIS_URL`). Fail startup if URL missing. |
| `mongo` | `store: "mongo"` | Uses existing mongoose connection. Collection `rateLimitHits` with TTL on window expiry. Not a public modelRouter model. |

Prefer a small `RateLimitStore` interface (`consume({key, max, windowMs}) → {allowed, remaining, resetAt}`) so Redis/Mongo adapters are testable without Express. `express-rate-limit` is allowed if the store interface still holds and 429 goes through `APIError`.

### Skip list (always)

- `GET /health` (and common aliases if already mounted, e.g. `/healthz`)
- `GET /openapi.json`
- `/swagger` prefix when Swagger is enabled

Sync HTTP (`POST /sync/mutate`) is **not** skipped: it is `api` bucket HTTP *plus* the existing mutation nack limiter. That is intentional (HTTP flood vs mutation budget).

### Trust proxy

Express `req.ip` is the load-balancer address until `trust proxy` is set. Cloud Run is one hop (GFE). Default `1` when the limiter is on. Operators behind extra proxies set `trustProxy: 2` (or a subnet). `trustProxy: false` keeps the socket address (tests, local). Spoofing `X-Forwarded-For` without trust proxy must not change the key.

## Models

No public CRUD model. Mongo store may use an internal schema (`key`, `hits`, `expiresAt`) with field `description`s if it is a Mongoose model; otherwise a raw collection with a TTL index. Follow `mongoose-schema-safety` if a schema is added. No user-facing migration.

## APIs

| Method | Path | Policy |
|--------|------|--------|
| POST | `/auth/login` | auth |
| POST | `/auth/signup` | auth |
| POST | `/auth/refresh_token` | auth |
| GET | `/auth/github`, `/auth/github/callback` | auth |
| * | `{betterAuth.basePath}/sign-in/*`, `sign-up/*`, `forget-password` | auth |
| GET/PATCH | `/auth/me` | api |
| * | modelRouter, admin, AI HTTP, `POST /mcp` | api |
| GET | `/health`, `/openapi.json` | skip |

429 body is the existing JSONAPI `APIError` serializer (`TooManyRequestsError` name already mapped in `errors.ts`).

## Notifications

None.

## UI

None this slice. example-backend: commented or docs-only snippet showing how to enable; **do not** turn the limiter on in the default example server.

## Docs in this slice

| Page | Change |
|------|--------|
| `docs/how-to/rate-limiting.md` | **New.** Enable object, stores, trust proxy, auth vs api numbers, Terreno 58 default-on, memory vs replica warning. |
| `docs/reference/api.md` | `rateLimit` on `TerrenoApp`; skip list; 429. |
| `docs/reference/environment-variables.md` | Redis URLs reused; no new required enable env. |
| `docs/explanation/authentication.md` | Replace “implement rate limiting” with the opt-in `auth` bucket. |
| `docs/explanation/configuration-system.md` | Replace the fake `RATE_LIMIT_MAX` `express-rate-limit` snippet so it is not the HTTP limiter. |
| `docs/explanation/roadmap-seed-issues.md` | IP + task URLs for `rate-limiting`. |
| `mcp-server/src/docs/upgrades/` (next minor or a **58** stub section in how-to) | Default-on when Terreno 58 is cut; this slice documents the promise. |
| `.rulesync/rules/api/00-api.mdc` | `rateLimit` option. |
| `CHANGELOG.md` | Added opt-in rate limiting. |

## Testing

Tracer: `TerrenoApp` with `rateLimit: {}` → 21st `POST /auth/login` in 15 min → 429 + headers; 21st list GET still allowed until 601.

Cases:

- Default off: 100 logins succeed (no 429).
- Auth bucket: 20 allowed, 21st 429; `api` still has remaining.
- API bucket: 600 allowed, 601st 429 on a modelRouter list.
- Skip: `/health` never 429.
- Authenticated user: two IPs, same user, share `api` budget.
- Unauthenticated: two users behind one IP share `auth` login budget.
- `trustProxy: 1` + `X-Forwarded-For`: key is client IP; without trust proxy, spoofed header ignored.
- Memory store isolation between keys.
- Redis/Mongo: unit tests with fake store; optional integration if env present, skip otherwise.
- Existing `api/` suite unchanged with limiter off.

Skills: `backend-test-env` if any test mutates env (Redis URL). `mongoose-schema-safety` if Mongo store uses a schema.

## Risks

| Risk | Mitigation |
|-------|-----------|
| Default-on later breaks burst tests | 58 upgrade note + test helper `disableRateLimit` or omit option; current tests stay off. |
| Memory store on Cloud Run | Docs: shared store required for a global bucket. |
| Trust proxy spoofing | Never honor forwarded headers unless `trust proxy` is set. |
| Auth path drift (Better Auth) | Central path table + tests against default `basePath`; configurable extra prefixes. |
| Double limit with sync mutate | Documented; HTTP `api` + mutation nack are different units. |

## Phases

1. Store interface + memory + 429 + skip + auth/api classification + TerrenoApp mount (tracer).
2. Redis + Mongo adapters.
3. Trust-proxy tests + GitHub/Better Auth path coverage.
4. Docs, changelog, rulesync, example-backend snippet, seed-issue links.

## Files to Create / Modify

| File | Role |
|------|--------|
| `api/src/rateLimit/*.ts` | Options, middleware, stores, path tables |
| `api/src/terrenoApp.ts` | `rateLimit` option + mount + trust proxy |
| `api/src/api.ts` | Remove list-GET TODO |
| `api/src/index.ts` | Export types |
| `api/src/rateLimit/*.test.ts` | Tracer + cases above |
| `example-backend/src/server.ts` | Commented enable snippet |
| Docs listed above | Same slice |

## Task List

[docs/tasks/rate-limiting.md](../tasks/rate-limiting.md)

## Acceptance Criteria

- [ ] Limiter off by default; existing `bun run api:test` does not 429 from this feature.
- [ ] `rateLimit: {}` enforces auth 20 / api 600 per 15 min with documented keys.
- [ ] `POST /auth/login` is on the auth bucket.
- [ ] Redis and Mongo stores implement the same consume contract.
- [ ] Trust proxy 1 + `req.ip` behind a forwarded-for header; spoofing ignored when trust is off.
- [ ] 429 is `APIError` with `Retry-After` and `RateLimit` headers.
- [ ] Docs how-to + reference + auth explanation + Terreno 58 default-on note exist.
- [ ] Sync mutation limiter behavior unchanged (existing sync tests still pass).
- [ ] Merging the implementation PR closes https://github.com/TerrenoLabs/terreno/issues/1187 (`Fixes #1187`).
