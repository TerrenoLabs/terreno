# SyncDB Hardening Plan (terreno-syncdb-2)

**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1081  
**Status:** Complete  
**Parent IP:** [syncdb-local-first.md](syncdb-local-first.md) — this plan hardens that IP and shares its roadmap issue

Implementation plan for hardening PR #869 (`@terreno/syncdb` local-first data layer,
branch `worktree-ip-syncdb`). This plan is self-contained: it restates each defect,
the exact fix, the files involved, and the tests that prove it. Work happens on a
branch cut from `worktree-ip-syncdb` (or on that branch directly).

Every file path below is relative to the repo root. Line numbers reference the PR
head commit `c854c146` and may drift slightly — always locate by the described code,
not the line number alone.

---

## Global invariants — apply to EVERY task in this plan

These override anything else in this document if there is a conflict.

**INV-1: Ordering is sacred.**
Mutation order matters. Within an entity, order is absolute. Across entities and
collections, assume order matters too (creates can be referenced by later mutations
in other collections). The replay pipeline must preserve **global FIFO order by
`enqueueOrder`** unless a task explicitly says otherwise. When any mutation fails
with a retryable outcome, **stop the line** — do not skip ahead and apply later
mutations while an earlier one is unresolved. The only sanctioned exception is
per-entity conflict skipping (Task B4), which is explicitly specified there.

**INV-2: A 401 / auth failure NEVER destroys local data.**
Unauthorized outcomes (HTTP 401, `AuthRequiredError`, `unauthorized` nack, socket
auth rejection) must: (a) leave every outbox row, entity, cursor, and conflict
exactly as it was; (b) not increment retry budgets; (c) transition the client into
a visible `paused: "auth"` state; (d) resume automatically and completely when the
SAME user re-authenticates. Local data is wiped only when a DIFFERENT userId
authenticates (existing `runUserCheck` behavior) or when the host app explicitly
calls the wipe API. Token expiry, session revocation, and transient 401s are
recoverable states, not logout.

**INV-3: Idempotency is the retry safety net — never weaken it.**
Every mutation keeps its client-minted `mutationId`, and the server ledger
(`api/src/sync/mutationHandler.ts`) keeps exactly-once semantics per id. Any retry
mechanism (batch or single) must be safe to replay wholesale because of this.
Changes that could double-apply a mutation are wrong by definition.

**INV-4: Repo conventions.**
bun test + expect; Luxon (never `Date` in app logic); RORO; const arrow functions;
interfaces over types; early returns; `logger.*` on backend, `console.info/debug/
warn/error` on frontend. E2E: testIDs only, no `waitForTimeout`.

---

## Model flags summary

Most tasks are **Sonnet-implementable** because this plan does the design work.
Flags where that is not enough:

| Task | Flag | Why |
|---|---|---|
| C1 (seq commit fence) | **OPUS — design + implementation** | Distributed-ordering correctness under concurrent writers; requires reasoning about Mongo transaction/commit semantics that a spec can't fully pin down. |
| C2 (per-stream cursors) | **OPUS — design; Sonnet can execute after** | Client-visible protocol change with migration for already-deployed cursors; get the contract reviewed before code. |
| C4 (scope-move tombstones on write path) | **OPUS recommended** | Change-stream/write-path interleaving is subtle; wrong fix silently loses tombstones. |
| B1–B5 (batch protocol) | Sonnet implement, **OPUS review the final semantics** before merge | Spec below is complete, but ordering edge cases deserve a second set of eyes. |
| Everything else (A, D, E, F) | **Sonnet** | Mechanical once specified. |

Suggested execution order: Phase A → B → D → E → C → F. A/B/D/E are independent
enough to parallelize; C changes the wire contract and should land before any real
external consumer adopts the protocol; F (tests/infra) accompanies each phase and
finishes last.

---

# Phase A — Client replay correctness & scheduling (Sonnet)

The replay scheduler is trigger-driven with no self-wake-up, no crash recovery, and
a baseVersion scheme that self-conflicts. These five tasks kill the observed
"queues everything up and gets stuck" symptoms.

## A1. Startup recovery for stranded outbox rows

**Problem.** Nothing recovers durable `inFlight` rows after a crash/reload.
`outbox.listQueued` only returns `status === "queued"`
(`syncdb/src/mutations/outbox.ts` ~line 163), and `client.start()`
(`syncdb/src/client.ts` ~382-404) has no recovery pass. A row stranded `inFlight`
never replays, and its entity's `pendingMutationId` blocks every future delta
(`syncdb/src/sync/deltaApplier.ts` ~47-50) and snapshot page
(`syncdb/src/sync/bootstrap.ts` ~56-59) forever. Sibling crash windows:
between `markAcked` and `releaseEntity`, and between `markConflicted` and
`writeConflict` (`syncdb/src/sync/replayCoordinator.ts`).

**Fix.**
1. Add `outbox.recoverStartupState({userId})`:
   - Every `inFlight` row → transition back to `queued`. Do NOT increment
     `attemptCount` (recovery is not an attempt).
   - Every `acked` row whose entity still has `pendingMutationId === mutationId`
     → clear the entity's `pendingMutationId` (replays the missing
     `releaseEntity`).
   - Every `conflicted` row with no matching `_conflicts` row → write the conflict
     row now (localData from the entity, serverData `null`, `serverSeq 0`), so the
     UI can surface it. Alternatively re-queue it; pick writing the conflict row —
     it is the state the machine had committed to.
