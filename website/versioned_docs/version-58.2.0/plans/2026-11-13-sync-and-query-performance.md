# Keep sync fan-out and list queries cheap as an app grows

Terreno's realtime sync and its generated list endpoints work well for a small app and get slower in ways an adopter cannot see until production. Every API instance watches every collection in the database and throws most events away. One document change is checked and serialized once per connected socket, one socket at a time. Every list request counts the whole result set. The realtime plugin also accepts a Redis adapter option that logs success and attaches nothing, and the example backend carries an unused second socket stack. This plan removes the change-stream and fan-out costs from the framework defaults, makes the list count free for lists that fit in one page and optional for the rest, adds cursor pagination, and writes down how to run more than one instance. One cost stays on by default: a list longer than one page still runs an exact count unless the router or the request asks for a capped or omitted total (Q1 asks whether to change that default now). Adopters with growing tables and many connected clients feel it; small apps see no change.

Source: codebase audit `docs/audits/2026-11-12/REPORT.md` findings 3.11, 3.12, 3.13 and 4.6 (detail in `security-performance.md` 6–8 and `code-refactoring.md` 8). Findings 4.7 and 3.14 are planned separately in `docs/plans/2026-11-13-syncdb-cross-tab-safety.md`.

## The idea

Four changes, each additive or behaviour-preserving for existing apps:

1. **Change stream.** The watcher's `$match` lists the registered synced collections (`"ns.coll": {$in: [...]}`), so MongoDB never does a full-document lookup for jobs, audit, session or log writes. The stream reopens when a synced collection registers after startup, and it resumes from the driver's own token so a quiet stream never holds a stale one.
2. **Fan-out.** Sockets in a room are grouped by user. The read-permission check runs once per user, the payload is serialized once per user (once per change when no per-user response handler exists), and groups run with bounded concurrency instead of in series. The `sync:delta` wire format does not change.
3. **Lists.** `total` stays in the response by default and stays exact, so nothing an adopter reads changes. It becomes free when the result fits in one page, runs beside the find instead of before it, and can be capped or switched off per router or per request. A new cursor mode (`pagination=cursor`, `after=<cursor>`) pages without `skip`.
4. **Multi-instance.** Every instance runs its own change stream and emits only to its own sockets, so Terreno sync needs no Socket.IO adapter. `adapter: "redis"` is deprecated as the no-op it is, the dead example socket stack is deleted, and the model is documented.

Rejected: making `total` opt-in now. The admin tables and any adopter pagination read `total` today (`admin-frontend/src/AdminModelTable.tsx:496`), so that is a silent break for a performance gain the free path already delivers for small lists. Rejected: implementing the Redis adapter. With an adapter attached, room-level broadcasts would be delivered once per instance, and sync gains nothing from it.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Scope the change stream to synced collections | none | api realtime | Pipeline test + real change stream test: a write to an unsynced collection never reaches the handler |
| T2 | Reopen the stream when a synced collection registers late | T1 | api realtime, collection registry | A collection registered after start gets deltas; resume uses the driver token |
| T3 | Check and serialize once per user in delta fan-out | T2 | api realtime | Call-count tests: 4 sockets of 2 users → 2 permission checks; a slow user does not delay others; sockets with different privileges are never grouped |
| T4 | Make list totals cheap | none | api list route, OpenAPI | `countDocuments` spy: 0 calls when the page is complete; capped and none modes |
| T5 | Cursor pagination for list routes | T4 | api list route, OpenAPI | Walk 5 documents in pages of 2 with ties; invalid cursors return 400 |
| T6 | Regenerate the example SDK | T5 | example-frontend SDK | Generated SDK contains `totalMode`, `pagination`, `after`, `nextCursor` |
| T7 | Deprecate the no-op adapter option | none | api realtime | `adapter: "redis"` warns once and never claims an adapter is configured |
| T8 | Delete the unused example socket stack | none | example-backend | File and its adapter dependencies are gone; typecheck, knip and the flags e2e stay green |
| T9 | Document running more than one instance | T2, T3, T7 | docs | Explanation page states the model; links resolve |

Tracer: `openChangeStream` in `api/src/realtime/changeStreamWatcher.ts` — the pipeline every delta passes through.
E2E: None new — no UI or cross-process contract changes shape; existing `example-frontend/e2e/realtime.spec.ts`, `syncdb-load-delta.spec.ts` and `socket-flags.spec.ts` must stay green and are named in T3, T7 and T8.
Regression: None — no hard-to-automate change.
User guide: None — no user-visible change; these are framework and operator behaviours.
Design: None — no canvas.
Out of scope: cross-tab web persistence and per-partition storage (separate IP), admin table on cursor paging. Three audit recommendations inside these findings are not delivered here and are parked with reasons in Expansions: the unindexed-sort warning (3.13, X2), moving the mutation budget to the shared rate-limit store (4.6, X3), and the per-user session sweep (3.12, X4).
Open risks: by default a list longer than one page still runs an exact count (Q1); a change stream filtered to few collections can sit idle for a long time (T2 handles the resume token); fan-out grouping must never let one socket's privileges authorize another (T3 groups only sockets that resolve to the same user document or the same token claims).
Elephant: nothing here has a load number behind it — the audit read code and this plan proves call counts, not latency; T3 records one before/after run of the manual `bun run api:load` harness as evidence, but no task gates on a latency budget.

