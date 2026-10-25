# SyncDB Phase C Design (syncdb-2)

**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1081
Design authority doc for Phase C (server protocol correctness). Hand this verbatim to a
Sonnet implementer. Read alongside `terreno-syncdb-2.md` (INV-1..4, C1-C8). C5 (mutation
ledger lease) is owned/implemented elsewhere — this doc designs *around* it and never
edits `mutationHandler.ts` beyond what C6/C8 already touch.

Global invariants restated in Phase-C terms: INV-1 ordering is per-stream monotonic;
INV-2 never purge/wipe on 401 — only on confirmed membership change or explicit wipe;
INV-3 idempotency ledger owns exactly-once; INV-4 repo conventions.

Line refs are anchors, not truth — locate by described code.

---

## 1. C1 — Seq commit fence

### Decision: **Option 2 (stable frontier) with a hardened optimistic claim.** Reject Option 1 and 3.

**Why not Option 1 (transactional counter+write).** Every synced write currently flows
through Mongoose `save()` (executors AND arbitrary consumer `.save()` in pre/post hooks
and app code) or the query-write hooks. A transaction requires a `ClientSession` plumbed
through *every* one of those call sites. `syncSeqPlugin.claimSyncSeqs` already joins
`this.$session()` when present, but the executors do NOT open a session, and we cannot
force a session onto consumer code that calls `doc.save()` directly (the plugin's own
doc comment admits "without a caller session the claim is a plain atomic `$inc`"). A
transaction that only wraps the executor path leaves every direct-`.save()` write
un-fenced — a partial fix that hides the bug. Honest assessment: full transactional
coverage is **not achievable** without a breaking API change forcing sessions on all
consumers. Rejected.

**Why not Option 3 (post-commit sequencing singleton).** Adds an ordering singleton
(SPOF + horizontal-scale hazard) and a second write per mutation; makes the ack path
async w.r.t. seq assignment, breaking the current synchronous `ack.seq` contract that
the client's `baseVersion` chaining (A2) depends on. Rejected.

**Chosen: stable frontier.** Keep the cheap optimistic `$inc` claim (no transaction, no
per-write session plumbing — zero new cost on the hot path). Add a *frontier* that
consumers (snapshot + delta cursor advancement) never cross until the claim is known
committed. A client cursor may advance to seq N **only when every seq ≤ N in that stream
is committed** (its owning write durably landed or its claim was reclaimed).

#### Write-path algorithm (`syncSeqPlugin.ts` + `models.ts`)

Extend `SyncCounter` with an in-flight registry so the frontier is computable:

```
SyncCounterDocument {
  stream: string;                // unchanged
  seq: number;                   // last claimed (unchanged)
  pending: Array<{seq: number; claimedAt: Date}>;  // NEW — uncommitted claims
}
```

`claimSyncSeqs({stream, count, session})` becomes two atomic phases:

1. **Claim + register (pre-write).** One `findOneAndUpdate`:
   `{$inc: {seq: count}, $push: {pending: {$each: [{seq, claimedAt: now}, ...]}}}`
   returning `new: true`. The claimed range is `[seq-count+1, seq]`. Stamp `_syncSeq`
   as today. (Still joins `this.$session()` when a caller opened one — that path gets
   true atomicity for free and skips the pending registry via a fast path below.)
2. **Confirm (post-write).** After the document write commits, remove the claim:
   `{$pull: {pending: {seq: {$in: claimedRange}}}}`. This runs in `schema.post("save")`
   and in a `post` hook on the query-writes. A crash between phases leaves a stale
   `pending` entry — handled by the reclaim lease below.

Fast path: when a caller session is present, the write and `$inc` are already atomic;
skip the pending registry entirely (register nothing, confirm nothing). Frontier logic
treats a stream with no `pending` entries as fully committed up to `seq`.