2. Call it from `client.start()` immediately after the persister finishes
   `startAutoLoad()` and `runUserCheck` resolves the userId, before the first
   `replayOutbox()`.

**Tests** (`syncdb/src/mutations/outbox.test.ts`, `syncdb/src/client.test.ts`):
- Store persisted with an `inFlight` row → after `start()`, row is `queued` and
  replays; entity receives deltas again after resolution.
- `acked` row + entity still pending → pendingMutationId cleared on start.
- `conflicted` row without conflict row → conflict row exists after start.

## A2. Send-time baseVersion refresh

**Problem.** `mutate()` captures `baseVersion: existing?.seq` at enqueue time
(`syncdb/src/client.ts` ~470, ~497). Optimistic writes never advance `seq`, so two
queued edits to the same entity carry the same base; after the first acks at seq
N+1, the second (base N) is a guaranteed `conflict` nack against the server's
strict equality check (`api/src/sync/executors.ts` ~400). Every offline session
with >1 edit per doc manufactures conflicts.

**Fix.** In the replay coordinator, when building the request
(`replayCoordinator.ts` `buildRequest`), for `update`/`delete` operations read the
entity's CURRENT `seq` from the store and use it as `baseVersion` when it is newer
than the stored one (the stored one remains the floor; never send a lower value
than stored). The prior mutation's ack has already stamped the entity's seq via
`releaseEntity(mutation, ack.seq)`, so this chains bases correctly through a queue
of edits. Keep the enqueue-time capture as the initial value.

Do NOT coalesce mutations in this task. (Optional coalescing is a follow-up,
gated behind a config flag, and is intentionally out of scope: server-side hooks
observe each write, and collapsing intermediate states changes semantics.)

**Tests** (`syncdb/src/sync/replayCoordinator.test.ts`, plus one integration test
in `api/src/sync/integration.test.ts`):
- Enqueue create + update to same entity offline → replay online → both ack, no
  conflict.
- Enqueue update + update → both ack; second request carried the first's acked seq.
- Regression: a genuinely stale base (server changed underneath) still conflicts.

## A3. Real scheduler: drain-until-empty + timed wake-ups + jittered backoff

**Problem.** Four park-without-wakeup paths (`replayCoordinator.ts`):
transport failure returns with no reschedule; error-nack backoff sets `retryAt`
but no timer fires when it elapses; a mutation enqueued during a running replay
coalesces into a stale snapshot and is never sent; and the only safety net is the
5-minute periodic timer (`client.ts` `DEFAULT_RECONCILE_INTERVAL_MS`). Plus:
transport failures burn the error-nack `attemptCount` budget (outbox
`markInFlight` increments every attempt; the terminality check reads the same
counter), so an offline stretch can push the first real server error straight to
terminal `failed`.

**Fix.** Rework `createReplayCoordinator`:
1. **Drain until empty.** After a drain pass completes, re-run `listQueued`; if
   new queued mutations exist (and nothing parked the queue), immediately run
   another pass. `replay()` resolves only when the queue is empty or parked.
2. **Timed wake-ups.** Whenever a drain parks (transport failure or error-nack
   backoff), arm a single `setTimeout` for the earliest `retryAt` (transport
   failures get their own backoff schedule, below) that calls the internal drain
   again. Store the timer handle; clear it on `stop()` (coordinator needs a
   `dispose()` called from `client.stop()`), on wipe, and when an external
   trigger runs a drain first. Never hold more than one armed timer per user.
3. **Two separate retry budgets:**
   - *Server error-nacks* keep the existing budget: `MAX_ERROR_NACK_ATTEMPTS`
     (5), exponential backoff — but add full jitter:
     `delay = random(0, base * 2^(attempt-1))`, capped at 30s.
   - *Transport failures* (thrown sends, timeouts) get UNLIMITED retries with
     the same capped jittered backoff and must NOT count toward the error-nack
     budget. Implement by tracking a separate in-memory
     `transportFailures: Map<mutationId, count>` for backoff computation, and by
     changing terminality to use a dedicated `errorNackCount` cell on the outbox
     row (new column, incremented only on error-nacks) instead of `attemptCount`.
     `attemptCount` stays as a diagnostic total.
4. **Global FIFO drain (INV-1).** Replace the per-collection parallel drain
   (`Promise.all` over collections) with ONE serial drain over the global
   `enqueueOrder`-sorted queue. This removes cross-collection reordering. (The
   batch task B3 builds directly on this.)
5. `client.replayOutbox()` must skip the extra full `listQueued` scan when debug
   logging is disabled (currently unconditional, `client.ts` ~250).

**Tests** (`replayCoordinator.test.ts` with injected `now` + fake timers):
- Enqueue during an active drain → sent by the same `replay()` call, no external
  trigger.
- Error-nack → backoff elapses → retry fires from the armed timer alone.
- Transport failure ×10 → still queued (not terminal); a subsequent error-nack
  starts its budget at 1.
- Jitter: two backoffs for the same attempt differ (seeded random injectable).
- Global order: mutations across two collections replay strictly in enqueue
  order.
- `dispose()` clears armed timers (no post-stop sends).

## A4. Auth-pause pipeline (the 401 contract) — INV-2 made concrete

**Problem.** Today: `unauthorized` socket nacks pause correctly, but
`AuthRequiredError` thrown by the HTTP channel (`syncdb/src/sync/httpChannel.ts`
~15-20, 77-79) is swallowed by the coordinator's bare `catch` as a generic
transport failure — retried forever with the dead token, burning budget. There is
no user-visible paused state, no re-auth hook, and nothing resumes replay
specifically on re-authentication of the same user.