## E2E tests

None — no new UI or cross-process acceptance criterion. Server behaviour is proven at the route and exported-function seams with real MongoDB change streams in the api suite. The existing browser specs `example-frontend/e2e/realtime.spec.ts`, `example-frontend/e2e/syncdb-load-delta.spec.ts` and `example-frontend/e2e/socket-flags.spec.ts` already drive live deltas and flag updates end to end; T3, T7 and T8 require them green.

The two-instance claim behind T7 and T9 has no automated proof in this plan. The watcher is one per process (module-level state in `changeStreamWatcher.ts`), so two instances cannot run inside one test process, and the repository has no harness that starts two backends against one MongoDB. The claim rests on the code: each process opens its own stream and emits through `socket.emit` on its own sockets. A two-process check is Expansion X5.

## Regression cases

None — no hard-to-automate change.

## User guide

None — no user-visible change. Nothing an end user of the example app sees or does differs.

## Design

None — no canvas.

## Tasks

Supporting skills for every task: `terreno:terreno-backend-api`, `terreno:terreno-backend-tests`, `terreno:update-docs`. Each task that changes behaviour adds its own `changelog/unreleased/<name>.md` fragment (format in `changelog/unreleased/README.md`) and updates the docs named in its `Docs:` line in the same commit. Use `bun run --cwd api test:ci` paths or `bun test --only-failures <path>` from `api/`.

- [ ] **T1** — Scope the change stream to synced collections
  - Depends on: none
  - Files: api/src/realtime/changeStreamWatcher.ts, api/src/realtime/changeStreamScope.test.ts, changelog/unreleased/change-stream-synced-collections-only.md, docs/explanation/local-first-data.md
  - Criteria:
    - The pipeline `$match` is `{"ns.coll": {$in: <synced collection names minus ignored>}, operationType: {$in: ["insert","update","replace","delete"]}}`. `DEFAULT_IGNORED_COLLECTIONS` and `changeStream.ignoredCollections` are subtracted from the list.
    - With no synced collection registered, no stream is opened and `startChangeStreamWatcher` does not throw; one `logger.info` says so when `debug` is on.
    - The JS-side `findSyncEntryByCollectionName` check stays as a second guard.
  - Seam: exported `buildChangeStreamPipeline` (new, `@internal`) and `startChangeStreamWatcher` against the in-memory replica set the api suite already uses (see `api/src/realtime/realtime.test.ts` for the harness pattern). Where a case says "injected `db.watch` spy", use `spyOn(mongoose.connection.db, "watch")`.
  - Interface: `buildChangeStreamPipeline({collections: string[], ignored: string[]}): Record<string, unknown>[]` returns `[{$match}, {$project}]`; `$project` is unchanged from today (`documentKey`, `fullDocument`, `ns`, `operationType`, `updateDescription`).
  - Cases:
    - `collections: ["todos","projects"], ignored: ["sessions"]` → `$match["ns.coll"]` equals `{$in: ["todos","projects"]}`
    - `collections: ["todos","sessions"], ignored: ["sessions"]` → `{$in: ["todos"]}`
    - `collections: []` → `startChangeStreamWatcher` opens no stream (the injected `db.watch` spy has 0 calls) and returns
    - Real stream: the test itself opens `mongoose.connection.db.watch(buildChangeStreamPipeline({collections: [<todo collection>], ignored: []}), {fullDocument: "updateLookup"})`, inserts one `AuditRow` (unsynced model) then one `IntTodo`, and collects events until the todo arrives → exactly 1 event delivered, with `ns.coll` equal to the todo collection
    - `startChangeStreamWatcher` with an injected `db.watch` spy and `IntTodo` synced → the spy's first argument deep-equals `buildChangeStreamPipeline({collections: [<todo collection>], ignored: DEFAULT_IGNORED_COLLECTIONS})`
    - `ignoredCollections: [<todo collection>]` with only that collection synced → no stream opened
  - Blast radius: every `sync:delta` passes through this pipeline → existing `api/src/realtime/realtime.test.ts` and `api/src/sync/syncSocket.test.ts` must stay green; tests there that assert the old `$nin` pipeline are updated in this task.
  - Test skills: terreno-backend-tests
  - Docs: one paragraph in `docs/explanation/local-first-data.md` on what the watcher watches.
  - Verification: `cd api && bun test src/realtime/changeStreamScope.test.ts src/realtime/realtime.test.ts`

