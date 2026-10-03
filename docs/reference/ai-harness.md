# @terreno/ai/harness

Durable, multi-phase tasks with transactional checkpoints and audit spans, plus durable
agent conversations built on them. Concepts:
[Durable agent harness](../explanation/durable-agent-harness.md).

```typescript
import {defineAgent, defineTask, defineTool, Harness, InProcessRunner} from "@terreno/ai/harness";
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
- [Versioning](#versioning)
- [Agents and conversations](#agents-and-conversations)
- [defineTool](#definetool)
- [defineAgent](#defineagent)
- [Conversations](#conversations)
- [The agent turn task](#the-agent-turn-task)
- [Model-call resilience](#model-call-resilience)
- [Subagents (rt.runAgent)](#subagents-rtrunagent)
- [ExecutionEnv](#executionenv)
- [Task statuses](#task-statuses)
- [HarnessTask model](#harnesstask-model)
- [HarnessOwner model](#harnessowner-model)
- [HarnessConversation model](#harnessconversation-model)
- [HarnessMessage model](#harnessmessage-model)
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
| `onInterrupt` | `"park" \| "fail"` (`HARNESS_INTERRUPT_ACTIONS`) | No | Default `"park"`. What an interrupted `replay: "never"` phase does: `park` sets `interrupted`; `fail` ends the task `failed` with `Interrupted, not retried: ...` and wakes its owner. The built-in tool task uses `fail`. |
| `spanKind` | `"AGENT" \| "CHAIN" \| "TOOL"` | No | Kind of the task's own span. Default `CHAIN`. |
| `spanName` | `(input) => string` | No | Name of the task's own span. Default `name@version`. |

Returns the definition plus `kind: "task"` and `key: "name@version"`.

The `task` view passed to `run`: `{id, name, version, input, state, phase, attempt, userId?}`.

## Harness

| Method | Description |
| --- | --- |
| `Harness.open({registry, runner?, models?, env?, priceMap?, testHooks?})` | Checks requirements, rejects a duplicate `name@version` or agent name, ensures collections and indexes exist. `runner` defaults to `new InProcessRunner()`. See [open options](#open-options). |
| `start()` | Throws, claiming nothing, when any non-terminal task uses a `name@version` missing from the registry (see [Versioning](#versioning)). Then starts the runner. Throws when already started. The runner recovers expired tasks once it owns execution. |
| `stop()` | Stops claiming work, waits (without a time limit) for the phase in flight while still renewing the owner lease, then releases it. No-op when not started. |
| `createTask(definition, input, {requestId?, userId?})` | Inserts a `pending` task, its `ObsTrace`, and its root span in one transaction. Wakes the runner. The definition must be in the registry. |
| `resolveInterrupted(id, {action, reason, result?, userId?})` | Resolve an `interrupted` task. See [resolveInterrupted](#resolveinterrupted). |
| `abort(id, {reason, userId?})` | Abort a task and every non-terminal task it owns, bottom-up. See [abort](#abort). |
| `createConversation({agent, userId?})` | Start a conversation with a registered agent. See [Conversations](#conversations). |
| `conversation(id)` | Load a conversation handle. Throws when it does not exist. |
| `waitForTask(id, {timeout?, pollInterval?})` | Polls Mongo until the task is `completed`, `failed`, or `aborted`. An `interrupted` task is not terminal, so the wait times out unless someone resolves it. Defaults: 30 s timeout, 50 ms poll. Throws on timeout with the current status. |

`requestId` is an idempotency key backed by a unique sparse index. A repeated or concurrent
create with the same id returns the first task and leaves no extra trace. Reusing a
`requestId` for a different task name, or with a different `userId` (including none versus
some), throws. A soft-deleted task still owns its `requestId`.

### open options

| Option | Type | Description |
| --- | --- | --- |
| `registry` | `Array<task definition \| agent>` | Every `defineTask` definition (and version) and every `defineAgent` agent this process uses. The built-in `terreno.agent.turn@1` and `terreno.agent.tool@1` are always added. |
| `models` | `({provider, modelId}) => LanguageModel` | Resolves an agent's model refs to Vercel AI SDK models. Required when `registry` lists an agent. |
| `env` | `ExecutionEnv` | Handed to phases as `rt.env` and to tools as `api.env`. Optional. |
| `priceMap` | `Record<modelId, {inputPerMTok, outputPerMTok}>` | Prices LLM spans (`usage.costUsd`). Defaults to the registered `ObservabilityApp`'s `priceMap`, read at call time. |
| `runner` | `HarnessRunner` | Default `new InProcessRunner()`. |
| `testHooks` | `HarnessTestHooks` | Test-only. See [Testing](#testing). |

```typescript
import {anthropic} from "@ai-sdk/anthropic";