**Frontier computation** (`models.ts`, `computeStableFrontier({stream})`):
`frontier = (min pending.seq) - 1`, or `seq` (the head) when `pending` is empty. A stale
pending entry (claimedAt older than `PENDING_CLAIM_LEASE_MS`, default 60s) is treated as
abandoned: it is `$pull`ed opportunistically at read time and excluded from the min, so a
crashed writer cannot freeze the frontier forever. (Liveness cost of the frontier: a live
write in flight briefly holds the frontier at its seq-1; snapshots see the gap fill within
one write latency, or one lease on crash.)

#### Where the frontier gates cursor advancement

- **Snapshot (`routes.ts`):** the page's `seqFilter` upper-bounds at the frontier:
  `{_syncSeq: {$gt: cursor, $lte: frontier}}`. `hasMore` is true when either the frontier
  is below `seq` (more coming, not yet committed) OR a full page was returned. The response
  `cursor` is `min(lastEntitySeq, frontier)` — never advance a client past an uncommitted
  hole. A client at the frontier with `hasMore:true` and zero new entities polls/reconciles
  (rate-limited) until the frontier moves.
- **Delta (`changeStreamWatcher.ts`):** deltas are only observed via the change stream
  *after* commit, so a delta's seq is always ≤ committed. BUT a delta can arrive for seq N
  while N-1's claim is still pending (out-of-commit-order). The watcher already emits deltas
  as they arrive and the client's `applyDelta` advances the per-stream cursor to `delta.seq`
  unconditionally. **Fix:** the watcher stamps each delta with the *stream frontier at emit
  time* (`frontierSeq` field on `SyncDelta`); the client advances its cursor to
  `min(delta.seq, delta.frontierSeq)` (see §5). This closes the delta-side inversion with
  no server round-trip.

#### Multi-doc lookup mis-stamp (m9)

`preQueryWrite` does `model.find(filter).limit(1)` — a non-`_id` filter can match a
different doc than the one the update targets, stamping the wrong stream's seq. **Fix:**
refuse to sequence a query-write whose filter is not a single-document identity filter.
Require the filter to contain `_id` (or `{_id: {$eq}}`); if absent, throw the same loud
`unsupportedWrite`-style error ("query-write on a synced model must target a single
document by _id; use findByIdAndUpdate or loop"). This is the same contract stance the
plugin already takes for `updateMany`/`upsert`. Consumer code that did ad-hoc
`updateOne({field: x})` on a synced model must migrate to `_id`-targeted writes — a loud,
one-time break beats silent duplicate seqs.

#### No-op save seq burn (m10)

`schema.pre("save")` claims a seq even when nothing changed. **Fix:** in `pre("save")`,
if `!this.isNew && this.modifiedPaths().filter(p => p !== "_syncSeq" && p !== "_syncPrevStream").length === 0`,
skip the claim and leave `_syncSeq` untouched (no delta emitted because the doc write is a
no-op Mongoose skips anyway). For query-writes, if the effective `$set`/replacement is
empty, skip.

#### Failure / retry semantics

- Claim registered but write throws → the confirm never runs; the pending entry ages out
  in one lease and is reclaimed. The burned seq is a benign gap (client rate-limited
  reconcile, as today). No transaction to roll back.
- Confirm `$pull` throws after a successful write → log `logger.error`; the entry ages out
  via lease. Never fail the user write for a confirm error.
- `TransientTransactionError` — N/A (no transactions).

#### Client-visible contract (write into `syncdb-local-first.md`)

> A client cursor for a stream may advance to seq N only when the server reports N ≤ that
> stream's *stable frontier*: every seq ≤ N in the stream is committed. Snapshots never
> return a cursor above the frontier; deltas carry the frontier so the client clamps.
> Consequence: no committed document is ever permanently skipped by cursor catch-up.

#### Performance

Hot path adds one array `$push` on claim and one `$pull` on confirm per write (both on the
already-fetched counter doc, indexed by `stream`). `pending` stays tiny (bounded by
concurrent in-flight writes per stream, seconds-scale). Session-backed writes pay nothing.

#### Migration of existing stamped data

None required for stamped docs — they are already committed (no pending entries exist
pre-deploy; `pending` defaults to `[]`, frontier = head). The counter's new `pending`
field is additive and `strict:"throw"`-safe (defined in schema).

---

## 2. C2 — Per-stream snapshot cursors

### Decision: **one stream per request**, with a discovery endpoint.

Simpler than `cursors: Record<stream,number>` (no partial-progress bookkeeping in one
response; each request is independently retryable and rate-limited; maps 1:1 onto the
existing `_cursors` rows). The collection-flattened cursor is removed.

#### Stream discovery — `GET /sync/streams`

```
GET /sync/streams  ->  { streams: Array<{stream: string; collection: string}> }
```

Implementation reuses `resolveUserStreams` (already in `socketHandlers.ts`, extract to
`streams.ts` as `resolveUserStreamsForEntry`): for each registered entry the user can
`list`, resolve owner/tenant/broadcast/custom stream keys. This is the authoritative set
of streams the user currently belongs to. Runs against the **full user** (D2) so tenant
memberships resolve.

#### Snapshot request/response

```
GET /sync/snapshot?stream={streamKey}&cursor={n}&limit={n}
  ->  SyncStreamSnapshotResponse {
        stream: string;
        entities: SyncEntityPayload[];       // unchanged shape
        cursor: number;                       // clamped to frontier (§1)
        hasMore: boolean;
        frontierSeq: number;                  // stream stable frontier (§1)
        oldestRetainedSeq: number;            // C7 retention floor (§ interactions)
      }
```

Server decodes `stream` → `{collectionTag, scopeValue}`, looks up the entry, verifies the
stream is in the user's `resolveUserStreamsForEntry` set (403 otherwise — a client must
not snapshot a stream it does not belong to), builds the scope filter as
`{[scopeField]: scopeValue}` (single value, not `$in`), and pages with the frontier-bounded
`seqFilter` from §1. Keep the C3 legacy stratum (§3) and C6 per-doc read checks.

