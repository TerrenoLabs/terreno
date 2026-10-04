# @terreno/ai/harness

Durable, multi-phase tasks with transactional checkpoints and audit spans, plus durable
agent conversations built on them. Concepts:
[Durable agent harness](../explanation/durable-agent-harness.md). Worked example:
[Build a durable workflow](../how-to/build-a-durable-workflow.md) (`clinic.intakeSummary`).

```typescript
import {
  approvalGate,
  defineAgent,
  defineExtension,
  defineTask,
  defineTool,
  Harness,
  HarnessApp,
  hook,
  InProcessRunner,
  section,
  wrapTool,
} from "@terreno/ai/harness";
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
- [Events, waits, and sleep](#events-waits-and-sleep)
- [Approvals](#approvals)
- [Require human approval](#require-human-approval)
- [approvalGate](#approvalgate)
- [HarnessApp and HTTP routes](#harnessapp-and-http-routes)
- [Event stream (SSE)](#event-stream-sse)
- [abort](#abort)
- [Versioning](#versioning)
- [Agents and conversations](#agents-and-conversations)
- [defineTool](#definetool)
- [defineAgent](#defineagent)
- [Conversations](#conversations)
- [The agent turn task](#the-agent-turn-task)
- [Model-call resilience](#model-call-resilience)
- [Subagents (rt.runAgent)](#subagents-rtrunagent)
- [Extensions](#extensions)
- [Hooks](#hooks)
- [Sections and the recorded system prompt](#sections-and-the-recorded-system-prompt)
- [Tool wraps and precedence](#tool-wraps-and-precedence)
- [Memos](#memos)
- [ExecutionEnv](#executionenv)
- [Task statuses](#task-statuses)
- [HarnessTask model](#harnesstask-model)
- [HarnessOwner model](#harnessowner-model)
- [HarnessConversation model](#harnessconversation-model)
- [HarnessMessage model](#harnessmessage-model)
- [HarnessMemo model](#harnessmemo-model)
- [HarnessInboxEvent model](#harnessinboxevent-model)
- [HarnessApproval model](#harnessapproval-model)
- [HarnessEvent model](#harnessevent-model)
- [Audit spans](#audit-spans)
- [Errors](#errors)
- [Testing](#testing)
- [Implementation notes](#implementation-notes)

## Requirements

| Requirement | Why | Failure (`code`: `detail`) |
| --- | --- | --- |
| MongoDB replica set (or `mongos`) on the default mongoose connection | Checkpoint and span commit in one transaction | `Harness.open` throws `harness-replica-set-required`: `Harness.open requires a MongoDB replica set: ...` |
| Local observability models (`createLocalObservabilityPlugin()`) | `ObsTrace` / `ObsSpan` are the audit log | `Harness.open` throws `harness-config-invalid`: `Harness.open requires the local observability plugin: ...` |
| A connected default connection | Models live on `mongoose.connection` | `Harness.open` throws `harness-config-invalid`: `Harness.open requires a connected mongoose default connection` |

Every harness error is an `APIError` (see [Errors](#errors)). Quoted error text on this
page is the error's `detail`; its `message` is the stable `title` of its `code`.

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
| `approvals` | `Record<key, {approvers}>` | No | Who may decide each `rt.approval(key)`. A key left out uses `[Permissions.IsAdmin]`. See [Approvals](#approvals). |

Returns the definition plus `kind: "task"` and `key: "name@version"`.

The `task` view passed to `run`: `{id, name, version, input, state, phase, attempt, userId?}`.

## Harness

| Method | Description |
| --- | --- |
| `Harness.open({registry, runner?, models?, env?, priceMap?, streaming?, testHooks?})` | Checks requirements, rejects a duplicate `name@version` or agent name, ensures collections and indexes exist. `runner` defaults to `new InProcessRunner()`. See [open options](#open-options). |
| `start()` | Throws, claiming nothing, when any non-terminal task uses a `name@version` missing from the registry (see [Versioning](#versioning)). Then starts the runner. Throws when already started. The runner recovers expired tasks once it owns execution. |
| `stop()` | Stops claiming work, waits (without a time limit) for every phase in flight while still renewing the owner lease, then releases it. No-op when not started. |
| `createTask(definition, input, {requestId?, userId?})` | Inserts a `pending` task, its `ObsTrace`, and its root span in one transaction. Wakes the runner. The definition must be in the registry. |
| `resolveInterrupted(id, {action, reason, result?, userId?})` | Resolve an `interrupted` task. See [resolveInterrupted](#resolveinterrupted). |
| `abort(id, {reason, userId?})` | Abort a task and every non-terminal task it owns, bottom-up. See [abort](#abort). |
| `decideApproval(approvalId, {approved, reason?, userId?})` | Approve or reject a pending approval without checking approvers. See [Approvals](#approvals). |
| `mayApprove({approval, user, method?})` | Whether `user` passes the approval's approvers. `method` defaults to `"update"`. |
| `approvableApprovals({user})` | Pending, unexpired approvals of live tasks that `user` may approve, oldest first. |
| `sendEvent(id, event, payload?, {requestId?})` | Store an event in the task's inbox and wake the task when it waits on it. Works without a running runner. See [Events, waits, and sleep](#events-waits-and-sleep). |
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
| `runner` | `HarnessRunner` | Default `new InProcessRunner()`. For many instances, `JobsRunner` (see [JobsRunner](#jobsrunner)). |
| `streaming` | `{deltaFlushChars?, deltaFlushInterval?, deltaTtl?}` | How streamed model text becomes `delta` events. Defaults: 200 characters, `{milliseconds: 250}`, `{hours: 1}`. Non-positive values throw. See [Event stream (SSE)](#event-stream-sse). |
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
| `concurrency` | `8` | Most claimed tasks run at once. Must be a positive integer, or the constructor throws. `1` runs one task at a time. |
| `pollInterval` | `{milliseconds: 250}` | Idle sleep between claim attempts. `createTask` and a task that frees a slot wake the runner early. |
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
aborted. An idle owner re-polls every `pollInterval`, so a retry starts within one poll of
its `runAt`.

Up to `concurrency` tasks run at once, each under its own task lease and heartbeat, so a
slow phase (a long model call, a phase blocked on I/O) does not delay other tasks. Ordering
guarantees:

- Tasks are **claimed** oldest first (`created`), one claim at a time, while a slot is free.
- With `concurrency` above 1, claimed tasks run in parallel, so a later task can finish
  first. Use `concurrency: 1` for strict one-at-a-time order.
- Phases of one task always run in order, and a phase never commits twice: the claim is an
  atomic update, and every commit is fenced on the task lease. (A runner that froze past
  its lease may still be executing phase code while recovery replays it; only its commit
  is rejected.)
- Turns of one conversation stay serial regardless of `concurrency`; turns of different
  conversations, and sibling child tasks, run in parallel.
- `stop()` stops claiming and waits for every task in flight.

Before Phase 2 the runner ran one task at a time. Upgrading to the default of 8 means
parallel model calls (watch provider rate limits and cost) and more stream-counter retries
(see [Implementation notes](#implementation-notes)). Pass `concurrency: 1` to keep the old
behavior.

### JobsRunner

Runs phases as `@terreno/jobs` jobs so any number of instances share the work. Import it
from its own entry point; `@terreno/jobs` is an optional peer dependency, and importing
`@terreno/ai` or `@terreno/ai/harness` never loads it. How-to:
[Run the harness on multiple instances](../how-to/run-harness-on-multiple-instances.md).

```typescript
import {JobsApp} from "@terreno/jobs";
import {Harness} from "@terreno/ai/harness";
import {JobsRunner} from "@terreno/ai/harness/jobsRunner";

const jobs = new JobsApp();
const harness = await Harness.open({registry, runner: new JobsRunner({jobs})});
app.register(jobs).build(); // the runner enqueues through the registered jobs service
await harness.start();
await jobs.startWorker();
```

| Option | Default | Description |
| --- | --- | --- |
| `jobs` | required | The `JobsApp`. The constructor defines `terreno.harness.phase` on it (`HARNESS_PHASE_JOB_NAME`). Register it and build the app before `harness.start()`; otherwise `start()` throws `harness-config-invalid`. |
| `pollInterval` | `{milliseconds: 500}` | Sleep between dispatch scans. `createTask`, `sendEvent`, and each finished phase wake the dispatcher early. |
| `leaseDuration` | `{seconds: 30}` | Lifetime of each task lease without a renewal. |
| `heartbeatInterval` | `{seconds: 10}` | How often a running phase renews its task lease, and how often this instance sweeps expired leases. Must be positive and shorter than `leaseDuration`, or the constructor throws. |
| `ownerId` | `hostname:pid:uuid` | Id written into every task lease this runner holds. |
| `dispatchBatchSize` | `100` | Most runnable tasks one scan enqueues. Must be a positive integer, or the constructor throws. |

Every instance runs a dispatcher and a jobs worker. There is no owner lease.

1. **Dispatch.** Each scan lists runnable tasks (the same rule `InProcessRunner` claims by)
   and enqueues one `terreno.harness.phase` job per task with payload `{taskId}` and
   idempotency key `taskId:phase:attempt:claims`. `claims` counts how often the task was
   claimed, so each runnable visit of a phase (first run, retry, event wake, replay) gets
   its own job, and repeated scans or instances enqueue it once. When the job with that key
   already ended without claiming the task (for example it died after its retries, or ran
   on an instance mid-deploy that did not register the task), the dispatcher follows or
   extends the chain `<key>:<endedJobId>` until a job is in flight, so the task is not
   stranded.
2. **Run one phase.** The job handler claims that task under a fresh fenced task lease,
   runs **one** phase with heartbeats, and hands a task that is still `running` back as
   `pending` (lease cleared) for the next job. It then wakes the dispatcher. A handler
   whose task is no longer runnable (another job claimed it, or it is aborting) does
   nothing and succeeds.
3. **Recover.** Each instance sweeps expired task leases once per `heartbeatInterval`, with
   the same replay and interruption rules as `InProcessRunner`. A replayed task becomes
   runnable with a new `claims` value, so it is dispatched again.

Load: with N instances, the recovery sweep (expired leases, settled child waits, stranded
queued conversations) runs N times per `heartbeatInterval`, where `InProcessRunner` runs it
once, and each scan does one job lookup per runnable task (up to `dispatchBatchSize`). The
sweeps are fenced, so this costs queries, not correctness. Raise `heartbeatInterval` and
`pollInterval` for large fleets.

The task lease, not the job lock, is the authority. Two jobs for one phase race on the
atomic claim, and only one runs it. A worker that froze past its lease cannot commit: its
`rt.commit` throws `HarnessCommitConflictError`. A phase that runs longer than the jobs
lock TTL is safe for the same reason. A job that runs on an instance whose harness is not
started (or is stopping) throws `harness-runner-stopped`, so the jobs worker retries it.

`stop()` stops dispatching and waits for every phase this instance is running. Stop the
jobs worker (`jobs.stopWorker()`) after `harness.stop()`.

### Custom runners

A custom runner implements `HarnessRunner` (`start(context)`, `stop()`, `wake()`). The
`context` provides `acquireOwnerLease(lease)`, `releaseOwnerLease(lease)`,
`recoverExpired()`, `claimNext(lease)`, `claimTask(taskId, lease)` (claim one task by id
when it is runnable now, else `null`), `listRunnable(limit)` (oldest runnable tasks as
`{taskId, phase, attempt, claims}`, unclaimed), and `runTask(task, lease, {maxPhases?})`,
where `lease` is `{owner, duration, heartbeat}` (Luxon `Duration`s). With `maxPhases`,
`runTask` hands a task that is still `running` after that many phases back as `pending`.

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
| `rt.memo(key)` / `rt.memo(key, value)` | Read, or first-write, a durable value scoped to this task. See [Memos](#memos). |
| `rt.waitFor(event, {timeout?})` | Return the payload of the next `event` sent to this task, or `undefined` once `timeout` passes; until then the task waits. See [Events, waits, and sleep](#events-waits-and-sleep). |
| `rt.sleep(duration)` | Return once `duration` has passed; until then the task waits. See [Events, waits, and sleep](#events-waits-and-sleep). |
| `rt.approval(key, {title, summary?, payload?, timeout?, notify?})` | Ask a human to approve; return the decision. Until then the task waits. See [Approvals](#approvals). |
| `rt.output(text)` | Append an `output` event (permanent) to the task's event stream. Empty text is ignored; a non-string throws. A phase that re-runs (after a wait, retry, or replay) sends its output again. See [Event stream (SSE)](#event-stream-sse). |

Rules:

- Call `commit` once per phase. A second call throws inside the phase; the first checkpoint stands.
- `phase` must exist in `phases`. An unknown phase fails the task.
- A phase that returns without committing fails the task (no retry).
- A phase that throws before committing is retried under the task's `retry` policy; see [Retries](#retries).
- After `rt.commit` or a wait that started waiting, `rt.createTask`, `rt.waitForTasks`, `rt.runAgent`, `rt.waitFor`, `rt.sleep`, `rt.approval`, `rt.output`, and memo writes throw. Memo reads still work.

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
heartbeat. `JobsRunner` has no owner lease: every instance sweeps once per
`heartbeatInterval`, and concurrent sweeps are fenced, so each expired task is recovered
once. It scans up to 100 `running` tasks whose lease expired (or that have no lease),
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

## Events, waits, and sleep

```typescript
const followUp = defineTask<{patientId: string}, unknown, unknown>({
  name: "clinic.followUp",
  version: 1,
  initial: () => ({phase: "await"}),
  phases: {
    await: {
      run: async (task, rt) => {
        const labs = await rt.waitFor<{a1c: number}>("labs.ready", {timeout: {days: 2}});
        if (!labs) {
          await rt.sleep({hours: 1}); // back off before paging someone
          await rt.commit({phase: "escalate"});
          return;
        }
        await rt.commit({phase: "review", state: {labs}});
      },
    },
    // ...
  },
});