**Fix.**
1. In `drainCollection`'s catch, detect `AuthRequiredError` (instanceof, exported
   from httpChannel) and treat it exactly like an `unauthorized` nack: requeue
   (no budget consumption), set `authPaused`, stop the drain, return
   `{paused: "auth"}`.
2. Add to client state and `SyncStatus` (`client.ts` `getSyncStatus`, and
   `syncdb/src/react/hooks.ts` `useSyncStatus`): `paused?: "auth"`, plus
   `queuedCount` already present and new `failedCount`. Set `paused: "auth"`
   whenever a replay returns it OR the socket transport reports an auth-rejected
   (re)connect; clear it when replay subsequently succeeds.
3. Add `onAuthRequired?: () => void` to `SyncDbConfig`, fired (debounced — at most
   once per pause episode) when entering the paused state, so the host app can
   show a re-login prompt.
4. On `authProvider` change events (`handleAuthChange`): if the resolved userId
   equals `currentUserId`, clear the pause and immediately replay — with the
   outbox fully intact. (Different userId keeps existing wipe behavior.) When
   `getUserId()` returns null/undefined (logged out), DO NOT wipe: keep data and
   remain paused. Wipe on logout only if the host app opts in via a new
   `wipeOnSignOut?: boolean` config consumed by an explicit `client.signOut()`
   method (which the app calls deliberately) — never inferred from a 401.
5. Before surfacing the pause, give the auth adapter one chance to refresh:
   `betterAuthAdapter` (`syncdb/src/auth/betterAuthAdapter.ts`) should expose an
   optional `refresh(): Promise<boolean>`; the client calls it once per pause
   episode and retries replay if it returns true.
6. While paused for auth, the reconcile/bootstrap loops must also stand down
   (they hit the same 401s) — gate `reconcile()` on the pause flag, and make
   `handleStatusChange`/timer triggers no-op replay+reconcile while paused
   (auth-change is the only unpause path).

**Tests** (`client.test.ts`, `replayCoordinator.test.ts`,
`api/src/sync/integration.test.ts`):
- HTTP channel throws `AuthRequiredError` → status shows `paused: "auth"`,
  outbox untouched, zero budget consumed, `onAuthRequired` fired once.
- Same-user re-auth → pause clears, queue drains fully, entities converge.
- Logout (userId → undefined) → data retained; later same-user login → queue
  drains (integration: offline edits survive a token expiry + re-login round
  trip).
- Different-user login → wipe still happens (regression).
- No reconcile/snapshot requests are issued while paused.

## A5. Outbox hygiene: pruning, O(1) ordering, durable sort key

**Problem.** Acked/failed rows are never deleted; `nextEnqueueOrder` scans the
whole table per enqueue; `listQueued` scans per replay/mutate/status; FIFO sorts
primarily on locale-offset ISO `createdAt` via `localeCompare` (DST/timezone
travel can reorder an update before its create).