The old `?collection=` param is removed. `snapshotFilter` for custom scopes still applies
but is now parameterized by the single stream value.

#### Client stream discovery, join, leave (INV-2)

Client keeps `_cursors` rows keyed by the **real stream key** (delta plumbing already does
this). The `snapshot:{collection}` pseudo-cursors are deleted.

- On `start()` and each `reconcile()`: call `GET /sync/streams`. Diff against the streams
  present in `_cursors` and a persisted `_knownStreams` set:
  - **New stream** (in server set, not in `_knownStreams`) → cursor 0, bootstrap it
    incrementally (cheap: idempotent upserts). Add to `_knownStreams`. This is the
    tenant-join backfill.
  - **Removed stream** (in `_knownStreams`, absent from server set) → **only when the
    `GET /sync/streams` call succeeded (HTTP 200)** purge that stream's local entities and
    its cursor + `_knownStreams` entry. A 401/403/transport error is NOT a membership
    change (INV-2): leave everything intact, enter/keep auth-pause if 401. Purge = delete
    all entities whose stream resolves to the removed key (client stores `collection`; it
    must be able to map entity→stream — see §5 client work item).
- Bootstrap iterates `GET /sync/streams` result, not `config.collections`. `config.collections`
  becomes the *subscribe* list only.

#### Migration for deployed clients holding legacy `snapshot:{collection}` cursors

On `start()`, if any `_cursors` row key matches `/^snapshot:/`, delete all of them and
clear `_knownStreams`, then let the normal discovery path bootstrap every stream from
cursor 0. Idempotent upserts + seq guards make re-bootstrap cheap and non-destructive
(existing entities keep their data; only stale/lower seqs are re-fetched). Gate this behind
the E2 schema-version bump so it runs exactly once. Legacy entities already local are NOT
wiped — this is a cursor migration, not a data wipe.

---

## 3. C3 — Legacy-doc pagination

### Decision: **`_id`-paged legacy stratum with an opaque `legacyCursor`.** Reject the migration-script-only option.

A back-stamp migration must run per stream across all deployments and races live writes;
the `_id` stratum is self-contained in the route and needs no ops coordination. (A
back-stamp maintenance script MAY still be offered later as an optimization, but the route
must be correct without it.)

#### Wire change

