# @terreno/ai/harness

Durable, multi-phase tasks with transactional checkpoints and audit spans. Concepts:
[Durable agent harness](../explanation/durable-agent-harness.md).

```typescript
import {defineTask, Harness, InProcessRunner} from "@terreno/ai/harness";
```

## Table of Contents

- [Requirements](#requirements)
- [Minimal example](#minimal-example)
- [defineTask](#definetask)
- [Harness](#harness)
- [Runtime (rt)](#runtime-rt)
- [Leases](#leases)
- [Replay and interruption](#replay-and-interruption)
- [resolveInterrupted](#resolveinterrupted)
- [Task statuses](#task-statuses)
- [HarnessTask model](#harnesstask-model)
- [HarnessOwner model](#harnessowner-model)
- [Audit spans](#audit-spans)
- [Errors](#errors)
- [Testing](#testing)
- [Implementation notes](#implementation-notes)

## Requirements

| Requirement | Why | Failure |
| --- | --- | --- |
| MongoDB replica set (or `mongos`) on the default mongoose connection | Checkpoint and span commit in one transaction | `Harness.open` throws `Harness.open requires a MongoDB replica set` |
| Local observability models (`createLocalObservabilityPlugin()`) | `ObsTrace` / `ObsSpan` are the audit log | `Harness.open` throws `Harness.open requires the local observability plugin` |
| A connected default connection | Models live on `mongoose.connection` | `Harness.open` throws `requires a connected mongoose default connection` |

## Minimal example

```typescript
import {createLocalObservabilityPlugin} from "@terreno/ai";
import {defineTask, Harness, InProcessRunner} from "@terreno/ai/harness";

const intakeSummary = defineTask<{patientId: string}, {chart?: string}, {status: string}>({
  name: "clinic.intakeSummary",
  version: 1,
  initial: () => ({phase: "fetch", state: {}}),
  retry: {maxAttempts: 3},
  phases: {
    fetch: {
      replay: "safe",
      run: async (task, rt) => {
        const chart = await ehr.getChart(task.input.patientId);
        await rt.commit({phase: "write", state: {chart}});
      },
    },
    write: {
      run: async (task, rt) => {
        await ehr.writeNote(task.input.patientId, task.state.chart, {idempotencyKey: `note-${task.id}`});
        await rt.commit({terminal: {status: "completed", result: {status: "filed"}}});
      },
    },
  },
});

createLocalObservabilityPlugin();
const harness = await Harness.open({registry: [intakeSummary], runner: new InProcessRunner()});
await harness.start();
const task = await harness.createTask(intakeSummary, {patientId}, {requestId: `intake-${patientId}`});
```

## defineTask

`defineTask<In, State, Out>(definition)` validates and freezes a task definition.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Registry name. Non-empty. |
| `version` | positive integer | Yes | Pinned on every task. Bump on any change to phase names or state shape. |
| `initial` | `(input) => {phase, state?}` | Yes | First checkpoint. `phase` must be a key of `phases`. |
| `phases` | `Record<string, {replay?, run}>` | Yes | At least one. `run(task, rt)` must call `rt.commit()` exactly once. |
| `phases[x].replay` | `"safe" \| "never"` | No | Default `"never"`. What happens when the phase is cut off mid-run: see [Replay and interruption](#replay-and-interruption). |
| `retry` | `{maxAttempts?, backoffMs?, maxBackoffMs?}` | No | Copied onto each task. Retry behavior ships in a later slice; today a thrown phase fails the task. |
| `abort` | `(task, rt) => Promise<void>` | No | Compensation handler. Stored now; called by `harness.abort` in a later slice. |

Returns the definition plus `kind: "task"` and `key: "name@version"`.

The `task` view passed to `run`: `{id, name, version, input, state, phase, attempt, userId?}`.

## Harness

| Method | Description |
| --- | --- |
| `Harness.open({registry, runner?, testHooks?})` | Checks requirements, rejects a duplicate `name@version`, ensures collections and indexes exist. `runner` defaults to `new InProcessRunner()`. |
| `start()` | Starts the runner. Throws when already started. The runner recovers expired tasks once it owns execution. |
| `stop()` | Stops claiming work, waits (without a time limit) for the phase in flight while still renewing the owner lease, then releases it. No-op when not started. |
| `createTask(definition, input, {requestId?, userId?})` | Inserts a `pending` task, its `ObsTrace`, and its root span in one transaction. Wakes the runner. The definition must be in the registry. |
| `resolveInterrupted(id, {action, reason, result?, userId?})` | Resolve an `interrupted` task. See [resolveInterrupted](#resolveinterrupted). |
| `waitForTask(id, {timeout?, pollInterval?})` | Polls Mongo until the task is `completed`, `failed`, or `aborted`. An `interrupted` task is not terminal, so the wait times out unless someone resolves it. Defaults: 30 s timeout, 50 ms poll. Throws on timeout with the current status. |

`requestId` is an idempotency key backed by a unique sparse index. A repeated or concurrent
create with the same id returns the first task and leaves no extra trace. Reusing a
`requestId` for a different task name, or with a different `userId` (including none versus
some), throws. A soft-deleted task still owns its `requestId`.

### InProcessRunner

| Option | Default | Description |
| --- | --- | --- |
| `pollInterval` | `{milliseconds: 250}` | Idle sleep between claim attempts. `createTask` wakes the runner early. |
| `leaseDuration` | `{seconds: 30}` | Lifetime of the owner lease and of each task lease without a renewal. Luxon `DurationLike`. |
| `heartbeatInterval` | `{seconds: 10}` | How often both leases are renewed. Must be positive and shorter than `leaseDuration`, or the constructor throws. |
| `ownerId` | `hostname:pid:uuid` | Id written into every lease this runner holds. |

| Member | Description |
| --- | --- |
| `role` | `IN_PROCESS_RUNNER_ROLES` value: `"owner"` (draining), `"standby"` (waiting for the owner lease), or `"stopped"`. |
| `ownerId` | The resolved owner id. |

Only the owner claims work. It claims the oldest `pending` task whose `name@version` is
registered and whose `runAt` is empty or past, sets it `running` with a fresh task lease,
and runs phases one after another until the task stops. One task runs at a time.

A custom runner implements `HarnessRunner` (`start(context)`, `stop()`, `wake()`). The
`context` provides `acquireOwnerLease(lease)`, `releaseOwnerLease(lease)`,
`recoverExpired()`, `claimNext(lease)`, and `runTask(task, lease)`, where `lease` is
`{owner, duration, heartbeat}` (Luxon `Duration`s).

## Runtime (rt)

| Member | Description |
| --- | --- |
| `rt.commit({phase, state?})` | Checkpoint: move to `phase`. Omitted `state` keeps the current state. Resets `attempt` to 0. |
| `rt.commit({terminal: {status: "completed", result?}})` | Finish the task with a result. |
| `rt.commit({terminal: {status: "failed", error}})` | Finish the task as failed. |
| `rt.taskId` | The task id as a string. |

Rules:

- Call `commit` once per phase. A second call throws inside the phase; the first checkpoint stands.
- `phase` must exist in `phases`. An unknown phase fails the task.
- A phase that returns without committing fails the task.
- A phase that throws before committing fails the task with the error message.

## Leases

| Lease | Stored in | Taken | Renewed | Released |
| --- | --- | --- | --- | --- |
| Owner | `HarnessOwner` row `key: "default"` | When free or expired; the loser of a race stays `standby` | Every `heartbeatInterval` by the owner, including while `stop()` waits for the last task | After that task settles, `stop()` expires it, so a standby takes over within one heartbeat |
| Task | `HarnessTask.lease {owner, token, acquiredAt, expiresAt}` | At claim, with a new random `token` | Every `heartbeatInterval` while the phase runs, fenced on `token` | A phase commit writes a new token for the next phase; a terminal commit or interruption clears it |

- `rt.commit` only applies while the task is `running`, at the phase it started from, **and**
  still carries this run's `token`. Otherwise it throws `HarnessCommitConflictError` and
  writes nothing.
- When a renewal finds a different token, renewal stops. The phase keeps running, but its
  commit will be rejected.
- If the owner loses its own lease (a renewal finds another owner), it drops to `standby`
  and stops claiming after the current task.
- The owner lease decides who drains. Task tokens are what make a stale commit harmless, so
  a briefly doubled owner (for example after a long pause) still cannot double-commit a task.

Assumptions:

- Lease expiry is written and compared with each host's clock. Keep clock skew between
  hosts well under `leaseDuration - heartbeatInterval`; a host whose clock runs ahead by
  more can treat a live lease as expired.
- `rt.commit` hands the next phase a lease that starts at commit time. Keep work after
  `rt.commit` short (well under `leaseDuration`), or recovery may treat the next phase as
  interrupted before it starts.
- Tasks written before leases existed have no `lease`. They are fenced on "no token", and
  recovery treats them as expired.

Recovery runs when a runner becomes owner (on `start()` or on takeover) and on every owner
heartbeat. It scans up to 100 `running` tasks whose lease expired (or that have no lease),
oldest first, for registered `name@version`s only. A stopping owner skips the sweep. A task
whose interruption commit keeps failing for a non-conflict reason is logged and retried on
the next sweep.

## Replay and interruption

A `running` task whose lease expired was cut off mid-phase: its runner crashed, froze, or
lost the database.

| Interrupted thing | `replay: "safe"` | default (`never`) |
| --- | --- | --- |
| Phase | Back to `pending` at the same checkpoint; a runner re-runs the phase from its checkpoint | Status `interrupted`; waits for `resolveInterrupted` (`retry` / `abort` / `complete`) |
| Phase that no longer exists in the definition | — | Treated as `never`: `interrupted` |
| Tool call | Planned (agents slice) | Planned (agents slice) |
| Model request | Planned: always re-requested | — |

Each interruption writes, in the same transaction as the status change, one `CHAIN` span
named after the phase with `status: "error"`:

| Span field | Value |
| --- | --- |
| `error` | `Interrupted: lease of <owner> expired mid-phase; re-running (replay: safe)` or `...; awaiting resolveInterrupted (replay: never)` |
| `output` | `{interrupted: true, leaseOwner, replay, status}` where `status` is `pending` or `interrupted` |
| `startedAt` | `lease.acquiredAt` (when the cut-off phase started) |

Interruption is not terminal: the root span and `ObsTrace` stay open. A safe phase that
re-runs and succeeds adds its normal `ok` span, so the trace shows both attempts.

Expired tasks of versions this process does not register are left alone.

## resolveInterrupted

```typescript
await harness.resolveInterrupted(taskId, {
  action: "retry", // "retry" | "abort" | "complete"
  reason: "Confirmed in the EHR that no note was filed",
  userId: operator._id,
});
```

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | `"retry" \| "abort" \| "complete"` (`HARNESS_RESOLVE_ACTIONS`) | Yes | Decision. |
| `reason` | `string` | Yes | Non-blank. Recorded in the audit span; for `abort` also in the outcome. |
| `result` | `unknown` | No | Stored as `outcome.result` for `complete`. |
| `userId` | `ObjectId \| string` | No | Recorded as `decidedBy`. |

| Action | Task after | Root span / trace |
| --- | --- | --- |
| `retry` | `pending` at the same phase; the runner is woken and re-runs it | Still open |
| `abort` | `aborted`, `outcome: {status: "aborted", error: "Aborted after interruption: <reason>"}`. No abort handler runs yet. | Closed, `status: "error"`, `errorSummary` set |
| `complete` | `completed`, `outcome: {status: "completed", result}` | Closed, `status: "ok"`, `output: result` |

Every action writes one `CHAIN` span named `resolveInterrupted` (`status: "ok"`,
`output: {action, reason, phase, decidedBy?, result?}`) in the same transaction.

| Error | When |
| --- | --- |
| `resolveInterrupted action must be one of abort, complete, retry` | Unknown `action`. |
| `resolveInterrupted requires a reason` | Missing or blank `reason`. |
| `Task <id> is <status>, not interrupted` | The task is in any other status. |
| `HarnessCommitConflictError` | Another resolution won a race. Nothing is written. |
| `findExactlyOne` not-found error | No task with that id. |

## Task statuses

| Status | Meaning |
| --- | --- |
| `pending` | Created, waiting for a runner. |
| `running` | Claimed under a task lease. A phase is executing, or the runner died and recovery will act once the lease expires. |
| `waiting` | Reserved: blocked on an event, sleep, or child tasks. |
| `interrupted` | A `replay: "never"` phase was cut off. Waits for `resolveInterrupted`. Never claimed. |
| `completed` | Terminal. `outcome.result` holds the result. |
| `failed` | Terminal. `outcome.error` holds the cause. |
| `aborted` | Terminal. Set by `resolveInterrupted({action: "abort"})`; `harness.abort` ships later. |

## HarnessTask model

Collection `harnesstasks`. Every field has a schema `description`; `strict: "throw"`.

| Field | Type | Description |
| --- | --- | --- |
| `name`, `version` | String, Number | Pinned definition. |
| `input` | Mixed | Immutable input. |
| `state`, `phase` | Mixed, String | Current checkpoint. |
| `status` | enum (see above) | Lifecycle status. Default `pending`. |
| `outcome` | `{status, result, error}` | Set on terminal commit. |
| `attempt` | Number | Failed attempts of the current phase. Default 0. |
| `retry` | `{maxAttempts, backoffMs, maxBackoffMs}` | Copied from the definition. |
| `ownership` | `{kind: root \| task \| conversation, id}` | Default `root`. |
| `rootTaskId` | ObjectId | Top of the ownership tree; equals `_id` for root tasks. |
| `traceId`, `rootSpanId` | ObjectId | Audit trace and its root `CHAIN` span. |
| `requestId` | String | Idempotency key; unique sparse index. |
| `userId` | ObjectId | Optional initiating user. Also set on the `ObsTrace`. |
| `lease` | `{owner, token, acquiredAt, expiresAt}` | Current task lease. Cleared on terminal commit and interruption. |
| `background`, `runAt`, `waiting` | | Reserved for later slices. |

Indexes: `{requestId}` unique sparse, `{status, runAt}`, `{rootTaskId}`, `{status, lease.expiresAt}`.

## HarnessOwner model

Collection `harnessowners`. One row per singleton lease; `InProcessRunner` uses `key: "default"`.

| Field | Type | Description |
| --- | --- | --- |
| `key` | String | Lease name. Unique index. |
| `owner` | String | Runner instance id holding the lease. |
| `expiresAt` | Date | When the lease lapses unless renewed. |
| `created`, `updated` | Date | Timestamps. |

## Audit spans

| When | Write (same transaction) |
| --- | --- |
| `createTask` | `ObsTrace` (`name: "name@version"`, `input`, `userId`, `status: "ok"`) and a root `CHAIN` span with the same name. |
| Each phase commit | One `CHAIN` span named after the phase, parented to the root span. `input: {attempt, state}`; `output`: the next phase and state, or the terminal outcome. `status: "error"` and `error` for a failed terminal. |
| Interruption (expired lease) | One error `CHAIN` span named after the cut-off phase. See [Replay and interruption](#replay-and-interruption). |
| `resolveInterrupted` | One `CHAIN` span named `resolveInterrupted`; closes root span and trace for `abort` / `complete`. |
| Terminal commit | Root span and `ObsTrace` get `endedAt`, `status`, `output`; failures also set `error` / `errorSummary`. |

If the commit transaction aborts, the task stays at its previous checkpoint in `running`
and no span is written. Once its lease expires, recovery treats it as interrupted.

## Errors

| Error | When |
| --- | --- |
| `HarnessCommitConflictError` | The task was no longer `running` at the phase this commit started from, or its lease token changed (another runner took it over). Also thrown by a losing concurrent `resolveInterrupted`. Nothing is written. |
| `InProcessRunner heartbeatInterval must be positive and shorter than leaseDuration` | Invalid lease options. |
| `Harness registry lists <key> more than once` | Duplicate `name@version` in `registry`. |
| `requestId "<id>" already belongs to ...` | `requestId` reused for another task name or another user. |
| `<key> is not in this harness registry` | `createTask` with an unregistered definition. |
| `<key>: initial phase "<x>" is not one of ...` | `initial()` returned an unknown phase. Nothing is written. |
| `defineTask(...)` validation errors | Empty name, non-positive or fractional version, no phases, a phase without `run`, an invalid `replay`. |

## Testing

- `@terreno/ai` tests run on an in-memory single-node replica set (`ai/src/tests/bunSetup.ts`).
  `TERRENO_TEST_MONGODB_URI` overrides it and must point at a replica set.
- Use `waitForTask` to await completion.
- `testHooks.beforeCommitEnd({taskId, phase, session})` runs inside the commit transaction
  after every write. Read with `session` to see the uncommitted writes, then throw to prove
  the commit is atomic. Test-only; never set in production.
- `testHooks.isHeartbeatSuspended()`: while it returns true, owner acquisition fails and
  every lease renewal is skipped, as if the process froze. To simulate a crash, start a
  harness with short leases (for example `leaseDuration: {milliseconds: 300}`,
  `heartbeatInterval: {milliseconds: 50}`), let a phase hang on a promise, flip the hook to
  true, then open a second harness on the same database. Release the hung phase before
  `stop()`; its late commit is rejected.

## Implementation notes

Low-risk choices made in the first slice:

| Choice | Reason |
| --- | --- |
| `HarnessTask.rootSpanId` stores the root span id | Phase spans need a parent without a lookup. |
| Phase commits fence on `{_id, status: "running", phase, lease.token}` | The token tells two runs of the same phase apart, including a phase that commits back to itself. |
| Each phase commit writes a new lease token for the next phase | The lease is per phase without an extra write at phase start. |
| A safe-replay recovery goes back to `pending` instead of running in place | One claim path (and one place that issues tokens) for fresh, retried, and replayed work. |
| Recovery also runs on every owner heartbeat, not only at takeover | A dead owner's task lease can outlive its owner lease by up to one heartbeat; a takeover-only scan would miss it. |
| Interruption spans start at `lease.acquiredAt` | Records when the cut-off phase began. |
| `resolveInterrupted({action: "abort"})` closes the trace as `error` | `ObsTrace.status` is `ok` or `error`; an abort is not a success. |
| `requestId` replays are scoped to the same `userId` | Stops one caller from reading another user's task through a shared key. |
| A failed commit transaction leaves the task `running` at its last checkpoint | The work may have had side effects; expired-lease recovery applies the phase's `replay` policy. |
| A thrown phase fails the task immediately | Retry policy is stored but its behavior ships in the retries slice. |
| `requestId` relies on the unique index inside the create transaction | One code path for repeats and races; the losing transaction rolls back its trace and span. |
