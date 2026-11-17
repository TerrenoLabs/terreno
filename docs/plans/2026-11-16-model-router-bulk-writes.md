# Bulk writes on modelRouter

`@terreno/api`'s `modelRouter` writes one document per request. A client that has to
create, update, or delete many records has to send one request per record, with no way to
make the set succeed or fail together. The only batch paths today are the admin panel's
`bulk-patch` (which skips the router's hooks and `responseHandler`) and the sync outbox
batch (synced models only). This change adds an opt-in `POST /<route>/bulk` endpoint to any
`modelRouter`. Each item goes through the same permissions, hooks, validation, audit, and
`responseHandler` as the single-document routes. By default the whole batch commits or
rolls back in one Mongo transaction. App developers building imports, multi-select edits,
and agent tools get this, and so do their end users.

## The idea

A router opts in with `bulk: true` or `bulk: {maxItems?: number, methods?: ("create" | "update" | "delete")[]}`.
This mounts `POST /<route>/bulk`:

```jsonc
// request
{
  "atomic": true,                       // optional, default true
  "operations": [
    {"method": "create", "body": {...}},
    {"method": "update", "id": "<id>", "body": {...}},   // body may carry _updatedAt for conflict detection
    {"method": "delete", "id": "<id>"}
  ]
}
// 200 response (both modes when every item succeeds; partial mode always)
{"data": [
  {"index": 0, "method": "create", "id": "<new id>", "status": 201, "data": {/* responseHandler(doc, "create") */}},
  {"index": 1, "method": "update", "id": "<id>",     "status": 200, "data": {/* responseHandler(doc, "update") */}},
  {"index": 2, "method": "delete", "id": "<id>",     "status": 204}
]}
```

- **Atomic (default).** All items run inside one Mongo transaction, joined through Mongoose's
  `transactionAsyncLocalStorage`, so writes made inside `pre*` hooks roll back too. `post*`
  hooks, audit events, and `responseHandler` run only after the commit. The first failing item
  aborts the transaction. The response then carries that item's own status, with the same
  error body the single route would return plus `meta.index`. No other item's data is
  returned.
- **Partial (`"atomic": false`).** Items run in order, each committed on its own. A failure
  is recorded and the batch continues. The response is always 200, with one entry per item in
  input order. A failed entry is `{index, method, id?, status, error}`, where `error` is the
  body the single route would have returned (a 409 conflict also carries `data`, the
  server's current doc).
- **Shared pipeline.** Every item goes through `executeCreate` / `executeUpdate` /
  `executeDelete` (`api/src/sync/executors.ts`). These are the same functions behind
  `POST /`, `PATCH /:id`, and `DELETE /:id`, so the item gets the same method and object
  permissions (405, 403, 404), transformer, pre/post hooks, RBAC write guards, Mongoose
  validation, population, and soft delete. Each hook receives a per-item request whose
  `body` is the item's body and whose `params.id` is the item's id.

Rejected alternative: Mongo `bulkWrite` / `updateMany`. They skip Mongoose middleware and
every router hook, and they are disabled on synced models (`registrationSideEffects.ts:96`).

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Replica-set lane for transaction tests | none | api test setup | a canary test that opens a transaction passes in `bun run api:test` and CI |
| T2 | Tracer: `bulk` option + `POST /bulk` envelope + partial-mode create | none | `api/src/bulk.ts`, `api/src/api.ts` | supertest: creates go through permissions, preCreate, responseHandler |
| T3 | Partial-mode update and delete | T2 | `api/src/bulk.ts` | supertest: object permissions, conflicts, soft delete, per-item results |
| T4 | Atomic mode (default) in a transaction | T1, T3 | `api/src/bulk.ts`, `api/src/bulkTransaction.ts` | supertest on a replica set: a failure rolls back every item and hook write |
| T5 | OpenAPI for `/bulk` | T2 | `api/src/bulkOpenApi.ts` | `/openapi.json` documents the envelope; codegen emits a hook |
| T6 | Example + docs | T4, T5 | example-backend todos, docs | example test passes; docs pages updated |

Tracer: `POST /<route>/bulk` → `executeCreate` → `responseHandler`, partial mode
E2E: None — backend framework route, proven in-process with supertest (the e2e guide's lowest tier); the api `http` smoke runs once per package and is unchanged
Regression: None — no hard-to-automate change
User guide: None — no user-visible change
Design: None — backend only
Out of scope: X1 bulk MCP tool, X2 per-item rate limiting, X3 syncdb local-store bulk, X4 admin bulk-patch on this path
Open risks: transactions need a replica set (the dev stack already requires one, but a standalone Mongo cannot serve atomic bulk); a hook that reads `req.body` expecting the whole request will see only its item; one request of up to `maxItems` (100) writes costs one rate-limit token (X2)
Elephant: atomic mode turns on `transactionAsyncLocalStorage` on the app's shared Mongoose instance, so any app code running inside a bulk request (hooks, plugins) silently joins the transaction. That is intended, but it means a slow or external-I/O hook holds the transaction open, and Mongo aborts transactions after 60s by default.

## E2E tests

None — `bulk` is a backend framework route with no frontend flow. Every criterion is proven
in-process with supertest against a real Mongo, which is the e2e guide's
unit-and-integration tier (`docs/testing/e2e.md` "Test tiers"). The api package's `http`
smoke covers the built entry once per package, and this change does not touch it.

## Regression cases

None — no hard-to-automate change.

## User guide

None — no user-visible change. This is a developer-facing API, documented in
`docs/reference/api.md` (T6).

## Design

None — backend only.

## Tasks

- [x] **T1** — Run api transaction tests on a replica set
  - Depends on: none
  - Files: api/src/tests/mongoTopology.ts, api/src/isolated/mongoTopology.isolated.ts, api/package.json, docs/explanation/test-isolation.md, docs/explanation/test-sharding.md
  - Seam: the api test runner's isolated lane
  - Interface: an `api/src/isolated/*.isolated.ts` file calls
    `useMongoTopology({topology: "replicaSet" | "standalone"})` from
    `api/src/tests/mongoTopology.ts`, which swaps the default mongoose connection to a fresh
    in-memory Mongo of that topology for that process only. The api `test`, `test:ci`, and
    `test:agent` scripts pass `--isolated` so local runs include these files (`test:coverage`
    already does). Every other api test keeps the standalone preload.
  - Changed from the approved brief (T1): the brief named a `*.atomic.test.ts` lane with
    `TERRENO_TEST_USE_REPLSET=true`, but `registerSimpleMongoPreload` ignores that variable
    (it connects to `TERRENO_TEST_MONGODB_URI` or `127.0.0.1`, standalone on CircleCI), and the
    repo already runs `*.isolated.ts` files one process each, so the swap reuses that lane.
  - Cases:
    - the canary opens `mongoose.connection.startSession()`, runs `startTransaction()`,
      inserts a doc, aborts, and the doc does not exist
    - the canary runs in `bun run api:test`, `bun run api:test:ci`, and the CircleCI api job,
      and is not skipped
    - other api tests keep the standalone preload (suite wall time is not meaningfully worse)
  - Blast radius: none
  - Test skills: terreno-test-setup, terreno-backend-tests
  - Docs: `docs/explanation/test-isolation.md` or `docs/reference/test.md`, saying how to opt
    a file into a replica set

- [x] **T2** — Mount `POST /bulk` with the request envelope and partial-mode create
  - Depends on: none
  - Files: api/src/bulk.ts, api/src/bulk.test.ts, api/src/api.ts, api/src/errors.ts
  - Seam: `POST /<route>/bulk` (HTTP route via supertest; `getBaseServer` + `authAsUser`
    from `api/src/tests.ts`)
  - Interface:
    - `ModelRouterOptions.bulk?: boolean | {maxItems?: number; methods?: ("create"|"update"|"delete")[]}`.
      `true` means `{maxItems: 100, methods: ["create","update","delete"]}`. Absent or
      `false` means no route (POST `/bulk` then falls through to whatever the router
      already does, for example a 404, or a `bulk` collection action).
    - Body: `{atomic?: boolean, operations: Array<{method: "create", body: object} | {method: "update", id: string, body: object} | {method: "delete", id: string}>}`.
    - The route is mounted with the collection actions, before `endpoints` and the
      `/:id` routes, behind `authenticateMiddleware(options.allowAnonymous)`. It does
      **not** use `permissionMiddleware`: each item calls the executor without
      `existingDoc`, so the executor runs its own method and object checks.
    - Registration throws (status 500 APIError, like `assertNoActionCollisions`) when
      `bulk` is enabled and `collectionActions.bulk` exists.
    - In this task only `"atomic": false` runs. A request without `"atomic": false` returns
      501 `{code: "bulk-atomic-not-implemented"}` until T4 lands. Every test in this task
      sends `"atomic": false` explicitly, so the tests stay valid after T4.
    - Each create item: `executeCreate({model, options, body: item.body, req: itemReq, user})`,
      then `responseHandler(doc, "create", itemReq, options)`, then
      `void maybeRecordModelRouterAudit({operation: "create", verb: "created", ...})`.
      `itemReq` is a per-item request object: the real request's `user`, `headers`, and
      everything else, with `body = item.body`. Result `{index, method: "create", id, status: 201, data}`.
    - When `options.validation` / `configureOpenApiValidator()` enables create-body
      validation, each create item's body goes through `validateModelRouterBody` with
      `method: "create"`. A failure becomes that item's 400.
    - Envelope errors are a whole-request 400 with no write: missing or non-array
      `operations`, empty `operations`, more than `maxItems`, an unknown `method`, a method
      not in `bulk.methods`, update/delete without `id`, create/update without an object
      `body`, a non-boolean `atomic`.
    - Partial-mode failure entry: `{index, method, status, error}`. `error` is exactly the JSON
      body the error handler would send on the single route. One mapper,
      `toBulkItemError(error, req)` in `bulk.ts`, produces it: `mongooseErrorToAPIError`
      first (`errors.ts:450`), then a 500 fallback for anything that is not an APIError,
      then the same warn/error log and Sentry capture and the same serialization
      `apiErrorMiddleware` uses. This task exports those two helpers from `errors.ts`
      (`serializeAPIError`, `logAndCaptureAPIError`, both module-private today).
    - Post hooks: every item calls its executor with `skipPostHooks: true` and then runs
      `runPostCreate` itself (same for update/delete in T3). This makes partial and atomic
      mode share one post-hook path. A post hook that throws turns that item's entry into
      the error the single route returns (`400 post-create-hook-error`); the write stays
      committed, exactly like `POST /`.
    - Body validation: this task extracts the per-body check inside
      `getBodyValidationMiddleware` (`api.ts:609`) into an exported
      `validateModelRouterBody({model, options, method: "create" | "update", body})` that
      returns the cleaned body or throws the same 400. The existing middleware calls it, so
      `POST /` and `PATCH /:id` behave the same as before.
  - Cases (Food model from `tests.ts`, `atomic: false` everywhere):
    - router without `bulk` → `POST /food/bulk` is not the bulk handler (404, or matches no route)
    - `bulk: true`, IsAny create, 2 creates → 200, `data` length 2, statuses 201/201, both docs in Mongo, `data[i].data` equals what `POST /food` returns for the same body (responseHandler ran)
    - `preCreate` sets `calories = 14` → both stored docs have 14
    - `preCreate` returns null for the second item only → `data[0].status` 201, `data[1].status` 403 with `error.title` "Create not allowed"; the first doc exists
    - create permission `[IsAdmin]`, non-admin user → each item status 405
    - `bulk: {methods: ["update"]}` with a create item → 400, nothing written
    - `bulk: {maxItems: 2}` with 3 items → 400; `operations: []` → 400; `method: "upsert"` → 400
    - no token on a non-anonymous router → 401
    - `postCreate` runs once per created doc, in input order
    - `postCreate` throws `new Error("boom")` on item 1 → `data[0].status` 201, `data[1].status` 400 with `error.code` `post-create-hook-error`; both docs exist (same as `POST /food` with that hook)
    - `configureOpenApiValidator()` on, a create body with a wrong-typed field → that item 400 with the same `error` body `POST /food` returns for that body
    - Mongoose required-field ValidationError on one item → that item 400 with `error.meta.fields` set, matching `POST /food`
    - a `preCreate` that throws a plain `new Error("x")` → the single route's status and body for that hook (`400 pre-create-hook-error`); a non-APIError thrown past the executor → 500
    - existing `POST /` and `PATCH /:id` validation tests still pass after the `validateModelRouterBody` extraction
    - `audit: true` with AuditApp → one `AuditEvent` per created doc
    - router with `bulk: true` and `collectionActions: {bulk: ...}` → `modelRouter(...)` throws
    - `actions.test.ts:272` (a `bulk` collection action without `bulk` enabled) still passes
    - no `"atomic"` key → 501 `bulk-atomic-not-implemented`, nothing written
  - Blast radius: creates the same docs `POST /` creates. List/read and sync deltas read them, and those are covered by existing tests because the executor is shared. No new consumer.
  - Test skills: terreno-backend-tests
  - Docs: none in this task (T6)

- [ ] **T3** — Partial-mode update and delete items
  - Depends on: T2
  - Files: api/src/bulk.ts, api/src/bulk.test.ts, api/src/sync/executors.ts, api/src/sync/executors.test.ts
  - Seam: `POST /<route>/bulk`
  - Interface:
    - update item → body through `validateModelRouterBody({method: "update"})` (T2) when
      validation is on, then `executeUpdate({id, body, req: itemReq, skipPostHooks: true, ...})`,
      then `runPostUpdate` with the returned `cleanedBody` and `prevDoc`. `itemReq.params.id = id`.
      There is no `existingDoc`, so the executor runs the method check (405) before it loads
      the doc (404) and runs the object check (403), in the same order as `PATCH`. When
      `body._updatedAt` is set, build the same timestamp `concurrencyCheck` the `PATCH /:id`
      handler builds from `_updatedAt`. Headers are not used for bulk. Result:
      `{status: 200, data: responseHandler(doc, "update")}`. An `ExecutorConflictError`
      becomes `{status: 409, error: <exactly the PATCH 409 body>}`, which is
      `{data: responseHandler(serverDoc, "update"), error: "Conflict", message: "Document was modified since your last read"}` (`api.ts:1148`).
      Audit: `before` = `snapshotAuditBefore({doc: prevDoc})`, then
      `maybeRecordModelRouterAudit(operation: "update")`.
    - delete item → `executeDelete({id, req: itemReq, skipPostHooks: true, ...})`, then
      `runPostDelete`. Result: `{status: 204, id}`, with no `data`. `executeDelete` returns only
      `{doc}` today, so this task makes it also return `prevDoc` (the doc before the tombstone)
      when `skipPostHooks` is true, matching `executeUpdate`. Audit: operation "delete", `before` from `prevDoc`.
    - The same id may appear more than once. Items run in input order.
  - Cases (Food, `atomic: false`):
    - update 2 docs owned by user → statuses 200/200; Mongo reflects both; `preUpdate` and `postUpdate` each run twice; `postUpdate` receives `prevValue`
    - update permission `[IsOwner]`, one item targets another user's doc → that item 403, the other 200
    - update of a nonexistent id → 404; malformed id → the same status `PATCH /food/<malformed>` returns
    - update with a stale `_updatedAt` → entry status 409; `entry.error` deep-equals the body `PATCH /food/:id` returns for the same stale `_updatedAt`; a newer `_updatedAt` → 200
    - validation on, an update body with a wrong-typed field → that item 400 with the same body `PATCH /food/:id` returns
    - update permission `[]` and a nonexistent id → 405 (method check before load, like PATCH)
    - update body containing `deleted: true` on a soft-delete model → `deleted` is stripped (as on `PATCH`)
    - delete 2 docs on a soft-delete model → statuses 204/204; docs have `deleted: true`; `preDelete` and `postDelete` each run twice
    - delete permission `[]` → item 405
    - mixed `[create, update, delete]` in one request → statuses 201/200/204 in order
    - `audit: true` → one AuditEvent per item with the right operation and before/after
  - Blast radius: sync-enabled model (`syncPlugin` + `isDeletedPlugin`). Bulk update and delete
    in partial mode stamp `_syncSeq` like `PATCH`. Add one case in bulk.test.ts on a synced
    test model: after a bulk update, the doc's `_syncSeq` advanced. `executeDelete` is shared
    with the sync mutation channel: add an executors.test.ts case that
    `executeDelete({skipPostHooks: true})` returns `prevDoc` with `deleted` not true, and the
    existing sync mutation tests still pass.
  - Test skills: terreno-backend-tests
  - Docs: none in this task (T6)

- [ ] **T4** — Atomic mode by default, inside one transaction
  - Depends on: T1, T3
  - Files: api/src/bulk.ts, api/src/bulkTransaction.ts, api/src/isolated/bulkAtomic.isolated.ts (replica set via `useMongoTopology`), api/src/isolated/bulkStandalone.isolated.ts (the standalone case), api/src/sync/syncSeqPlugin.ts + its test (only if the seq claim does not join the session)
  - Seam: `POST /<route>/bulk` with `atomic` omitted or `true`
  - Interface:
    - `atomic` defaults to `true` (remove the T2 501).
    - Enabling `bulk` on any router calls `mongoose.set("transactionAsyncLocalStorage", true)`
      on the Mongoose instance that owns the model (`model.base`).
    - Run: `session = await model.db.startSession()`, `session.startTransaction()`, then
      `await model.base.transactionAsyncLocalStorage.run({session}, runItems)`. That is the
      same store `connection.transaction()` fills (`mongoose/lib/connection.js:754-757`), so
      every Mongoose op inside, including hook writes, picks up the session. `runItems` runs
      each item's executor with `skipPostHooks: true`, collecting `cleanedBody` / `prevDoc`.
      On the first throw, `abortTransaction()` and respond with that item's status and
      `toBulkItemError` body plus `meta.index`. A conflict is a 409 whose body is the PATCH
      409 body (it includes the server doc, a read) plus `meta.index`. Otherwise
      `commitTransaction()`. Then, per item in order: `runPostCreate` / `runPostUpdate` /
      `runPostDelete`, `void maybeRecordModelRouterAudit`, and `responseHandler`. Always
      `endSession()`.
    - No automatic retry: do not use `withTransaction` / `connection.transaction()`, because
      a retry re-runs `pre*` hooks. A `TransientTransactionError` or
      `UnknownTransactionCommitResult` aborts and returns 409
      `{code: "bulk-transaction-conflict"}`.
    - Mongo without transaction support (standalone): 400
      `{code: "bulk-atomic-unsupported", detail: "...requires a replica set; send atomic:false for per-item writes"}`
      before any write. Detect it once per connection with `db.admin().command({hello: 1})`:
      no `setName` and `msg !== "isdbgrid"` means standalone. Never fall back silently.
    - A post hook that throws after commit: the writes stay committed. The response is 200,
      and that item's entry carries the error the single route returns
      (`400 post-create-hook-error` etc.), the same as partial mode and `POST /` (see Q2).
  - Cases (bulkAtomic.isolated.ts unless noted):
    - 3 creates, no `atomic` key → 200, 3 docs exist
    - 3 creates where `preCreate` returns null on item 2 → 403, `meta.index: 1`; **0** docs exist; `postCreate` was called 0 times; 0 AuditEvents
    - update A + update B where B is 403 → 403 `meta.index: 1`; A is unchanged in Mongo
    - delete A + create invalid (Mongoose validation error) → 400 `meta.index: 1`; A is still not deleted
    - a `preCreate` hook that writes another model (e.g. `UserModel.updateOne`) on the item that later aborts → that write is rolled back too
    - success → `postCreate` / `postUpdate` / `postDelete` run once per item, after the commit (a hook that reads the doc from a fresh query sees it committed)
    - a stale `_updatedAt` on one update → 409 with `meta.index`, body otherwise equal to the PATCH 409 body; no other item applied
    - item 2's `preCreate` runs `FoodModel.findById(<item 1's new id>)` → finds it (proves the hook joined the session and sees the uncommitted write)
    - a `postCreate` that throws on item 1 of a 2-create atomic batch → 200; both docs exist; `data[1].status` 400 `post-create-hook-error`; `data[0].status` 201
    - standalone Mongo (`bulkStandalone.isolated.ts`) → 400 `bulk-atomic-unsupported`, nothing written; `atomic: false` on the same server still works
  - Blast radius: synced models. An aborted transaction must not leave a claimed `_syncSeq`
    that stalls the stream. Case on a synced test model in bulkAtomic.isolated.ts: an atomic
    batch aborts on item 2, then a single `PATCH` on that stream succeeds and a sync
    delta/snapshot fetch from the pre-batch cursor returns the PATCHed doc. If the seq claim
    does not join the session (`syncSeqPlugin.ts` reads `this.$session()`), the task makes
    it join and covers that in `sync/syncSeqPlugin.test.ts`.
  - Test skills: terreno-backend-tests, terreno-test-setup
  - Docs: none in this task (T6)

- [ ] **T5** — Document `POST /bulk` in OpenAPI
  - Depends on: T2
  - Files: api/src/bulkOpenApi.ts, api/src/bulkOpenApi.test.ts, api/src/api.ts
  - Seam: `GET /openapi.json` on a server with a `bulk` router, plus the syncdb codegen's
    `discoverOperations`
  - Interface:
    - `POST /<route>/bulk` with operationId `{tag}_bulk`. The request schema is the envelope,
      with each `body` referencing the router's create/update body schema. The 200 schema is
      the result array, with `data` referencing the model's response schema. 400/401 use the
      standard error schemas.
    - Only the methods in `bulk.methods` appear in the `method` enum.
  - Cases:
    - `bulk: true` → `paths["/food/bulk"].post` exists with operationId `food_bulk`; the `method` enum is `["create","update","delete"]`
    - `bulk: {methods: ["update"]}` → the enum is `["update"]`
    - no `bulk` → no `/food/bulk` path
    - `discoverOperations` on that spec yields a `food_bulk` operation (the syncdb codegen will emit a hook)
    - the existing openApi snapshot tests still pass (no change for routers without `bulk`)
  - Blast radius: syncdb `--api-out` codegen consumes the spec, covered by the discoverOperations case. For synced collections see Q3.
  - Test skills: terreno-backend-tests
  - Docs: none in this task (T6)

- [ ] **T6** — Example router and docs for bulk writes
  - Depends on: T4, T5
  - Files: example-backend/src/api/todos.ts, example-backend/src/api/todos.test.ts, example-frontend/store/apiSdk.ts (regenerated with `bun run sdk`, never hand-edited), docs/reference/api.md, docs/explanation/model-router-actions.md, .rulesync source of the api rules generated-endpoints table, api/src/api.ts (remove the `// Support bulk actions` TODO)
  - Seam: `POST /todos/bulk` on example-backend
  - Interface: `todoRouter` gets `bulk: true`.
  - Cases:
    - example-backend todos.test.ts: an owner sends `[create, update own, delete own]` in partial mode → 201/200/204
    - another user's todo in an update item → partial mode 403 for that item
    - (atomic cases are proven in T4; the example uses `atomic: false` unless the example test lane runs on a replica set)
  - Blast radius: none
  - Test skills: terreno-backend-tests
  - Docs: new `## modelRouter bulk writes` section in `docs/reference/api.md` (option,
    envelope, both modes, statuses, replica-set requirement, hook `req.body` note, synced
    collection note); a "Reserved names" note under "Collision detection" in
    `model-router-actions.md`; a `/bulk` row in the generated-endpoints rules table (edit
    the `.rulesync` source, then regenerate).

## Assumptions

- The route is opt-in per router (`bulk`), as answered. The default `maxItems` is 100, matching `MAX_SYNC_MUTATIONS_PER_BATCH`.
- Bulk has no request-header conflict detection. Only `body._updatedAt` per item.
- Both modes call executors with `skipPostHooks: true` and run `runPost*` themselves; in
  atomic mode that happens after the commit. This is the existing executor API built for the
  sync channel.
- No automatic transaction retry, because a retry would re-run `pre*` hooks.
- Partial mode keeps the 200 status even when every item fails. Callers read per-item `status`.
- Rate limiting counts one request. `maxItems` is the only amplification bound (see X2).
- The executor handles RBAC `access` routers unchanged, because `resolveModelRouterAccess` writes into `options.permissions` before the route is built.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q1 | Should a router be able to forbid partial mode (e.g. `bulk: {allowPartial: false}`)? | No router switch in v1. Every bulk router accepts `atomic: false`. | You asked for a request flag. Partial mode applies the same per-item permissions as N single requests, so it grants nothing new. | Add `allowPartial` to the option, plus a 400 case and an OpenAPI tweak | T2, T5 |
| Q2 | In atomic mode, a `post*` hook throws after the commit. What does the client get? | 200; that item's entry carries the hook error the single route returns (e.g. 400 `post-create-hook-error`), other entries are successes | Matches `POST /` (400 after commit) per item, and matches partial mode; a whole-request 4xx would hide that the batch committed and invite a duplicating retry | Return the hook's error status for the whole request with `meta.index` and `meta.committed: true` | T2, T4 |
| Q3 | Synced collections: syncdb codegen will emit a plain request hook for `/bulk`, which bypasses the local store. Allow it? | Allow it, and document that local-first clients should use the sync outbox. No codegen change. | Writes still sync back through the change stream. Excluding the path would hide a working server API from SDKs. | Exclude `/bulk` on `x-terreno-sync` collections in `discoverOperations` (a small syncdb task) | T5, T6 |
| Q4 | Atomic failure response: only the failing item's error, or also each item's would-be status? | Only the failing item's error body (the single route's body, so a 409 includes the server doc) plus `meta.index` | Nothing was committed, so other items' results are meaningless and could leak data | Add `meta.results` with per-item pre-abort statuses | T4 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | `mcp: {bulk: true}`: register a `<model>_bulk` MCP tool | MCP mirrors REST CRUD and actions | S | T4 |
| X2 | Count bulk items against rate limits (per-item cost) | One request can now do up to `maxItems` writes | S | T2 |
| X3 | syncdb `useMutate` bulk API that goes through the outbox | Local-first clients get a plain request hook today (Q3) | M | T5 |
| X4 | Move admin `bulk-patch` onto this path so admin bulk edits run router hooks and audit | admin bulk-patch skips hooks, audit, and responseHandler (`adminApp.ts:2064`) | M | T4 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 | When one item fails, what happens to the rest? | "make it configurable, default to all or nothing with a transcation but allow setting a flag on the request for per item" | Atomic transaction by default (T4); `"atomic": false` request flag for per-item results (T2, T3); T1 adds a replica-set test lane |
| D2 (durable) | Endpoint shape | One mixed `POST /<route>/bulk` with `{operations: [{method, id?, body?}]}` | One route, one OpenAPI op, one generated hook |
| D3 (durable) | Opt-in or default | Opt-in per router via `bulk` | No new surface on existing apps |

## Sign-off

Status: approved 2026-11-17
Cut: 1 round, 10 findings: 10 fixed (F1 post-hook errors match the single route; F2 PATCH 409 body; F3 update validation; F4 shared error mapper; F5 prevDoc for audit; F6 ALS seam named; F7 `*.atomic.test.ts` lane; F8 standalone case file + detection; F9 rate-limit risk listed; F10 atomic 409 keeps server doc), 0 moved, 0 rebutted. Second round skipped: fixes tightened briefs without changing the task graph.