Snapshot request gains optional `legacyCursor` (opaque string = last `_id` seen in the
seq-0 stratum). Response gains optional `legacyCursor` (echo-forward token; absent when the
legacy stratum is exhausted).

Algorithm in `routes.ts`:

- When `cursor === 0` AND no `legacyCursor` yet, OR `legacyCursor` present: page the
  **seq-0 stratum** with `{_syncSeq: {$exists: false}}` (or `{$in: [null, 0]}` for legacy
  zeros), sorted `{_id: 1}`, filter `_id > legacyCursor`, `limit+1`. Return
  `cursor: 0`, `legacyCursor: <last _id>`, `hasMore: true` while the stratum has more.
- When the seq-0 stratum is exhausted, return `legacyCursor: undefined` and switch to
  normal seq paging (`{_syncSeq: {$gt: 0, $lte: frontier}}`) starting at `cursor: 0`.
- Client (`bootstrap.ts`) echoes `legacyCursor` back until absent, then proceeds by seq.

Loud failure: none needed — the stratum terminates deterministically by `_id`. Keep the
existing client loop-guard (`hasMore && page.cursor > cursor`) but extend it to also treat
`legacyCursor` advancement as progress (so a page of seq-0 docs with an advancing
`legacyCursor` does not trip the guard).

---

## 4. C4 — Scope-move tombstones from the write path

### Decision: explicit `SyncScopeMove` marker doc written in the same op as the move.

The current post-image read of `_syncPrevStream` (`changeStreamWatcher.ts` ~576) is racy:
a second write resets the field before the first change event is processed. Move the signal
to the write.

#### Schema (`models.ts`, new `SyncScopeMove`)

```
SyncScopeMoveDocument {
  _id;
  collection: string;      // collectionTag
  entityId: string;        // moved doc _id
  fromStream: string;      // old stream (the one to tombstone)
  toStream: string;        // new stream
  seq: number;             // claimed from the OLD stream's counter
  created: Date;           // TTL-indexed, same retention as tombstones (C7)
}
```

Index `{fromStream: 1, seq: 1}` for old-stream snapshot catch-up. TTL index on `created`
with the model's tombstone retention (default 90d, C7).

#### When written

In `syncSeqPlugin` (both `pre("save")` and `preQueryWrite`) when a scope move is detected
(`prevStream !== null`): claim a seq from the **old** stream's counter and insert a
`SyncScopeMove` marker, joining the caller session when present so it commits with the
move. Still stamp `_syncPrevStream` on the doc (harmless; the marker is now the source of
truth). The marker's seq participates in the old stream's frontier (§1) exactly like a
tombstone.

#### Watcher emission

Add `synccounters`, `syncmutations`, `syncscopemoves`, `synckeys` to
`DEFAULT_IGNORED_COLLECTIONS` (C7) so the marker's own change event does NOT drive fan-out.
Instead, when the watcher processes the *moved document's* change event (or a dedicated
watch on `SyncScopeMove` inserts — pick the document-event path to reuse existing plumbing),
it emits the old-stream tombstone from the marker's `fromStream` + `seq` rather than from
the racy `_syncPrevStream` post-image. Concretely: change `emitSyncDelta` to, on any synced
doc change, look up any `SyncScopeMove` markers for `{collection, entityId}` with
`seq > lastEmittedForOldStream` and emit a `{deleted:true}` tombstone to each `fromStream`
room, then emit the create/normal delta to the new stream. Because the marker is durable,
a racing second write cannot erase it.

#### Snapshot catch-up on the old stream

`GET /sync/snapshot?stream={oldStream}` must merge `SyncScopeMove` markers into its page:
markers with `fromStream === stream` and `seq in (cursor, frontier]` become tombstone
entities (`{id: entityId, deleted: true, seq, data: null}`). Union with the normal entity
page, sort by seq, page by frontier. This is how a client that was offline during the move
learns the doc left its stream.

#### TTL / retention

Same window as tombstones (C7 `retentionDays`, default 90). A cursor older than
`oldestRetainedSeq` triggers full re-bootstrap (§ interactions), which re-derives current
membership and drops the moved-away doc naturally.