- [ ] **T2** — Reopen the stream when a synced collection registers late
  - Depends on: T1 (same file; extends the open path T1 creates)
  - Files: api/src/realtime/changeStreamWatcher.ts, api/src/collectionRegistry.ts, api/src/collectionRegistry.test.ts, api/src/realtime/changeStreamReopen.test.ts
  - Criteria:
    - `collectionRegistry` exposes `onCollectionRegistryChange(listener): () => void`; it fires after `registerCollection`, `replaceCollectionOptions` and `clearCollectionRegistry`.
    - While the watcher is running, a registry change that alters the watched collection list closes the current stream and opens a new one with the new list, resuming from the last token. A change that does not alter the list does nothing. Several changes in one tick cause one reopen.
    - The resume token comes from the driver's `stream.resumeToken` (it advances on empty batches) and falls back to the last delivered event's `_id`.
    - `stopChangeStreamWatcher` removes the registry listener.
    - A new `@internal` export `changeStreamOpened(): Promise<void>` resolves when the current stream's cursor is established (immediately when no stream is needed). Tests await it before inserting, so no case depends on timing.
    - If MongoDB rejects a resume token on the widened pipeline, the reopen falls back to opening without a token and emitting the existing resync hint, the same path history loss takes.
    - A registry-triggered close is intentional: it bumps `watcherGeneration` before closing, so the old stream's `close` event schedules no backoff restart and logs no warning. A registry-triggered open runs with `isReopen: true`, so a failure retries with backoff and never throws out of `registerCollection`.
  - Seam: `startChangeStreamWatcher` / `stopChangeStreamWatcher` with a real in-memory replica set, and `onCollectionRegistryChange` as an exported function.
  - Interface: `onCollectionRegistryChange(listener: () => void): () => void` (returns unsubscribe).
  - Cases:
    - listener registered, `registerCollection(...)` called once → listener called 1 time; after unsubscribe → 0 further calls
    - watcher started with synced `A` only; register synced `B`; insert into `B` → a socket in `B`'s stream room receives 1 `sync:delta` with `collection` equal to `B`'s tag
    - watcher started with 0 synced collections (no stream); register synced `A`; insert into `A` → 1 `sync:delta`
    - register 3 synced collections synchronously → the injected `db.watch` spy shows exactly 1 additional call
    - re-register an already-watched collection with new options → 0 additional `db.watch` calls
    - after `stopChangeStreamWatcher()`, registering a collection → 0 `db.watch` calls
    - reopen passes `resumeAfter` equal to the previous stream's `resumeToken` when that is defined
    - real stream: watcher started with `A` only; insert `a1` and receive its delta; register `B`; await `changeStreamOpened()`; insert `b1` → exactly 1 delta for `b1`, and `a1`'s delta is not emitted a second time (the widened pipeline resumed from the narrower stream's token)
    - a registry-triggered reopen → `logger.warn` is not called with a message containing `Change stream closed`
    - `db.watch` spy throws on a registry-triggered open → `registerCollection` does not throw
  - Blast radius: `clearSyncRegistry` in tests now notifies the watcher → the reopen path must tolerate an empty list (close, do not reopen). Covered by the third-from-last case and the existing realtime suite.
  - Test skills: terreno-backend-tests
  - Verification: `cd api && bun test src/realtime/changeStreamReopen.test.ts src/collectionRegistry.test.ts src/realtime/realtime.test.ts`