**Fix** (all in `syncdb/src/mutations/outbox.ts`):
1. Sort `listQueued` by `enqueueOrder` primary, `createdAt` tiebreak (invert
   today's order).
2. Keep a `_meta` value cell (`store.raw.setValue`) holding the max
   `enqueueOrder`; `nextEnqueueOrder` reads/increments it (rebuild from a table
   scan once at startup if absent).
3. Add `outbox.prune({userId, keepFailed?: number})`: delete `acked` rows
   immediately upon a successful drain pass (they carry no future value — the
   server ledger owns idempotency), keep the most recent N `failed` rows
   (default 50) for debugging/UI, delete older ones. Call from the coordinator
   after each drain pass. `conflicted` rows are never pruned automatically.

**Tests:** pruning after drain; enqueueOrder survives restart; ordering stable
across a simulated timezone offset change in `createdAt`.

---

# Phase B — Ordered batch protocol (Sonnet implement; OPUS review semantics)

Goal: N queued mutations should cost ~N/50 round-trips instead of N, without ever
reordering or continuing past a failure.

## B1. Wire contract

New request/response types in `api/src/sync/types.ts` and `syncdb/src/types.ts`:

```ts
interface SyncMutateBatchRequest {
  /** Ordered. The server MUST apply strictly in array order. */
  mutations: SyncMutateRequest[];   // each still carries its own mutationId
}

interface SyncMutateBatchResponse {
  /**
   * One result per PROCESSED mutation, in the same order as the request.
   * Length < request length means the server halted at the first non-ack:
   * results[last] is that failing outcome, and every mutation after it was
   * NOT attempted (still safe to resend).
   */
  results: ({type: "ack"; ack: SyncAck} | {type: "nack"; nack: SyncNack})[];
}
```

Transports: `POST /sync/mutate/batch` (`api/src/sync/routes.ts`) and socket event
`sync:mutateBatch` (`api/src/sync/socketHandlers.ts`). Batch size limit: server
rejects > 100 mutations per batch with a `validation` nack-shaped 422; enforce
before any processing.

## B2. Server: strict-order, stop-on-first-non-ack

In `api/src/sync/mutationHandler.ts` add `applySyncMutationBatch`:
1. Iterate the array **strictly serially** (`for … await`), calling the existing
   `applySyncMutation` per item — full reuse of the idempotency ledger,
   executors, permissions, and delta emission. No parallelism, ever.
2. **Stop-on-error (the user's hard requirement):** on the first result whose
   type is `nack`, append that nack to `results` and RETURN immediately.
   Mutations after it are not attempted, not ledgered, not acked — the client
   re-sends them later and INV-3 makes the overlap safe.
3. Rate limiting: the socket path's existing mutation limiter counts each
   mutation in the batch (not each batch) against the window; add the same
   counting to the HTTP route (which currently has no limiter — add one).
4. Duplicate `mutationId`s *within* one batch: reject the whole batch up front
   with a `validation` outcome (client bug; fail loudly).

**Tests** (`api/src/sync/mutationHandler.test.ts`, `syncRoutes.test.ts`,
`syncSocket.test.ts`):
- 10 mutations, #4 conflicts → results length 4, mutations 5–10 unledgered;
  resending 4–10 as a new batch: #4 returns its recorded conflict from the
  ledger (idempotent), 5–10 apply.
- Whole-batch duplicate resend → all results served from ledger, docs written
  once.
- Order proof: create → update → delete for one entity in one batch works;
  reversed order fails at #1 without touching #2/#3.
- Oversized batch and intra-batch duplicate ids rejected before processing.

## B3. Client: batched drain on top of A3's global FIFO

In `replayCoordinator.ts`:
1. Build each send as the next contiguous chunk (≤ 50, configurable
   `batchSize`) of the global queue — preserving `enqueueOrder`, possibly mixing
   collections (the request items each carry their collection).
2. `baseVersion` refresh (A2) applies per item at chunk-build time. Within one
   chunk, if it contains multiple mutations for the same entity, compute later
   items' `baseVersion` optimistically as "previous item's expected post-ack
   seq" is NOT possible (seqs are server-assigned) — so instead: **a chunk may
   contain at most one mutation per entity**; the chunk builder cuts the chunk
   short when it would include a second mutation for an entity already in it.
   The next chunk (after acks land and A2 refreshes bases) carries the rest.
   This keeps per-entity chaining correct without guessing seqs.
3. Response handling walks `results` in order, applying the existing
   single-mutation handlers (`handleAck`, `handleConflict`,
   `handleTerminalFailure`, unauthorized-pause, error-backoff). Every request
   mutation with no result (server halted) → back to `queued`, untouched
   budgets. Then apply the stop-the-line rules of B4.
4. Transport fallback & capability detection: on HTTP 404 / socket
   `sync:error {code: "unknown-event"}` for the batch call, set a per-connection
   `batchUnsupported` flag and fall back to the existing single-mutation sends
   (still in global FIFO order). Re-probe after reconnect.
5. Send path: batches prefer the socket when connected, HTTP channel otherwise
   (mirror the existing single-send selection in `client.ts`).

## B4. Stop-the-line rules (client-side outcome policy)

After processing a batch response, decide whether the drain continues:

| First non-ack outcome | Policy |
|---|---|
| `error` (transient) | **Halt the whole drain.** Jittered backoff (A3), timed wake-up retries from that mutation onward. Nothing after it is sent this pass. |
| transport failure / timeout | **Halt the whole drain.** Unlimited-budget backoff (A3). The whole batch is safe to resend (INV-3). |
| `unauthorized` | **Halt everything**, enter auth pause (A4). No data touched. |
| `conflict` | Mark conflicted + write conflict row (existing). The ENTITY is now blocked: subsequent drains **skip every queued mutation for an entity that has an unresolved conflict or a queued predecessor that was skipped** (they stay `queued`, budgets untouched). Other entities continue — with one escape hatch: config `haltQueueOnConflict?: boolean` (default `false`) halts the entire drain instead, for apps with cross-entity ordering dependencies. Document both modes in `syncdb/README.md`. |
| `validation` | Terminal for that mutation (existing `markFailed` + release). Then apply the same per-entity skip rule to its queued successors — a successor building on a rejected write is very likely also invalid; skip-and-surface beats blind apply. Successors become eligible again only via explicit `client.retryFailed({entityId})` (new API) or when the user resolves/dismisses. Continue the drain for other entities. |

Rationale for the per-entity (not global) default on conflict/validation: a global
halt on a *user-resolvable* outcome can freeze all sync for days behind one
conflict sheet. Transient/auth outcomes halt globally because retrying will fix
them without user action. **OPUS should review this table before merge.**

**Tests** (`replayCoordinator.test.ts` + `integration.test.ts`):
- 120 queued across 2 collections → exactly 3 batch round-trips (lock in the
  contract), global order preserved on the server (assert via seq order).
- Conflict on entity X mid-batch → X's later mutations stay queued and are
  absent from subsequent batches; entity Y's mutations proceed; after the user
  resolves X (keepMine requeue), X's successors drain in original relative
  order.
- Same scenario with `haltQueueOnConflict: true` → nothing after the conflict is
  sent at all.
- Batch response shorter than request → tail re-queued untouched; next drain
  resends from the halt point; server ledger dedupes the boundary mutation.
- Mid-batch socket disconnect → entire batch re-queued, resent on reconnect,
  applied exactly once (integration).
- Validation failure → successors for that entity skipped and surfaced via
  status; `retryFailed` re-enables them.

## B5. SyncStatus + UI surfacing

Extend `SyncStatus` (client + `useSyncStatus` + `ui/src/SyncStatusBanner.tsx`):
`queuedCount`, `failedCount`, `blockedEntities: number`, `paused?: "auth"`,
`draining: boolean`, and drain progress (`sentThisDrain/totalThisDrain`).
Banner states: syncing (with progress when > 20 queued), paused-for-auth (tap →
`onAuthRequired`), N failed (tap → detail). Keep testIDs
(`sync-status-*`) per convention; add `sync-paused-auth-indicator`.

---

# Phase C — Server protocol correctness

## C1. Seq commit fence — **OPUS (design + implementation)**

**Problem.** `_syncSeq` is claimed from a separate counter in `pre("save")`
(`api/src/sync/syncSeqPlugin.ts` ~81) before the document write commits, with no
transaction and no ordering fence. Writer A claims seq 5, stalls; writer B claims
6 and commits first; any client whose cursor reaches 6 (via delta or snapshot)
uses `$gt: 6` forever and permanently misses A's doc (`api/src/sync/routes.ts`
~159). Also: the pre-query-write lookup can stamp a seq from stream X's counter
onto a doc in stream Y (non-`_id` filters), producing duplicate seqs in a stream.

**Direction to evaluate (Opus decides):**
- Option 1 — transactional assignment: counter `$inc` + document write in one
  Mongo transaction (replica set is already required for change streams). Cost:
  transactions on every synced write; retry logic for `TransientTransactionError`;
  Mongoose session plumbed through the executors.
- Option 2 — stable frontier: keep optimistic claims, but expose per stream a
  `stableSeq` = highest seq below which no claim is uncommitted (track in-flight
  claims in the counter doc: claim registers, commit confirms; frontier =
  min(pending)−1 or head). Snapshot/delta consumers only advance cursors to the
  frontier. Cost: complexity + a liveness dependency on claim cleanup for
  crashed writers (needs a lease/TTL).
- Option 3 — post-commit sequencing: writes commit without a seq; a single
  ordered assigner (change-stream driven) stamps seqs afterward. Cost: an extra
  write per mutation and an ordering singleton.

Whatever is chosen must also fix: the multi-doc lookup mis-stamp (m9), no-op
`save()` burning seqs and emitting deltas (m10), and must define the contract in
`docs/implementationPlans/syncdb-local-first.md`.

**Tests:** concurrent writers with forced commit inversion (delay the lower seq's
commit via a `pre("save")` test hook) → a client bootstrapping/catching up at
every intermediate cursor sees BOTH docs eventually; property-style test looping
random interleavings.

## C2. Per-stream snapshot cursors — **OPUS design, Sonnet execute**

**Problem.** `GET /sync/snapshot` merges all of a user's streams into one query
and returns a single max-seq cursor (`routes.ts` ~142-180), but each stream has
an independent counter. A user in org1 (seq 1000) and org2 (seq 5) can never
catch up org2 past cursor 1000; joining a tenant post-bootstrap never backfills.

**Fix shape (contract for Opus to ratify):** snapshot request/response become
per-stream: client sends `cursors: Record<stream, number>` (or requests one
stream at a time — simpler and preferred); server returns entities + per-stream
next cursor + `hasMore`. Server must expose "which streams does this user have"
(`GET /sync/streams` or embedded in the snapshot response) so the client can
detect NEW streams (tenant joined → cursor 0 backfill) and REMOVED streams
(tenant left → local purge of that stream's entities — respecting INV-2: purge
only on confirmed membership change, never on 401). Client keeps
`_cursors` rows per real stream (the plumbing already exists for deltas;
`snapshot:{collection}` pseudo-streams get replaced). Migration: on first run
with the new client, discard legacy snapshot cursors and re-bootstrap
incrementally (cursor 0 per stream — cheap because pages are idempotent upserts).

**Tests:** two-tenant skew scenario end-to-end; tenant join backfills; tenant
leave purges locally; legacy-cursor migration path.

## C3. Legacy-doc pagination infinite loop (Sonnet)

**Problem.** With > `limit` docs lacking `_syncSeq`, the first snapshot page is
all `seq: 0`, cursor never advances, `hasMore` stays true → client loops forever
(`routes.ts` ~157-179; the client-side guard in `bootstrap.ts` stops the loop but
bootstrap then never completes).

**Fix.** Page the seq-0 stratum by `_id`: when `cursor === 0`, sort
`{_syncSeq: 1, _id: 1}` and return an opaque `legacyCursor` (last `_id`) the
client echoes back until the unsynced stratum is exhausted, then switch to seq
paging. Alternative (simpler, evaluate): a one-time migration script/plugin
startup pass that back-stamps `_syncSeq` on legacy docs per stream — if chosen,
the route should refuse (500 with clear message) when unstamped docs exceed the
page limit, pointing at the migration. Either way the failure mode must be loud,
not an infinite loop.

**Tests:** 1,201 legacy docs, limit 500 → bootstrap terminates with all docs;
mixed legacy+stamped pagination; loop-guard regression.

## C4. Scope-move tombstones from the write path — **OPUS recommended**

**Problem.** The old-stream tombstone is derived from `_syncPrevStream` read via
change-stream `updateLookup` post-image (`api/src/realtime/changeStreamWatcher.ts`
~576-608): a second write racing the first event's processing resets the field,
and the moved-away-from user never gets the tombstone (keeps stale data +
post-move edits until reconcile).

**Fix direction.** Emit the removal signal at write time, not stream time: when
`syncSeqPlugin` detects a stream change, write an explicit tombstone marker
(e.g. a `SyncScopeMove` document: {stream, entityId, seq claimed from the OLD
stream's counter}) in the same operation scope as the move; the watcher emits
old-stream tombstones from those markers (and they appear in snapshots for the
old stream). This makes moves durable and replayable instead of racy. TTL the
markers with the same retention as tombstones (E7/C7).

**Tests:** move + immediate second write with artificially delayed change-event
processing → old-scope client still receives the tombstone; snapshot catch-up
from a pre-move cursor sees it too.

## C5. Mutation-ledger crash resilience (Sonnet)

**Problem A (M4).** A server crash between inserting the `pending` ledger row and
finalizing it wedges that `mutationId` for the 30-day TTL — every retry polls 1s
then nacks "still in flight" (`api/src/sync/mutationHandler.ts` ~75-104,
~223-235).
**Problem B (M5).** A post-hook throw AFTER the document write finalizes the
ledger as `failed`/`validation` even though the write (and its delta) happened —
client rolls back real data, ledger lies forever.

**Fix.**
- A: add a lease — `pending` rows carry `claimedAt`; the duplicate-claim path may
  take over rows older than 60s via
  `findOneAndUpdate({_id, status: "pending", claimedAt: {$lt: cutoff}},
  {$set: {claimedAt: now}})` and re-run the mutation (idempotent by INV-3 —
  the executor path must tolerate the write having already landed: treat
  create-E11000-on-same-id + identical `mutationId` provenance as success by
  reading the doc back; for update/delete re-check seq before re-applying).
- B: reorder the pipeline — run the document write, then finalize the ledger
  `applied` (with the ack payload) BEFORE running post-hooks; post-hook errors
  are logged (`logger.error`) and reported to the response as ack-with-warning,
  not converted into a nack. If the `applied` finalize itself fails, crash the
  request loudly (500 → client transport-retry → duplicate path returns the
  doc-derived outcome via the lease takeover above).

**Tests:** kill between claim and finalize (simulate by stubbing) → retry after
lease expiry succeeds; post-hook throw → doc changed AND ack returned AND ledger
`applied`; replay returns the recorded ack.

## C6. Sync write-scope enforcement + snapshot read parity (Sonnet)

- **Create scope check (M6):** in `applySyncMutation` for `create` (and for
  `update` when the incoming data changes the scope field), resolve the entry's
  scope; for `owner` strategy force/verify the owner field equals the
  authenticated user id; for `tenant` strategy verify the tenant field value is
  in `getUserScopes(user, entry)` — nack `unauthorized` otherwise. This is the
  sync boundary backstop regardless of consumer `preCreate` quality.
- **Snapshot per-doc read checks (M2):** after fetching a page in
  `GET /sync/snapshot`, run the same per-document `read` permission the delta
  path uses (`checkPermissions("read", …, doc)`), dropping denied docs but STILL
  advancing the cursor past them (parity with delta behavior). Also honor
  `options.queryFilter`.
- **`$or`/`deleted` clobber (M1):** build the snapshot query as
  `{$and: [scopeFilter, {deleted: {$in: [true,false]}}, seqFilter]}` — never
  spread-merge filters.
- **Upsert bypass (M8):** `syncSeqPlugin` pre-query-write hook must throw on
  `upsert: true` for synced models (same loud contract as `updateMany`).
- **Socket user parity (D2 dependency):** these checks must run against the full
  user (see D2), not the synthetic socket user.

**Tests:** create with foreign ownerId/tenant nacked over both transports;
snapshot omits per-doc-denied docs that deltas also omit; `$or` snapshotFilter
composes correctly (page respects both filters); upsert throws.

## C7. Server tombstone/ledger retention (Sonnet)

Tombstones are served forever with full `data` (privacy + payload growth); the
watcher also processes bookkeeping collections' own change events. Fix: (a) strip
`data` from tombstones at write time or serialization time — a tombstone needs
only id/seq/deleted; (b) add `synccounters`, `syncmutations` (and C4's marker
collection) to `DEFAULT_IGNORED_COLLECTIONS` in
`api/src/realtime/changeStreamWatcher.ts`; (c) document a retention policy:
tombstones older than N days (default 90, configurable per model in the sync
options) may be hard-deleted by a provided maintenance script
(`api/src/sync/scripts/compactTombstones.ts`), paired with the client-side rule
that a cursor older than the retention window must trigger full re-bootstrap
(client compares snapshot response's `oldestRetainedSeq` — add to response — with
its cursor).

**Tests:** tombstone payloads carry no data; ignored collections generate no
watcher work (spy); stale-cursor client detects retention gap and re-bootstraps.

## C8. Server minor batch (Sonnet, one PR)

- `baseVersion` omitted on update → `validation` nack (never accidental
  conflict/accidental success) — `mutationHandler.ts` ~250.
- Delete of already-deleted doc → idempotent ack (return current seq), not 404
  `validation` — `executors.ts` ~488-492.
- Cap `sync:subscribe` array length (e.g. 100) before iterating; length check
  first — `socketHandlers.ts` ~151.
- Reject duplicate `collectionTag` at registration; make snapshot-index
  `createIndex` failure a startup error, not a warn — `registry.ts`.
- `serialize.ts` responseHandler method fidelity: pass `"read"` for
  single-entity sync serialization instead of hardcoded `"list"`/`"update"`.
- Await/serialize change-handler dispatch per document id (keep cross-doc
  concurrency) so per-entity delta order is guaranteed; document the per-entity
  LWW-by-seq contract in `api/src/sync/types.ts`.

Each with a focused test.

---

# Phase D — Auth & security (Sonnet)

## D1. Socket session re-validation

**Problem.** Sockets authenticate once at handshake (`api/src/realtime/
socketAuth.ts` ~141-177); expiry/revocation/disable never disconnects — deltas
(PHI) keep flowing indefinitely.

**Fix.** Add to the realtime app a periodic re-validation sweep (default every
60s, configurable): for each connected socket, re-run the cheap parts of its
validator (JWT: verify expiry locally; Better Auth: batch session lookups) and
re-load the user's `disabled` flag; on failure emit `sync:auth-expired` then
`socket.disconnect(true)`. The syncdb client must map `sync:auth-expired` +
subsequent reconnect auth failure into the A4 auth-pause path (NO wipe — INV-2).
Also: pass `issuer` to the legacy JWT socket validator for parity with HTTP
(`socketAuth.ts` vs `api/src/auth.ts` ~359-361), and replace the
dot-count JWT discrimination in `auth.ts` ~362-370 with header-decode detection.

**Tests:** new `api/src/realtime/socketAuth.test.ts` — validator matrix (valid/
expired/wrong-secret/wrong-issuer JWT; valid/invalid Better Auth bearer; chain
fall-through; missing token). Sweep disconnects an expired/disabled session;
client lands in auth-pause with outbox intact.

## D2. Full user for socket-side authorization

**Problem.** Socket paths authorize with a synthetic `{_id, admin, id}` user
(`api/src/realtime/socketUser.ts`), so `getUserScopes` sees no
`organizationIds` — tenant sync over sockets silently returns nothing (fails
closed here, but consumers can fail open).

**Fix.** Load the full user document once at handshake (by decoded id), cache on
`socket.data.user`, refresh during D1's sweep; pass THAT to `getUserScopes`,
`checkPermissions`, and delta filters. Remove the synthetic-shape pathway for
sync. Add a test where `getUserScopes` actually reads `user.organizationIds`
(every existing test stubs it — that masked this bug).

## D3. Tenant create-escape + reference hardening

Fix `example-backend/src/api/projects.ts` `preCreate`: spread body FIRST, then
force/validate `organizationId ∈ user.organizationIds` (throw `APIError` 403
otherwise). C6 adds the framework backstop; the reference implementation must
still model the right pattern. Test both transports.

## D4. Membership revocation vs socket rooms

On D1's sweep (or a user-updated hook), re-resolve the user's streams and
`socket.leave()` rooms for streams no longer held. Test: revoke org membership →
no further deltas for that org on the live socket.

## D5. Admin/password hygiene

`setPasswordForUser` route (`example-backend/src/api/adminUsers.ts` +
`api/src/auth.ts` helper): add `logger.info` audit line (admin id, target id,
timestamp — never the password), an upper length bound (e.g. 256), and a test
for `requireAdminMiddleware` 403 paths. Small task, do alongside D1.

---

# Phase E — Client storage & React (Sonnet)

## E1. Lifecycle serialization (`start`/`stop`/auth-change mutex)

**Problem.** `stop()` re-reads module-level `persister` after awaiting the
debounced `save()`; interleaved `start()` for a new user gets its persister
destroyed → client half-started, every `mutate()` throws (`client.ts` ~406-422 +
`example-frontend/app/_layout.tsx` ~133-150). `start()` twice also double-
registers listeners and leaks the reconcile interval.

**Fix.** Introduce a generation counter + a single promise-chain mutex
(`lifecycle = lifecycle.then(op)`) through which `start`, `stop`,
`handleAuthChange`, and `runUserCheck` all pass. Capture `persister` into a
local before any await; after each await, abort if the generation changed.
`start()` when already started → no-op (or stop-then-start, but pick one and
test it). `stop()` disposes the A3 coordinator timers.

**Tests:** rapid stop/start user-switch (would have caught the bug — assert new
user's persistence works and `mutate()` succeeds); double-start listener counts;
Playwright regression: remove the serial-file workaround comment in
`example-frontend/playwright.config.ts` (~16-19) once concurrent syncdb clients
are stable, and let two syncdb specs share a worker.

## E2. Wire schema versioning

`getSchemaVersion()` has zero callers. On `start()` after autoload: if persisted
`schemaVersion` exists and ≠ `SYNC_SCHEMA_VERSION` → `wipeLocalData` + set
current version + full re-bootstrap (this wipe is sanctioned: it is a schema
migration, not an auth event). Always stamp the version on fresh stores.
Test: persist v1 data, load under v2 → wiped + re-bootstrapped; equal versions
untouched.

## E3. Persistence failure surfaces

- Move the `idbGet` inside the try in `encryptedIndexedDbPersister.getPersisted`
  and distinguish "no data" (return undefined → fresh store OK) from "read
  error" (throw → persister must NOT autosave an empty store over the blob:
  propagate a load failure state instead) — `syncdb/src/persisters/
  encryptedIndexedDbPersister.ts` ~79-93.
- Wire `onDecryptFailure` end-to-end: add to `SyncDbConfig`; default behavior =
  wipe + re-bootstrap + `console.warn` (documented). This also revives
  wipe-on-user-change on web.
- Web factory: check `globalThis.indexedDB`; when absent fall back to the memory
  persister and emit a one-time `console.warn` + a `persistence: "memory" |
  "durable" | "error"` field on `SyncStatus`.
- Track and clear the debounce timer in `destroy()`; wipe `keyCacheDbNames` in
  `runUserCheck` (`client.ts` ~304) and `SyncDevPanel`.

**Tests:** rejecting `idbGet` at load leaves the stored blob intact; quota-
exceeded on save surfaces `persistence: "error"`; decrypt failure invokes the
config hook; destroy-with-pending-save writes nothing after destroy.

## E4. Batched application + render hygiene

- Wrap each snapshot page (`bootstrap.ts` ~92-101) and each socket delta burst
  (`deltaApplier` callers) in `store.raw.transaction(() => …)` — one listener
  notification + one autosave per page instead of per row.
- `useQuery` (`syncdb/src/react/hooks.ts` ~129): skip rows whose `data` is null
  (corrupt-row guard — currently crashes list consumers).
- Move `optionsRef.current = options` out of render (layout effect or snapshot
  path).

**Tests:** listener fire-count == 1 per applied page (would have caught the
O(N²)); corrupt row present → `useQuery` returns the healthy rows, no throw;
listener stats return to baseline after unmount (add for all four hooks).

## E5. Client-side compaction

Prune local tombstones after they age past the server retention window (C7):
on each successful reconcile, delete `deleted: true` rows older than the
window (age from a `deletedAt` cell to add at tombstone-apply time), and drop
their MergeableStore metadata where TinyBase allows. Test with fake clock.

## E6. UI minor batch

`ConflictSheet` testIDs suffixed with `mutationId` (duplicate-testID strict-mode
fix); banner conflict badge gets `accessibilityRole="button"`;
`debugLog.clear()` resets stats coherently; align its doc comments. One PR.

---

# Phase F — Test & load infrastructure (Sonnet)

Unit/functional tests live inside Phases A–E. This phase is cross-cutting infra.

## F1. Integration additions (`api/src/sync/integration.test.ts`)

- Socket drop after k of n batch-acked → remaining n−k apply exactly once.
- Token expiry mid-session → auth-pause → re-auth → cursor-correct resume,
  outbox intact (INV-2 end-to-end).
- Two real syncdb clients (same user, two "devices") editing one doc —
  delta-vs-pending interleavings.
- Ack lost client-side (drop the response, not the request) → resend consumes
  the recorded ledger ack.

## F2. Server-side load harness (no browser)

New `api/src/sync/loadHarness.ts` (bun script, not in default test run; wire a
`bun run api:load` script): reuse the integration rig — N socket.io clients on N
owner streams (start N=50), seed 5k docs via `example-backend/src/api/
loadtest.ts` generate, then drive batched `POST /sync/mutate/batch` at a target
rate with mixed ops + deliberate duplicate mutationIds + deliberate mid-batch
conflicts. Report: mutate p50/p95/p99, change-stream→delta fan-out lag per
socket, 5k-doc bootstrap wall time, final-state convergence check per client
(exact set equality vs Mongo). Nightly CI job with generous thresholds
(p95 mutate < 250ms local-Mongo, delta lag < 2s @ 50 sockets) — fail loudly,
tune later. Also add plain route tests for `loadtest.ts` (admin guard, clamps).

## F3. Chaos/spotty-connection e2e

Extend `example-frontend/e2e/helpers/syncdbSuite.ts`'s `routeWebSocket` proxy
into a chaos proxy (do NOT use CDP `emulateNetworkConditions` — it does not
throttle WebSocket frames):
- per-frame latency injection: `setTimeout(forward, rand(0, latencyMs))`;
- `dropSocket()` closing live sockets at random intervals;
- HTTP jitter via delayed `route.continue()`;
- a flap loop over existing `goSyncOffline`/`goSyncOnline` with random 1–8s
  dwells.

New spec `syncdb-chaos.spec.ts` (own CI shard): queue ~30 UI mutations while
flapping (this covers reconnect-mid-drain), run server-side churn concurrently
(`loadtest churn`), stop chaos, then assert: queued badge clears, local set ==
`listTodosAs(user)` via REST, **zero duplicates** (the key assertion — flapping
mid-ack forges duplicate deliveries), and total mutate-request count ≤
ceil(mutations/batchSize) + retries budget (locks in batching). All waits by
testID/`expect.poll`; no `waitForTimeout`.

## F4. Client-side load e2e

`syncdb-loadlab.spec.ts`, `@load` tag, nightly shard (not PR-blocking): admin
suite user (add one to `fixtures/testUsers.ts` — the loadtest routes are
admin-guarded), `loadtest generate {count: 2000}`, assert a new `todos-count`
testID converges (do NOT count DOM rows; virtualize the list first if it isn't),
then 10 churn rounds with the page open, final convergence + time-to-converge
recorded via Playwright annotations. This will regress instantly if E4's
transaction batching breaks.

## F5. Coverage restorations

The PR deletes `offline.spec.ts` (728 lines) covering the legacy RTK offline
middleware, which non-sync screens still use. Either restore a slim 2–3 test
version of it or document the deprecation of the RTK offline path explicitly in
`rtk/README.md`. Decide with the repo owner; default: restore slim version.

---

## Acceptance checklist (definition of done for the whole plan)

- [ ] 500 mutations queued offline drain in ≤ 12 round-trips after reconnect,
      in exact enqueue order, surviving a mid-drain disconnect with zero
      duplicates and zero losses (F2/F3 assert this).
- [ ] Two offline edits to one doc never self-conflict (A2).
- [ ] App killed mid-send recovers on next start; no permanently frozen
      entities (A1).
- [ ] 401 at any point (HTTP, socket, mid-drain, mid-bootstrap) pauses sync
      visibly, preserves all local data, and fully resumes on same-user re-auth
      (A4/D1 — INV-2).
- [ ] A conflict blocks only its entity (or the whole queue when
      `haltQueueOnConflict`), never silently skipped past (B4 — INV-1).
- [ ] No client can permanently miss a committed document via cursor catch-up
      (C1/C2/C3).
- [ ] Sockets stop delivering data within 60s of revocation/expiry/disable (D1).
- [ ] `bun run lint`, `bun run api:test`, `bun run ui:test`, syncdb package
      tests, and all four+2 e2e shards green.