---

## 5. Interactions & client work items

**C1 fence ↔ C2 cursor.** C2's per-stream `cursor` is upper-bounded by C1's `frontierSeq`.
The snapshot response carries `frontierSeq`; the client stores it but advances its
`_cursors` seq only to the returned `cursor` (already clamped). Deltas carry `frontierSeq`;
`applyDelta` advances the cursor to `min(delta.seq, delta.frontierSeq)`.

**C7 retention ↔ C2 response.** `oldestRetainedSeq` (the lowest seq still retained for the
stream after tombstone compaction) is added to the snapshot response. On reconcile, if the
client's stored cursor for a stream `< oldestRetainedSeq`, it may have missed compacted
tombstones → drop that stream's local entities + cursor and re-bootstrap from 0 (sanctioned
wipe: retention gap, not auth).

### Exact syncdb client work items

1. `types.ts` — add `frontierSeq` and (optional) `legacyCursor` to `SyncSnapshotResponse`;
   add `SyncStreamInfo`/`GET /sync/streams` response type; add `frontierSeq` to `SyncDelta`.
2. `httpChannel.ts` — `fetchSnapshotPage` sends `stream` (not `collection`) + optional
   `legacyCursor`, returns the new fields; add `fetchStreams(): Promise<SyncStreamInfo[]>`.
3. `cursor.ts` — unchanged API; document that keys are now real stream keys only.
4. `bootstrap.ts` — rewrite to page **per stream** (loop streams from `fetchStreams`),
   echo `legacyCursor`, clamp cursor to `frontierSeq`, honor `oldestRetainedSeq`
   re-bootstrap. Remove `snapshotCursorStream`/`snapshot:` pseudo-cursors.
5. `deltaApplier.ts` — advance cursor to `min(delta.seq, delta.frontierSeq)`.
6. `client.ts` — `start()`/`reconcile()` call `fetchStreams`, run join-backfill /
   leave-purge diff against persisted `_knownStreams` (new store table), gated by HTTP-200
   success (INV-2); legacy `snapshot:` cursor migration on start (behind E2 version bump);
   entity→stream mapping helper for purge (store `stream` on each entity row OR recompute
   from `collection`+scope — prefer storing `stream` at apply time).
7. Store schema — add `_knownStreams` table and (recommended) a `stream` column on entity
   rows to make leave-purge O(stream). Bump `SYNC_SCHEMA_VERSION` (triggers E2 wipe path
   for old stores — acceptable, re-bootstrap is cheap).

---

## 6. Test matrix

**C1 (concurrency, `api/src/sync/sync.test.ts` + new `syncFrontier.test.ts`):**
- Forced commit inversion: two writers claim seq 5 and 6 on one stream; a `pre("save")`
  test hook delays writer-5's commit. Assert `computeStableFrontier` returns 4 while 5 is
  pending; snapshot at cursor 4 returns nothing (hasMore true); after 5 commits, frontier
  jumps to 6 and snapshot returns both docs. A client looping catch-up at every intermediate
  cursor eventually sees BOTH.
- Property-style: N writers, random commit interleavings + random crashes (skip confirm);
  after lease expiry, every committed doc appears in a full catch-up; no committed doc
  skipped. Loop 100 seeds.
- m9: `updateOne({nonIdField: x})` on a synced model throws the loud error.
- m10: `doc.save()` with no modified paths claims no new seq (counter unchanged, no delta).
- Migration: pre-existing stamped docs (empty `pending`) → frontier = head immediately.

**C2 (`syncRoutes.test.ts` + integration):**
- Two-tenant skew: user in org1 (seq 1000) + org2 (seq 5). Per-stream snapshot catches org2
  to 5 and org1 to 1000 independently; the old flattened cursor bug (org2 stuck at 1000)
  does NOT reproduce.
- `GET /sync/streams` returns owner + both tenant streams; reflects `organizationIds`.
- Join: add org3 membership → `fetchStreams` includes it → client bootstraps org3 from 0.
- Leave: remove org2 → `fetchStreams` omits it (200) → client purges org2 entities.
- Leave under 401: `fetchStreams` 401 → NO purge, auth-pause, data intact (INV-2 regression).
- Legacy migration: store seeded with `snapshot:todos` cursor → start() deletes it,
  re-bootstraps per stream, entities converge, no data loss.

