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
- [Retries](#retries)
- [Child tasks and waitForTasks](#child-tasks-and-waitfortasks)
- [abort](#abort)
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
| `retry` | `{maxAttempts?, backoffMs?, maxBackoffMs?}` | No | Copied onto each task. See [Retries](#retries). `maxAttempts` must be a positive integer, `backoffMs` non-negative, `maxBackoffMs >= backoffMs`. |
| `abort` | `(task, rt) => Promise<void>` | No | Compensation handler, run by `harness.abort` and `resolveInterrupted({action: "abort"})`. `rt` is `{taskId, reason, userId?}`. See [abort](#abort). |

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
| `abort(id, {reason, userId?})` | Abort a task and every non-terminal task it owns, bottom-up. See [abort](#abort). |
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
registered, whose `runAt` is empty or past (by Luxon's `DateTime.now()`), and that has no
`abortRequested`. It sets the task `running` with a fresh task lease and runs phases one
after another until the task stops: terminal, `pending` for a retry, `waiting`, or
aborted. One task runs at a time. An idle owner re-polls every `pollInterval`, so a retry
starts within one poll of its `runAt`.

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
| `rt.signal` | `AbortSignal`. Aborts when the task is aborted (at once in this process, within one heartbeat elsewhere), or when this run loses its lease. Pass it to cancellable calls. |
| `rt.createTask(definition, input, {background?, key?})` | Create a child task. Returns its id. See [Child tasks and waitForTasks](#child-tasks-and-waitfortasks). |
| `rt.waitForTasks(ids, {policy?})` | Return child outcomes once they settle; until then the task waits. See [Child tasks and waitForTasks](#child-tasks-and-waitfortasks). |

Rules:

- Call `commit` once per phase. A second call throws inside the phase; the first checkpoint stands.
- `phase` must exist in `phases`. An unknown phase fails the task.
- A phase that returns without committing fails the task (no retry).
- A phase that throws before committing is retried under the task's `retry` policy; see [Retries](#retries).
- After `rt.commit` or a `waitForTasks` that started waiting, `rt.createTask` and `rt.waitForTasks` throw.

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
| `abort` | Same path as [abort](#abort): owned tasks are aborted first, then the task's `abort` handler runs, then `aborted`, `outcome: {status: "aborted", error: "Aborted after interruption: <reason>"}` | Closed, `status: "error"`, `errorSummary` set |
| `complete` | `completed`, `outcome: {status: "completed", result}` | Closed, `status: "ok"`, `output: result` |

Every action writes one `CHAIN` span named `resolveInterrupted` (`status: "ok"`,
`output: {action, reason, phase, decidedBy?, result?}`) in the same transaction. For
`abort`, `output` also has `abortHandler` (see [abort](#abort)); a failed handler sets
the span `status: "error"`. `complete` and `abort` re-check the task's owner, so a
waiting parent wakes.

## Retries

A phase that **throws** before committing is a failed attempt. The task's `retry` policy
(copied from the definition at create time) decides what happens.

| Field | Default (`HARNESS_RETRY_DEFAULTS`) | Description |
| --- | --- | --- |
| `maxAttempts` | `3` | Runs allowed per phase visit, first run included. |
| `backoffMs` | `1000` | Delay base. |
| `maxBackoffMs` | `60000` | Cap on one delay, before jitter. |

After failure number `n` (`attempt` becomes `n`):

| Condition | Result |
| --- | --- |
| `n < maxAttempts` | `pending` at the same phase and state, `attempt: n`, `runAt = now + delay`, lease cleared. |
| `n >= maxAttempts` | `failed`, `outcome: {status: "failed", error: <message>}`, `attempt: n`. Root span and trace close as errors. |

`delay = min(maxBackoffMs, backoffMs * 2^(n-1))`, then equal jitter: a uniform value in
`[delay / 2, delay]`. Time comes from Luxon (`DateTime.now()`), so `Settings.now` controls
it in tests.

- `task.attempt` in the phase view tells the phase which attempt it is (0 on the first run).
- A phase commit resets `attempt` to 0. A terminal commit keeps it.
- Not retried (fail at once): returning without `rt.commit`, committing to an unknown
  phase or an invalid terminal status, a stored phase that no longer exists,
  `rt.createTask` with an unregistered definition, `rt.waitForTasks` on tasks this task
  does not own.
- A thrown phase whose run already lost its lease writes nothing; recovery handles it.
- A phase that throws after `rt.commit` keeps the checkpoint; no retry.

Each failed attempt writes an error `CHAIN` span named after the phase in the same
transaction: `input: {attempt, state}`, `output: {retry: {attempt, maxAttempts, runAt}}`.
The final failure writes the usual failed-terminal span.

## Child tasks and waitForTasks

```typescript
const reconcile = defineTask<{patientId: string}, unknown, HarnessChildOutcome[]>({
  name: "clinic.reconcile",
  version: 1,
  initial: () => ({phase: "fanOut"}),
  phases: {
    fanOut: {
      run: async (task, rt) => {
        const ids = [
          await rt.createTask(fetchLabs, {patientId: task.input.patientId}),
          await rt.createTask(fetchMeds, {patientId: task.input.patientId}),
        ];
        const outcomes = await rt.waitForTasks(ids, {policy: "failFast"});
        await rt.commit({terminal: {status: "completed", result: outcomes}});
      },
    },
  },
});
```

### rt.createTask(definition, input, options?)

| Option | Default | Description |
| --- | --- | --- |
| `key` | call position in this phase run (`"0"`, `"1"`, ...) | Names the child within the current attempt of the current phase visit. A re-run of the same attempt (wake, crash replay) with the same key returns the existing child. A retry (next attempt) or a later visit of the phase creates a fresh child. |
| `background` | `false` | Stored on the child. Turn-abort semantics ship with conversations. |

The child:

| Field | Value |
| --- | --- |
| `ownership` | `{kind: "task", id: <parent id>}` |
| `rootTaskId`, `traceId`, `userId` | The parent's |
| `rootSpanId` | A new `CHAIN` span named `name@version`, parented to the parent's span |
| `requestId` | `harness-child:<parentId>:<step>:<attempt>:<key>` (internal; `step` counts the parent's phase commits) |
| `status` | `pending`; the runner is woken |

Creation runs in one transaction fenced on the parent's lease token (and renews the
parent's lease). A run that lost its lease gets `HarnessCommitConflictError` and nothing
is written. The definition must be registered.

A child's terminal commit closes the child's span. Only the root task closes the
`ObsTrace`.

### rt.waitForTasks(ids, {policy?})

| Policy | Resolves when |
| --- | --- |
| `all` (default) | Every child is terminal. |
| `failFast` | Every child is terminal, or one is `failed` / `aborted`. The rest still in flight are aborted (with their subtrees, handlers bottom-up) with reason `Sibling task <id> <status> (failFast wait of <parent id>)` before it resolves. |

Returns `HarnessChildOutcome[]` in the order of `ids`: `{id, name, status, result?, error?}`.

When not yet settled:

1. The task commits `status: "waiting"`, `waiting: {kind: "tasks", taskIds, policy}`, and
   clears its lease, fenced on the lease token, with a `CHAIN` span named after the phase
   (`output: {waiting: {kind, policy, taskIds}}`).
2. The phase stops (the call throws an internal signal; do not catch it).
3. When a child settles, its owner is re-checked; once the wait is satisfied the task goes
   back to `pending` (no span). A sweep on every owner heartbeat re-checks waiting tasks,
   so a wake lost to a crash still happens.
4. The phase **runs again from the start** of the same checkpoint. `rt.createTask` returns
   the same children and `rt.waitForTasks` returns the outcomes immediately.

Keep work before a wait idempotent: it runs once per wake. `ids` must all be tasks this
task created; otherwise the task fails.

## abort

```typescript
await harness.abort(taskId, {reason: "Duplicate intake", userId: operator._id});
```

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `reason` | `string` | Yes | Non-blank. Recorded on every abort span and in each `outcome.error` as `Aborted: <reason>`. |
| `userId` | `ObjectId \| string` | No | Recorded as `abortedBy` and passed to handlers as `rt.userId`. |

Steps:

1. **Fence, top-down.** Each non-terminal task in the subtree gets `abortRequested: {at,
   reason, userId}` (runners never claim it again). A `running` task's lease token is
   rotated, so its phase can no longer commit, create children, or renew its lease. Its
   `rt.signal` aborts at once in this process, and within one heartbeat in another.
2. **Abort, bottom-up** (deepest level first, newest first within a level). For each task:
   run its `abort(task, rt)` handler, then commit `aborted` (`outcome: {status: "aborted",
   error}`, lease, `waiting`, and `runAt` cleared) with an `abort` span, in one
   transaction fenced on "not terminal".
3. Re-check the aborted task's owner, so a parent waiting on it wakes.

| `abort` span field | Value |
| --- | --- |
| `name` | `abort` |
| `parentSpanId` | The aborted task's span |
| `output` | `{reason, abortedBy?, requestedOn: <id passed to abort>, abortHandler}` |
| `abortHandler` | `{status: "ok"}`, `{status: "none"}` (no handler), `{status: "error", error}`, or `{status: "unregistered", error}` (this process does not register that `name@version`) |
| `status` / `error` | `"error"` and `Abort handler failed: <message>` when the handler threw; otherwise `"ok"` |

The aborted task's span closes as an error; a root task also closes the trace with
`errorSummary: "Aborted: <reason>"`.

Rules:

- A handler that throws is recorded and the abort proceeds. Compensations that must not
  be lost should be idempotent and retried by your own code or an operator.
- Terminal descendants are skipped; their handlers do not run.
- A descendant that finishes on its own before its fence keeps its outcome.
- The handler gets the task view (`id`, `input`, `state`, `phase`, ...) and
  `rt: {taskId, reason, userId?}`. It has no timeout; a hanging handler stalls the abort.
- Concurrent aborts of the same task (two operators, or an operator and a `failFast`
  sibling abort) run its handler once. Each task carries a one-minute handler claim
  (`abortRequested.handlerClaimExpiresAt`); the other aborter waits until the task is
  aborted and returns it. A handler that runs longer than a minute can be started a
  second time by a waiting aborter.
- The first abort request is the one recorded in `abortRequested`; later requests keep it.
- A running phase is not killed. In this process it sees `rt.signal` aborted at once; in
  another process it notices at its next lease renewal (within one `heartbeatInterval`).
  A phase that ignores `rt.signal` keeps running side effects while its handler runs, in
  either process, and one more phase can start in the narrow window before the abort
  rotates the lease token. None of those writes commit. Phases with side effects should
  check `rt.signal` before acting.
- Throws `abort requires a reason` for a blank reason and `Task <id> is already <status>`
  for a terminal task.
- If the process dies mid-abort, the remaining tasks keep `abortRequested` and are never
  claimed. Call `abort` again to finish (after a handler claim lapses, within one minute).
  `resolveInterrupted` rejects `retry` for such a task; use `abort`.

| Error | When |
| --- | --- |
| `resolveInterrupted action must be one of abort, complete, retry` | Unknown `action`. |
| `resolveInterrupted requires a reason` | Missing or blank `reason`. |
| `Task <id> is <status>, not interrupted` | The task is in any other status. |
| `Task <id> is being aborted; resolve it with abort, not retry` | `retry` on a task with `abortRequested`. |
| `HarnessCommitConflictError` | Another resolution won a race. Nothing is written. |
| `findExactlyOne` not-found error | No task with that id. |

## Task statuses

| Status | Meaning |
| --- | --- |
| `pending` | Created, waiting for a runner. |
| `running` | Claimed under a task lease. A phase is executing, or the runner died and recovery will act once the lease expires. |
| `waiting` | Blocked on child tasks (`rt.waitForTasks`). Holds no lease and is never claimed. Woken back to `pending` when the wait is satisfied. Events and sleeps ship later. |
| `interrupted` | A `replay: "never"` phase was cut off. Waits for `resolveInterrupted`. Never claimed. |
| `completed` | Terminal. `outcome.result` holds the result. |
| `failed` | Terminal. `outcome.error` holds the cause. |
| `aborted` | Terminal. Set by `harness.abort` or `resolveInterrupted({action: "abort"})`. `outcome.error` holds the reason. |

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
| `step` | Number | Phase commits so far; names the current phase visit for idempotent child creation. Default 0. |
| `retry` | `{maxAttempts, backoffMs, maxBackoffMs}` | Copied from the definition. |
| `ownership` | `{kind: root \| task \| conversation, id}` | Default `root`. `rt.createTask` children are `{kind: "task", id: <parent>}`. |
| `rootTaskId` | ObjectId | Top of the ownership tree; equals `_id` for root tasks. |
| `traceId`, `rootSpanId` | ObjectId | Audit trace and its root `CHAIN` span. |
| `requestId` | String | Idempotency key; unique sparse index. |
| `userId` | ObjectId | Optional initiating user. Also set on the `ObsTrace`. |
| `lease` | `{owner, token, acquiredAt, expiresAt}` | Current task lease. Cleared on terminal commit and interruption. |
| `runAt` | Date | Earliest claim time; set by a retry, cleared by the next commit. |
| `waiting` | `{kind, taskIds, policy, key, timeoutAt}` | Set while `waiting`. `kind: "tasks"` today; `event` / `sleep` (with `key`, `timeoutAt`) ship later. |
| `abortRequested` | `{at, reason, userId, handlerClaimExpiresAt}` | Set when an abort starts. Blocks claims. `handlerClaimExpiresAt` is the current aborter's claim on running the handler. |
| `background` | Boolean | Stored from `rt.createTask`. Default false. |

Indexes: `{requestId}` unique sparse, `{status, runAt}`, `{rootTaskId}`, `{status, lease.expiresAt}`, `{ownership.id, ownership.kind}`.

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
| Failed attempt with retries left | One error `CHAIN` span named after the phase, `output: {retry: {attempt, maxAttempts, runAt}}`. |
| `rt.createTask` | The child's `CHAIN` span (`name@version`), parented to the parent's span. |
| `rt.waitForTasks` starts waiting | One `CHAIN` span named after the phase, `output: {waiting: {...}}`. |
| `harness.abort` | One `abort` span per aborted task; closes that task's span (and the trace for a root task). |
| Terminal commit | The task's span gets `endedAt`, `status`, `output`; failures also set `error`. For a root task the `ObsTrace` closes too (`errorSummary` on failure). |

If the commit transaction aborts, the task stays at its previous checkpoint in `running`
and no span is written. Once its lease expires, recovery treats it as interrupted.

## Errors

| Error | When |
| --- | --- |
| `HarnessCommitConflictError` | The task was no longer `running` at the phase this commit started from, or its lease token changed (another runner took it over, or an abort fenced it). Also thrown by `rt.createTask` / `rt.waitForTasks` from a run that lost its lease, by a losing concurrent `resolveInterrupted`, and by `harness.abort` when the task finished on its own first. Nothing is written. |
| `abort requires a reason` / `Task <id> is already <status>` | `harness.abort` with a blank reason, or on a terminal task. |
| `rt.waitForTasks only waits on tasks this task created with rt.createTask` | Fails the task (no retry). |
| `rt.waitForTasks policy must be one of all, failFast` | Unknown policy. Fails the task. |
| `Child key "<key>" already belongs to task ...` | Two `rt.createTask` calls in one phase visit used the same `key` for different definitions. |
| `defineTask(...): retry.* ...` / `abort must be a function` | Invalid `retry` policy or `abort` handler. |
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
- Set `retry: {backoffMs: 0}` for fast retry tests. To test timing, freeze Luxon
  (`Settings.now = () => clock.toMillis()`), pass `testHooks.random: () => 0.5` for a
  fixed jitter, and advance `clock` past `runAt`. Restore `Settings.now = () => Date.now()`
  after each test.
- `testHooks.beforeCommitEnd({taskId, phase, session})` runs inside the commit transaction
  after every write. Read with `session` to see the uncommitted writes, then throw to prove
  the commit is atomic. Test-only; never set in production.
- `testHooks.random()` replaces `Math.random` for retry jitter. Test-only.
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
| A retry goes back to `pending` with `runAt` instead of sleeping in the runner | The runner never holds a lease while waiting, and the backoff survives a restart. |
| Equal jitter (`[delay/2, delay]`) rather than full jitter | Keeps a guaranteed minimum backoff so a retry storm cannot start at zero delay. |
| API-misuse errors are not retried | Retrying cannot fix them; failing fast surfaces the bug. |
| `waitForTasks` suspends by committing `waiting` and re-running the phase on wake | No in-memory continuation to lose; the same machinery serves events and sleeps later. |
| Child idempotency keys are scoped to a phase visit (`step`) and attempt | A wake or crash replay reuses the children; a retry or a later visit (a loop) gets fresh ones, so a retried fan-out does not re-read the same failed child. |
| Abort handlers run under a one-minute claim per task | Concurrent aborts must not run one compensation twice; an expiring claim still lets a later abort finish after a crash. |
| The handler `rt` has no `signal` | The run's signal is already aborted by then; handing it over would cancel the compensation's own calls. |
| The runner re-checks its lease token before each phase after the first | An abort (or takeover) from another process usually stops the task at the next phase boundary instead of after a heartbeat; this is best-effort, and fenced commits are the guarantee. |
| Owner wakes happen after the child's commit, plus a heartbeat sweep | A check inside the child's transaction could miss a sibling settling concurrently (snapshot isolation); a post-commit check by the last child always sees all of them. |
| Wakes write no span | The wait span and the next phase span already bound the wait; wakes are not checkpoints. |
| Abort fences the whole subtree before any handler runs | Otherwise a running phase could commit, or a woken parent could start, while handlers run. |
| Abort commits fence on status, not the lease token | An abort deliberately overrides the run in flight. |
| A failing abort handler does not stop the abort | A half-aborted tree is worse than a missed compensation; the span records it. |
| `resolveInterrupted({action: "abort"})` goes through the abort path | One place runs handlers and aborts owned tasks. |
| `requestId` relies on the unique index inside the create transaction | One code path for repeats and races; the losing transaction rolls back its trace and span. |
