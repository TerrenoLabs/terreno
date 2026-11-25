# SyncDB: high-churn fields without a sequence claim per write

**Status:** Draft  
**Roadmap:** Area=`api`, Target=`Next`, Impact=`Feature`  
**Branch:** syncdb-high-churn-fields  
**Owner:** Josh Gachnang  
**Created:** 2026-11-09  

This is an options document. It describes the problem, compares five ways to handle it, and
recommends an order. Nothing here is implemented yet; the Decisions table lists what needs an
answer before a task list is written.

## Goal

A synced document can carry fields that change every few seconds (a gauge, a heartbeat, a
progress counter) without each change costing three replicated writes and a round trip through
the stream's counter document.

## Problem

Every write to a synced model outside a caller session does three things
(`api/src/sync/syncSeqPlugin.ts`, `api/src/sync/models.ts`):

1. `claimSyncSeqs`: a pipeline update on the stream's `synccounters` document that increments
   `seq` and pushes a `pending` entry.
2. The document write itself, stamped with `_syncSeq`.
3. `confirmSyncSeqs`: a `$pull` of the `pending` entry.

That is three oplog entries per write, two of them on one hot document per stream. The cost is
the same whether the write changes a title a person typed or a memory reading that moved by a
few kilobytes.

### Measured in a consumer app (Shade, 2026-11-09)

Shade projects each agent session's container memory (`memUsedBytes`, `memPercent`) into two
synced collections every few seconds. Over a 20-hour oplog:

| Namespace | Oplog entries | Size | Share |
|---|---|---|---|
| `synccounters` | 1,519,392 | 547 MB | 56% |
| the two projection collections | 443,273 | 167 MB | 17% |
| everything else | about 395,000 | about 270 MB | 27% |

In one hour the sessions collection took 12,596 updates and its counter took 25,094. The
replication oplog window fell from about 48 hours to 20 hours and tripped the oplog-window
alert. Shade has since added a deadband in its own projection code, which is Option B below done
by hand in one app.

### What makes this hard

- **Catch-up reads by sequence.** A snapshot pages `_syncSeq` in `(cursor, frontier]`
  (`api/src/sync/routes.ts`). A write with no new sequence is invisible to a client that was
  offline when it happened.
- **Clients drop deltas that do not raise the sequence.** `applyDelta` ignores a delta whose
  `seq` is not strictly higher than the stored entity's (`syncdb/src/sync/deltaApplier.ts`). An
  unsequenced change cannot reuse the `sync:delta` event as it stands.
- **The no-op check is all or nothing.** `pre("save")` already skips the claim when the only
  modified path is `updated`. There is no way for a model to add its own fields to that set, and
  the query-write path (`findOneAndUpdate`, `updateOne`) has no such check at all.

## Non-Goals

- Changing ordering or frontier guarantees for ordinary fields (C1 stays as it is).
- Offline edits to high-churn fields. They are server-written values; client mutations on them
  keep going through the normal sequenced path or are rejected.
- Replacing the per-stream counter with another ordering source. See Option E, listed only for
  completeness.

## Options

### Option A: volatile fields (unsequenced writes, live-only delivery, periodic sequencing)

A model declares fields that change often:

```ts
sync: {
  scope: {type: "broadcast"},
  volatile: {fields: ["memUsedBytes", "memPercent"], sequenceEveryMs: 60_000},
}
```

- A write whose meaningful modified paths are all volatile skips the claim and the confirm. The
  document write still happens, so the value is durable and a snapshot of the document returns
  the current value. Cost: one oplog entry instead of three.
- The change-stream watcher sees the update with an unchanged `_syncSeq` and emits a new
  `sync:volatile` event carrying `{collection, id, stream, seq, fields}`. The client merges the
  fields into the entity it holds when `seq` matches the entity's sequence, and ignores the
  event otherwise (a sequenced delta is on its way or already applied).
- To bound staleness for clients that were offline, a volatile-only write is sequenced normally
  when the document's last sequenced write is older than `sequenceEveryMs`. Catch-up then sees
  a value at most that old. The plugin needs the time of the last sequenced write, either a new
  `_syncSeqAt` stamp or an in-process map keyed by document id.
- A write that touches any non-volatile field is sequenced as today and carries the volatile
  fields with it.