**C3 (`syncRoutes.test.ts` + `bootstrap.test.ts`):**
- 1,201 legacy docs (no `_syncSeq`), limit 500 → bootstrap terminates with all 1,201 via
  `legacyCursor` paging, then continues into seq stratum. Loop-guard not tripped.
- Mixed legacy + stamped: legacy stratum fully drained before seq paging begins; no doc
  fetched twice, none missed.

**C4 (`changeStreamWatcher.test.ts` / integration):**
- Move + immediate second write with artificially delayed change-event processing → old
  stream still receives the tombstone (from the marker, not the overwritten
  `_syncPrevStream`). Assert tombstone delivered to `fromStream` room.
- Offline old-stream client: snapshot from a pre-move cursor returns the move as a tombstone
  entity (marker merged into the page).
- Marker TTL/retention: marker older than `retentionDays` is absent; cursor older than
  `oldestRetainedSeq` triggers re-bootstrap.

---

## 7. Implementation task list (ordered, Sonnet-executable)

1. **`models.ts`** — add `pending` to `SyncCounter`; rewrite `claimSyncSeqs` (claim+register
   / session fast path); add `confirmSyncSeqs({stream, seqs, session})` (`$pull`) and
   `computeStableFrontier({stream})` (min-pending-1, opportunistic stale `$pull`,
   `PENDING_CLAIM_LEASE_MS`). Add `SyncScopeMove` model + indexes. **[Opus-care: the
   frontier + lease math and the session fast path — get the pending-registry invariants
   reviewed.]**
2. **`syncSeqPlugin.ts`** — no-op skip (m10); `_id`-only guard for query-writes (m9);
   call `confirmSyncSeqs` in `post("save")` + query-write post hooks; write `SyncScopeMove`
   marker on detected scope move (claim from old stream). **[Opus-care: post-hook wiring —
   the `this` context differs between save and query middleware.]**
3. **`streams.ts`** — extract `resolveUserStreamsForEntry` from `socketHandlers.ts` (shared
   by socket subscribe + `GET /sync/streams` + snapshot stream-membership check).
4. **`routes.ts`** — `GET /sync/streams`; rewrite `GET /sync/snapshot` to per-stream
   (membership check, single-value scope filter, frontier-bounded seqFilter, `legacyCursor`
   stratum (C3), `frontierSeq` + `oldestRetainedSeq` in response, `SyncScopeMove` merge for
   old-stream catch-up). Remove `?collection=` path.
5. **`changeStreamWatcher.ts`** — add sync bookkeeping collections to
   `DEFAULT_IGNORED_COLLECTIONS`; emit old-stream tombstones from `SyncScopeMove` markers
   instead of `_syncPrevStream`; stamp `frontierSeq` on emitted deltas. **[Opus-care:
   change-stream/marker interleaving.]**
6. **`types.ts` (api + syncdb)** — add `frontierSeq`, `legacyCursor`, `oldestRetainedSeq`,
   `SyncScopeMove`/streams types, per-stream snapshot response.
7. **syncdb client** — items 1-7 of §5 (httpChannel, bootstrap, deltaApplier, client,
   store schema + version bump, `_knownStreams`, entity `stream` column). **[Opus-care:
   the join/leave diff under INV-2 — the 200-gate is the whole ballgame.]**
8. **Tests** — the full §6 matrix, one focused test per fix.
9. **Docs** — `syncdb-local-first.md`: the C1 cursor contract, per-stream snapshot protocol,
   `GET /sync/streams`, `SyncScopeMove`, retention/`oldestRetainedSeq` re-bootstrap rule.

Sequencing: 1→2 (write path) can land before 3→6 (read path); 7 (client) depends on 6; C3
(within 4) and C4 (2/4/5) are independent slices. C1 fence must land before C2 client rollout
so cursors never advance past uncommitted seqs.
