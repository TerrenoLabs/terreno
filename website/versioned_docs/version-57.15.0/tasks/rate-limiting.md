# Tasks: API rate limiting

IP: [rate-limiting.md](../implementationPlans/rate-limiting.md)  
**Closes:** https://github.com/TerrenoLabs/terreno/issues/1187

**Feature profile:** false (full IP)

## Phase 1 — Tracer (memory, TerrenoApp)

- [x] **Task 1.1**: Rate-limit module + TerrenoApp mount
  - Delivers: `rateLimit: {}` on `TerrenoApp` limits HTTP; omitted option is a no-op; `POST /auth/login` uses the auth bucket (20 / 15 min); modelRouter list uses `api` (600 / 15 min); skip `/health` and `/openapi.json`; 429 `APIError` `code: "rate-limit-exceeded"` with `Retry-After` and IETF `RateLimit` / `RateLimit-Policy`; memory store; `trust proxy` default `1` when enabled
  - Files: `api/src/rateLimit/types.ts`, `api/src/rateLimit/store.ts`, `api/src/rateLimit/memoryStore.ts`, `api/src/rateLimit/policies.ts`, `api/src/rateLimit/middleware.ts`, `api/src/rateLimit/rateLimit.test.ts`, `api/src/terrenoApp.ts`, `api/src/index.ts`, `api/src/api.ts` (remove `TODO add rate limit`)
  - Blocked by: none
  - Skills: `terreno-backend-api`, `backend-test-env`, `update-docs`
  - Docs: stub section in `docs/reference/api.md` (`rateLimit` option) so the tracer is documented when it lands
  - Acceptance: bun tests — default off (burst login no 429); auth 20 then 429; 21st list GET still 200; 601st list 429; `/health` never 429; 429 body/headers; login classified auth

## Phase 2 — Shared stores

- [x] **Task 2.1**: Redis store
  - Delivers: `store: "redis"` uses `VALKEY_URL` then `REDIS_URL`; missing URL fails startup with a clear `APIError`; consume contract matches memory
  - Files: `api/src/rateLimit/redisStore.ts`, tests with a fake client; optional skip-if-no-redis integration
  - Blocked by: 1.1
  - Skills: `terreno-backend-api`
  - Docs: store table in `docs/how-to/rate-limiting.md` (create page if 4.1 not started — Pick may write the Redis rows into the how-to started in 1.1/4.1)
  - Acceptance: unit tests against the store interface; startup failure without URL

- [x] **Task 2.2**: Mongo store
  - Delivers: `store: "mongo"` uses the process mongoose connection and `rateLimitHits` with TTL expiry; same consume contract
  - Files: `api/src/rateLimit/mongoStore.ts` (+ schema/types if a model is used), tests against in-memory Mongo via existing `@terreno/test` harness
  - Blocked by: 1.1
  - Skills: `mongoose-schema-safety` (if a Mongoose schema is added), `backend-test-env`
  - Docs: Mongo collection / TTL note on the how-to
  - Acceptance: two keys isolated; expiry/window reset; no public modelRouter for hits

## Phase 3 — Paths and proxy

- [x] **Task 3.1**: Auth path table + Better Auth / GitHub
  - Delivers: GitHub OAuth start/callback on auth bucket; Better Auth `basePath` sign-in/sign-up/forget-password on auth; `/auth/me` on api; extra `skip` callback honored
  - Files: `api/src/rateLimit/policies.ts`, tests
  - Blocked by: 1.1
  - Acceptance: supertest (or middleware unit tests with req.url) for each classified prefix

- [x] **Task 3.2**: Trust-proxy keying
  - Delivers: with `trustProxy: 1`, `X-Forwarded-For` client IP is the unauthenticated key; `trustProxy: false` ignores spoofed forwarded-for; override hop count works
  - Files: `api/src/rateLimit/*.ts`, `api/src/terrenoApp.ts`, tests
  - Blocked by: 1.1
  - Acceptance: two tests (trust on vs off) with distinct `X-Forwarded-For` values

## Phase 4 — Docs and example

- [x] **Task 4.1**: Diátaxis + changelog + rules
  - Delivers: operator how-to, reference, auth explanation, env reference (no enable env), replace misleading `RATE_LIMIT_*` snippet in configuration-system, Terreno 58 default-on note, `.rulesync/rules/api/00-api.mdc`, `CHANGELOG.md` Added
  - Files: `docs/how-to/rate-limiting.md`, `docs/reference/api.md`, `docs/reference/environment-variables.md`, `docs/explanation/authentication.md`, `docs/explanation/configuration-system.md`, `.rulesync/rules/api/00-api.mdc`, `CHANGELOG.md`; `bun run rules` / `skills:sync` if required after rulesync
  - Blocked by: 1.1 (content can land with 2.x/3.x; must match shipped stores)
  - Skills: `update-docs`
  - Acceptance: a stranger can enable Redis on Cloud Run from the how-to; 58 default-on is explicit; `bun run website:build` if docs site is in the slice

- [x] **Task 4.2**: example-backend snippet (limiter stays off)
  - Delivers: commented `rateLimit: process.env.RATE_LIMIT_ENABLED === "true" ? {store: "memory"} : undefined` (or equivalent) showing app-owned env
  - Files: `example-backend/src/server.ts` (or `index`/`terrenoApp` bootstrap)
  - Blocked by: 1.1
  - Acceptance: default example server still has no limiter; comment compiles if uncommented

- [x] **Task 4.3**: Roadmap seed + 58 upgrade stub
  - Delivers: `docs/explanation/roadmap-seed-issues.md` `rate-limiting` section points at IP/task GitHub URLs and `IP=rate-limiting`; how-to or `mcp-server/src/docs/upgrades/` notes that Terreno 58 defaults the limiter on
  - Files: `docs/explanation/roadmap-seed-issues.md`; upgrade note path named in how-to until 58 exists
  - Blocked by: 4.1
  - Skills: `update-docs`
  - Acceptance: seed `Implementation plan` / `Tasks` links are not `*(not yet written)*`