// Anywhere with a Harness (an API route, a webhook), runner up or not:
await harness.sendEvent(taskId, "labs.ready", {a1c: 6.1}, {requestId: `labs-${orderId}`});
```

### rt.waitFor(event, {timeout?})

| Argument | Description |
| --- | --- |
| `event` | Non-empty event name. A blank name fails the task (no retry). |
| `timeout` | Luxon `DurationLike`, non-negative. Omitted: wait forever. Invalid: fails the task. |

Returns the payload of the oldest undelivered event named `event`, or `undefined` once
`timeoutAt` (first call time + `timeout`) passes with none. An event already buffered when the
call runs wins over a passed timeout. One that lands while the timeout is being recorded
stays buffered for the next `rt.waitFor` of that name.

A run that lost its lease (taken over or aborted) cannot resolve a wait: the call throws
`HarnessCommitConflictError`, takes no event, and the run can write nothing more.

### rt.sleep(duration)

`duration` is a non-negative Luxon `DurationLike`. Returns `undefined` once
`timeoutAt` (first call time + `duration`) passes. `{seconds: 0}` returns at once.

### How a wait runs

1. The call takes a key `<step>:<n>`: the phase visit (`step`) and its position among
   this phase's `waitFor` / `sleep` calls (`n`, from 0).
2. When `task.waits[key]` says the call already resolved, it returns the recorded result
   (the same event's payload, or `undefined`). No new event is taken.
3. Otherwise an event wait takes the oldest undelivered matching event. Failing that, a
   passed `timeoutAt` resolves it. Either way the resolution is recorded in `waits[key]`,
   the event is marked consumed, and a resume span is written, in one transaction fenced
   on the lease. The phase continues.
4. Otherwise the task commits `status: "waiting"`, `waiting: {kind: "event", key: event,
   timeoutAt}` (or `{kind: "sleep", timeoutAt}`), `waits[key]`, and clears its lease, with
   a `CHAIN` span named after the phase (`output: {waiting: {...}}`). The phase stops.
5. It wakes when a matching event arrives (`sendEvent` sets it `pending`) or when
   `timeoutAt` passes (the runner claims it). The phase runs again from its checkpoint.

Several waits in one phase run in order: each wake re-runs the phase, earlier calls
return their records, and the next call waits. Keep the calls in the same order on every
run; a call whose kind or event name differs from its record fails the task.

Records live until the next phase commit (`waits` is cleared then). A retry of the same
phase visit returns the same results.

### harness.sendEvent(taskId, event, payload?, {requestId?})

1. Throws when `event` is blank or starts with the reserved `terreno.` prefix, the task does not exist, or it is `completed`,
   `failed`, or `aborted` (`Task <id> is already <status>; it cannot receive event "<event>"`).
2. With `requestId`, an earlier event of this task with that key is returned as is (a
   no-op). The key is unique per task; reusing it for another event name throws.
3. In one transaction: increments `eventSeq`, inserts a `HarnessInboxEvent` with
   `seq = eventSeq`, and, when the task is `waiting` on this event name, sets it
   `pending`. Wakes the local runner.

Returns the `HarnessInboxEvent`.

| Rule | Behavior |
| --- | --- |
| Ordering | FIFO per event name, by `seq`. Different names are independent. |
| Buffering | An event no wait has taken yet stays undelivered until a `rt.waitFor` of its name takes it, in any later phase. |
| Retention | Rows stay after delivery (`consumedKey`, `consumedAt` set) and after the task ends. Events left undelivered when the task ends are never delivered. No TTL. |
| No runner | The event and the wake are stored in Mongo; the task runs when a runner starts. |
| Abort | `harness.abort` works on a waiting task: it is aborted with its `waiting` and `waits` cleared. Later sends throw. |

### Latency

| Wake | Worst case |
| --- | --- |
| Event, sent in the owner process | Immediate when the runner is idle; otherwise after the task in flight stops. |
| Event, sent from another process | One `pollInterval` of the owner (default 250 ms) after the owner is idle. |
| Timeout or sleep | One `pollInterval` after `timeoutAt`, once the owner is idle. |
| No owner up | When an owner starts or takes over (up to `leaseDuration`, default 30 s, after the old owner died). |

The runner adds no timers or polling for waits: timeouts use the same claim query as
retries (`{status: "waiting", waiting.timeoutAt <= now}` next to `{status: "pending",
runAt <= now}`).

### Spans

| When | Span (same transaction) |
| --- | --- |
| The task starts waiting | `CHAIN` named after the phase, `output: {waiting: {kind, key?, timeoutAt?}}`. |
| An event is delivered | `CHAIN` `wait:<event>`, `input: {event, kind, startedAt, timeoutAt?}`, `output: {event, eventId, seq, payload, timedOut: false}`. `payload` is a summary (`{type, keys?, keyCount?, length?}`), never the values. `durationMs` is the time since the call first ran. |
| An event wait times out | `CHAIN` `wait:<event>`, `output: {event, timedOut: true}`. |
| A sleep ends | `CHAIN` `sleep`, `output: {elapsed: true}`. |

## Approvals

`rt.approval(key, options)` asks a human to approve, waits for the decision, and returns it.
It is an [event wait](#events-waits-and-sleep) on a dedicated event plus a
`HarnessApproval` row.

```typescript
const intakeSummary = defineTask<{patientId: string}, IntakeState, {status: string}>({
  name: "clinic.intakeSummary",
  version: 1,
  approvals: {
    "clinician-signoff": {approvers: [Permissions.IsAuthenticated, isClinician]},
  },
  initial: () => ({phase: "review"}),
  phases: {
    review: {
      replay: "safe",
      run: async (task, rt) => {
        const decision = await rt.approval("clinician-signoff", {
          title: "Sign off intake summary",
          summary: `Patient ${task.input.patientId}`,
          payload: task.state.summary,
          timeout: {hours: 24},
          notify: (approval) => comms.send({template: "approval-requested", data: {id: approval.id}}),
        });
        await rt.commit(decision.approved ? {phase: "write"} : {terminal: {status: "completed", result: {status: "rejected"}}});
      },
    },
    // ...
  },
});
```

### rt.approval(key, options)

| Argument | Type | Description |
| --- | --- | --- |
| `key` | `string` | Non-empty. Selects the approvers policy (`approvals[key]`). |
| `title` | `string` | Required. What the approver is asked to approve. |
| `summary` | `string` | Optional. Shown under the title. |
| `payload` | JSON | Optional. What the approver reviews. Stored on the approval. |
| `timeout` | Luxon `DurationLike` | Optional, positive. Expire the approval when nobody decides in time. Omitted: wait forever. |
| `notify` | `(approval) => void \| Promise<void>` | Optional. Called once after the approval is first stored. |

Returns `HarnessApprovalResult`:

| Outcome | Result |
| --- | --- |
| Approved | `{approvalId, approved: true, decidedAt, decidedBy?, reason?}` |
| Rejected | `{approvalId, approved: false, decidedAt, decidedBy?, reason}` |
| Expired | `{approvalId, approved: false, expired: true}` |

`decidedAt` is an ISO string. `decidedBy` is the deciding user's id; it is unset when
`harness.decideApproval` was called without `userId`.

Misuse (blank key, no title, non-string `summary`, non-function `notify`, a timeout that is
not positive, an `approvers` option) fails the task without a retry. Approvers go on the
definition, never on the call; see [Approvers](#approvers).

### How an approval runs

1. The call takes the next wait key `<step>:<n>` (shared with `rt.waitFor` and `rt.sleep`).
   Its event is `terreno.approval:<key>:<step>:<n>`.
2. When the call already resolved in this phase visit, it returns the stored decision.
3. Otherwise the task parks `waiting` on that event. The same transaction upserts the
   `HarnessApproval` (unique per `{taskId, callKey}`, `status: "pending"`,
   `expiresAt` = `timeoutAt`). A re-run of the phase visit finds the same row; nothing is
   duplicated. `notify` runs once, after the commit that inserted the row.
4. A decision (`approve` / `reject` route or `harness.decideApproval`) runs one
   transaction: sets `status`, `decidedBy`, `decidedAt`, `reason`; appends the event to the
   task's inbox (waking it); and writes the `approval:<key>` span.
5. The phase runs again and the call returns the decision, read from the approval row.
6. When `timeoutAt` passes first, the runner resumes the task; the same transaction that
   records the timeout sets the approval `expired` and writes its `approval:<key>` span.

| Rule | Behavior |
| --- | --- |
| Decide after `expiresAt` | Refused (409 / `HarnessApprovalConflictError` `has expired`), even before the runner records the expiry. |
| Decision and expiry race | Both write the task row, so one transaction retries. The expiry only applies to a `pending` approval; when a decision won, the call takes the decision instead. |
| Decide twice | The second call is refused: `Approval <id> is already <status>`. Exactly one of two concurrent decisions wins. |
| Task aborted, failed, or completed | The approval stays `pending` but leaves the inbox; deciding it is refused: `belongs to a task that is already <status>`. |
| Owner down | The decision is stored and the task set `pending`; the next owner resumes it. |
| `harness.sendEvent` to a `terreno.`-prefixed event | Throws: the prefix is reserved, so approval events come only from decisions. |
| An approval event written below the public API | Cannot approve: the call reads the approval row and fails the task with `received its event without a recorded decision`. |
| `notify` throws | Logged with `logger.error`; the approval stands. A crash between the commit and `notify` skips it. |

### Approvers

Approvers live in code, never in Mongo. The approval stores `definitionKey`
(`name@version:key`) and, for hook approvals, `extension`. At request time the process
serving HTTP looks the policy up in its own registry:

| Approval | Policy |
| --- | --- |
| From `rt.approval` | `definitions["name@version"].approvals[key]` |
| From a `beforeTool` hook (`api.approval`) | `extensions[extension].approvals[key]` |
| Policy key not declared | `HARNESS_DEFAULT_APPROVERS` = `[Permissions.IsAdmin]` |
| `name@version` or extension not registered in this process | Nobody may decide it (fail closed). Register the same definitions in the API process. |

An approver is a `@terreno/api` permission function, the modelRouter shape:

```typescript
type HarnessApprover = (method: RESTMethod, user?: User, approval?: HarnessApprovalDocument) => boolean | Promise<boolean>;
```

| Rule | Detail |
| --- | --- |
| Combination | Every approver must return true (AND), like modelRouter `permissions`. An empty list means nobody. |
| `method` | `"update"` for the inbox, `approve` / `reject`, and the `mayApprove` default (so the inbox lists exactly what the caller can decide); `"read"` for `GET /:id`. |
| `approval` | Always passed (the inbox evaluates each approval). |
| Task input | `await approvalTaskInput(approval)` loads the requesting task's `input`. For hook approvals that is the tool call's task input; the tool arguments are in `payload.args`. |
| A throwing approver | Denies, with a `logger.warn`. |

```typescript
const isClinician: HarnessApprover = async (_method, user, approval) => {
  const {clinicId} = await approvalTaskInput<{clinicId: string}>(approval as HarnessApprovalDocument);
  return Boolean(user && (await Staff.exists({clinicId, role: "clinician", userId: user.id})));
};
```

### harness.decideApproval(approvalId, {approved, reason?, userId?})

Decides without checking approvers (for trusted server code; the routes check first).
Returns the updated `HarnessApproval`. Throws `decideApproval requires approved: true or
false`, `decideApproval: a rejection requires a reason`, or
`HarnessApprovalConflictError` (already decided, expired, or task ended). `reason` is
trimmed; a blank reason is not stored.

## Require human approval

1. Declare who may decide, per approval key, on the task definition:
   `approvals: {"clinician-signoff": {approvers: [Permissions.IsAuthenticated, isClinician]}}`.
2. Call `rt.approval("clinician-signoff", {title, payload, timeout})` in a `replay: "safe"`
   phase and branch on `approved` (and `expired`).
3. Register `HarnessApp` with the same `Harness` (or one opened with the same registry):

   ```typescript
   const harness = await Harness.open({registry: [intakeSummary]});
   await harness.start();
   new TerrenoApp({userModel: User}).register(new HarnessApp({harness})).start();
   ```

4. Approvers decide in the admin **AI Harness → Approvals** inbox
   ([admin-frontend](admin-frontend.md#ai-harness-approvals-inbox)), or list
   `GET /harness/approvals` and call `POST /harness/approvals/:id/approve` or `/reject` with
   `{reason}`.
5. To gate agent tool calls instead of a phase, add [`approvalGate`](#approvalgate) to the agent.

## approvalGate

`approvalGate(options)` returns an extension whose `beforeTool` hook requires an approval
before every call of the named tools.

```typescript
const writeGate = approvalGate({tools: [writeNote], approvers: [isClinician], timeout: {hours: 4}});
const charter = defineAgent({name: "clinic.charter", tools: [writeNote], extensions: [writeGate], ...});
const harness = await Harness.open({models, registry: [charter, writeGate]});
```

| Option | Default | Description |
| --- | --- | --- |
| `tools` | — | Required, non-empty. `defineTool` tools or tool names. |
| `approvers` | `[Permissions.IsAdmin]` | Who may approve calls of these tools. |
| `name` | `approvalGate:<tool names joined by ",">` | Extension name; must be unique in the registry. |
| `title` | `Run tool "<toolName>"` | A string, or `({toolName, args}) => string`. |
| `timeout` | none | Expire the approval (blocking the call) when nobody decides in time. |
| `notify` | none | As in `rt.approval`. |

| Step | Behavior |
| --- | --- |
| A gated call arrives | The hook reads the turn memo `approvalGate:<name>:<toolCallId>`. When unset, it calls `api.approval(<toolName>, {title, payload: {toolName, toolCallId, args}})`. The tool call's task waits; its turn waits on it. |
| Decided | The call runs again from the top, gets the decision, and stores `{approved, decidedBy?, reason?, expired?}` in the memo. |
| Approved | The hook returns `undefined`; `execute` runs. |
| Rejected | `{block: 'Approval to run "<tool>" was rejected: <reason>'}`; the model gets it as the tool's error result. |
| Expired | `{block: 'Approval to run "<tool>" expired before anyone decided'}`. |

The memo is scoped to the turn, so a replayed call (`replay: "safe"` tool, restart) reuses
the decision instead of asking again. The approval's `definitionKey` is
`terreno.agent.tool@1:<toolName>` and its `extension` is the gate's name. Other tools pass
through. A wait inside any `beforeTool` hook suspends the call the same way; `api.approval`
is not offered to sections, `beforeModelRequest`, or `afterTool` (the tool already ran).

## HarnessApp and HTTP routes

`new HarnessApp({harness, basePath?, heartbeatInterval?})` is a `TerrenoPlugin`. Its `eventHub` is the change stream its SSE connections share.
`basePath` defaults to `/harness`; it must start with `/` and not end with `/`.
`heartbeatInterval` (default `{seconds: 15}`, must be positive) paces SSE heartbeats.
Conversation, task, and approval routes are `modelRouter`s with instance actions, so they
appear in `/openapi.json` (tag `harness`). The two SSE routes are plain Express routes
(the listed exception to modelRouter actions) and are not in the OpenAPI spec.

### Conversation routes

| Method | Path | Permissions | Behavior |
| --- | --- | --- | --- |
| GET | `/harness/conversations` | `IsAuthenticated` | The caller's own conversations (`userId` = caller, admins included), newest first. |
| GET | `/harness/conversations/:id` | Owner (`userId`) or admin | One conversation. Others: 403. |
| POST | `/harness/conversations/:id/submit` | Owner only | Body `{content, requestId, whenBusy?}` (strict; `whenBusy` is `"queue"` (default) or `"steer"`). Returns `{conversationId, disposition, requestId, turnTaskId?}`; see [send](#send-queue-and-steer). Admins cannot submit: messages are sent as the conversation's user. |
| GET | `/harness/conversations/:id/events` | Owner or admin | SSE. See [Event stream (SSE)](#event-stream-sse). |
| POST / PATCH / DELETE | `/harness/conversations[/:id]` | — | 405. Conversations are created with `harness.createConversation`. |

| Status | When |
| --- | --- |
| 400 | Blank `content` or `requestId`, unknown `whenBusy`, unknown keys. |
| 403 | Not the owner (submit), or neither owner nor admin (read). |
| 409 | Submit to a subagent conversation: `code: "harness-conversation-owned"`. |

### Task routes

| Method | Path | Permissions | Behavior |
| --- | --- | --- | --- |
| GET | `/harness/tasks/:id` | Owner (`userId`) or admin | One task. Others: 403. |
| POST | `/harness/tasks/:id/abort` | Owner or admin | Body `{reason}` (required, non-blank). Runs `harness.abort` with the caller as `userId`; returns the aborted task. |
| POST | `/harness/tasks/:id/resolveInterrupted` | Admin | Body `{action: "retry" \| "abort" \| "complete", reason, result?}`. Runs `harness.resolveInterrupted` with the caller as `userId`; returns the task. |
| GET | `/harness/tasks/:id/events` | Owner or admin | SSE for the task and its descendants. See [Event stream (SSE)](#event-stream-sse). |
| GET (list) / POST / PATCH / DELETE | `/harness/tasks[/:id]` | — | 405. |

| Status | When |
| --- | --- |
| 400 | Missing or blank `reason`, unknown `action`, unknown keys. |
| 403 | abort: neither owner nor admin. resolveInterrupted: not an admin. |
| 404 | resolveInterrupted `retry`: the task's `name@version` is no longer registered (`"harness-not-registered"`). |
| 409 | abort: the task already ended (`code: "harness-task-terminal"`). resolveInterrupted: the task is not `interrupted` (`"harness-task-not-interrupted"`), or `retry` on a task being aborted (`"harness-task-aborting"`). Either route: lost a commit race on a task that has not ended (`"harness-commit-conflict"`); retry the request. |

### Approval routes

| Method | Path | Permissions | Behavior |
| --- | --- | --- | --- |
| GET | `/harness/approvals` | `IsAuthenticated` | Pending, unexpired approvals of live tasks whose approvers pass for the caller (`method: "update"`), oldest first. `limit`, `page`, `total`, and `more` apply after the filter. Query fields: `taskId`, `rootTaskId`. Nothing to approve: `{data: []}`. |
| GET | `/harness/approvals/:id` | `IsAuthenticated` + approvers (`"read"`) | One approval in any status. Others: 403. |
| POST | `/harness/approvals/:id/approve` | `IsAuthenticated` + approvers (`"update"`) | Body `{reason?}` (strict; a blank `reason` is 400). Returns the approval. |
| POST | `/harness/approvals/:id/reject` | `IsAuthenticated` + approvers (`"update"`) | Body `{reason}`, required, non-blank (400 otherwise). Returns the approval. |
| POST / PATCH / DELETE | `/harness/approvals[/:id]` | — | 405. Approvals are created only by `rt.approval`. |

| Status | When |
| --- | --- |
| 400 | Body fails the schema (missing or blank reject `reason`, unknown keys). |
| 403 | The caller does not pass the approval's approvers (also when this process does not register its definition or extension). |
| 404 | No approval with that id. |
| 409 | Already decided, expired, or its task ended. `code: "harness-approval-not-pending"`; `detail` names the cause. |

`decidedBy` is the caller's user id (`req.user.id`).

Approvers decide in the admin approvals inbox: `HarnessApp.adminContribution()` adds custom
screen `harness-approvals` (group "AI Harness") to `AdminApp`, rendered by
`@terreno/admin-frontend`'s `HarnessApprovalInbox`, which can also be mounted outside admin
chrome. `harnessAdminScreens()`, `HARNESS_APPROVALS_SCREEN`, and `AI_HARNESS_GROUP` are exported
from `@terreno/ai/harness`. See
[AI Harness approvals inbox](admin-frontend.md#ai-harness-approvals-inbox).

The example backend mounts `HarnessApp` only when Mongo is a replica set (`Harness.open`
requires one). Its unit tests run on a standalone memory server, so the example-backend
OpenAPI snapshot excludes the `/harness/*` routes; the generated example-frontend SDK
(`bun run sdk` against a replica-set backend) includes them.
It registers `clinic.intakeSummary@1` with its `clinic.summarizer` agent (the worked example
in [Build a durable workflow](../how-to/build-a-durable-workflow.md)) and
`demo.approvalDemo@1`, and starts runs with the `startClinicalIntake` and
`startHarnessApprovalDemo` admin scripts.

## Event stream (SSE)

Every conversation and every task tree has an append-only event log (`HarnessEvent`).
Two SSE routes serve it:

| Route | Stream | Contents |
| --- | --- | --- |
| `GET /harness/conversations/:id/events` | The conversation's own stream (`streamId` = conversation id) | Conversation events: transcript, deltas, turns, tool calls, queued submissions. |
| `GET /harness/tasks/:id/events` | The task tree's stream (`streamId` = root task id), narrowed to events whose `taskPath` includes `:id` | Task events of the task and every task below it (children, grandchildren, subagent turns, tool calls). Not the task's ancestors or siblings. |

A subagent's transcript is on its own conversation stream; its turn's `task.status` events
are on the caller's task stream.

### Event types

| Type | Stream | Written | Payload |
| --- | --- | --- | --- |
| `message.created` | Conversation | With the message, in its commit | `{message}`: the stored `HarnessMessage` (`_id`, `seq`, `role`, `parts`, `turnTaskId`, `requestId?`, `toolCallId?`, `toolName?`, `status?`). Every role, including recorded system prompts. |
| `message.queued` | Conversation | With the queue entry | `{content, requestId, whenBusy}` |
| `turn.started` | Conversation | With the turn task | `{turnTaskId, status}` |
| `turn.finished` | Conversation | With the turn's terminal commit (completed, failed, or aborted) | `{turnTaskId, status, outcome: {status, result?, error?}}` |
| `tool.started` | Conversation | With the tool-call task | `{taskId, toolCallId, toolName, turnTaskId, status}` |
| `tool.finished` | Conversation | With the tool-call task's terminal commit | `{taskId, toolCallId, toolName, turnTaskId, status, outcome}` |
| `delta` | Conversation | While a model request streams, outside any commit; expires | `{turnTaskId, step, requestKey, text}` |
| `task.status` | Task | With the task's creation, and with every commit that changes its `status` or `phase` | `{taskId, name, version, status, phase, parentTaskId?, outcome?}` |
| `output` | Task | `rt.output(text)`, in its own transaction | `{phase, attempt, text}`. At least once per phase run: a re-run sends it again; `attempt` tells retries apart. |
| `approval.requested` | Task | With the waiting commit that creates the approval | `{approvalId, key, title, summary?, status, expiresAt?, taskId}` |
| `approval.decided` | Task | With the decision (or expiry) | `{approvalId, key, title, status: approved \| rejected \| expired, decidedBy?, decidedAt?, reason?, taskId}` |

Every event except `delta` and `output` commits in the same transaction as the change it
reports, so a client never sees an event for a change that rolled back. `task.status` is
not written for claims (`pending` → `running`) or for wakes from outside the task
(`sendEvent`, a settled child, a decided approval); the next commit reports the task's
state. A wait that finds its event already buffered commits `waiting` and `pending` in one
transaction and writes both.

### Frames and ids

```
id: 7
event: message.created
data: {"seq":7,"type":"message.created","created":"2026-10-03T12:00:00.000Z","taskId":"...","payload":{...}}

: heartbeat
```

| Rule | Detail |
| --- | --- |
| `id` | The event's `seq`: strictly increasing from 1 per stream, unique (`{streamId, seq}` index). A task stream's ids are the tree's seqs, so a narrowed stream has gaps. |
| Order | A stream's events commit in `seq` order: each writer increments the stream's counter (`HarnessEventStream`) in its transaction, so concurrent writers serialize on it. |
| Resume | Send the last id received as `Last-Event-ID` (browsers' `EventSource` does on reconnect) or `?after=<seq>`. The header wins. Neither: from the start. A non-integer is 400. |
| Exactly once | A connection subscribes to the app's shared tail before it queries the replay. The tail starts at a cluster time read when its first subscriber registers, and every subscriber waits for the tail to start before it queries its replay, so the start time precedes every replay query. The tail delivers every insert after it, so every event is in the replay, the tail, or both; frames with `seq` at or below the last one sent are dropped. Each event reaches a client once, in order, across a reconnect to any instance. |
| Heartbeat | A `: heartbeat` comment every `heartbeatInterval` (default 15 s) keeps proxies from closing an idle stream. |
| Close | The connection is tracked from the first middleware, so a client that leaves during auth, the lookups, or the replay releases its subscription and heartbeat timer. A tail error closes every stream of the app; clients reconnect with `Last-Event-ID`. |
| Auth | `authenticateMiddleware` (401 without a user), then owner (`userId`) or admin (403). Unknown or malformed id: 404. Errors are JSON, sent before the stream starts. |
| 503 | The server could not read a cluster time to start the tail (not a replica set). |
| Cost | One change stream per `HarnessApp` instance (`harnessApp.eventHub`), opened with the first viewer and closed with the last, fanned out in memory by stream and task path. The tail finishes its opening read before closing, so the server has a cursor id and the close runs `killCursors`. Viewers do not hold pooled Mongo connections; each reconnect runs its replay queries. |

### Deltas

A turn's `request` phase streams the model (`streamText`). Text is buffered and written as
one `delta` event once `streaming.deltaFlushChars` characters accumulate or
`streaming.deltaFlushInterval` passes, and once more when the response ends, before the
commit. So a request's deltas precede its `message.created`. Delta rows get
`expiresAt = now + streaming.deltaTtl`; a TTL index deletes them. A delta write that fails
is logged and dropped.

The committed message is authoritative. A client concatenates `delta.text` per
`(turnTaskId, step, requestKey)` and replaces it with the assistant `message.created` of
that step. `requestKey` is fresh for every model attempt: a retried, fallen-back, or
crash-replayed request streams under a new key, so a client drops the text of an older
key for the same step. A crash mid-stream leaves that attempt's deltas (until they
expire) and no message; recovery re-requests.

Requests with structured output (`rt.runAgent` with an `output` schema) do not stream: they
use `generateText` and write no deltas.

### Latency

A committed event reaches connected clients when its transaction commits plus change-stream
delivery (typically milliseconds). Deltas add up to `deltaFlushInterval`. A reconnect
replays from Mongo first, in pages of 500.

```typescript
const source = new EventSource(`/harness/conversations/${id}/events`); // cookies or a proxy add auth
source.addEventListener("delta", (event) => appendDraft(JSON.parse(event.data).payload));
source.addEventListener("message.created", (event) => commitMessage(JSON.parse(event.data).payload));
```

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
- Throws `harness-invalid-request` (`abort requires a reason`) for a blank reason and
  `harness-task-terminal` (`Task <id> is already <status>`) for a terminal task.
- If the process dies mid-abort, the remaining tasks keep `abortRequested` and are never
  claimed. Call `abort` again to finish (after a handler claim lapses, within one minute).
  `resolveInterrupted` rejects `retry` for such a task; use `abort`.

| `code` | `detail` | When |
| --- | --- | --- |
| `harness-invalid-request` | `resolveInterrupted action must be one of abort, complete, retry` | Unknown `action`. |
| `harness-invalid-request` | `resolveInterrupted requires a reason` | Missing or blank `reason`. |
| `harness-task-not-interrupted` | `Task <id> is <status>, not interrupted` | The task is in any other status. |
| `harness-task-aborting` | `Task <id> is being aborted; resolve it with abort, not retry` | `retry` on a task with `abortRequested`. |
| `harness-commit-conflict` | `Harness commit for task <id> phase "<phase>" lost its checkpoint fence` | `HarnessCommitConflictError`: another resolution won a race. Nothing is written. |
| (none) | `findExactlyOne` not-found error | No task with that id. |

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
| `extensions` | `Array<defineExtension result \| string>` | No | Extensions every conversation with this agent uses, in order. Stored as names; each must be in the registry (`Harness.open` throws otherwise). No duplicates. See [Extensions](#extensions). |
| `maxSteps` | positive integer | No | Model requests one turn may make. Default `10` (`HARNESS_AGENT_DEFAULT_MAX_STEPS`). |
| `fallbackModels` | `Array<{provider, modelId}>` | No | Tried in order after the primary model's retryable failures run out. |
| `modelRetry` | `{maxAttempts?, backoffMs?, maxBackoffMs?}` | No | Retries per model. Defaults `HARNESS_MODEL_RETRY_DEFAULTS`: 3 attempts, 500 ms base, 8 s cap. |
| `output` | zod schema | No | The final answer is parsed as JSON (code fences and preamble tolerated) and validated. The turn result carries `output`; a mismatch fails the turn. Also the default `output` of `rt.runAgent`. |

## Conversations

A conversation stores a snapshot of the agent's config (model, instructions, extension
names, the tool names the agent and those extensions resolve to, fallbacks, `maxSteps`)
and an ordered transcript. The snapshot keeps a running
conversation stable when the agent definition changes; tool code, `modelRetry`, and
`output` come from the registered agent at run time.

| Member | Description |
| --- | --- |
| `harness.createConversation({agent, extensions?, userId?})` | Creates an `idle` conversation. `agent` must be the registered definition. `extensions` (definitions or names) replaces the agent's extension list for this conversation; each must be registered. Returns a `HarnessConversationHandle`. |
| `harness.conversation(id)` | Loads a handle. |
| `handle.id`, `handle.document` | Id and the conversation as loaded. |
| `handle.messages()` | Every `HarnessMessage`, in `seq` order. |
| `handle.submit({content, requestId})` | Starts a turn now, or throws while one runs. See below. |
| `handle.send({content, requestId, whenBusy})` | Starts a turn, or queues or steers the message while one runs. See [send](#send-queue-and-steer). |

`submit`, in one transaction:

1. Claims the conversation (`idle` → `busy`, `activeTurnTaskId` set).
2. Appends the user message with the next `seq`.
3. Creates the turn task (`terreno.agent.turn@1`), owned by the conversation, run as the
   conversation's `userId`, and wakes the runner.

| Case | Result |
| --- | --- |
| Repeated `requestId` | Returns the turn it started; appends nothing. Keys are per conversation. |
| Another turn is running, or submissions are queued | Throws `HarnessConversationBusyError` (`activeTurnTaskId` set). Use `send` to queue or steer. |
| Lost a race to another submit | Re-reads the conversation: still busy → `HarnessConversationBusyError` naming the winning turn; idle again (the winner already finished) → claims it and starts its own turn. Up to 3 claims. |
| Blank `content` / `requestId` | Throws `harness-invalid-request`: `submit requires non-empty content` / `submit requires a requestId`. |
| Subagent (task-owned) conversation | Throws `HarnessConversationOwnedError`: only `rt.runAgent` runs its turns. |

When a turn ends (completed, failed, or aborted) the conversation goes back to `idle` in
the turn's terminal commit itself, on every path (an answer, a failed model call, a
thrown phase, an abort, an interruption, a resolution). If the process
dies before that write, the next `submit` sees the turn is terminal and frees the
conversation itself. Two concurrent submits with one `requestId` both get the same turn.
Right after a turn ends, the next queued submission starts (see below).

### send, queue, and steer

`handle.send({content, requestId, whenBusy})` (the HTTP `submit` action) returns
`{conversationId, disposition, requestId, turnTaskId?}`:

| Conversation | `whenBusy` | `disposition` | What happens |
| --- | --- | --- | --- |
| Idle, nothing queued | either | `started` | A turn starts now, as `submit` does. `turnTaskId` is the new turn. |
| Busy | `queue` | `queued` | Appended to `queued` (with a `message.queued` event). It runs as its own turn after the active turn and every earlier queued submission. No `turnTaskId` yet. |
| Busy | `steer` | `steered` | Appended to `queued` as a steering entry. The active turn's **next model request** (the `request` phase after the current tool round, or a re-requested one) sends it after the stored transcript, and that request's commit stores it as a user message (before the answer) and removes it from `queued`. `turnTaskId` is the active turn. |
| Idle with a backlog | either | `queued` | Joins the back of the queue; the oldest queued submission starts. |

Rules:

- Queued submissions start one per turn, oldest first, when a turn ends (completed,
  failed, or aborted). A start is one transaction: claim the idle conversation (fenced on
  the entry being first), remove the entry, insert the user message, create the turn.
- A steer that arrives after the active turn's last model request started (the model is
  already answering without tools) is left in `queued` and runs as the next turn. So is a
  steer when the turn fails or is aborted.
- A steering entry joins whichever turn makes the next model request, ahead of older
  `queue` entries: steering is for the conversation in progress.
- Idempotent on `requestId` (per conversation): a repeat returns where the first
  submission is now (`started` with its turn once a queued submission ran, `steered` once
  a steering message was stored) and adds nothing. User messages carry `requestId`
  (unique per conversation).
- Every terminal commit of a turn (answer, failure, abort, interruption, resolution)
  frees its conversation in the same transaction. If the process dies before the next
  queued submission starts, the runner that owns execution starts it: its recovery pass
  (at takeover and every heartbeat) and, while idle, a sweep at most once per second first
  free any conversation still `busy` on a finished or missing turn (queue or no queue),
  then start the oldest submission of each idle conversation with a queue. The conversation's next `send` also
  starts it. The start is fenced on the entry being first in an idle conversation, so it
  runs once however many sweeps race.

## The agent turn task

`terreno.agent.turn@1` is an ordinary registered task (`AGENT_TURN_TASK_NAME`). Input
`{conversationId}`; `retry: {maxAttempts: 1}` (model retries happen inside `request`).

| Phase | `replay` | Work | Commit (one transaction) |
| --- | --- | --- | --- |
| `request` | `safe` | Load the transcript; call the model with retries and fallbacks | Assistant message (text and tool-call parts) + `LLM` span + next checkpoint: `tools` when there are tool calls, otherwise `completed` |
| `tools` | `safe` | One `terreno.agent.tool@1` child per tool call (`rt.createTask`), then `rt.waitForTasks` (`all`) | One tool message per call, in call order + `request`, or `completed` with `finishReason: "max-steps"` once `maxSteps` requests were made |

Result (`HarnessTurnResult`): `{finishReason: "stop" | "max-steps", steps, text, output?}`.
At `maxSteps` the last tool calls still get results, so the transcript never ends on an
unanswered call. Aborting the turn after those tool calls are stored and before their
results are stored marks that assistant message `aborted`. The next request skips it, so
the model transcript never ends on an unanswered call. An aborted tool still writes no
tool message.

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
| `input` | `{messages: {count, fromSeq, toSeq, hash?}, system: {hash, messageSeq?, sections}, tools, models, rewrittenBy?}` (`messages.hash`, the sha256 of the JSON messages sent, only when a `beforeModelRequest` hook rewrote the request): the transcript slice sent and the system prompt by hash (the texts themselves are in `HarnessMessage`), so span size stays bounded. See [Sections and the recorded system prompt](#sections-and-the-recorded-system-prompt). |
| `output` | `{text, toolCalls, finishReason, attempts}`; `attempts` lists every try (`{provider, modelId, attempt, error?, statusCode?, retryable?}`) |
| `usage` | `{inputTokens, outputTokens, model, costUsd?}`; `costUsd` only when `priceMap` prices the model |
| `status` / `error` | `error` and the failure message when no model answered; `output` is then `{attempts}` and the turn fails in the same commit |

`request` streams the model with `streamText` and writes coalesced `delta` events while
it answers; the assistant message and span commit only when the response is complete.
Requests with structured output use `generateText`. See [Deltas](#deltas).

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

## Extensions

An extension is a named bundle of prompt sections, tools, hooks, and tool wraps. Agents
and conversations use extensions by name; list each one in `Harness.open({registry})`.

```typescript
const clinicPolicy = defineExtension({
  name: "clinic.policy",
  sections: [section("rules", () => "Never prescribe. Cite chart sources.")],
  tools: [pageNurse],
  hooks: [
    hook("beforeTool", async (call, api) => {
      if (call.toolName !== "writeNote") {
        return undefined;
      }
      const key = `allow:${call.toolCallId}`;
      // Ask the policy service once; a replay reads the stored decision.
      const allowed = (await api.memo<boolean>(key)) ?? (await api.memo(key, await policy.allows(call.args)));
      return allowed ? undefined : {block: "Writing notes needs clinician sign-off"};
    }),
  ],
  wraps: [wrapTool("lookupChart", withAuditLog)],
});

const summarizer = defineAgent({name: "clinic.summarizer", extensions: [clinicPolicy], ...});
const harness = await Harness.open({models, registry: [summarizer, clinicPolicy]});
```

| Builder | Signature | Notes |
| --- | --- | --- |
| `defineExtension` | `({name, sections?, tools?, hooks?, wraps?, approvals?}) => HarnessExtensionDefinition` | Validates and freezes. `name` required; no duplicate section or tool names. `approvals`: who may decide each `api.approval(key)` its `beforeTool` hooks request (default `[Permissions.IsAdmin]`). |
| `section` | `(name, (input, api) => string \| undefined \| Promise<...>)` | A named piece of the system prompt. See [Sections](#sections-and-the-recorded-system-prompt). |
| `hook` | `(kind, fn)` | `kind`: `beforeModelRequest`, `beforeTool`, `afterTool` (`HARNESS_HOOK_KINDS`). An extension may list several hooks of one kind; they run in list order. |
| `wrapTool` | `(toolOrName, (tool) => tool)` | Decorates the winning tool of that name. See [Tool wraps and precedence](#tool-wraps-and-precedence). |

Registration and lookup:

| Case | Result |
| --- | --- |
| Two extensions with one name in `registry` | `Harness.open` throws `harness-config-invalid`: `Harness registry lists extension "<name>" more than once`. Replacing an extension's behavior across versions ships later. |
| An agent names an unregistered extension | `Harness.open` throws `harness-config-invalid`: `Agent "<agent>" uses extension "<name>", which is not in this harness registry`. |
| `createConversation({extensions})` names an unregistered or repeated extension | Throws `harness-not-registered`: `Extension "<name>" is not in this harness registry` / `harness-invalid-request`: `createConversation: an extension is listed more than once`. An entry that is not an extension definition or name throws `harness-definition-invalid` (500). |
| A conversation's snapshot names an extension the running process lacks | The turn's `request` fails the turn with `Extension "<name>" is not in this harness registry`. |

Extensions are code: they come from the registry at run time. The conversation stores
only their names (and the tool names they resolved to at create time).

## Hooks

Every hook gets an `api`:

| Member | Description |
| --- | --- |
| `taskId` | The task running the hook: the turn for `beforeModelRequest` and sections, the tool call's task for `beforeTool` / `afterTool`. |
| `turnTaskId` | The turn task. |
| `conversationId` | The conversation. |
| `signal` | Aborts with the turn or when the run loses its lease. |
| `memo` | [Memo](#memos) scoped to the turn task (from tool hooks too). |
| `approval(key, options)` | `beforeTool` only. `rt.approval` of the tool call's task; approvers come from this hook's extension `approvals[key]`. The call waits until it is decided, then runs again from the top, so memoize the decision by `toolCallId`. See [approvalGate](#approvalgate). |

| Hook | Runs | Returns | Effect |
| --- | --- | --- | --- |
| `beforeModelRequest(request, api)` | In `request`, after sections are built, before each model call | `{system, messages}` or `undefined` | Replaces the request. `messages` are AI SDK `ModelMessage`s. The span records `rewrittenBy` (extensions whose hook returned a request) and `messages.hash`. A rewritten system prompt is recorded in the transcript; rewritten messages are not (only their hash), so keep message rewrites deterministic. |
| `beforeTool(call, api)` | In the tool call's task, after the arguments pass `parameters`, before `execute` | `undefined`, `{block: reason}`, or `{args}` | `{block}` stops the call: `execute` never runs; the tool result is an error whose text is `reason`, verbatim. `{args}` replaces the arguments; the next hook sees them. The final arguments are validated again. |
| `afterTool(call, result, api)` | After `execute` returns (not after it throws) | A replacement result, or `undefined` | Replaces the result the model sees (JSON; `undefined` keeps it, return `null` for null). |

`call` is `{toolName, toolCallId, args}`.

Order: extensions in the conversation's order; within an extension, its `hooks` in list
order. Each hook sees the previous hook's output. The first `{block}` stops the rest.

When a hook fails:

| Case | Result |
| --- | --- |
| `beforeModelRequest` throws | The turn fails: `Extension "<name>" beforeModelRequest hook failed: <message>`. No model call; the conversation goes back to `idle`. |
| `beforeModelRequest` returns something without a string `system` and a `messages` array | The turn fails: `Extension "<name>" beforeModelRequest hook must return {system, messages} or undefined`. |
| `beforeTool` / `afterTool` throws | The tool call fails, like a throwing tool: the model gets the error result `Extension "<name>" beforeTool hook failed: <message>` (or `afterTool`). The turn continues. |
| `beforeTool` returns anything else | Tool error result `Tool "<name>" failed: Extension "<x>" beforeTool hook must return undefined, {block}, or {args}`. |
| Rewritten arguments fail `parameters` | Tool error result `Invalid arguments for tool "<name>" after beforeTool hooks: <zod issues>`. |
| The turn is aborted while a hook runs | The abort wins; nothing is reported to the model. |

A failing hook is never retried (turn and tool tasks run with `retry: {maxAttempts: 1}`).
A `request` that is replayed after a crash runs its sections and `beforeModelRequest`
hooks again; a replayed `replay: "safe"` tool call runs its tool hooks again. Store
decisions that must not change with `api.memo`.

## Sections and the recorded system prompt

Before every model request the turn builds the system prompt:

1. The conversation's `instructions`.
2. Each section of each extension, extensions in the conversation's order, sections in
   list order. A section returning `undefined`, `null`, or blank text is skipped.
3. Pieces are joined with a blank line (`"\n\n"`).
4. `beforeModelRequest` hooks may then replace it.

Section `input`: `{agentName, conversationId, step, messages}` (`step` is 1 for the
turn's first request; `messages` are the AI SDK messages about to be sent). The second
argument is the hook `api`. A throwing section fails the turn:
`Extension "<name>" section "<section>" failed: <message>`.

What the model saw is recorded:

| When the effective system prompt | Then |
| --- | --- |
| Equals the last recorded prompt in this conversation (or, before any, the conversation's `instructions`) | Nothing new is written. |
| Differs | The request's commit appends a `system` message with one `system-prompt` part `{type: "system-prompt", text, hash, sections: [{extension, name}]}`, just before the assistant message. Written on the failed-model path too. |

The `LLM` span's `input.system` is `{hash, messageSeq?, sections}`: `hash` is the sha256
of the text sent; `messageSeq` points to the `system` message holding it (unset when the
text is the conversation's `instructions`). Recorded prompts are never sent back to the
model as messages.

## Tool wraps and precedence

The tools a conversation can call are resolved on every request and every tool call:

1. The agent's `tools`.
2. Each extension's `tools`, in the conversation's extension order. A tool with a name
   already present replaces it: later wins.
3. Every wrap, in extension order, applied to the tool that won its name, whichever
   extension (or the agent) provided it. A wrap naming a tool nobody provides is ignored.
   With several wraps on one tool, the first extension's wrap is innermost.

A wrap gets the winning tool and returns the tool to use (typically
`defineTool({...tool, execute: ...})`). It must return a `defineTool` tool with the same
name; otherwise resolution throws `harness-definition-invalid`: `Extension "<x>" wrap of tool
"<name>" must return a defineTool tool named "<name>"`. A throwing wrap reports `Extension "<x>" wrap of tool
"<name>" failed: <message>`. Where it throws decides what fails: `createConversation`
throws, `request` fails the turn, a tool call reports the error to the model. Keep wraps
pure: they run on every resolution.

The conversation snapshot's `tools` lists the resolved names at create time. A tool an
extension adds later is not callable in existing conversations.

## Memos

`rt.memo(key, value?)` stores a decision durably.

```typescript
const route = await rt.memo("route", await chooseRoute(task.input)); // first run decides
```

| Call | Returns |
| --- | --- |
| `rt.memo(key)` | The stored value, or `undefined`. |
| `rt.memo(key, value)` | Stores `value` when `key` is unset, then returns the stored value. A later write (another run, another process, a concurrent call) gets the first value back. `value` `undefined` is a read. The expression computing `value` still runs on every call; read first (`(await rt.memo(key)) ?? (await rt.memo(key, await decide()))`) to call an expensive or side-effecting decision once. |

| Rule | Detail |
| --- | --- |
| Scope | Per task: unique `(taskId, key)`. `rt.memo` uses the running task. Hook `api.memo` uses the turn task, also from tool hooks (which run in the tool call's task), so a decision survives a re-run of the request or of the tool call. One turn shares one scope across all its model requests and tool calls: key tool decisions by `toolCallId`, and per-request decisions in sections or `beforeModelRequest` by `step` (a fixed key keeps the first request's value for the whole turn). |
| Values | Stored as a JSON copy (nested `undefined` is dropped). A BigInt, or a top-level value JSON cannot represent (a function, a symbol), throws `harness-invalid-request`: `memo "<key>": value is not JSON-serializable`. |
| Keys | Non-empty strings; blank keys throw `harness-invalid-request`: `memo requires a non-empty key`. |
| Fencing | Each write runs in its own transaction that first renews the running task's lease, fenced on its phase and lease token. A run that lost its lease gets `HarnessCommitConflictError` and writes nothing. |
| After commit | A write after the phase committed (or started waiting) throws; reads still work. |
| Concurrency | The unique index decides the race; every writer returns the winner's value. |

Writes are durable as soon as the call returns, not with the phase's commit, so a crash
after the write and before the commit keeps the decision for the replay.

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
| `waiting` | Blocked on child tasks (`rt.waitForTasks`), an event (`rt.waitFor`), or a sleep (`rt.sleep`). Holds no lease. Woken back to `pending` when the wait is satisfied; an event or sleep wait whose `timeoutAt` passed is claimed directly. |
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
| `claims` | Number | Times a runner claimed the task. Numbers each runnable visit; `JobsRunner` puts it in the job idempotency key. Default 0; a missing value reads as 0. |
| `retry` | `{maxAttempts, backoffMs, maxBackoffMs}` | Copied from the definition. |
| `ownership` | `{kind: root \| task \| conversation, id}` | Default `root`. `rt.createTask` children are `{kind: "task", id: <parent>}`; agent turns are `{kind: "conversation", id}`, except subagent turns, which are `{kind: "task", id: <caller>}`. |
| `rootTaskId` | ObjectId | Top of the ownership tree; equals `_id` for root tasks. |
| `ancestorIds` | [ObjectId] | Owning tasks from the root down to the parent; empty for a root task. Set at create; scopes task event streams. |
| `traceId`, `rootSpanId` | ObjectId | Audit trace and its root `CHAIN` span. |
| `requestId` | String | Idempotency key; unique sparse index. |
| `userId` | ObjectId | Optional initiating user. Also set on the `ObsTrace`. |
| `lease` | `{owner, token, acquiredAt, expiresAt}` | Current task lease. Cleared on terminal commit and interruption. |
| `runAt` | Date | Earliest claim time; set by a retry, cleared by the next commit. |
| `waiting` | `{kind, taskIds, policy, key, timeoutAt}` | Set while `waiting`. `kind: "tasks"` (`taskIds`, `policy`), `"event"` (`key` = event name, optional `timeoutAt`), or `"sleep"` (`timeoutAt`). |
| `waits` | Mixed | `rt.waitFor` / `rt.sleep` records of the current phase visit by `<step>:<n>`: `{kind, key?, startedAt, timeoutAt?, resolution?, eventId?, resolvedAt?}`. `resolution` is `event`, `timeout`, or `elapsed`. Cleared on each phase commit and on abort. |
| `eventSeq` | Number | Events received by `sendEvent`. Default 0. |
| `abortRequested` | `{at, reason, userId, handlerClaimExpiresAt}` | Set when an abort starts. Blocks claims. `handlerClaimExpiresAt` is the current aborter's claim on running the handler. |
| `background` | Boolean | Stored from `rt.createTask`. Default false. |

Indexes: `{requestId}` unique sparse, `{status, runAt}`, `{status, waiting.timeoutAt}`, `{rootTaskId}`, `{status, lease.expiresAt}`, `{ownership.id, ownership.kind}`.

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
| `queued` | `[{content, requestId, submittedAt, whenBusy}]` | Submissions waiting on the active turn, oldest first: `whenBusy: "queue"` runs later as its own turn, `"steer"` joins the active turn's next model request. See [send](#send-queue-and-steer). |
| `userId` | ObjectId | Turns run as this user. |
| `seq` | Number | Highest message `seq` handed out. Default 0. |
| `created`, `updated`, `deleted` | | Plugins. |

Indexes: `{userId, created}`, `{ownership.id, ownership.kind}`, `{ownership.id, ownerKey}` unique (partial: `ownerKey` set), `{queued.requestId, status}` (partial: a queued submission exists; the queue sweep), `{status, activeTurnTaskId}` (the sweep for conversations busy on a finished turn).

## HarnessMessage model

Collection `harnessmessages`. Every field has a schema `description`; `strict: "throw"`;
empty objects are kept (`minimize: false`), so `{}` tool arguments survive.

| Field | Type | Description |
| --- | --- | --- |
| `conversationId` | ObjectId | Required. |
| `seq` | Number | Required. Strictly increasing per conversation from 1; allocated by `$inc` on the conversation inside the commit transaction. |
| `role` | `system` \| `user` \| `assistant` \| `tool` (`HARNESS_MESSAGE_ROLES`) | |
| `parts` | array | `{type: "text", text}`, `{type: "tool-call", toolCallId, toolName, input}`, `{type: "tool-result", toolCallId, toolName, output, isError}`, `{type: "system-prompt", text, hash, sections}` (recorded system prompts; never sent to the model). |
| `status` | `ok` \| `error` | Tool messages only. |
| `toolCallId`, `toolName` | String | Tool messages only. |
| `turnTaskId` | ObjectId | Turn that wrote the message. |
| `requestId` | String | User messages from `submit` / `send`: the submitter's idempotency key. |
| `aborted` | Boolean | Skipped when building the next prompt. Set when an assistant message is aborted after its tool calls were stored and before their results were stored. The turn does not store partial text (it streams as `delta` events and commits only complete messages). |

Indexes: `{conversationId, seq}` unique; `{conversationId, requestId}` unique (partial: `requestId` set).

## HarnessMemo model

Collection `harnessmemos`. Every field has a schema `description`; `strict: "throw"`;
empty objects are kept.

| Field | Type | Description |
| --- | --- | --- |
| `taskId` | ObjectId | Required. The task the memo is scoped to (the turn task for hook memos). |
| `key` | String | Required. |
| `value` | Mixed | First value written (JSON). |
| `created`, `updated` | | Plugin. |

Index: `{taskId, key}` unique. Rows are not deleted with their task.

## HarnessInboxEvent model

Collection `harnessinboxevents`. Every field has a schema `description`; `strict: "throw"`;
empty objects are kept.

| Field | Type | Description |
| --- | --- | --- |
| `taskId` | ObjectId | Required. The task the event was sent to. |
| `name` | String | Required. Event name. |
| `payload` | Mixed | What `rt.waitFor` returns. |
| `seq` | Number | Required. Position in the task's inbox (1, 2, ...). |
| `requestId` | String | Sender idempotency key. |
| `consumedKey` | String | `<step>:<n>` of the wait call that took it; unset while undelivered. |
| `consumedAt` | Date | When it was taken. |
| `created`, `updated` | | Plugin. |

Indexes: `{taskId, name, consumedKey, seq}`; `{requestId, taskId}` unique where
`requestId` exists; `{consumedKey, taskId}` unique where `consumedKey` exists (one event
per wait call).

## HarnessApproval model

Collection `harnessapprovals`. Every field has a schema `description`; `strict: "throw"`;
empty objects are kept.

| Field | Type | Description |
| --- | --- | --- |
| `taskId` | ObjectId | Required. Task that waits on the decision. |
| `rootTaskId` | ObjectId | Required. Root of its ownership tree. |
| `traceId` | ObjectId | Required. The requesting task's `ObsTrace`. |
| `callKey` | String | Required. `<step>:<n>` of the wait call. |
| `event` | String | Required. Inbox event the decision sends. |
| `definitionKey` | String | Required. `name@version:key` of the requesting task. |
| `key` | String | Required. Approval key; selects the approvers policy. |
| `extension` | String | Extension whose `approvals` hold the approvers (hook approvals only). |
| `title` | String | Required. |
| `summary` | String | |
| `payload` | Mixed | What the approver reviews (JSON). |
| `status` | `pending` \| `approved` \| `rejected` \| `expired` | Required. Default `pending` (`HARNESS_APPROVAL_STATUSES`). |
| `decidedBy` | ObjectId (User) | Who approved or rejected. |
| `decidedAt` | Date | When. |
| `reason` | String | Why. |
| `expiresAt` | Date | `timeoutAt` of the wait; unset means never. |
| `created`, `updated` | | Plugin. |

Indexes: `{callKey, taskId}` unique; `{status, created}`. Rows are not deleted with their
task.

## HarnessEvent model

Collection `harnessevents`: the SSE log. Every field has a schema `description`;
`strict: "throw"`. Rows are never updated.

| Field | Type | Description |
| --- | --- | --- |
| `streamId` | ObjectId | Conversation id, or root task id for a task tree. Required. |
| `seq` | Number | Position in the stream; strictly increasing from 1. Required. |
| `type` | `HARNESS_EVENT_TYPES` value | See [Event types](#event-types). |
| `payload` | Mixed | Event body. |
| `taskId` | ObjectId | The task the event is about, when there is one. |
| `taskPath` | [ObjectId] | Task-stream events: the task's `ancestorIds` plus the task. Empty on conversation events. |
| `expiresAt` | Date | `delta` rows only: `created + streaming.deltaTtl`. |
| `created` | Date | Write time. |

Indexes: `{streamId, seq}` unique, `{streamId, taskPath, seq}`, `{expiresAt}` TTL
(`expireAfterSeconds: 0`).

`HarnessEventStream` (collection `harnesseventstreams`) holds one counter per stream:
`_id` = `streamId`, `seq` = the highest seq handed out. Created on the stream's first event.

## Audit spans

| When | Write (same transaction) |
| --- | --- |
| `createTask` | `ObsTrace` (`name: "name@version"`, `input`, `userId`, `status: "ok"`) and a root `CHAIN` span with the same name. |
| Each phase commit | One `CHAIN` span named after the phase, parented to the root span. `input: {attempt, state}`; `output`: the next phase and state, or the terminal outcome. `status: "error"` and `error` for a failed terminal. |
| Interruption (expired lease) | One error `CHAIN` span named after the cut-off phase. See [Replay and interruption](#replay-and-interruption). |
| `resolveInterrupted` | One `CHAIN` span named `resolveInterrupted`; closes root span and trace for `abort` / `complete`. |
| Failed attempt with retries left | One error `CHAIN` span named after the phase, `output: {retry: {attempt, maxAttempts, runAt}}`. |
| `rt.createTask` | The child's `CHAIN` span (`name@version`), parented to the parent's span. |
| `rt.waitForTasks` / `rt.waitFor` / `rt.sleep` starts waiting | One `CHAIN` span named after the phase, `output: {waiting: {...}}`. |
| `rt.waitFor` / `rt.sleep` resolves | One `CHAIN` span `wait:<event>` or `sleep`. See [Events, waits, and sleep](#spans). |
| `rt.approval` decided or expired | One `CHAIN` span `approval:<key>` under the requesting task's span, in the decision's (or expiry's) transaction. `input: {approvalId, definitionKey, title}`; `output: {decision: "approved" \| "rejected" \| "expired", decidedBy?, reason?}`. Starts when the approval was created. |
| `harness.abort` | One `abort` span per aborted task; closes that task's span (and the trace for a root task). |
| Agent `request` commit | One `LLM` span parented to the turn's span, with the assistant message (and a `system` message when the system prompt changed). See [The agent turn task](#the-agent-turn-task). |
| Tool call | The tool task's own span has kind `TOOL` and the tool's name; it closes with the tool's outcome. |
| `rt.runAgent` | The subagent turn's own span has kind `AGENT` and the agent's name, parented to the caller's span; the turn's `LLM`, phase, and `TOOL` spans nest under it. |
| Terminal commit | The task's span gets `endedAt`, `status`, `output`; failures also set `error`. For a root task the `ObsTrace` closes too (`errorSummary` on failure). |

If the commit transaction aborts, the task stays at its previous checkpoint in `running`
and no span is written. Once its lease expires, recovery treats it as interrupted.

## Errors

Every error the harness throws for a caller to act on is an `APIError` from
`@terreno/api`: `message` is the stable `title` of its `code`, the per-occurrence sentence
is in `detail`, and a wrapped error is in `cause`. Over HTTP the error middleware sends
`status`, `code`, `title`, and `detail`. Detect them with `isAPIError(error)` and branch on
`error.code`; never parse `message`. `HARNESS_ERRORS` (exported from `@terreno/ai/harness`)
lists every kind:

| `code` | `status` | `title` | Kinds of failure |
| --- | --- | --- | --- |
| `harness-definition-invalid` | 500 | Invalid harness definition | `defineTask` / `defineTool` / `defineAgent` / `defineExtension` / `approvalGate` validation, and `rt.*` misuse inside a phase. Thrown as `HarnessDefinitionError`, which fails the task at once (no retry). |
| `harness-config-invalid` | 500 | Invalid harness configuration | `Harness.open`, `HarnessApp`, `InProcessRunner` (lease timing, `concurrency`), `JobsRunner`, `streaming`, and registry problems. |
| `harness-replica-set-required` | 500 | MongoDB replica set required | `Harness.open` on a deployment without transactions. |
| `harness-invalid-request` | 400 | Invalid harness request | A caller passed a bad argument (`abort`, `sendEvent`, `decideApproval`, `resolveInterrupted`, `submit` / `send`, `createConversation`, memos, a `terreno.harness.phase` payload without `taskId`). |
| `harness-not-registered` | 404 | Not registered in this harness | A task definition, agent, or extension the registry lacks. |
| `harness-not-found` | 404 | Harness record not found | A conversation or child task disappeared. |
| `harness-already-started` | 409 | Already started | `Harness.start` / `InProcessRunner.start` / `JobsRunner.start` called twice. |
| `harness-runner-stopped` | 503 | Harness runner is not running | A `terreno.harness.phase` job ran on an instance whose harness is not started; the jobs worker retries it. |
| `harness-commit-conflict` | 409 | Harness commit lost its checkpoint fence | `HarnessCommitConflictError`. |
| `harness-approval-not-pending` | 409 | Approval can no longer be decided | `HarnessApprovalConflictError`. |
| `harness-conversation-busy` | 409 | Conversation is busy | `HarnessConversationBusyError`. |
| `harness-conversation-owned` | 409 | Conversation is run by its owning task | `HarnessConversationOwnedError`. |
| `harness-request-id-conflict` | 409 | requestId is already in use | A task, event, or child `key` reused for something else. |
| `harness-task-terminal` | 409 | Task already ended | `abort` or `sendEvent` on a completed, failed, or aborted task. |
| `harness-task-not-interrupted` | 409 | Task is not interrupted | `resolveInterrupted` on a task in another status. |
| `harness-task-aborting` | 409 | Task is being aborted | `resolveInterrupted` `retry` on a task with `abortRequested`. |
| `harness-internal` | 500 | Harness invariant violated | An internal invariant broke (a hand-sent approval event, a closed event tail). |
| `harness-wait-timed-out` | 504 | Timed out waiting for task | `waitForTask` gave up. |

What a task or turn records as its `error` (and what the model sees for a failed tool
call) is the harness error's `detail` alone; another `APIError` records `title: detail`;
any other error its `message`.

The classes keep their names and `instanceof` checks. `HarnessDefinitionError`,
`HarnessCommitConflictError`, `HarnessApprovalConflictError`,
`HarnessConversationBusyError`, and `HarnessConversationOwnedError` extend `APIError`.
`HarnessExtensionError`, `HarnessModelCallError`, and `HarnessSubagentError` are turn
outcomes, not caller errors: they stay plain `Error`s whose `message` is the recorded text.

| `code` | `detail` | When |
| --- | --- | --- |
| `harness-commit-conflict` | `Harness commit for task <id> phase "<phase>" lost its checkpoint fence` | The task was no longer `running` at the phase this commit started from, or its lease token changed (another runner took it over, or an abort fenced it). Also thrown by `rt.createTask` / `rt.waitForTasks` from a run that lost its lease, by a losing concurrent `resolveInterrupted`, and by `harness.abort` when the task finished on its own first. Nothing is written. |
| `harness-invalid-request` / `harness-task-terminal` | `abort requires a reason` / `Task <id> is already <status>` | `harness.abort` with a blank reason, or on a terminal task. |
| `harness-definition-invalid` | `rt.waitForTasks only waits on tasks this task created with rt.createTask` | Fails the task (no retry). |
| `harness-definition-invalid` | `rt.waitForTasks policy must be one of all, failFast` | Unknown policy. Fails the task. |
| `harness-definition-invalid` | `<key>: rt.waitFor requires an event name` / `rt.waitFor timeout ...` / `rt.sleep duration must be a valid, non-negative duration` | Misuse; fails the task (no retry). |
| `harness-definition-invalid` | `<key>: wait call <step>:<n> was rt.waitFor("a") on an earlier run and is ...` | Wait calls changed order between runs of a phase. Fails the task. |
| `harness-task-terminal` | `Task <id> is already <status>; it cannot receive event "<event>"` | `sendEvent` to a terminal task. |
| `harness-invalid-request` / `harness-request-id-conflict` | `sendEvent requires an event name` / `sendEvent: event names starting with "terreno." are reserved for the harness ...` / `requestId "<id>" already sent event "<name>" to task ...` | `sendEvent` misuse. |
| `harness-request-id-conflict` | `Child key "<key>" already belongs to task ...` | Two `rt.createTask` calls in one phase visit used the same `key` for different definitions. |
| `harness-definition-invalid` | `defineTask(...): retry.* ...` / `abort must be a function` | Invalid `retry` policy or `abort` handler. |
| `harness-config-invalid` | `InProcessRunner heartbeatInterval must be positive and shorter than leaseDuration` | Invalid lease options. |
| `harness-config-invalid` | `Harness registry lists <key> more than once` | Duplicate `name@version` in `registry`. |
| `harness-config-invalid` | `Harness.start: in-flight tasks use task versions this registry does not register: ...` | A non-terminal task uses an unregistered `name@version`. Nothing was claimed. |
| `harness-request-id-conflict` | `requestId "<id>" already belongs to ...` | `requestId` reused for another task name or another user. |
| `harness-not-registered` | `<key> is not in this harness registry` | `createTask` with an unregistered definition. (`rt.createTask` throws the same text as `harness-definition-invalid`, which fails the task.) |
| `harness-not-registered` | `<key> is not in this harness registry; register it before retrying` | `resolveInterrupted` `retry` on a task of an unregistered version. |
| `harness-definition-invalid` | `<key>: initial phase "<x>" is not one of ...` | `initial()` returned an unknown phase. Nothing is written. A child created with `rt.createTask` fails its parent's phase without retrying, since the error is deterministic. |
| (plain `Error`) | `HarnessExtensionError` | A section, hook, or wrap threw. `message`: `Extension "<name>" <what> failed: <cause>`; `extension`: the extension name. Fails the turn or the tool call; see [Hooks](#hooks). |
| `harness-definition-invalid` | `Extension "<name>" beforeModelRequest hook must return {system, messages} or undefined` / `... beforeTool hook must return undefined, {block}, or {args}` / `... wrap of tool "<tool>" must return a defineTool tool named "<tool>"` | A hook or wrap returned the wrong shape. |
| (plain `Error`) | `HarnessSubagentError` | `rt.runAgent`: the subagent's turn failed or was aborted, or its output did not match the schema. See [Subagents (rt.runAgent)](#subagents-rtrunagent). |
| `harness-definition-invalid` | `<key>: rt.runAgent agent "<name>" is not in this harness registry` / `rt.runAgent requires non-empty input` / `rt.runAgent output for "<name>" cannot be expressed as JSON Schema` | Misuse; fails the caller (no retry). |
| `harness-definition-invalid` | `<key>: rt.approval requires a key` / `rt.approval("<key>") requires a title` / `... does not take approvers; declare them in defineTask(...)` / `... summary must be a string` / `... notify must be a function` / `... timeout must be positive` | Misuse; fails the task (no retry). |
| `harness-internal` | `Approval <id> received its event without a recorded decision` | The approval's event was sent by hand. Fails the phase. |
| `harness-approval-not-pending` | `Approval <id> is already <status>` / `... has expired` / `... is no longer pending` / `... belongs to a task that is already <status>` | `HarnessApprovalConflictError` from `decideApproval` (409 over HTTP). |
| `harness-invalid-request` | `decideApproval requires approved: true or false` / `decideApproval: a rejection requires a reason` | `decideApproval` misuse. |
| `harness-definition-invalid` | `<label>: approvals must be an object keyed by approval key` / `approval keys must be non-empty` / `approvals.<key>.approvers must be an array of permission functions` | Invalid `approvals` on `defineTask` or `defineExtension`. |
| `harness-definition-invalid` | `approvalGate: tools must list at least one tool` / `every tool must be a defineTool tool or a tool name` / `title must be a string or a function` | Invalid `approvalGate` options. |
| `harness-config-invalid` | `HarnessApp basePath must start with "/" and not end with "/": "<path>"` / `HarnessApp requires an opened Harness` / `HarnessApp heartbeatInterval must be positive` | Invalid `HarnessApp` options. |
| `harness-conversation-busy` | `Conversation <id> is busy with turn task <taskId>; ...` | `HarnessConversationBusyError`: `submit` while a turn runs or submissions are queued. `activeTurnTaskId` names the turn. |
| `harness-conversation-owned` | `Conversation <id> belongs to task <taskId>; only rt.runAgent runs its turns` | `HarnessConversationOwnedError`: `submit` / `send` on a subagent conversation (409 over HTTP). |
| `harness-invalid-request` | `submit requires non-empty content` / `submit requires a requestId` / `send whenBusy must be one of queue, steer` | `submit` / `send` misuse. |
| `harness-not-registered` / `harness-invalid-request` | `Agent "<name>" is not in this harness registry` / `Extension "<name>" is not in this harness registry` / `createConversation: an extension is listed more than once` | `createConversation` misuse. |
| `harness-definition-invalid` | `<key>: rt.output takes a string` | `rt.output` with a non-string; fails the task (no retry). |
| `harness-invalid-request` | `memo requires a non-empty key` / `memo "<key>": value is not JSON-serializable` | Memo misuse; the phase fails and retries. |
| `harness-config-invalid` | `Harness streaming.deltaFlushChars must be a positive integer` / `Harness streaming.deltaFlushInterval and deltaTtl must be positive` | Invalid `Harness.open({streaming})`. |
| `harness-config-invalid` | `` Harness.open: the registry lists agents; pass `models` to resolve them `` / `Harness.open needs a models resolver to run agents` | Agents without a model resolver. |
| `harness-wait-timed-out` | `Timed out waiting for task <id> (<key>) in status <status>` | `waitForTask` passed its `timeout`. |
| `harness-definition-invalid` | `defineTask(...)` validation errors | Empty name, non-positive or fractional version, no phases, a phase without `run`, an invalid `replay`. |

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
  `doStream`, `specificationVersion`, `provider`, `modelId`, `supportedUrls`). Turns
  stream, so `doStream` must answer (a LanguageModelV2 stream: `stream-start`,
  `text-start` / `text-delta` / `text-end`, `tool-call`, `finish`); only structured-output
  requests call `doGenerate`. The ai tests' `withGenerateStreaming` (`ai/src/tests/generateStream.ts`)
  answers `doStream` from a scripted `doGenerate`, and `gatedStreamingModel`
  (`ai/src/tests/harnessStreaming.ts`) lets a test feed text into a live request. Throw an
  `APICallError` with `statusCode` from the mock to exercise retries and fallbacks; set
  `modelRetry: {backoffMs: 0}` for speed.
- SSE: `listen(app)` and `openSse(url, {headers})` in `ai/src/tests/harnessStreaming.ts`
  run an app on a free port and parse frames as they arrive. Pass `heartbeatInterval` to
  `HarnessApp` and small `streaming` settings to `Harness.open` to keep tests fast.
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
| Event `seq`s come from a per-stream counter document incremented in the writer's transaction | The counter write serializes a stream's writers, so `seq` order is commit order and a resuming reader never skips an event committed late. |
| Task-tree events share the root task's stream, scoped by `taskPath` | One `Last-Event-ID` covers a whole subtree; a per-task stream could not be resumed across children. |
| Each event lives on exactly one stream: conversation events on the conversation, task events on the tree | No duplicate writes; a subagent's transcript is watched on its own conversation stream. |
| `delta` and `output` writes run in their own small transaction, not the phase commit | Streamed text must reach clients before the commit; the committed message remains authoritative. |
| Steering messages are stored by the request commit that sent them | The transcript keeps provider order (tool results directly after their calls); a steer that never reached a request stays queued and becomes a turn. |
| The SSE tail starts at a cluster time read before any subscriber's replay query | No gap between replay and tail; overlap is removed by `seq`. |
| One shared change stream per `HarnessApp`, not one per connection | A change stream holds a pooled connection while it waits; per-connection streams let a few dozen viewers starve commits and lease renewals. |
| Queue recovery is a sweep by the execution owner, not part of the turn's terminal commit | Starting a turn is its own transaction; the sweep (fenced, idempotent) covers the crash window between the two. |
| Writers to one stream conflict on its counter document | The price of commit-ordered `seq`s. `withTransaction` retries the loser. `InProcessRunner` (default `concurrency: 8`) and `JobsRunner` both run sibling tasks of one tree in parallel, so their writes to the shared root stream retry alongside HTTP submits, approvals, and deltas. `InProcessRunner({concurrency: 1})` avoids task-on-task contention. |
| Interruption spans start at `lease.acquiredAt` | Records when the cut-off phase began. |
| `resolveInterrupted({action: "abort"})` closes the trace as `error` | `ObsTrace.status` is `ok` or `error`; an abort is not a success. |
| `requestId` replays are scoped to the same `userId` | Stops one caller from reading another user's task through a shared key. |
| A failed commit transaction leaves the task `running` at its last checkpoint | The work may have had side effects; expired-lease recovery applies the phase's `replay` policy. |
| A retry goes back to `pending` with `runAt` instead of sleeping in the runner | The runner never holds a lease while waiting, and the backoff survives a restart. |
| Equal jitter (`[delay/2, delay]`) rather than full jitter | Keeps a guaranteed minimum backoff so a retry storm cannot start at zero delay. |
| API-misuse errors are not retried | Retrying cannot fix them; failing fast surfaces the bug. |
| `waitForTasks` suspends by committing `waiting` and re-running the phase on wake | No in-memory continuation to lose; the same machinery serves events and sleeps. |
| Wait results are recorded on the task (`waits`), keyed `<step>:<n>` without the attempt | A retry or replay of the same phase visit must return the same payload; keying by attempt would make a retry wait for a second event. |
| The inbox is its own collection (`HarnessInboxEvent`), not `HarnessEvent` | `HarnessEvent` is the SSE stream log (coalesced, TTL); inbox rows are durable inputs. |
| `sendEvent` always writes the task row (`$inc eventSeq`) | A concurrent waiting commit and send then write-conflict and one retries, so a wake cannot be lost to snapshot isolation. The waiting commit also counts buffered events in its transaction and sends itself back to `pending` when one is there. |
| Timeouts and sleeps are claimed by the runner's claim query | Same path as `runAt`: no in-process timers, survives restarts, latency of one poll. |
| Resume spans summarize the payload | Payloads may carry PHI; the inbox row holds the value. |
| Undelivered events are kept, not expired | Retention is the app's call; a TTL would silently drop inputs a later wait expects. |
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
| Hooks are registered with `hook(kind, fn)` in a `hooks` array, not a `{beforeTool: fn}` object | One extension can hold several hooks of one kind in a stated order. |
| A `{block}` reason is the tool error text verbatim | The extension author controls exactly what the model reads. |
| Tool hooks run inside the tool call's task | Their side effects and errors land on that call's `TOOL` span and outcome, and they share its replay policy. |
| Hook memos are scoped to the turn task | A tool call's task is gone after it settles; the turn outlives the request and tool re-runs, so their decisions are found again. |
| A memo write is its own small transaction that renews the lease | Durable before the phase commits (a crash keeps it); the lease write gives a real conflict with a concurrent commit, takeover, or abort, so a stale run cannot write. |
| The effective system prompt is recorded as a `system` message only when it changes | The transcript holds exactly what the model saw without one copy per request; seqs and transcripts of conversations without extensions are unchanged. |
| LLM span `input.system` is `{hash, messageSeq, sections}`, not the text | Same bounded-span rule as `messages`; the text is one transcript lookup away. |
| Tools are resolved per request and per call, not cached | Wraps and overrides stay consistent with the registry the process runs; wraps must be pure. |
| Tool resolution failures in a tool call are reported to the model | Same treatment as any tool error; the turn keeps going. |
| Approvers are declared on the definition (`defineTask({approvals})`, extension `approvals`), not passed to `rt.approval` | The API process must evaluate approvers without running the phase, including after a restart; functions cannot be stored, so they are looked up by `name@version` + `key` in the registry. |
| An approval is an event wait plus a row upserted in the waiting commit | Reuses wait idempotency (`<step>:<n>`), wake, timeout, and restart behavior; the row and the wait can never disagree. |
| The call returns the approval row's decision, not the event payload | Only a recorded decision can approve; a hand-sent event cannot. |
| Expiry is written in the timeout's transaction and is conditional on `pending` | A decision and an expiry can never both apply; the loser retries (`HarnessWaitRaceError`, at most 3 times). |
| Decisions after `expiresAt` are refused before the runner records the expiry | What the approver sees matches what the task will do. |
| An unregistered `name@version` or extension denies everyone | Fail closed; a stale API process must not fall back to a looser default. |
| The inbox evaluates approvers in memory, then pages with `{_id: {$in}}` | Approvers are code; pending sets are small; `total`, `page`, and `more` stay correct. |
| Approvals of terminal tasks stay `pending` but are hidden and undecidable | Nothing consumes them; the abort or failure is already audited. |
| Gate decisions are memoized in the turn by `toolCallId` | A replayed or re-run call does not ask twice. |
| `api.approval` exists only in `beforeTool` | Sections and `beforeModelRequest` re-run on every request; `afterTool` runs after the side effect. |