Cost and risk:

- Protocol addition: a new socket event and a client handler. Older clients ignore the event and
  see volatile fields refresh only on sequenced writes, which is a safe degradation.
- The query-write path has to learn which fields an update touches (`$set`, `$unset`, `$inc`
  keys) to decide whether it is volatile-only. Replacements are always sequenced.
- The watcher has to distinguish "update with unchanged `_syncSeq`" from a sequenced delta.
  `updateDescription.updatedFields` already says whether `_syncSeq` changed.
- Permissions and masking apply to `sync:volatile` exactly as to deltas; the event must go
  through the same per-socket serialization.

Effect on the measured case: 3 entries per memory write down to 1, with no loss of live
resolution. The two counter updates behind each projection write were about 320 MB of the
980 MB measured, so roughly a third off Shade's total oplog volume.

### Option B: declarative write coalescing (drop writes that do not matter yet)

A model declares a tolerance and a minimum interval per field:

```ts
sync: {
  scope: {type: "broadcast"},
  coalesce: {
    memPercent: {minDelta: 1, minIntervalMs: 15_000},
    memUsedBytes: {follows: "memPercent"},
  },
}
```

- In `pre("save")` and the query-write hook, a write whose meaningful modified paths are all
  coalesced fields, and where each change is inside its tolerance or its interval, is dropped
  entirely: no claim, no document write, no oplog entry.
- A change that exceeds the tolerance, or the first change after the interval, is written and
  sequenced as today.

Cost and risk:

- No protocol change, no client change. Smallest diff of the five.
- Lossy by design: clients see the value in steps. Fine for gauges, wrong for anything that must
  be exact at rest. A trailing flush (write the last dropped value after the interval) fixes
  "exact at rest" but needs an in-process timer, which does not survive a restart and misbehaves
  with several API instances unless the timer is per instance and idempotent.
- Dropping a `save()` silently is surprising. The hook must unmark the paths and leave the
  in-memory document holding the stored value, or callers will read back a value that was never
  written.
- `minDelta` only means something for numbers. Other types get `minIntervalMs` only.

Effect on the measured case: depends on the tolerance. A one-point deadband on `memPercent`
removes nearly all of the writes for an idle session.

### Option C: cheaper sequencing for every write (batched confirms)

Keep the semantics and reduce the cost of the confirm. Today each confirm is its own `$pull`.
Instead:

- Hold confirmed seqs in a per-stream, in-process queue.
- Fold the queue into the next claim on that stream: the claim's pipeline update already
  rewrites `pending`, so it can filter out confirmed seqs in the same update.
- Flush the queue with a standalone `$pull` after a short idle delay (for example 50 ms) so a
  quiet stream's frontier still advances promptly.

Cost and risk:

- Under sustained writes this takes 3 entries per write to 2, and counter writes from 2 to 1.
  A quiet stream gains nothing, since each write still gets its own flush.
- The frontier lags by up to the flush delay. Deltas already carry `frontierSeq` and clients
  clamp to it, so correctness holds, but cursor advancement and `hasMore` lag by the same
  amount.
- A crash loses queued confirms. Those entries age out through the existing 60-second lease,
  so the frontier stalls for up to a minute after a crash under load. That is the same failure
  mode as today's crash between claim and confirm, but it would now cover more seqs.
- Helps every synced model with no configuration. Does nothing about the write to the document
  itself, or about deltas fanned out to every subscriber.

Effect on the measured case: up to half of the counter entries, so at most about a quarter
off the total, with no app changes.

### Option D: ephemeral channel (values that never touch MongoDB)

Give apps a first-class way to publish values that are not part of the document at all:

```ts
syncApp.publishEphemeral({collection: "zergsessions", id, stream, fields: {memPercent: 41.2}});
```

- The server keeps the latest value per `(collection, id)` in memory and emits `sync:ephemeral`
  to the stream's room. A client joining the room gets the current values in the join
  acknowledgement.
- The client keeps ephemeral fields in a separate in-memory layer that query hooks merge over
  the stored entity. Nothing is written to the local store or to MongoDB.

Cost and risk:

- Zero oplog entries. The right model for presence, typing indicators, live gauges and progress.
- Values are lost on server restart until the next publish, and are not available offline.
- Several API instances need a shared fan-out (the Socket.IO adapter already in use, or Redis)
  and a shared "latest value" store for joins, or a join can miss values published on another
  instance.
- Largest surface of the five: a server API, a socket event, a client layer, hook changes and
  codegen typing for the ephemeral fields. Apps must move the fields out of their schema.

Effect on the measured case: removes the projection writes and their counter updates, about
half of Shade's oplog volume.

### Option E: order by cluster time instead of a counter (not recommended)

Stamp documents with the server's operation time (`$currentDate` with `$type: "timestamp"`) and
use that as the cursor. No counter document, so one oplog entry per write for every model.

Rejected for now: the stable-frontier problem that C1 solved comes back in a harder form
(timestamps are assigned before commit, so a reader can see a later timestamp before an earlier
one lands), stream-local ordering turns into global ordering, every stored client cursor needs a
migration, and scope-move markers and tombstone compaction are both built on per-stream seqs.
It is a rewrite of the protocol, listed so the comparison is complete.

## Comparison

| | Oplog entries per high-churn write | Live resolution | Offline catch-up | Protocol change | Client change | App change |
|---|---|---|---|---|---|---|
| Today | 3 | full | exact | | | |
| A: volatile fields | 1 | full | stale by at most `sequenceEveryMs` | new event | new handler | config only |
| B: coalescing | 0 for dropped writes, 3 for kept | stepped | exact for what was written | none | none | config only |
| C: batched confirms | 2 under load | full | exact | none | none | none |
| D: ephemeral channel | 0 | full | none | new event and join payload | new layer | move fields, new publish call |
| E: cluster time | 1 | full | exact | rewrite | rewrite | none |

## Recommendation

1. **Ship B first.** It needs no protocol or client work, it is what the affected app has
   already done by hand, and it fixes the alerting problem on its own. Start with
   `minDelta` and `minIntervalMs`, without a trailing flush.
2. **Then A**, for fields where stepping is not acceptable. It keeps full live resolution at a
   third of the cost and degrades safely for older clients.
3. **C is independent** and worth doing for every model, but it is an optimisation of the hot
   path with a crash-recovery trade-off, so it should come with a load-harness comparison
   (`api/src/sync/loadHarness.ts`) before it is approved.
4. **D only if** presence-style features (typing, cursors, live progress) arrive on the roadmap.
   It is the cleanest answer for values that should never be stored, and too much surface to
   build for gauges alone.

## Decisions

| Question | Decision |
|----------|----------|
| Which options go ahead, and in what order? | Open. Recommendation: B, then A; C separately after a load test; D deferred. |
| B: does a dropped write need a trailing flush so the stored value is exact at rest? | Open. Recommendation: no in the first version. |
| B: should a dropped `save()` be silent, or logged at debug level? | Open. Recommendation: debug log with model and paths. |
| A: where does "last sequenced at" live, a `_syncSeqAt` field or process memory? | Open. Recommendation: `_syncSeqAt`, so it is correct across instances and restarts. |
| A: default for `sequenceEveryMs` | Open. Recommendation: 60 seconds. |
| A: may clients mutate volatile fields? | Open. Recommendation: reject in the mutation handler; they are server-written. |
| C: flush delay, and is a longer post-crash frontier stall acceptable? | Open. Needs load-harness numbers. |

## Phases

Written once the decisions above are made. Each chosen option is its own phase with its own
task list under `docs/tasks/`.

## Files to Create / Modify

For B and A, the likely touch points:

- `api/src/sync/types.ts`: `SyncConfig.coalesce`, `SyncConfig.volatile`, the `sync:volatile`
  payload type.
- `api/src/sync/syncSeqPlugin.ts`: extend the no-op check in `pre("save")`; add the same check
  to `preQueryWrite`.
- `api/src/realtime/changeStreamWatcher.ts`: emit `sync:volatile` for updates that leave
  `_syncSeq` unchanged on a model with volatile fields.
- `api/src/sync/mutationHandler.ts`: reject client mutations on volatile fields.
- `syncdb/src/sync/deltaApplier.ts` and `syncdb/src/client.ts`: apply `sync:volatile`.
- `docs/explanation/local-first-data.md` and `docs/reference/syncdb.md`: document the options
  and when to use each.