- [ ] **T3** — Check and serialize once per user in delta fan-out
  - Depends on: T2 (same file)
  - Files: api/src/realtime/changeStreamWatcher.ts, api/src/realtime/deltaFanOut.test.ts, changelog/unreleased/sync-delta-fan-out-per-user.md
  - Criteria:
    - `emitPayloadToAuthorizedRoom` groups the room's sockets only when they resolve to the same authorization input. Sockets with a loaded user document (`socket.data.fullUser`) group by user id. Sockets without one (no `userModel`; the user is built from that socket's own token claims in `api/src/realtime/socketUser.ts`) group by user id plus the `admin` and `isAnonymous` claims. A full-user socket and a token-only socket never share a group. A socket with no user is its own group. Authorization (`authorizeAdminBroadcastDocument`, `canReadDocument`) and `buildPayload` run once per group, with the first socket's user, and the result is emitted to every socket in the group.
    - The history-lost hint is emitted with `io.local.emit(SYNC_RESYNC_EVENT, hint)` instead of `io.emit`, so an app that attaches its own Socket.IO adapter does not multiply it by instance count.
    - Groups run concurrently, at most 16 at a time (`FAN_OUT_CONCURRENCY`, module constant). The function still resolves only after every group has finished, so per-entity ordering (`serializePerEntity`) is unchanged.
    - In `emitSyncDeltaForChange`, when the entry has no modelRouter `responseHandler` (so the payload cannot depend on the user: either `config.responseHandler(plain, method)` or none), the serialized `data` is computed once per change and reused for every group and for the admin-broadcast stream.
    - A throw in one group's check or serialization drops the emission for that group only and is logged and sent to Sentry as today.
    - The emitted `sync:delta` payload is byte-for-byte what it is today.
  - Seam: exported `emitPayloadToAuthorizedRoom` and `emitSyncDeltaForChange` with a fake `io` (rooms map + sockets map, as in `api/src/realtime/realtime.test.ts`).
  - Interface: unchanged signatures.
  - Cases:
    - room with sockets s1, s2, s3 (user A) and s4 (user B); entry `permissions.read` is a counting spy that returns true → spy called 2 times; `buildPayload` called 2 times; `emit` called once on each of the 4 sockets with the same event name
    - same room, `permissions.read` returns false for user B → s1–s3 receive the event, s4 receives nothing
    - same room, `buildPayload` throws for user A only → s4 receives the event, s1–s3 receive nothing, 1 error logged
    - two sockets with no user → 2 permission checks (not grouped)
    - no `fullUser` on either socket, same token id `u1`, s1 token `admin: true`, s2 token `admin: false`, `permissions.read: [Permissions.IsAdmin]` → 2 permission checks; s1 receives the event, s2 receives nothing
    - same token id, one socket with `fullUser` and one without → 2 permission checks
    - watcher `error` event with a `ChangeStreamHistoryLost` error (code 286) and a fake `io` whose `local.emit` and `emit` are spies → `local.emit` called once with `"sync:resync-required"` and `{reason: "history_lost"}`; top-level `emit` called 0 times
    - user A's permission check is a deferred promise that never resolves until released; user B's resolves at once → s4's `emit` is observed before A's promise is released
    - 40 single-socket users whose checks each hold a deferred promise → at most 16 checks are in flight at any time
    - `emitSyncDeltaForChange` for an entry with `config.responseHandler` as a counting spy and 3 users in the room → spy called 1 time; with a modelRouter `responseHandler` spy instead → called 3 times
  - Evidence (not a gate): run `bun run api:load` once on the commit before this task and once after, and record both fan-out lag lines in the stage result.
  - Blast radius: every delta consumer. Existing history-lost tests in `api/src/realtime/realtime.test.ts` move to the `local.emit` spy. Existing `api/src/realtime/realtime.test.ts`, `api/src/sync/syncSocket.test.ts`, `api/src/sync/integration.test.ts` stay green; browser specs `example-frontend/e2e/realtime.spec.ts` and `syncdb-load-delta.spec.ts` stay green (run by Brew/CI).
  - Test skills: terreno-backend-tests
  - Verification: `cd api && bun test src/realtime/deltaFanOut.test.ts src/realtime/realtime.test.ts src/sync/`

- [ ] **T4** — Make list totals cheap
  - Depends on: none
  - Files: api/src/api.ts, api/src/openApi.ts, api/src/api.listTotal.test.ts, api/src/__snapshots__/openApi.test.ts.snap, example-backend/src/__snapshots__/openapi.test.ts.snap, syncdb/src/query/queryWindows.test.ts, docs/reference/api.md, docs/reference/syncdb.md, changelog/unreleased/list-total-modes.md
  - Criteria:
    - New router options `total?: "exact" | "capped" | "none"` (default `"exact"`) and `totalCap?: number` (default `10000`).
    - New reserved query parameter `totalMode` (added to `PAGINATION_QUERY_PARAMS`, never treated as a filter). A request can lower the cost, never raise it: order is `none` < `capped` < `exact`, and the effective mode is the lower of router and request.
    - Exact mode: when the request has no `page` (or `page=1`) and the find returned at most `limit` documents, `total` is that document count and `countDocuments` is not called. Otherwise `countDocuments(query)` runs concurrently with the find.
    - Capped mode: same free path; otherwise `countDocuments(query, {limit: totalCap + 1})`. When the count exceeds the cap the response has `total: totalCap` and `totalCapped: true`. `totalCapped` is absent otherwise.
    - None mode: no count, and the response has no `total` key.
    - `data`, `limit`, `more`, `page` are unchanged. The OpenAPI list schema documents `totalMode` and adds `totalCapped` (`total` is already optional there).
  - Seam: `GET /<route>` on a `modelRouter` mounted in a test app (pattern in `api/src/api.query.test.ts`), with `spyOn(Model, "countDocuments")`.
  - Interface: `GET /food?limit=<n>&page=<n>&totalMode=<exact|capped|none>` → `{data: Food[], limit: number, more: boolean, page?: string, total?: number, totalCapped?: true}`.
  - Cases (collection of 5 documents unless stated):
    - `?limit=10` → `total: 5`, `more: false`, countDocuments called 0 times
    - `?limit=2` → `total: 5`, `more: true`, countDocuments called 1 time
    - `?limit=2&page=3` → `data.length 1`, `total: 5`, countDocuments called 1 time
    - `?limit=10&page=1` → `total: 5`, countDocuments called 0 times
    - `?limit=2&totalMode=none` → no `total` key, countDocuments called 0 times
    - router `total: "capped", totalCap: 3`, `?limit=2` → `total: 3`, `totalCapped: true`
    - router `total: "capped", totalCap: 10`, `?limit=2` → `total: 5`, no `totalCapped` key
    - router `total: "none"`, `?limit=2&totalMode=exact` → no `total` key (a request cannot raise the mode)
    - `?totalMode=bogus` → 400 with `code: "invalid-total-mode"`
    - router with `queryFields: ["name"]` and `?totalMode=none&name=Apple` → 200; `totalMode` is not rejected as a disallowed filter
    - `queryFilter` returning `null` → `{data: []}` exactly as today
    - no token on a router with `list: [Permissions.IsAuthenticated]` → 401 (unchanged)
    - syncdb window query (`syncdb/src/query/queryWindows.test.ts`): a list response with no `total` key → the window's `total` is `-1` and paging by `more` still works; a response with `total: 3, totalCapped: true` → the window's `total` is `3`
  - Blast radius: `total` readers — syncdb windowed queries (`syncdb/src/query/queryWindows.ts:437` and `:555` already fall back to `-1` when `total` is absent; the case above pins it and `docs/reference/syncdb.md` says a `queryCollections` route set to `none` reports an unknown total), `admin-frontend/src/AdminModelTable.tsx`, `AdminScriptList.tsx`, `ModelsGridWidget`, `comms/CommsDashboardScreen.tsx` and generated SDK types. Defaults keep `total` present and exact, so no consumer changes; `bun run --cwd admin-frontend test:ci` and `bun run --cwd admin-backend test:ci` stay green. `api/src/mcp/handlers.ts:307` has its own count and is not touched.
  - Test skills: terreno-backend-tests
  - Docs: `docs/reference/api.md` list-pagination section: the three modes, the free path, the request-can-only-lower rule.
  - Verification: `cd api && bun test src/api.listTotal.test.ts src/api.query.test.ts src/openApi.test.ts`; `cd example-backend && bun test src/openapi.test.ts`; `cd syncdb && bun test src/query/queryWindows.test.ts`. Both OpenAPI snapshots are regenerated by their tests' update flag, never hand-edited.