const harness = await Harness.open({
  models: ({modelId}) => anthropic(modelId),
  registry: [intakeSummary, summarizer],
});
```

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
| `rt.env` | The `ExecutionEnv` from `Harness.open({env})`, or `undefined`. |
| `rt.signal` | `AbortSignal`. Aborts when the task is aborted (at once in this process, within one heartbeat elsewhere), or when this run loses its lease. Pass it to cancellable calls. |
| `rt.createTask(definition, input, {background?, key?})` | Create a child task. Returns its id. See [Child tasks and waitForTasks](#child-tasks-and-waitfortasks). |
| `rt.waitForTasks(ids, {policy?})` | Return child outcomes once they settle; until then the task waits. See [Child tasks and waitForTasks](#child-tasks-and-waitfortasks). |
| `rt.runAgent(agent, {input, output?, instructions?})` | Run a registered agent as a subagent and return its answer; until it finishes the task waits. See [Subagents (rt.runAgent)](#subagents-rtrunagent). |

Rules:

- Call `commit` once per phase. A second call throws inside the phase; the first checkpoint stands.
- `phase` must exist in `phases`. An unknown phase fails the task.
- A phase that returns without committing fails the task (no retry).
- A phase that throws before committing is retried under the task's `retry` policy; see [Retries](#retries).
- After `rt.commit` or a `waitForTasks` that started waiting, `rt.createTask`, `rt.waitForTasks`, and `rt.runAgent` throw.

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
| Tool call | The tool task returns to `pending` and the tool runs again | The tool task ends `failed` with `Interrupted, not retried: lease of <owner> expired mid-phase (replay: never)`; that text is the tool's error result, and the turn continues |
| Model request | Always re-requested (`request` is `replay: "safe"`); the cut-off call wrote nothing | — |

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

## Versioning

Every task row stores the `name` and `version` of the definition that created it. Several
versions of one name may be registered side by side; the registry key is the exact
`name@version`.

| Lookup | Resolves by |
| --- | --- |
| `harness.createTask(definition, ...)` | `definition.key`; the row records `definition.version`. |
| Claiming, phase runs, retries | The row's `name@version`. A runner only claims rows whose key it registers. |
| Expired-lease recovery | The row's `name@version`. Rows of keys this process does not register are left alone. |
| `harness.abort` / `resolveInterrupted` `abort` | The row's `name@version` abort handler. A key this process does not register is recorded as `abortHandler: {status: "unregistered"}`. |
| `rt.createTask(child, ...)` | `child.key`; the child row records `child.version`. |
| `resolveInterrupted` `retry` | The row's `name@version`. Throws `<key> is not in this harness registry; register it before retrying` when this process does not register it, so the task is never re-queued where nothing would claim it. |

`Harness.start()` first counts non-terminal tasks (`pending`, `running`, `waiting`,
`interrupted`, including tasks with `abortRequested`) by `name@version`. When any key is
missing from the registry it throws one error listing each key with its count, sorted by
key, and claims nothing:

```text
Harness.start: in-flight tasks use task versions this registry does not register: test.intake@1 (3 tasks), test.intake@3 (2 tasks). Register those definitions (keep old versions until their tasks finish) or resolve the tasks first.
```

Terminal tasks (`completed`, `failed`, `aborted`) never block start. The check runs once
per `start()`; a row of an unregistered version created by another process afterwards is
skipped by claiming and recovery. Listing the same `name@version` twice in `registry`
throws from `Harness.open`. Rollout steps: [Ship a new task version](../how-to/ship-a-new-task-version.md).

## Agents and conversations

```typescript
import {z} from "@terreno/api";
import {defineAgent, defineTool, Harness} from "@terreno/ai/harness";

