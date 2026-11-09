---
name: debug-syncdb-with-mcp
description: >-
  Invoke when debugging SyncDB local state, stale data, outbox stalls,
  conflicts, cursor/stream drift, reconciliation, or offline behavior in a
  running Terreno app. Uses terreno-mcp-local to inspect, snapshot, compare,
  mutate, flush, merge, and repair SyncDB state.
---
# Debug SyncDB with MCP

Use the fixed SyncDB MCP tools instead of arbitrary `evaluate` snippets.

## 1. Establish the live client

1. Confirm the app creates its SyncDB client with `debug: true` in development.
2. Start the app and authenticate the affected user.
3. Call `get_syncdb_state` without filters.

Continue only when the response names a registered client and includes `status`,
`collections`, `outbox`, `conflicts`, `cursors`, `knownStreams`, `needsRepair`,
and `debug`.

## 2. Capture the baseline

Call `syncdb_snapshot` with `action: "capture"`. Keep the returned snapshot id.
Use `collection`, `entityId`, or `limit` only when the full state is too large.

The capture retains mergeable TinyBase content inside the local MCP process.
Returned JSON redacts sensitive fields and does not expose that merge payload.

## 3. Reproduce and inspect

Reproduce the issue once, then call:

- `get_syncdb_state` for the current state and debugger event stream
- `syncdb_snapshot` with `action: "capture"` for the post-reproduction state
- `syncdb_snapshot` with `action: "compare"` and both snapshot ids

Use the diff plus debug events to identify whether divergence begins at the
local mutation, outbox send, ack/nack, delta, cursor, or reconcile phase.

## 4. Change state only when required

Restart `terreno-mcp-local` with `TERRENO_MCP_EVAL=1`, then use
`syncdb_action`:

| Action | Purpose |
| --- | --- |
| `mutate` | Normal optimistic create/update/delete through the outbox |
| `setLocalEntity` / `deleteLocalEntity` | Direct local-only fault injection or repair |
| `flush` | Drain the durable outbox now |
| `reconcile` / `forceResync` | Catch up or purge and rebuild from server snapshots |
| `resolveConflict` / `retryFailed` | Unblock conflicted or terminally failed entities |
| `goOffline` / `goOnline` | Exercise queueing and reconnect behavior |
| `mergeSnapshot` | CRDT-merge a prior capture into the current TinyBase store; later HLCs win, including deletes |
| `clearDebug` | Reset retained debugger events and counters |

Prefer `mutate` over direct local edits. Capture another snapshot before
`setLocalEntity`, `deleteLocalEntity`, or `mergeSnapshot`; those actions bypass
normal server validation and outbox semantics.

## 5. Prove the diagnosis

Capture and compare a final snapshot, then verify:

- the expected entity payload, tombstone, seq, and stream
- no unintended pending mutation remains
- queued/conflict/failed counts match the expected outcome
- cursors and known streams are coherent
- debugger events show the expected send/ack/delta/reconcile sequence

The workflow is complete when the state diff and event sequence explain the
failure or prove the repair. See
[`docs/how-to/debug-with-mcp.md`](../../../../docs/how-to/debug-with-mcp.md) for
setup and examples.