- [ ] **T5** — Cursor pagination for list routes
  - Depends on: T4 (same route handler; cursor mode sets the default total mode T4 adds)
  - Files: api/src/api.ts, api/src/listCursor.ts, api/src/listCursor.test.ts, api/src/api.listCursor.test.ts, api/src/openApi.ts, api/src/__snapshots__/openApi.test.ts.snap, example-backend/src/__snapshots__/openapi.test.ts.snap, docs/reference/api.md, docs/how-to/paginate-large-lists.md, docs/how-to/README.md, changelog/unreleased/list-cursor-pagination.md
  - Criteria:
    - Cursor mode is on when the request has `pagination=cursor` or a non-empty `after`. Both are reserved query parameters. Requests without them behave exactly as before this task, including sort order.
    - In cursor mode the sort must be one field (request `sort`, else router `sort`, else `_id` ascending). `_id` is appended as a tie-break in the same direction. The response adds `nextCursor: string | null` (non-null exactly when `more` is true). The default total mode is `none` unless the request sends `totalMode`.
    - `after` resumes strictly after the cursor's position. The cursor carries only the last row's id: base64url JSON `{v: 1, id: <_id as string>}`. It never contains a sort value, because a router may sort by a field its responses hide (`api/src/api.ts:216-219`), and a cursor holding that value would leak it. The server looks the anchor document up under the request's own permission and query filter, reads its sort value there, and builds the range filter from it. Supported sort value types: string, number, boolean, Date, ObjectId, and null or missing.
    - Order of checks: the existing sort allowlist (`checkSortFields`) runs first and is unchanged; cursor validation runs after it.
    - Errors, all 400: `page` together with cursor mode → `code: "cursor-with-page"`; a multi-field sort (the repo's syntax is space-separated, `sort=name -calories`) → `"cursor-sort-unsupported"`; an anchor sort value that is an object or array → `"cursor-sort-unsupported"`; an undecodable cursor, an unknown `v`, an `id` that is not a string, any extra key, or an anchor document the caller's filter does not return (deleted, or another user's) → `"invalid-cursor"`.
    - The cursor filter is combined with the permission and query filter using `$and`; it can only narrow the result.
    - A sort field that holds more than one BSON type across documents (strings in some, numbers in others) is not supported in cursor mode, because MongoDB range comparisons do not cross types. The how-to says so; null or missing values are the one supported mix.
  - Seam: exported `encodeListCursor` / `decodeListCursor` / `buildCursorFilter` in `api/src/listCursor.ts`, and `GET /<route>` on a mounted `modelRouter`. The anchor lookup uses `findOneOrNoneFor` from `api/src/plugins.ts` (the repo bans `Model.findOne`).
  - Interface: `GET /food?pagination=cursor&limit=<n>&sort=<field|-field>&after=<cursor>` → `{data, limit, more, nextCursor: string | null, total?}`. `encodeListCursor({id}): string`; `decodeListCursor(text): {id: string}` (throws the 400 above); `buildCursorFilter({anchorId, anchorSortValue, sortField, direction}): Record<string, unknown>`.
  - Cases:
    - 5 documents with `calories` 100, 100, 100, 200, 300; `?pagination=cursor&limit=2&sort=calories` → 2 rows, `more: true`, `nextCursor` a non-empty string, no `total` key; following `after` three times yields all 5 ids exactly once, the last page has `more: false` and `nextCursor: null`
    - same data, `sort=-calories` → ids in descending calories, ties in descending `_id`, all 5 exactly once
    - no `sort` and no router sort → pages in ascending `_id`
    - sort field missing on 2 of 5 documents, ascending → those 2 come first, all 5 exactly once across pages
    - same data, descending → those 2 come last, all 5 exactly once across pages
    - a `Date` sort field (`created`) → all rows exactly once across pages
    - a document inserted between page 1 and page 2 with a sort value before the cursor does not appear on page 2 and no row repeats
    - `?pagination=cursor&totalMode=exact&limit=2` → `total: 5` present
    - `?pagination=cursor&page=2` → 400 `cursor-with-page`
    - `?pagination=cursor&sort=name%20-calories` (or an object sort with 2 keys) → 400 `cursor-sort-unsupported`
    - `?pagination=cursor&sort=secretField` where `secretField` is not in the router's sortable fields → the existing 400 from the sort allowlist, unchanged
    - `?after=not-base64` → 400 `invalid-cursor`; base64url of `{"v":1,"id":{"$ne":null}}` → 400 `invalid-cursor`; base64url of `{"v":1,"id":"<valid id>","s":5}` → 400 `invalid-cursor`; base64url of `{"v":2,"id":"<valid id>"}` → 400 `invalid-cursor`
    - a cursor whose anchor document was deleted after page 1 → 400 `invalid-cursor`
    - decoding any `nextCursor` the route returns yields exactly the keys `v` and `id`
    - `OwnerQueryFilter` router: user A's cursor used by user B → 400 `invalid-cursor` (B's filter does not return A's anchor); B never receives A's documents
    - no cursor params → response has no `nextCursor` key and equals the pre-task response for the same request
    - `decodeListCursor(encodeListCursor({id: "abc"}))` deep-equals `{id: "abc"}`
    - `buildCursorFilter({anchorId: "i3", anchorSortValue: 100, sortField: "calories", direction: 1})` → `{$or: [{calories: {$gt: 100}}, {calories: 100, _id: {$gt: "i3"}}]}`
  - Blast radius: none for existing requests (cursor mode is opt-in). OpenAPI consumers gain optional params → regenerated in T6.
  - Test skills: terreno-backend-tests
  - Docs: new how-to `docs/how-to/paginate-large-lists.md` (when to use cursor mode, the compound index `{<sortField>: 1, _id: 1}` to add, total modes), linked from `docs/how-to/README.md`; reference rows in `docs/reference/api.md`.
  - Verification: `cd api && bun test src/listCursor.test.ts src/api.listCursor.test.ts src/openApi.test.ts`; `cd example-backend && bun test src/openapi.test.ts`

- [ ] **T6** — Regenerate the example SDK
  - Depends on: T5
  - Files: example-frontend/store/apiSdk.ts
  - Criteria: the generated `example-frontend/store/apiSdk.ts` includes the new list parameters and response fields. It is produced by the generator, never hand-edited.
  - Seam: the generated file and the workspace typecheck.
  - Interface: none new.
  - Cases: none (untestable: generated output, no behaviour). Proven by: `example-frontend/store/apiSdk.ts` contains `totalMode`, `nextCursor` and `totalCapped`; `bun run --cwd example-frontend lint` and the root `bun run typecheck` pass; `git diff --stat` shows only that file.
  - Blast radius: generated types used by example-frontend screens → typecheck covers it.
  - Test skills: none; supporting skill `terreno:generate-sdk` (the generator needs the example backend running; follow that skill).
  - Verification: the commands above.

- [ ] **T7** — Deprecate the no-op adapter option
  - Depends on: none
  - Files: api/src/realtime/realtimeApp.ts, api/src/realtime/types.ts, api/src/realtime/realtimeAppSetup.test.ts, docs/reference/environment-variables.md, changelog/unreleased/realtime-adapter-option-deprecated.md
  - Criteria:
    - `adapter: "redis"` and `redisUrl` stay accepted by the type and are marked `@deprecated`. Setting `adapter: "redis"` logs one `logger.warn` that says the option has no effect, that Terreno sync needs no Socket.IO adapter, that an app wanting one for its own rooms attaches it with `getIo().adapter(...)`, and that the option is removed in the next major. Nothing logs "Redis adapter configured". No adapter is attached.
    - `ChangeStreamConfig.additionalCollections` (declared, never read anywhere) is marked `@deprecated — has no effect`.
    - `docs/reference/environment-variables.md` no longer lists `VALKEY_URL` as used by the realtime adapter.
  - Seam: `RealtimeApp.onServerCreated` with the injected `SocketServer` and `startChangeStreamWatcher` test seams (`api/src/realtime/realtimeAppSetup.test.ts`).
  - Interface: `new RealtimeApp({adapter: "redis"})` — unchanged type, new log behaviour.
  - Cases:
    - `adapter: "redis"`, `redisUrl: "redis://u:p@h:6379"` → `logger.warn` called exactly 1 time with a message containing `no effect`; no `logger.info` call contains `Redis adapter configured`; the injected server's `adapter` method is never called
    - `adapter: "redis"` with no URL in config or env → the same single warning (not the old "no VALKEY_URL" warning)
    - `adapter: "none"` and adapter omitted → 0 adapter warnings
  - Blast radius: apps that set the option keep compiling and keep today's behaviour (nothing attached). The option's reference text lives in the generated API reference built from the JSDoc in `types.ts`, so no hand-written reference page changes here.
  - Test skills: terreno-backend-tests
  - Verification: `cd api && bun test src/realtime/realtimeAppSetup.test.ts`

- [ ] **T8** — Delete the unused example socket stack
  - Depends on: none
  - Files: example-backend/src/websockets.ts, example-backend/src/websockets.test.ts, example-backend/src/server.ts, example-backend/src/conf.ts, example-backend/package.json, bun.lock, knip.jsonc, docs/explanation/example-coverage.md
  - Criteria:
    - `example-backend/src/websockets.ts` and `websockets.test.ts` are deleted. `server.ts` no longer imports `io`; `FeatureFlagsApp`'s `liveUpdates.socketIoServer` is `() => realtimeApp?.getIo() ?? null`.
    - Five dependencies are candidates to leave `example-backend/package.json`: `@socket.io/mongo-adapter`, `@socket.io/redis-adapter`, `@thream/socketio-jwt`, `socket.io` and `ioredis`. For each, search `example-backend/` (source, scripts, e2e) for another import; remove it when there is none, keep it and say why in the stage result when there is. The matching example-backend entries in `knip.jsonc` (around lines 402–438) are removed for every dependency removed. Exports in `example-backend/src/conf.ts` that only `websockets.ts` used are removed, so `bun run check:knip` reports zero findings.
    - `docs/explanation/example-coverage.md` no longer cites `example-backend/src/websockets.ts`.
  - Seam: none new.
  - Cases: none (untestable: a deletion with no new behaviour). Proven by: `rg -n "from \"./websockets\"|src/websockets" example-backend docs --glob '!docs/audits/**' --glob '!docs/plans/**' --glob '!docs/implementationPlans/**'` returns nothing; `bun run --cwd example-backend lint`; root `bun run typecheck`; `bun run check:knip`; `bun run --cwd example-backend test:ci`; and the existing browser spec `example-frontend/e2e/socket-flags.spec.ts` (flag live updates still arrive over the RealtimeApp socket) in Brew/CI.
  - Blast radius: feature-flag live updates read the socket server from `realtimeApp` only → `socket-flags.spec.ts`. With `BACKEND_SERVICE=api` there is no socket server, as today (`io` was always `null`).
  - Test skills: terreno-backend-tests
  - Verification: the commands listed under Cases.

- [ ] **T9** — Document running more than one instance
  - Depends on: T2, T3, T7 (describes what they ship)
  - Files: docs/explanation/local-first-data.md, docs/how-to/websocket-integration.md, docs/how-to/vercel-function-websockets.md, docs/how-to/deploy-backend-to-cloud-run.md
  - Criteria: `docs/explanation/local-first-data.md` gains a section "Running more than one instance" that states, in this order: every instance opens one change stream scoped to the synced collections; each instance emits deltas only to sockets connected to it, so no Socket.IO adapter is needed for sync or feature flags; sticky sessions are required when the polling transport is allowed; the 100 mutations per second budget (`api/src/sync/syncBatch.ts`) is counted per instance; resume tokens live in process memory, and a client that reconnects to another instance catches up through its cursor; an app's own `io.to(room).emit` reaches only local sockets unless it attaches an adapter with `getIo().adapter(...)`; a dedicated realtime role is possible by registering `RealtimeApp` only on some instances (the example gates it on `BACKEND_SERVICE`). The three how-to pages link to the section and no longer suggest an adapter is needed for sync (`vercel-function-websockets.md` line 91 is reworded to scope the adapter advice to an app's own rooms).
  - Seam: none.
  - Cases: none (untestable: prose). Proven by the repository's docs checks named in the `terreno:update-docs` skill and by `rg -n "adapter: \"redis\"" docs --glob '!docs/audits/**' --glob '!docs/plans/**'` returning only deprecation text.
  - Blast radius: none.
  - Test skills: none
  - Verification: the docs check command from `terreno:update-docs`; links resolve.

## Assumptions

- A1. No app depends on the watcher seeing non-synced collections: since Terreno 58 the handler drops every event whose collection has no sync registry entry (`changeStreamWatcher.ts:646-651` at audit time), so narrowing the `$match` changes cost, not behaviour.
- A2. All sockets of one user hold an equivalent user document. Each socket's `fullUser` is loaded at handshake and refreshed by the same 60 s sweep, so they can differ only inside one sweep interval, which is already the staleness bound for a single socket.
- A3. `countDocuments` skipped on the free path is exact: when a first-page find with `limit + 1` returns at most `limit` documents, that length is the count of the same query.
- A4. The api suite's in-memory MongoDB runs as a replica set, as the existing realtime tests require.
- A5. IP path follows the user-level convention `docs/plans/YYYY-MM-DD-<slug>.md`; `docs/implementationPlans/` is the older location and is not added to.

## Audit corrections

- 3.12 says each socket costs "one `computeStableFrontier` query". It is one query per target stream per change (`emitLiveDelta`), not per socket. The per-socket costs are the permission check and the serialization only.
- 3.12 calls the 60 s session sweep part of the sequential cost. `runSessionRevalidationSweep` already runs sockets concurrently with `Promise.all`; it is unbounded and per socket, not sequential. Left as Expansion X4.
- 4.6 is confirmed, with one addition: a Socket.IO adapter is not merely unimplemented, it is unnecessary for sync and would multiply `io.emit` broadcasts (history-lost hint, feature-flag updates) by the instance count. That is why the plan deprecates instead of implementing.
- `ChangeStreamConfig.additionalCollections` is documented and never read; not in the audit, handled in T7.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q1 | Should the default list `total` change (to capped or omitted) now? | No. Keep `"exact"` as the default in 58.x; propose flipping the default to `"capped"` in the next major with an upgrade note. | Admin tables and adopter pagination read `total`; the free path already removes the count for lists that fit in a page. | Flip now: T4 changes the default, adds a `Breaking` changelog fragment and an upgrade note, and admin-frontend must render "10,000+" when `totalCapped` is true (a UI task plus e2e). | T4 |
| Q2 | Implement `adapter: "redis"` instead of deprecating it? | Deprecate. | Each instance already fans out from its own change stream; an adapter adds a Redis dependency and duplicates broadcasts. | Implement: T7 becomes a dynamic `import("@socket.io/redis-adapter")` that fails startup when the peer is missing, every Terreno `io.emit` (feature flags included) moves to `io.local`, and T9 documents when to use it. | T7, T9 |
| Q3 | Remove `adapter` / `redisUrl` / `additionalCollections` from the types now? | No, deprecate now and remove in the next major. | Removing a typed option is a compile break for a no-op. | Remove now: T7 adds a `Breaking` fragment and an upgrade note. | T7 |
| Q4 | Is `totalMode` the right parameter name? | Yes. | `total` could collide with a model field used as a filter (an invoice `total`); `totalMode` is unlikely to. | Rename: T4, T5, T6 change one string and the docs. | T4, T5, T6 |
| Q5 | Should cursor mode return `total` by default? | No, `none` unless asked. | Cursor mode exists for large collections, where the count is the cost. | Yes: one default flips in T5. | T5 |
| Q6 | Should the example app or admin tables use cursor paging in this plan? | No (Expansion X1). | It is UI work with its own e2e and screenshots; the API is usable and documented without it. | Yes: add an admin-frontend task with a browser spec; depends on T6. | new task |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Admin tables and an example screen page with cursors and render capped totals | Repo rule to keep examples current; Q6 | M | T6 |
| X2 | Warn in non-production when a router's sort field has no index. Not built here: `queryFields` lists are long and most filters are fine unindexed, so the rule for what to warn on needs a pass over real routers first or it becomes startup noise. | Audit 3.13 recommendation | S | T5 |
| X3 | Move the sync mutation budget to the shared rate-limit store when one is configured | Audit `code-refactoring.md` 8; budget is per instance | S | rate-limit work in `secure-defaults` |
| X4 | Session revalidation sweep: reload each user once, bound concurrency. Not built here: the audit's premise (sequential) is wrong, session validity is per token so only the user reload can be shared, and the sweep is the disable/revoke path, which deserves its own review with `secure-defaults`. | Audit 3.12 | S | T3 |
| X5 | A CI-run check built on `api/src/sync/loadHarness.ts`: two backend processes on one MongoDB, one socket on each, each receives a change exactly once; plus a fan-out latency budget | Elephant line; the two-instance claim is unproven by test | M | T3 |
| X6 | `feature-flags` live updates emit with `io.local` | Same duplication as the resync hint when an app attaches an adapter | S | T7 |
| X7 | Web cross-tab persistence safety and per-partition storage | Audit 4.7 and 3.14 | L | `syncdb-cross-tab-safety` IP |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |

None. The human was not asked; every open question above stands on its recommendation.

Compatibility record (required by the request): `sync:delta` wire format unchanged (T3). REST list response: `total` unchanged by default; `totalCapped`, `nextCursor` and the `totalMode`, `pagination`, `after` parameters are additive (T4, T5). No on-device storage change in this plan.

## Sign-off

Status: approved 2026-11-13
Cut: 2 rounds (fresh subagent each), 18 findings: 15 fixed, 2 moved to questions or expansions (default total mode → Q1; two-instance proof → X5), 1 rebutted (regression case for load: a load run is automatable, so it is X5 and T3 evidence, not a manual suite case). Round 2's blocking finding (cursor leaked hidden sort values) was fixed by making the cursor id-only; no third round was run, so that rewrite of T5 is unreviewed.