const lookupChart = defineTool({
  name: "lookupChart",
  description: "Fetch a patient's chart",
  parameters: z.object({patientId: z.string()}),
  replay: "safe", // a read: re-running after a crash is harmless
  execute: async ({patientId}, api) => ehr.getChart(patientId, {signal: api.signal}),
});

const summarizer = defineAgent({
  name: "clinic.summarizer",
  model: {provider: "anthropic", modelId: "claude-sonnet-5-5"},
  fallbackModels: [{provider: "anthropic", modelId: "claude-haiku-4-5-20251001"}],
  instructions: "Summarize the chart for a clinician. Cite sources.",
  tools: [lookupChart],
});

const harness = await Harness.open({models: ({modelId}) => anthropic(modelId), registry: [summarizer]});
await harness.start();

const conversation = await harness.createConversation({agent: summarizer, userId});
const turn = await conversation.submit({content: "Summarize patient p7", requestId: "req-1"});
const done = await harness.waitForTask(turn._id);
// done.outcome.result: {finishReason: "stop", steps: 2, text: "..."}
```

## defineTool

`defineTool(definition)` validates and freezes a tool.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | Yes | 1-64 letters, digits, `_`, `-` (provider limit). Unique within an agent. |
| `description` | `string` | Yes | Sent to the model. Non-blank. |
| `parameters` | zod schema | Yes | Sent to the model as the tool's input schema, and checked before `execute`. |
| `replay` | `"safe" \| "never"` | No | Default `"never"`. What happens when the call is cut off mid-run: see [Replay and interruption](#replay-and-interruption). |
| `execute` | `(args, api) => Promise<Result>` | Yes | Runs the call. The return value must be JSON-serializable; `undefined` becomes `null`. |

`api`:

| Member | Description |
| --- | --- |
| `taskId` | The tool call's own task id. |
| `conversationId` | The conversation the call belongs to. |
| `signal` | Aborts when the turn is aborted or the run loses its lease. Pass it to cancellable calls. |
| `output(text)` | Append progress text. Recorded on the TOOL span as `output.streamedOutput`. Live streaming to clients ships with the event stream. |
| `env` | The `ExecutionEnv` from `Harness.open({env})`, or `undefined`. |

How a call ends:

| Case | Tool message `status` | Result the model sees |
| --- | --- | --- |
| `execute` returns | `ok` | The value (JSON) |
| `execute` throws, or returns a value that is not JSON-serializable | `error` | `Tool "<name>" failed: <message>` |
| Arguments fail `parameters` | `error` | `Invalid arguments for tool "<name>": <zod issues>` |
| The model names a tool the agent lacks, or one not in the conversation's snapshot | `error` | `Unknown tool "<name>"` |
| Interrupted, `replay: "never"` | `error` | `Interrupted, not retried: ...` |
| Interrupted, `replay: "safe"` | — | Re-run; then one of the rows above |

A failing tool is never retried: the error goes to the model, which decides what to do.

## defineAgent

`defineAgent(definition)` validates and freezes an agent. List it in `Harness.open({registry})`.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Unique within a registry. Conversations find the agent by name. |
| `model` | `{provider, modelId}` | Yes | Resolved by `Harness.open({models})`. |
| `instructions` | `string` | Yes | System prompt for every request. |
| `tools` | `defineTool` results | No | Default `[]`. No duplicate names. |
| `maxSteps` | positive integer | No | Model requests one turn may make. Default `10` (`HARNESS_AGENT_DEFAULT_MAX_STEPS`). |
| `fallbackModels` | `Array<{provider, modelId}>` | No | Tried in order after the primary model's retryable failures run out. |
| `modelRetry` | `{maxAttempts?, backoffMs?, maxBackoffMs?}` | No | Retries per model. Defaults `HARNESS_MODEL_RETRY_DEFAULTS`: 3 attempts, 500 ms base, 8 s cap. |
| `output` | zod schema | No | The final answer is parsed as JSON (code fences and preamble tolerated) and validated. The turn result carries `output`; a mismatch fails the turn. Also the default `output` of `rt.runAgent`. |

## Conversations

A conversation stores a snapshot of the agent's config (model, instructions, tool names,
fallbacks, `maxSteps`) and an ordered transcript. The snapshot keeps a running
conversation stable when the agent definition changes; tool code, `modelRetry`, and
`output` come from the registered agent at run time.

| Member | Description |
| --- | --- |
| `harness.createConversation({agent, userId?})` | Creates an `idle` conversation. `agent` must be the registered definition. Returns a `HarnessConversationHandle`. |
| `harness.conversation(id)` | Loads a handle. |
| `handle.id`, `handle.document` | Id and the conversation as loaded. |
| `handle.messages()` | Every `HarnessMessage`, in `seq` order. |
| `handle.submit({content, requestId})` | Starts a turn. See below. |

`submit`, in one transaction:

1. Claims the conversation (`idle` → `busy`, `activeTurnTaskId` set).
2. Appends the user message with the next `seq`.
3. Creates the turn task (`terreno.agent.turn@1`), owned by the conversation, run as the
   conversation's `userId`, and wakes the runner.

| Case | Result |
| --- | --- |
| Repeated `requestId` | Returns the turn it started; appends nothing. Keys are per conversation. |
| Another turn is running | Throws `HarnessConversationBusyError` (`activeTurnTaskId` set). Queueing and steering (`whenBusy`) ship with the submit endpoint. |
| Lost a race to another submit | Re-reads the conversation: still busy → `HarnessConversationBusyError` naming the winning turn; idle again (the winner already finished) → claims it and starts its own turn. Up to 3 claims. |
| Blank `content` / `requestId` | Throws `submit requires non-empty content` / `submit requires a requestId`. |
| Subagent (task-owned) conversation | Throws: only `rt.runAgent` runs its turns. |

When a turn ends (completed, failed, or aborted) the conversation goes back to `idle`:
in the terminal commit itself when the turn ends normally or the model call fails, right
after the commit otherwise (a thrown phase, an abort, an interruption). If the process
dies before that write, the next `submit` sees the turn is terminal and frees the
conversation itself. Two concurrent submits with one `requestId` both get the same turn.

## The agent turn task

`terreno.agent.turn@1` is an ordinary registered task (`AGENT_TURN_TASK_NAME`). Input
`{conversationId}`; `retry: {maxAttempts: 1}` (model retries happen inside `request`).

| Phase | `replay` | Work | Commit (one transaction) |
| --- | --- | --- | --- |
| `request` | `safe` | Load the transcript; call the model with retries and fallbacks | Assistant message (text and tool-call parts) + `LLM` span + next checkpoint: `tools` when there are tool calls, otherwise `completed` |
| `tools` | `safe` | One `terreno.agent.tool@1` child per tool call (`rt.createTask`), then `rt.waitForTasks` (`all`) | One tool message per call, in call order + `request`, or `completed` with `finishReason: "max-steps"` once `maxSteps` requests were made |

Result (`HarnessTurnResult`): `{finishReason: "stop" | "max-steps", steps, text, output?}`.
At `maxSteps` the last tool calls still get results, so the transcript never ends on an
unanswered call.

`terreno.agent.tool@1` (`AGENT_TOOL_TASK_NAME`) has phases `execute` (`never`) and
`executeSafe` (`safe`); the tool's `replay` picks one. `onInterrupt: "fail"`,
`retry: {maxAttempts: 1}`, `spanKind: "TOOL"`, span named after the tool.

Spans of one turn (one trace):

```
CHAIN terreno.agent.turn@1                  (turn root span; closes with the turn)
├── LLM   mock/primary-model                (one per request; usage + costUsd)
├── CHAIN request
├── CHAIN tools                             (waiting on children)
├── TOOL  lookupChart                       (the tool task's span: input = args, output = {value, streamedOutput?})
│   └── CHAIN execute
├── CHAIN tools                             (results committed)
├── LLM   mock/primary-model
└── CHAIN request                           (terminal)
```

| `LLM` span field | Value |
| --- | --- |
| `name` | `<provider>/<modelId>` of the model that answered |
| `input` | `{messages: {count, fromSeq, toSeq}, system, tools, models}`: the transcript slice sent (the messages themselves are in `HarnessMessage`), so span size stays bounded |
| `output` | `{text, toolCalls, finishReason, attempts}`; `attempts` lists every try (`{provider, modelId, attempt, error?, statusCode?, retryable?}`) |
| `usage` | `{inputTokens, outputTokens, model, costUsd?}`; `costUsd` only when `priceMap` prices the model |
| `status` / `error` | `error` and the failure message when no model answered; `output` is then `{attempts}` and the turn fails in the same commit |

Requests are non-streaming (`generateText`) in this slice. Token streaming ships with the
event stream.

## Model-call resilience

Each `request` phase tries the primary model, then each fallback, with the same budget.

| Failure | Action |
| --- | --- |
| HTTP 429, any 5xx | Retry with exponential backoff and equal jitter (same formula as [Retries](#retries), using `modelRetry`), up to `maxAttempts`; then the next model |
| No HTTP response (`APICallError` without a status and `isRetryable`), `fetch failed`, `ECONNRESET` / `ETIMEDOUT` / `ECONNREFUSED` / `EAI_AGAIN` / `ENOTFOUND` / `EPIPE` | Same as 429 |
| Any other 4xx (400, 401, 404, 408, ...) or a non-HTTP error | Fail at once; no fallback |
| `rt.signal` aborts | Stop at once, including mid-backoff |

The AI SDK's own retries are off (`maxRetries: 0`). When nothing answers, the phase throws
`HarnessModelCallError` (`attempts` attached) and the turn fails:

- `Model <provider>/<modelId> failed with a non-retryable error: <message>`
- `Model <provider>/<modelId> could not be resolved: <message>` (the `models` resolver threw)
- `Model call failed after <n> attempts across <models>: <last message>`

`isRetryableModelError(error)` is exported for apps that classify errors the same way.

## Subagents (rt.runAgent)

`rt.runAgent(agent, options)` runs a registered agent from a task phase and returns its
final answer. The subagent is a conversation owned by the calling task; its turn
(`terreno.agent.turn@1`) is a child task of the caller.

```typescript
const SummarySchema = z.object({risk: z.number(), summary: z.string()});

summarize: {
  replay: "safe",
  run: async (task, rt) => {
    const summary = await rt.runAgent(summarizer, {input: task.state.chart, output: SummarySchema});
    await rt.commit({phase: "review", state: {...task.state, summary}});
  },
},
```

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `input` | `unknown` | Yes | The subagent's user message. A string is sent as-is (blank is rejected); anything else as `JSON.stringify(input)`. |
| `output` | zod schema | No | Structured output. Defaults to the agent's own `output`. |
| `instructions` | `string` | No | Replaces the agent's instructions for this subagent conversation only. |

Returns the final assistant text, or, with a schema, the object the schema parsed. The
generic `rt.runAgent<T>(...)` types the result when the schema comes from the agent.

What one call does:

1. In one transaction, fenced on the caller's lease: creates the conversation
   (`ownership: {kind: "task", id: <caller>}`, `status: "busy"`, agent snapshot with
   `instructions` and `outputSchema`), its user message (`seq` 1), and the turn task
   (`ownership: {kind: "task", id: <caller>}`) with an `AGENT` span named after the agent.
2. Waits with `rt.waitForTasks([turn])`: the caller commits `waiting` and the phase stops.
3. When the turn settles the caller wakes and the phase re-runs from its checkpoint. The
   same call finds the same turn and conversation (step 1 writes nothing) and returns.

Idempotency key: the call's position in the phase (`agent:0`, `agent:1`, ...) within the
caller's phase visit (`step`) and attempt, the same scheme as `rt.createTask` keys. It is
stored on the conversation as `ownerKey` (`<step>:<attempt>:agent:<n>`, unique per owner).
A wake or crash replay reuses the conversation; a retry (next attempt) starts a new one.

| Situation | Behavior |
| --- | --- |
| Caller dies after creating the turn | Recovery re-runs the caller's phase (`replay: "safe"`); the call finds the same conversation and turn. No duplicate conversation, message, or model call. |
| Turn dies mid-flight | The turn's own recovery applies: completed model steps and tool results are committed and are not repeated. |
| Caller aborted | The turn is aborted with it (ownership tree, bottom-up) and its conversation goes back to `idle`. |
| Two calls in one phase | Each gets its own conversation and turn (`agent:0`, `agent:1`). The phase runs to the first call, waits, re-runs, returns the first result at once, and waits on the second. |
| Turn fails or is aborted | Throws `HarnessSubagentError` (`Subagent "<name>" failed: <turn error>`). The caller's `retry` policy applies; a retry starts a new subagent conversation. |
| Turn ends at `maxSteps` | Throws `HarnessSubagentError` (`Subagent "<name>" finished (max-steps) without a final answer`), with or without a schema: the last text precedes a tool round and is not an answer. |
| `harness.conversation(id).submit` on a subagent conversation | Throws `Conversation <id> belongs to task <taskId>; only rt.runAgent runs its turns`. |

Structured output:

- The schema is converted with the AI SDK's `asSchema(schema).jsonSchema` and stored on
  the conversation as `agent.outputSchema` (a JSON string: `$schema` / `$ref` keys are not
  valid Mongo field names).
- Each `request` sends `Output.object({schema: jsonSchema(outputSchema)})`, so the
  provider gets a JSON response format. Model text runs through the same fence and
  preamble cleanup as `AIService` (`withStrippedJsonFencesModel`, `service/jsonFenceModel.ts`).
- An answer that is not JSON fails the turn: `Agent "<name>" output does not match its
  schema (No object generated: could not parse the response.): <cause>`. The answer and
  its `LLM` span are still committed.
- The turn result carries the parsed JSON as `output`. The caller then validates it with
  the zod schema (refinements and transforms included); a mismatch throws
  `Subagent "<name>" output does not match its schema: <zod issues>`.
- An answer the SDK has no output for (a `length` or `content-filter` finish with no
  text) completes the turn without `output`; the caller throws
  `Subagent "<name>" answered without structured output`.

Limits:

- Call `runAgent` from task phases only. Tools (`HarnessToolApi`) have no `runAgent`: a
  wait would re-run the tool's `execute` from the top, repeating its side effects.
- Call sequentially. Concurrent calls (`Promise.all`) are not supported: the first wait
  ends the phase. For parallel fan-out, create child tasks that each call `runAgent`, then
  `rt.waitForTasks` them.
- A schema the AI SDK cannot express as JSON Schema fails the caller at once (no retry).

`HarnessSubagentError` fields: `agentName`, `conversationId`, `turnTaskId`, `status`
(`failed` or `aborted`).

Spans (one trace, the caller's):

```
CHAIN test.parent@1                   (caller's span)
├── AGENT test.summarizer             (the turn task's span; input {conversationId, instructions, messageSeq: 1})
│   ├── LLM   mock/mock-model
│   ├── CHAIN request
│   ├── TOOL  lookup
│   │   └── CHAIN execute
│   ├── CHAIN tools
│   ├── LLM   mock/mock-model
│   └── CHAIN request
├── CHAIN summarize                   (waiting)
└── CHAIN summarize                   (terminal)
```

## ExecutionEnv

Interface only in this slice (implementations ship with coding agents). Pass one to
`Harness.open({env})`.

| Method | Description |
| --- | --- |
| `read(path, {signal?})` | Read a UTF-8 file relative to the environment root. |
| `write(path, content, {signal?})` | Create or replace a UTF-8 file. |
| `exec(command, {args?, cwd?, env?, stdin?, timeoutMs?, signal?})` | Run a command; resolves `{exitCode, stdout, stderr}`. |

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

Collection `harnesstasks`. Every field has a schema `description`; `strict: "throw"`;
empty objects are kept (`minimize: false`), so an initial state `{}` is stored as `{}`.

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
| `ownership` | `{kind: root \| task \| conversation, id}` | Default `root`. `rt.createTask` children are `{kind: "task", id: <parent>}`; agent turns are `{kind: "conversation", id}`, except subagent turns, which are `{kind: "task", id: <caller>}`. |
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

## HarnessConversation model

Collection `harnessconversations`. Every field has a schema `description`; `strict: "throw"`.

| Field | Type | Description |
| --- | --- | --- |
| `ownership` | `{kind: root \| task, id}` | Default `root`. Subagent conversations are task-owned. |
| `agent` | `{name, model {provider, modelId}, instructions, tools[], extensions[], fallbackModels[], maxSteps, outputSchema?}` | Snapshot taken at create. `outputSchema` is the serialized JSON Schema `rt.runAgent` requests as structured output. |
| `ownerKey` | String | Subagent conversations only: which `rt.runAgent` call created it (`<step>:<attempt>:agent:<n>`). |
| `status` | `idle` \| `busy` (`HARNESS_CONVERSATION_STATUSES`) | `busy` while a turn runs. |
| `activeTurnTaskId` | ObjectId | The running turn. |
| `queued` | `[{content, requestId, submittedAt}]` | Reserved for `whenBusy: "queue"`. Empty today. |
| `userId` | ObjectId | Turns run as this user. |
| `seq` | Number | Highest message `seq` handed out. Default 0. |
| `created`, `updated`, `deleted` | | Plugins. |

Indexes: `{userId, created}`, `{ownership.id, ownership.kind}`, `{ownership.id, ownerKey}` unique (partial: `ownerKey` set).

## HarnessMessage model

Collection `harnessmessages`. Every field has a schema `description`; `strict: "throw"`;
empty objects are kept (`minimize: false`), so `{}` tool arguments survive.

| Field | Type | Description |
| --- | --- | --- |
| `conversationId` | ObjectId | Required. |
| `seq` | Number | Required. Strictly increasing per conversation from 1; allocated by `$inc` on the conversation inside the commit transaction. |
| `role` | `system` \| `user` \| `assistant` \| `tool` (`HARNESS_MESSAGE_ROLES`) | |
| `parts` | array | `{type: "text", text}`, `{type: "tool-call", toolCallId, toolName, input}`, `{type: "tool-result", toolCallId, toolName, output, isError}`. |
| `status` | `ok` \| `error` | Tool messages only. |
| `toolCallId`, `toolName` | String | Tool messages only. |
| `turnTaskId` | ObjectId | Turn that wrote the message. |
| `aborted` | Boolean | Partial message cut off mid-stream (event stream slice). Skipped when building the next prompt. |

Index: `{conversationId, seq}` unique.

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
| Agent `request` commit | One `LLM` span parented to the turn's span, with the assistant message. See [The agent turn task](#the-agent-turn-task). |
| Tool call | The tool task's own span has kind `TOOL` and the tool's name; it closes with the tool's outcome. |
| `rt.runAgent` | The subagent turn's own span has kind `AGENT` and the agent's name, parented to the caller's span; the turn's `LLM`, phase, and `TOOL` spans nest under it. |
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
| `Harness.start: in-flight tasks use task versions this registry does not register: ...` | A non-terminal task uses an unregistered `name@version`. Nothing was claimed. |
| `requestId "<id>" already belongs to ...` | `requestId` reused for another task name or another user. |
| `<key> is not in this harness registry` | `createTask` with an unregistered definition. |
| `<key> is not in this harness registry; register it before retrying` | `resolveInterrupted` `retry` on a task of an unregistered version. |
| `<key>: initial phase "<x>" is not one of ...` | `initial()` returned an unknown phase. Nothing is written. |
| `HarnessSubagentError` | `rt.runAgent`: the subagent's turn failed or was aborted, or its output did not match the schema. See [Subagents (rt.runAgent)](#subagents-rtrunagent). |
| `<key>: rt.runAgent agent "<name>" is not in this harness registry` / `rt.runAgent requires non-empty input` / `rt.runAgent output for "<name>" cannot be expressed as JSON Schema` | Misuse; fails the caller (no retry). |
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
- `testHooks.random()` replaces `Math.random` for retry jitter, including model-call
  backoff. Test-only.
- Agents: pass a mock `LanguageModel` through `models` (an object with `doGenerate`,
  `doStream`, `specificationVersion`, `provider`, `modelId`, `supportedUrls`). Throw an
  `APICallError` with `statusCode` from `doGenerate` to exercise retries and fallbacks;
  set `modelRetry: {backoffMs: 0}` for speed.
- Assert on plain copies (`JSON.parse(JSON.stringify(doc.field))`), never on mongoose
  subdocuments directly: Bun's matchers can loop forever walking them.
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
| The start-time version check is one `$group` aggregate over non-terminal rows | One round trip; the error names every missing key with a count instead of failing on the first. |
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
| Agent tasks are built per harness and always registered | Their phases close over the harness's agents and model resolver; any process can resume a turn. |
| Messages and LLM spans ride the phase commit through an engine-only `commitWithWrites` | The public `rt.commit` stays one argument; transcript and audit cannot diverge from the checkpoint. |
| The tool's `replay` selects the tool task's phase (`execute` / `executeSafe`) | Reuses per-phase replay recovery with no per-task override. |
| `onInterrupt: "fail"` instead of parking interrupted tools | A parked tool would block its turn forever; failing it makes the interruption the tool result. |
| The tool task's own span is the `TOOL` span | One span per call that opens at creation and closes with the outcome on every path (success, error, interruption, abort). |
| Turn and tool tasks use `retry: {maxAttempts: 1}` | Model retries live in `request`; tool errors go to the model. Re-running a whole phase on top would multiply calls. |
| Conversation snapshot holds model, instructions, tool names, fallbacks, `maxSteps` | A redeploy that edits the agent does not change a conversation mid-flight; code (tools, `modelRetry`, `output`) still comes from the registry. |
| `HarnessTask` and `HarnessMessage` keep empty objects (`minimize: false`) | Mongo otherwise drops `{}` tool arguments and states, and zod rejects the missing value. |
| A busy conversation throws on `submit` | Queue and steer ship with the submit endpoint; failing loudly beats silently dropping input. |
| A submit that loses the claim re-reads and retries (3 claims) | With a fast model the winner can finish before the loser looks; reporting "busy" for an idle conversation would be wrong. |
| Tool `api.output` is buffered onto the TOOL span | Durable now; the event stream will forward it live. |
| LLM span `input` names a seq range, not the full prompt | The transcript is already permanent; copying it into every span grows without bound and could hit the 16 MB document limit, making the commit fail and the safe `request` phase replay forever. |
| A model call that fails for good commits a failed terminal with an error LLM span | Every attempt (and which model failed how) stays in the audit, not only in the error string. |
| Tool calls outside the conversation's snapshot are refused | A tool added to the agent later must not become callable in an existing conversation. |
| A subagent's conversation, user message, and turn are created in the child-task transaction | Finding the turn by its child key also finds the conversation; a crash cannot leave a conversation without its turn. `ownerKey` + a unique index guard the same invariant on the conversation. |
| Subagent call keys use their own counter (`agent:<n>`) | Adding an `rt.createTask` call before a `runAgent` call does not change which conversation the call finds. |
| Structured output: the SDK parses, the caller's zod schema validates | The turn only holds JSON Schema (the zod schema cannot be stored); `jsonSchema()` does not validate, so the authoritative check runs where the zod schema is in hand. |
| `NoObjectGeneratedError` is a turn outcome, not a model failure | The model answered; retrying or falling back would bill another call for the same prompt. |
| Subagent turns release their conversation by `input.conversationId` | Their owner is the calling task, not the conversation. |
| The `AGENT` span input names the message (`messageSeq: 1`), not its content | Same bounded-span rule as `LLM` spans; the content is in the transcript. |
| A text subagent cut off by `maxSteps` throws | Its last text precedes a tool round; returning it as the answer would hide the cut-off. |
| `NoOutputGeneratedError` (no parsable final answer) leaves `output` unset | The caller reports it; treating it as a model failure would drop the committed answer. |
| `submit` refuses task-owned conversations | A conversation-owned turn there would escape the caller's ownership tree (abort, wait). |
| `withStrippedJsonFencesModel` lives in `service/jsonFenceModel.ts` | The harness subpath reuses it without loading `AIService`. |
| `rt.runAgent` is not on the tool api | A wait re-runs the tool's `execute` from the top, which would repeat side effects. |
