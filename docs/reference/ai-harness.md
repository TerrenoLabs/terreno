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
- [Task statuses](#task-statuses)
- [HarnessTask model](#harnesstask-model)
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
| `phases[x].replay` | `"safe" \| "never"` | No | Default `"never"`. Stored now; resume behavior ships with owner leases. |
| `retry` | `{maxAttempts?, backoffMs?, maxBackoffMs?}` | No | Copied onto each task. Retry behavior ships in a later slice; today a thrown phase fails the task. |
| `abort` | `(task, rt) => Promise<void>` | No | Compensation handler. Stored now; called by `harness.abort` in a later slice. |

Returns the definition plus `kind: "task"` and `key: "name@version"`.

The `task` view passed to `run`: `{id, name, version, input, state, phase, attempt, userId?}`.

## Harness

| Method | Description |
| --- | --- |
| `Harness.open({registry, runner?, testHooks?})` | Checks requirements, rejects a duplicate `name@version`, ensures collections and indexes exist. `runner` defaults to `new InProcessRunner()`. |
| `start()` | Starts the runner. Throws when already started. |
| `stop()` | Stops claiming work and waits for the phase in flight. No-op when not started. |
| `createTask(definition, input, {requestId?, userId?})` | Inserts a `pending` task, its `ObsTrace`, and its root span in one transaction. Wakes the runner. The definition must be in the registry. |
| `waitForTask(id, {timeout?, pollInterval?})` | Polls Mongo until the task is `completed`, `failed`, or `aborted`. Defaults: 30 s timeout, 50 ms poll. Throws on timeout with the current status. |

`requestId` is an idempotency key backed by a unique sparse index. A repeated or concurrent
create with the same id returns the first task and leaves no extra trace. Reusing a
`requestId` for a different task name, or with a different `userId` (including none versus
some), throws. A soft-deleted task still owns its `requestId`.

### InProcessRunner

| Option | Default | Description |
| --- | --- | --- |
| `pollInterval` | `{milliseconds: 250}` | Idle sleep between claim attempts. `createTask` wakes the runner early. |

It claims the oldest `pending` task whose `name@version` is registered and whose `runAt` is
empty or past, sets it `running`, and runs phases one after another until the task stops.
One task runs at a time. A custom runner implements `HarnessRunner`
(`start(context)`, `stop()`, `wake()`), where `context` provides `claimNext()` and
`runTask(task)`.

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

## Task statuses

| Status | Meaning |
| --- | --- |
| `pending` | Created, waiting for a runner. |
| `running` | Claimed; a phase is executing or the last commit transaction failed. |
| `waiting` | Reserved: blocked on an event, sleep, or child tasks. |
| `interrupted` | Reserved: a `replay: "never"` phase was cut off and needs `resolveInterrupted`. |
| `completed` | Terminal. `outcome.result` holds the result. |
| `failed` | Terminal. `outcome.error` holds the cause. |
| `aborted` | Terminal. Reserved for `harness.abort`. |

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
| `background`, `runAt`, `lease`, `waiting` | | Reserved for later slices. |

Indexes: `{requestId}` unique sparse, `{status, runAt}`, `{rootTaskId}`.

## Audit spans

| When | Write (same transaction) |
| --- | --- |
| `createTask` | `ObsTrace` (`name: "name@version"`, `input`, `userId`, `status: "ok"`) and a root `CHAIN` span with the same name. |
| Each phase commit | One `CHAIN` span named after the phase, parented to the root span. `input: {attempt, state}`; `output`: the next phase and state, or the terminal outcome. `status: "error"` and `error` for a failed terminal. |
| Terminal commit | Root span and `ObsTrace` get `endedAt`, `status`, `output`; failures also set `error` / `errorSummary`. |

If the commit transaction aborts, the task stays at its previous checkpoint in `running`
and no span is written.

## Errors

| Error | When |
| --- | --- |
| `HarnessCommitConflictError` | The task was no longer `running` at the phase this commit started from. The commit is discarded. |
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

## Implementation notes

Low-risk choices made in the first slice:

| Choice | Reason |
| --- | --- |
| `HarnessTask.rootSpanId` stores the root span id | Phase spans need a parent without a lookup. |
| Phase commits fence on `{_id, status: "running", phase}` | Rejects stale commits now. A phase that commits back to itself keeps the same filter, so the lease token (owner-lease slice) must join it before concurrent owners exist. |
| `requestId` replays are scoped to the same `userId` | Stops one caller from reading another user's task through a shared key. |
| A failed commit transaction leaves the task `running` at its last checkpoint | The work may have had side effects; recovery belongs to owner-lease resume, not an automatic failure. |
| A thrown phase fails the task immediately | Retry policy is stored but its behavior ships in the retries slice. |
| `requestId` relies on the unique index inside the create transaction | One code path for repeats and races; the losing transaction rolls back its trace and span. |
