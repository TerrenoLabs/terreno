# Implementation Plan: SyncDB Local-First Data Layer (v2)

*When an engineer is assigned to a project but before you begin coding, you should fill in the implementation plan and get feedback from the engineering team. Once you have finished or you make any changes, tag Josh with the @ symbol so he can review. Also tag anyone else that needs to be notified, has conflicting work, etc.*

**Status:** Shaped, ready for review
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1081
**Priority:** High
**Effort:** Large
**Supersedes:** the prior v1 plan (PR #739, previous content of this file) and the foundation implementation in PR #835 (to be closed with a comment linking here). Proven pieces of #835 — the outbox state machine, AES-GCM codec, delta applier, and type contracts — are harvested and adapted, not reused wholesale.
**Research:** investigation + decision log kept in the IP session's `research.md` (gitignored by repo convention); key findings and decisions are inlined below.

## Core Concept

`@terreno/syncdb` is a local-first data layer: a TinyBase `MergeableStore` (encrypted IndexedDB on web, expo-sqlite on native) is the UI's source of truth. Mutations apply locally and enqueue in a durable outbox, then replay over a `sync:mutate` ack/nack channel that executes the existing modelRouter write path (permissions, hooks, validation). Inbound changes flow from the existing change-stream watcher as `sync:delta` events carrying monotonic per-stream cursors, with HTTP snapshot/catch-up reconciliation. The server remains the source of truth for validation and authorization — but not for immediate UI responsiveness.

Key architectural decisions (rationale in `research.md`):

- **TinyBase `MergeableStore` from day one.** It is a per-cell LWW CRDT (hybrid logical clocks) with a different on-disk format from plain `Store`; adopting it now avoids a per-device data migration later and keeps the Yjs door open without implementing Yjs.
- **Custom delta protocol over the existing `RealtimeApp`** (Socket.io + Mongo change streams), not TinyBase's `WsSynchronizer` (a client-relay with no server-authoritative validation hook) and not an off-the-shelf engine (infra dependency, bypasses modelRouter permissions).
- **Simple cursors:** per-doc `_syncSeq` + reconcile-on-reconnect; no event log collection, no strict gap proof. Synced models must use soft delete (`isDeletedPlugin`) so tombstones remain queryable.
- **Multi-tenant by default:** streams are scoped `{collection}|{scope}` where scope is owner, tenant (configurable field), broadcast, or custom.
- **Auth lives in Better Auth.** Syncdb consumes a narrow `AuthProvider` interface; a Better Auth adapter ships in the package.
- **Encryption default-on for web** via Web Crypto AES-GCM in a custom IndexedDB persister. Key management is a configurable `KeyProvider`: default derives via HKDF from server-provided per-user key material (`GET /sync/key`); an alternative purely-local non-extractable CryptoKey provider ships too. Native relies on the OS sandbox (plaintext sqlite).

## **Models**

### Server (`@terreno/api`)

**`sync` option on modelRouter** (parallel to the existing `realtime` option):

```typescript
const router = modelRouter("/todos", Todo, {
  permissions: {...},
  sync: {
    // Which stream a doc belongs to — multi-tenant by default
    scope: {type: "owner"},                          // stream = todos|owner:{ownerId}
    // or {type: "tenant", field: "organizationId"}  // stream = todos|tenant:{orgId}
    // or {type: "broadcast"}                        // stream = todos|all
    // or (doc) => string                            // custom
    responseHandler?: (doc) => unknown,              // sanitize, like realtimeResponseHandler
  },
});
```

Registering `sync`:

- **requires soft delete** on the model (`isDeletedPlugin`, `deleted: true` tombstones) — validated at startup by the sync registry; hard-delete models cannot enable sync. This is what makes cursor catch-up correct without an event log. Note: `isDeletedPlugin` auto-injects `{deleted: {$ne: true}}` into `find`/`findOne` (`api/src/plugins.ts:52-57`) — sync's snapshot/catch-up queries **must explicitly bypass it** with `deleted: {$in: [true, false]}` (the plugin skips injection when the query already mentions `deleted`).
- **requires `syncPlugin` on the schema** (developer-applied, like `isDeletedPlugin` — Mongoose middleware cannot be attached after a model is compiled, so registration validates the plugin is present rather than applying it). The plugin's hooks consult the sync registry at write time, so un-registered models with the plugin no-op.
- custom resolver scopes additionally require a `snapshotFilter` in the sync config (a stream resolver function cannot be inverted into a Mongo query for the snapshot endpoint) — validated at registration.
- **restricts write paths**: the plugin hooks `save`, `insertMany`, `updateOne`, `findOneAndUpdate`, `replaceOne`, and `findOneAndReplace`; `updateMany`, `deleteMany`, `deleteOne`, and `findOneAndDelete` **throw on synced models** (multi-doc updates cannot stamp per-document seqs; hard deletes are invisible to tombstone catch-up — callers loop per doc and use soft delete). `Model.bulkWrite` bypasses Mongoose middleware entirely and is a documented restriction. The existing `bulkComplete` action in example-backend (`Todo.updateMany`, `example-backend/src/api/todos.ts:22`) is refactored accordingly in Phase 7.

**`realtime` vs `sync` coexistence:** a model may enable both. They emit distinct events (`sync` for the legacy RTK cache-patching path, `sync:delta` for syncdb) so clients never double-apply, at the cost of double emission work per change while both are enabled. Recommendation: treat `realtime` as deprecated for a model once `sync` is on; document this in the migration guide.

**New/modified Mongoose schemas** (all fields carry `description` per repo convention):

```typescript
// Plugin applied to every synced model at registration:
{_syncSeq: number}   // compound index: {<scopeField>: 1, _syncSeq: 1}

// SyncCounter — atomic per-stream monotonic counter
// (findOneAndUpdate + $inc + upsert; Redis upgrade path documented as future work)
{stream: string /* unique index */, seq: number}

// SyncMutation — idempotency ledger; a re-sent mutation (lost ack) is never double-applied
{mutationId: string /* unique index */, userId: string,
 status: "applied" | "conflicted" | "failed",
 resultId?: string, resultSeq?: number, error?: string,
 created: Date /* TTL index, 30 days */}

// SyncKey — per-user key material for the default encryption KeyProvider
{userId: string /* unique index */, keyMaterial: string /* 32 random bytes, base64, server-generated */,
 created: Date}
```

**Cursor semantics:** every synced write claims the next `seq` for its stream (`SyncCounter` `$inc`) and stamps it on the doc as `_syncSeq`. Validation failures never burn a seq (Mongoose runs validation before user pre-save hooks, so the claim happens post-validation); the claim **joins the caller's session** when one is present, giving caller-managed transactions counter+write atomicity. The plugin does not open its own transaction per write — a hot counter doc inside per-write transactions produces WriteConflict retry storms under concurrency — so a rare post-validation write failure (e.g. duplicate key) burns a seq, which the client already treats as a benign gap (see Gap handling). The client's cursor per stream is the highest seq it has applied. Catch-up = `find({...scopeFilter, deleted: {$in: [true, false]}, _syncSeq: {$gt: cursor}})`, paginated by `_syncSeq` ascending — safe under concurrent writes because a doc's seq only ever increases, moving it *ahead of* the scan pointer, never behind it. Deletes remain visible as soft-delete tombstones.

**Why a counter and not change-stream resume tokens:** resume tokens are opaque, oplog-scoped, and expire with oplog retention — they cannot answer "give me every doc in my stream changed since X" as a plain indexed query, which is what makes the HTTP catch-up trivial and durable. The counter's costs (one transactional `$inc` per synced write) are accepted; Redis is the documented upgrade path.

**Gap handling:** stream seqs are **not** guaranteed contiguous from any one client's perspective — permission-filtered deltas legitimately skip numbers. The seq-jump heuristic is therefore a *hint*, not a proof: jumps trigger an HTTP reconcile **rate-limited** (at most once per 30s per stream), and a low-frequency periodic reconcile (on visibility change / every few minutes while connected) guarantees convergence even for deltas missed with no observable jump.

**Scope changes** (doc moves tenant / owner changes): change streams run with `fullDocumentBeforeChange: "off"` (`changeStreamWatcher.ts:420`), so the old scope is **not available from the change event**. Instead, the `_syncSeq` plugin detects scope-field changes at write time and stamps `_syncPrevStream` on the doc; the watcher reads it from the post-image and emits a tombstone delta to the previous stream plus a create delta to the new stream. No Mongo pre-image configuration required.

### Client (`@terreno/syncdb` — no Mongoose, no Redux)

TinyBase `MergeableStore` layout, one store per `{app, userId}`:

```
tables:
  {collection}   → rowId = doc _id; cells: data (JSON string), seq, deleted, pendingMutationId?
  _outbox        → rowId = mutationId; cells: collection, operation, entityId, args (JSON),
                   baseVersion, status (queued|inFlight|acked|conflicted|failed),
                   attemptCount, userId, createdAt
  _cursors       → rowId = stream; cells: seq, updatedAt
  _conflicts     → rowId = mutationId; cells: collection, entityId, localData, serverData,
                   serverSeq, dismissed
values: schemaVersion, lastUserId
```

**Persistence:**

- Native: `ExpoSqlitePersister` (JSON-serialization mode — required for MergeableStore), plaintext (OS sandbox is sufficient).
- Web: custom `EncryptedIndexedDbPersister` (`createCustomPersister`): serialize mergeable content → AES-GCM encrypt via Web Crypto → single blob in IndexedDB. Encryption is **default-on**. (TinyBase's stock `IndexedDbPersister` does not support MergeableStore, so a custom persister is required regardless.)
- Tests/SSR: in-memory persister.

**Key providers (configurable):**

- `serverKeyProvider` (**default**): fetch `GET /sync/key` once per login, derive the AES-256-GCM key via HKDF (salt = app name + userId), cache as a **non-extractable CryptoKey in IndexedDB** so offline cold start still decrypts. Server rotation of key material → client detects decrypt failure, wipes, re-bootstraps.
- `localKeyProvider`: random non-extractable CryptoKey generated and stored locally; no server dependency (and no server-side copy of the material — strictly stronger for the at-rest case, at the cost of no server-driven rotation/revocation).

**Encryption threat model (stated explicitly):** the web encryption defends against **at-rest disk inspection of IndexedDB** (stolen/imaged device, backup scraping) and against a **stale store being readable after user switch** (per-user keys + wipe). It does **not** defend against XSS or any code executing on the origin (a non-extractable CryptoKey can still be *used* to decrypt in place), and with `serverKeyProvider` the server can reconstruct any user's key (that is the trade for rotation/revocation — choose `localKeyProvider` where that is unacceptable). Server-side data is protected by MongoDB/infra controls, not this layer.

## **APIs**

### HTTP endpoints (mounted by the sync plugin; all `authenticateMiddleware()` + model permissions + server-enforced scope filters, documented via `createOpenApiBuilder`)

| Method & Path | Purpose | Permissions |
|---|---|---|
| `GET /sync/snapshot?collection=&cursor=&limit=` | Bootstrap + catch-up. Returns `{entities: [{id, data, seq, deleted}], cursor, hasMore}`. `cursor=0` = full snapshot. Paginated (default 500). | Auth + model `list` permissions + scope filter (owner/tenant) applied server-side |
| `POST /sync/mutate` | HTTP fallback for outbox replay (same handler as the socket channel). Body: `{mutationId, collection, operation, id?, data?, baseVersion?}` | Auth + model's create/update/delete permissions via modelRouter write path |
| `GET /sync/key` | Returns caller's `keyMaterial` (creates on first call) for the default KeyProvider | Auth (own key only) |

### Socket protocol (new events on the existing authenticated Socket.io server)

| Event | Direction | Payload |
|---|---|---|
| `sync:subscribe` / `sync:unsubscribe` | client → server | `{collections: string[]}` — server resolves the user's streams from scope config (+ `getUserStreams(user)` for tenant membership) and joins rooms |
| `sync:delta` | server → client | `{collection, id, method, data?, seq, stream, deleted?}` — emitted by the change-stream watcher with per-socket permission checks (reuses `emitToAuthorizedRoom`) |
| `sync:mutate` | client → server | `{mutationId, collection, operation, id?, data?, baseVersion?}` — executes the modelRouter write path |
| `sync:ack` | server → client | `{mutationId, id, seq}` |
| `sync:nack` | server → client | `{mutationId, code: "conflict"\|"unauthorized"\|"validation"\|"error", serverDoc?, serverSeq?, message}` — conflict nacks carry the canonical server doc |

**Conflict rule:** client sends `baseVersion` = the `_syncSeq` it last saw for the doc; mismatch with the current `_syncSeq` → nack `conflict`. Same LWW semantics as the rtk offline queue's `If-Unmodified-Since`, on a monotonic integer. The extracted update executor (see below) accepts either check — REST passes the timestamp header, sync passes `baseVersion` — so the two LWW modes share one code path instead of diverging.

**A prerequisite refactor this plan owns explicitly:** modelRouter's create/update/delete logic is currently inline inside Express `asyncHandler` closures with permissions and validation as middleware (`api/src/api.ts:648-745` and onward) — there is **no callable write path today**. Phase 2 therefore begins by extracting transport-agnostic executors (`executeCreate/executeUpdate/executeDelete({model, options, user, body, id, ...})`) and migrating the REST handlers onto them with the entire existing API test suite kept green. `applySyncMutation` builds on those executors; it does not synthesize fake `req`/`res` objects.

**Idempotency (atomic claim):** the handler **inserts** a `SyncMutation` row with status `pending` (unique index on `mutationId`) *before* applying; a duplicate-key error means another delivery owns or completed it — the handler waits/reads back the recorded outcome instead of re-applying. This closes the race where socket retry and HTTP fallback deliver the same mutation concurrently.

**Socket auth:** a pluggable socket authenticator on `RealtimeApp` — legacy JWT (current `@thream/socketio-jwt` path) continues to work; a Better Auth session validator is added alongside.

### Client package API surface

```typescript
createSyncDb({name, collections, authProvider, keyProvider?, transportFactory?, persisterFactory?})
// authProvider: {getToken(), getUserId(), onAuthChange(cb)} — betterAuthAdapter ships in the package

client.start() / client.stop()            // load persister, hydrate, connect socket
client.bootstrap({collections?})          // HTTP snapshot pull (initial or forced)
client.mutate({collection, operation, id?, data})  // local apply + outbox enqueue + async flush
client.resolveConflict({mutationId, strategy: "useServer" | "keepMine"})
client.getSyncStatus()                    // {isOnline, queuedCount, conflictCount, isSyncing, streams}

// React (TinyBase reactive listeners, no Redux):
<SyncDbProvider client={client}>
useEntity(collection, id)
useQuery(collection, {filter?, sort?})
useMutate(collection)
useSyncStatus()
useConflicts()
```

Outbox replays FIFO per collection over the socket, falling back to `POST /sync/mutate`; per-user replay isolation is ported from `rtk/src/offlineMiddleware.ts` (queued mutations record `userId`; replay skips on mismatch).

## **Notifications**

None (no push/email/SMS). In-app sync state surfaces via `useSyncStatus()`: offline indicator, queued-mutation count, syncing state, unresolved-conflict count. The example app renders a status banner and a conflict resolution sheet.

## **UI**

Syncdb is a library; the UI work is the example-frontend proof surface:

- **Todos screen on syncdb** behind a `USE_SYNCDB` feature flag (existing OpenFeature infra). The RTK path remains the default until parity is verified.
- **`SyncStatusBanner`**: offline / N queued / syncing / conflict count. testIDs: `sync-status-banner`, `sync-queued-count`, `sync-conflict-badge`.
- **Conflict resolution sheet**: local vs server values side by side, "Keep mine" / "Use server". testIDs: `conflict-sheet`, `conflict-item-{id}`, `conflict-keep-mine-button`, `conflict-use-server-button`.
- **Dev testing panel** (dev-only): offline toggle, force reconnect, wipe local store. testIDs: `syncdb-dev-panel`, `syncdb-offline-toggle`, `syncdb-wipe-button`.

All components built from @terreno/ui primitives (Box, Text, Button, Modal/ModalSheet).

## Phases

1. **Server sync foundation** — `sync` modelRouter option + registry + soft-delete validation, `_syncSeq` plugin (transactional seq claim, all write paths, `updateMany`/`bulkWrite` guard, `_syncPrevStream`) + `SyncCounter`, `GET /sync/snapshot` (tombstone-inclusive), `SyncKey` (race-safe upsert) + `GET /sync/key`.
2. **Server mutation channel + deltas** — **CRUD executor extraction from modelRouter (Task 2.0, the load-bearing refactor)**, then shared mutation handler (`sync:mutate` + `POST /sync/mutate`) with atomic idempotency claim, ack/nack with conflict payloads, `sync:delta` emission with seq, `sync:subscribe` + tenant rooms, pluggable socket authenticator (Better Auth).
3. **Client core** — package scaffold, `MergeableStore` schema + typed accessors, persister factories (expo-sqlite / memory), outbox state machine + cursor store + idempotent delta applier (harvested from #835).
4. **Client crypto** — `EncryptedIndexedDbPersister`, AES-GCM codec (harvested), `serverKeyProvider` (default) + `localKeyProvider`, wipe-on-user-change.
5. **Client sync engine + transport** — Socket.io transport, HTTP fallback + bootstrap, replay coordinator, conflict store/resolver, reconcile heuristics; integration tests against a real example-backend.
6. **React layer + Better Auth adapter** — `SyncDbProvider`, hooks, `betterAuthAdapter`.
7. **Example integration + docs** — example-backend `sync` enablement (todos + a tenant-scoped model), example-frontend behind `USE_SYNCDB` with banner/conflict UI, Playwright e2e, migration guide, close #835.

Each phase is one PR. Phases 1–2 (server) and 3–4 (client foundations) can proceed in parallel once Phase 1's shared protocol types are agreed.

## Feature Flags & Migrations

- `USE_SYNCDB` feature flag in example-frontend only; the packages themselves need no flag (adoption is opt-in by construction).
- No data migrations: local stores are new; server collections (`SyncCounter`, `SyncMutation`, `SyncKey`) are additive. Docs without `_syncSeq` sort before any cursor and are delivered by the first snapshot; the plugin stamps them on their next write.
- `@terreno/rtk` is **not removed**: README deprecation notice for data-sync concerns + migration guide at `docs/how-to/migrate-rtk-to-syncdb.md`. rtk remains for non-synced RPC endpoints and legacy JWT auth until Better Auth migration completes.
- PR #835 is closed with a comment linking this plan once the IP PR is up.

## Activity Log & User Updates

None user-facing. Server-side `logger` instrumentation: applied mutations at `info` (mutationId, collection, seq), nacks at `info` with code, replay/idempotency anomalies at `warn`.

## Permissions & Access

- Every mutation — socket or HTTP — executes the modelRouter write path: identical permissions, pre/post hooks, and validation as REST CRUD. No parallel authorization system.
- Snapshot enforces model `list` permissions plus a server-side scope filter; clients can never read another scope's stream.
- Delta emission reuses the per-socket permission checks in `emitToAuthorizedRoom` (`api/src/realtime/changeStreamWatcher.ts:214-249`).
- Local isolation: store per `{app, userId}`; on auth user change syncdb wipes and re-bootstraps. Per-user encryption keys make a stale store unreadable to the next user.

## **Not included/Future work**

- **Bundling/chunking optimization** (future speed work, explicitly no tasks in this IP): lazy-load persisters per platform, code-split the sync engine so non-syncdb apps pay nothing, web chunking for faster initial load.
- Yjs CRDT backend for collaborative structures (rich text); the door stays open via the MergeableStore + persister/transport abstractions.
- Redis-based per-stream counters for high-throughput multi-instance deployments (documented upgrade path).
- Field-level conflict merge UI (v1 is whole-doc keep-mine/use-server).
- `@terreno/syncdb-codegen` typed collection descriptors from OpenAPI.
- Removing `@terreno/rtk`.
- Admin sync-inspection UI (outbox/cursor/conflict visibility in admin panel).
- Native sqlite encryption (SQLCipher) — sandbox deemed sufficient.

## Risks & Mitigations

- **modelRouter executor extraction (Task 2.0) is the highest-risk item in the plan**: it refactors the framework's most load-bearing file (`api/src/api.ts`, ~1000 lines of inline Express handlers). Mitigation: it is its own PR-sized task with the hard gate that the entire existing API test suite passes unchanged before anything sync-specific builds on it.
- **Whole-store serialize+encrypt per save** (TinyBase persisters persist the full store): debounced/throttled saves (500ms trailing); per-table blob sharding is the documented follow-up if profiling demands it. Encryption cost scales with store size, not change size — bounded in practice by scoping which collections sync.
- **TinyBase version behavior unverified in-repo** (`tinybase` is not yet a dependency anywhere): MergeableStore persister-mode constraints were verified against tinybase.org v8 docs, not an installed version. Task 3.1 pins the version; Task 3.5/4.2 acceptance tests are the tripwire.
- **Better Auth socket authentication**: `RealtimeApp` validates legacy JWTs only today. Pluggable authenticator added in Phase 2; legacy JWT path unchanged, so nothing regresses.
- **Seq counter write amplification** (one transactional `$inc` + doc write per synced write): acceptable at current scale; Redis path documented. Transactions require the replica set, which change streams already mandate.
- **Missed deltas while connected**: no strict gap proof by design — rate-limited seq-jump reconcile + reconcile-on-reconnect + periodic reconcile give eventual convergence (accepted in shaping). Permission-filtered deltas make seq gaps legitimate, hence the rate limiting.
- **Scope changes**: `_syncPrevStream` stamped at write time (no Mongo pre-image config needed); watcher emits old-stream tombstone + new-stream create; explicit test case.
- **Multi-tab same-user on web**: two tabs share one IndexedDB blob; concurrent persister saves are last-writer-wins at the blob level, which can drop the other tab's queued outbox rows. V1 mitigation: single-writer persistence via the Web Locks API (the lock-holding tab owns persister saves; others operate in-memory and re-load on lock acquisition). Full multi-tab coordination (BroadcastChannel state sharing) is future work; AC-8 remains valid because each tab holds its own socket.
- **`sync:mutate` flood**: per-socket rate limit on the mutation channel (consistent with existing subscription caps) — each mutation costs a transaction + ledger write.
- **MergeableStore ~2× storage overhead**: accepted for CRDT-readiness; documented.

## Acceptance Criteria

*All UI criteria run against example-frontend (web) with `USE_SYNCDB` on unless stated otherwise. Server-only behaviors (scope isolation, idempotency, permission enforcement) are additionally covered by bun API/integration tests per the Task List; the criteria below are the user-observable surface.*

### Feature: Local-First Reads & Bootstrap

#### AC-1: Todos load from the local store after login
**Priority:** P0
**Screen:** Todos
**Preconditions:**
- `USE_SYNCDB` flag on; test user has ≥3 todos on the server; fresh browser profile (empty local store)

**Steps:**
1. Log in via `loginAs()` and wait for `todos-screen` to be visible
2. Observe the todos list after bootstrap completes

**Expected results:**
- [ ] All server todos render as `todo-item-{id}` elements
- [ ] `sync-status-banner` shows no queued count and no offline indicator

**testIDs needed:** `todos-screen`, `todo-item-{id}`, `sync-status-banner`

---

#### AC-2: Data persists across reload without network
**Priority:** P0
**Screen:** Todos
**Preconditions:**
- AC-1 completed (local store populated)

**Steps:**
1. Toggle offline via `syncdb-offline-toggle` (dev panel)
2. Reload the page and wait for `todos-screen`

**Expected results:**
- [ ] Previously synced todos render from the local store with no network
- [ ] `sync-status-banner` shows the offline indicator (`sync-offline-indicator` visible)

**testIDs needed:** `syncdb-dev-panel`, `syncdb-offline-toggle`, `todos-screen`, `todo-item-{id}`, `sync-status-banner`, `sync-offline-indicator`

---

#### AC-3: Empty state renders for a user with no data
**Priority:** P1
**Screen:** Todos
**Preconditions:**
- Fresh user with zero todos

**Steps:**
1. Log in and wait for `todos-screen`

**Expected results:**
- [ ] `todos-empty-state` is visible; no `todo-item-*` elements exist

**testIDs needed:** `todos-empty-state`

---

### Feature: Offline Mutations & Durable Outbox

#### AC-4: Offline create applies instantly and syncs on reconnect
**Priority:** P0
**Screen:** Todos
**Preconditions:**
- Logged in, store bootstrapped

**Steps:**
1. Toggle offline via `syncdb-offline-toggle`
2. Type "Offline milk run" into `todos-title-input`, click `todos-create-button`
3. Observe the list and banner
4. Toggle back online
5. Wait for the queued count to clear

**Expected results:**
- [ ] The new todo appears in the list immediately (before any network)
- [ ] `sync-queued-count` shows "1" while offline
- [ ] After reconnect, `sync-queued-count` disappears and the todo remains (now server-acked)
- [ ] The todo is visible in a second browser session for the same user

**testIDs needed:** `todos-title-input`, `todos-create-button`, `sync-queued-count`, `syncdb-offline-toggle`

---

#### AC-5: Queued mutations survive an app reload
**Priority:** P0
**Screen:** Todos
**Preconditions:**
- Offline with 2 queued mutations (1 create, 1 update)

**Steps:**
1. Reload the page while still offline; wait for `todos-screen`
2. Observe banner and list
3. Toggle online

**Expected results:**
- [ ] `sync-queued-count` still shows "2" after reload (outbox is durable)
- [ ] Optimistic changes are still visible in the list
- [ ] After reconnect, both mutations replay in order and the queue clears

**testIDs needed:** `sync-queued-count`, `todos-screen`, `todo-item-{id}`

---

#### AC-6: Offline update and delete apply locally and replay
**Priority:** P1
**Screen:** Todos
**Preconditions:**
- Logged in with ≥2 synced todos

**Steps:**
1. Toggle offline
2. Toggle completion on one todo via `todo-toggle-{id}`; delete another via `todo-delete-{id}`
3. Toggle online; wait for the queue to clear

**Expected results:**
- [ ] Toggle and delete reflect immediately while offline
- [ ] After reconnect the server state matches (verify via second session): toggled todo is completed, deleted todo is gone

**testIDs needed:** `todo-toggle-{id}`, `todo-delete-{id}`

---

#### AC-7: User switch wipes local data
**Priority:** P0
**Screen:** Todos / Login
**Preconditions:**
- User A logged in with synced todos and 1 queued (offline) mutation

**Steps:**
1. Log out; log in as user B
2. Wait for `todos-screen`

**Expected results:**
- [ ] None of user A's todos are visible to user B
- [ ] `sync-queued-count` is absent (A's outbox not replayed as B)
- [ ] Logging back in as A re-bootstraps A's server data

**testIDs needed:** `todos-screen`, `sync-queued-count`

---

### Feature: Live Delta Sync

#### AC-8: Changes from another session appear without refresh
**Priority:** P0
**Screen:** Todos
**Preconditions:**
- Same user logged in from two browser contexts (A and B), both on `todos-screen`

**Steps:**
1. In context B, create a todo "From the other tab"
2. Observe context A without any interaction

**Expected results:**
- [ ] The new todo appears in context A via `sync:delta` (no reload, no refetch button)
- [ ] Completing it in B updates A; deleting it in B removes it from A

**testIDs needed:** `todo-item-{id}`, `todos-create-button`, `todo-toggle-{id}`, `todo-delete-{id}`

---

#### AC-9: Reconnect catch-up converges missed changes
**Priority:** P0
**Screen:** Todos
**Preconditions:**
- Same user in contexts A and B; A toggled offline

**Steps:**
1. In context B (online), create one todo, update another, delete a third
2. Toggle A back online
3. Wait for sync to settle

**Expected results:**
- [ ] Context A shows all three changes after reconnect (HTTP catch-up from cursor), with no duplicates

**testIDs needed:** `todo-item-{id}`, `syncdb-offline-toggle`

---

### Feature: Conflict Resolution

#### AC-10: Conflicting offline edit surfaces a conflict with both versions
**Priority:** P0
**Screen:** Todos / Conflict sheet
**Preconditions:**
- Same user in contexts A and B; both see todo T

**Steps:**
1. Toggle A offline; edit T's title to "Local edit" in A
2. In B (online), edit T's title to "Server edit"
3. Toggle A online; wait for replay
4. Click `sync-conflict-badge` to open the conflict sheet

**Expected results:**
- [ ] `sync-conflict-badge` appears showing "1"
- [ ] `conflict-sheet` shows the local value ("Local edit") and server value ("Server edit") side by side in `conflict-item-{id}`
- [ ] T's local display is not silently overwritten while the conflict is unresolved

**testIDs needed:** `sync-conflict-badge`, `conflict-sheet`, `conflict-item-{id}`

---

#### AC-11: "Use server" resolves to the server version
**Priority:** P0
**Screen:** Conflict sheet
**Preconditions:**
- AC-10 state (open conflict)

**Steps:**
1. Click `conflict-use-server-button`

**Expected results:**
- [ ] The sheet closes (or the item leaves the list); `sync-conflict-badge` disappears
- [ ] T shows "Server edit" locally; no mutation is re-sent

**testIDs needed:** `conflict-use-server-button`, `sync-conflict-badge`

---

#### AC-12: "Keep mine" re-applies the local version to the server
**Priority:** P1
**Screen:** Conflict sheet
**Preconditions:**
- AC-10 state (open conflict)

**Steps:**
1. Click `conflict-keep-mine-button`
2. Wait for the queue to clear

**Expected results:**
- [ ] T shows "Local edit" locally and in context B (mutation re-enqueued with fresh baseVersion and acked)
- [ ] `sync-conflict-badge` disappears

**testIDs needed:** `conflict-keep-mine-button`, `sync-conflict-badge`

---

### Feature: Sync Status UI

#### AC-13: Banner reflects offline / queued / syncing states
**Priority:** P1
**Screen:** Todos
**Preconditions:**
- Logged in, bootstrapped

**Steps:**
1. Toggle offline → observe banner
2. Create 2 todos → observe queued count
3. Toggle online → observe transition

**Expected results:**
- [ ] Offline: `sync-offline-indicator` visible
- [ ] Queued: `sync-queued-count` shows "2"
- [ ] On reconnect: count clears; banner returns to idle (no offline indicator, no count)

**testIDs needed:** `sync-status-banner`, `sync-offline-indicator`, `sync-queued-count`

---

### Feature: Encryption at Rest (web)

#### AC-14: IndexedDB contains no plaintext entity data
**Priority:** P0
**Screen:** N/A (storage assertion)
**Preconditions:**
- Logged in; a todo titled "SECRET_MARKER_XYZ" has synced; persister has saved

**Steps:**
1. Via `page.evaluate`, read all records from the syncdb IndexedDB database
2. Serialize the raw stored values and search for "SECRET_MARKER_XYZ"

**Expected results:**
- [ ] The marker string does not appear anywhere in raw IndexedDB contents (payload is AES-GCM ciphertext)
- [ ] After reload (same session), the todo still renders with the correct title (decrypt works)

**testIDs needed:** `todo-item-{id}` (post-reload assertion)

---

### Feature: Flag & Migration Safety

#### AC-15: USE_SYNCDB off leaves the RTK path unchanged
**Priority:** P0
**Screen:** Todos
**Preconditions:**
- `USE_SYNCDB` flag off

**Steps:**
1. Log in; wait for `todos-screen`
2. Create, toggle, and delete a todo

**Expected results:**
- [ ] All CRUD works exactly as before (RTK Query path)
- [ ] No syncdb UI (`sync-status-banner`, `syncdb-dev-panel`) is rendered

**testIDs needed:** `todos-screen`, `sync-status-banner`, `syncdb-dev-panel`

---

### Feature: Server Contract (API-level, verified by bun tests — listed for completeness)

#### AC-16: Scope isolation, idempotency, and authoritative validation
**Priority:** P0
**Screen:** N/A (API)
**Preconditions:** integration test environment (Phase 5.5)

**Expected results:**
- [ ] `GET /sync/snapshot` never returns another owner's/tenant's documents regardless of query params
- [ ] Re-sending a `sync:mutate` with the same `mutationId` returns the recorded outcome without double-applying
- [ ] A mutation violating model permissions is nacked `unauthorized`; one failing validation is nacked `validation`; neither modifies data
- [ ] A mutation with a stale `baseVersion` is nacked `conflict` and includes the canonical server doc + seq

**testIDs needed:** none (API tests)

---

## Task List (Bot Consumption)

*Structured task breakdown for automated implementation. The canonical copy lives at `docs/tasks/syncdb-local-first.md`; keep the two in sync.*

See `docs/tasks/syncdb-local-first.md` for the full 26-task breakdown across the 7 phases above (including Task 2.0, the modelRouter executor extraction).

---

## Phase C — Sync protocol correctness (updated contract)

Phase C hardened the wire protocol. The rules below OVERRIDE the earlier descriptions of
the snapshot endpoint, cursor advancement, and scope-move handling.

### C1 — Stable frontier (seq commit fence)

A client cursor for a stream may advance to seq N **only when the server reports N ≤ that
stream's *stable frontier***: every seq ≤ N in the stream is committed (its owning write
durably landed, or its claim was reclaimed after the crash lease expired).

- The `SyncCounter` carries an in-flight `pending: [{seq, claimedAt}]` registry. A claim
  registers its seq(s); the post-write hook (`confirmSyncSeqs`) clears them. The frontier
  is `min(live pending.seq) − 1`, or the head `seq` when no live pending entries remain.
  A pending entry older than `PENDING_CLAIM_LEASE_MS` (60s) is treated as abandoned
  (crashed writer) and excluded — a crash can never freeze the frontier forever.
- A **session-backed** claim commits atomically with its write, so it skips the pending
  registry entirely (nothing to confirm; frontier = head).
- **Snapshots** never return a `cursor` above `frontierSeq`. `hasMore` is true when a full
  page returned, extra scope-move markers remain, OR the frontier sits below the stream
  head (more committed seqs are coming). A client at the frontier with `hasMore: true`
  and no new entities polls/reconciles (rate-limited) until the frontier moves.
- **Deltas** carry `frontierSeq`; the client advances its cursor to
  `min(delta.seq, delta.frontierSeq)`, closing the delta-side commit-order inversion with
  no server round-trip.
- **Consequence:** no committed document is ever permanently skipped by cursor catch-up.

Write-path guards landed with C1: a query-write on a synced model MUST target a single
document by `_id` (m9 — a non-`_id` filter could stamp the wrong stream's seq); a save
whose only modified paths are auto-managed metadata (`_syncSeq`, `_syncPrevStream`,
`updated`) claims no seq (m10 — no-op saves do not burn seqs).

### C2 — Per-stream snapshots + stream discovery

- `GET /sync/streams` → `{streams: [{stream, collection}]}` — the authoritative set of
  streams the caller currently belongs to (resolved against the full user so tenant
  memberships reflect current `organizationIds`).
- `GET /sync/snapshot?stream={streamKey}&cursor={n}&limit={n}&legacyCursor={opaque}` →
  `{stream, entities, cursor, hasMore, frontierSeq, oldestRetainedSeq, legacyCursor?}`.
  One stream per request. The old `?collection=` param and the single flattened cursor are
  **removed**. The server verifies the caller belongs to the requested stream (403
  otherwise) and filters to the single scope value (`{field: value}`, never `$in`).
- The client keeps `_cursors` rows keyed by the **real stream key** (the same key deltas
  use). It persists a `_knownStreams` set and, on `start()`/`reconcile()`, diffs
  `GET /sync/streams` against it:
  - **New stream** → bootstrap from cursor 0 (tenant-join backfill).
  - **Removed stream** → purge that stream's local entities + cursor + known-stream entry —
    **only when `GET /sync/streams` returned HTTP 200** (INV-2). A 401 (AuthRequiredError)
    enters auth-pause and leaves everything intact; a transport error rethrows without
    purging. A 401/403/transport error is NEVER a membership change.
- Each local entity row records the `stream` it was written under, so leave-purge is
  O(stream).
- **Migration:** a client holding legacy `snapshot:{collection}` cursors deletes them and
  clears `_knownStreams` on start, then re-bootstraps every stream from 0 (idempotent
  upserts + seq guards make this cheap and non-destructive; local entities are not wiped).

### C3 — Legacy-doc pagination

Documents predating the seq plugin (no `_syncSeq`, or a literal 0) are paged as a separate
stratum by `_id`. While the stratum has more, the snapshot returns `cursor: 0` plus an
opaque `legacyCursor` (the last `_id` seen); the client echoes it back verbatim. When the
stratum is exhausted the server omits `legacyCursor` and paging proceeds by seq. This
terminates deterministically — no infinite loop when `> limit` unstamped docs exist.

### C4 — Scope-move markers (durable, not `_syncPrevStream`)

A scope move (owner/tenant change) writes a durable `SyncScopeMove` marker
`{collectionTag, entityId, fromStream, toStream, seq, created}` in the same op-scope as the
move, with the `seq` claimed from the OLD stream's counter. The change-stream watcher and
old-stream snapshot catch-up emit the old-stream tombstone **from the marker**, not from
the racy `_syncPrevStream` post-image — so a racing second write that resets
`_syncPrevStream` can no longer erase the tombstone. Markers share the tombstone retention
window (TTL). An offline old-stream client learns of the move because the marker is merged
into its snapshot page as a `{deleted: true, data: null}` entity.

### C7 — Retention + re-bootstrap

Tombstone deltas and snapshot tombstones carry **no data** (only id/seq/deleted). The sync
bookkeeping collections (`synccounters`, `syncmutations`, `syncscopemoves`, `synckeys`) are
in `DEFAULT_IGNORED_COLLECTIONS` so their own change events drive no fan-out. Tombstones and
markers older than the model's `retentionDays` (default 90) may be hard-deleted by the
`compactTombstones` maintenance script. The snapshot response reports `oldestRetainedSeq`;
a client whose stored cursor for a stream is **below** it may have missed compacted
tombstones → it purges that stream and re-bootstraps from 0 (a sanctioned retention-gap
wipe, distinct from an auth wipe — INV-2).
