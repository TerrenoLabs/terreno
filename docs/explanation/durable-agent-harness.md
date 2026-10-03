# Durable agent harness

`@terreno/ai/harness` runs long-lived work so that a crash, deploy, or restart never loses
it. Work is split into **phases**. Each finished phase commits a **checkpoint**, and the
same Mongo transaction writes its audit span. API: [AI harness reference](../reference/ai-harness.md).
Design lock: [implementation plan](../implementationPlans/durable-agent-harness.md).

## Why phases, not one long handler

A chat turn in `/gpt/prompt` lives inside one HTTP request. A `@terreno/jobs` job is one
opaque handler. Neither can stop halfway and pick up where it left off.

A harness task is a small state machine. A phase does some work, then calls
`rt.commit()` with the next phase or a terminal outcome. Work that was already committed
never runs again. After a crash, a fresh process restarts the **current phase** from its
last checkpoint, or parks it for a human when re-running is not safe (see
[Leases and crash resume](#leases-and-crash-resume)).

The harness does not journal and replay individual steps (Temporal/Inngest style). The
phase is the only replay boundary, so the unit to reason about is "what happens if this
phase runs twice?" A phase declares the answer with `replay` (`"safe"` or the default
`"never"`).

## Core concepts

| Concept | What it is |
| --- | --- |
| **Task** | Durable unit of work: `name@version`, `input`, `state`, `phase`, status, ownership. Model requests, tool calls, workflows, and subagents are all tasks. |
| **Phase** | A named async function of a task. It does work and calls `rt.commit()` with the next phase or a terminal outcome. A phase is the replay boundary. |
| **Checkpoint** | The committed `{phase, state}`. Resume always starts the current phase from its checkpoint. |
| **Conversation** | A transcript plus agent config (model, instructions, tools, extensions). Root, or owned by a task (subagent). |
| **Agent** | `defineAgent` config. Running an agent runs the built-in `terreno.agent.turn` task on a conversation. |
| **Tool** | `defineTool` with zod params and `replay: "safe" \| "never"` (default `never`). Runs as a child task of the turn. |
| **Extension** | Named bundle of prompt sections, tools, hooks, and tool wraps. |
| **Hook** | `beforeModelRequest`, `beforeTool`, `afterTool`. Can rewrite, block, or annotate. |
| **Memo** | `rt.memo(key, value?)`: durable decision storage scoped to a task. Survives restarts. |
| **Approval** | `rt.approval(key, {...})`: creates a `HarnessApproval`, waits for a decision, audits the decider. |
| **Event** | Append-only `HarnessEvent` rows with a per-stream `seq`. The SSE source. |
| **Runner** | Decides who executes runnable tasks and when. |

Shipped today: tasks, phases, checkpoints, the transactional audit span, the
`InProcessRunner` with owner and task leases, crash resume, `resolveInterrupted`, phase
retries, child tasks with `rt.waitForTasks`, and `harness.abort` over the ownership tree.
The other rows are the planned shape for later Phase 1 slices.

## Why the audit span shares the checkpoint transaction

Regulated work (clinical automation is the reference case) needs proof of every step.
`ObsSpan` from [AI observability](ai-observability.md) **is** the harness audit log, so
the admin Traces screens show harness runs with no extra UI.

A best-effort span written after the checkpoint could go missing on a crash. That would
leave a committed step with no audit record. So `rt.commit()` writes, in **one** Mongo
transaction:

1. The `HarnessTask` update: next `phase` and `state`, or the terminal `outcome`.
2. One `CHAIN` span for the finished phase, parented to the task's root span.
3. On a terminal commit, the closed root span and root `ObsTrace`.

Either all three land or none do. This is why `Harness.open` refuses to start without a
replica set (transactions need one) or without the local observability models. Planned
Langfuse and OTel exports will stay best-effort, after the transaction.

```
createTask ──tx──> HarnessTask(pending) + ObsTrace + root CHAIN span
phase "fetch" ── rt.commit ──tx──> task.phase=summarize + CHAIN span "fetch"
phase "summarize" ── rt.commit ──tx──> task.status=completed + CHAIN span "summarize"
                                       + root span / trace closed
```

## Leases and crash resume

A process can die at any moment, and a frozen process can wake up later and keep going.
Two leases make both cases safe.

| Lease | Question it answers | Granularity |
| --- | --- | --- |
| **Owner lease** (`HarnessOwner`) | Which process drains tasks right now? | One per database |
| **Task lease** (`HarnessTask.lease`) | Which run of this phase may commit? | One per running phase, with a random fencing `token` |

Both expire unless their holder renews them on a heartbeat. A second process starts on
**standby** and becomes owner once the owner lease expires (or at once, when the owner
stops cleanly).

The owner lease is about efficiency: one drainer, no claim storms. The **task token** is
about correctness. Every commit is fenced on the token, so a runner that lost its lease
(it froze past expiry and someone else took over) is rejected with
`HarnessCommitConflictError` and writes nothing, even if two processes briefly both think
they own execution.

```
process A: claim (token t1) ── phase runs ── A freezes ......... A wakes: commit(t1) ✗ rejected
process B:   standby ........ A's leases expire ── takeover ── recover: phase replay
                                                              claim (token t2) ── commit(t2) ✓
```

### Replay is a per-phase promise

When a new owner finds a `running` task whose lease expired, it cannot know how far the
phase got. The phase's `replay` says what is safe:

- `replay: "safe"`: the phase can run again from its checkpoint (reads, idempotent writes).
  The task goes back to `pending` and runs again.
- default `replay: "never"`: the phase might have done something that must not happen
  twice (an EHR write, a payment). The task becomes `interrupted` and stops.

The harness never guesses. An operator looks at the external system and calls
`resolveInterrupted` with `retry` (run the phase again), `abort` (give up), or `complete`
(it already happened; record the result), plus a reason. That decision is audited like
any other step.

Every interruption also writes an error `CHAIN` span in the same transaction as the status
change, so the trace shows exactly which phase was cut off and what happened next.

## Retries: a thrown phase is not a crash

A crash and a throw look different to the harness. A crash (expired lease) means "we do
not know how far the phase got", so `replay` decides. A throw means the phase code itself
said "this attempt failed", so the task's `retry` policy decides: back to `pending` at the
same checkpoint, with `runAt` pushed out by exponential backoff and jitter, until
`maxAttempts` runs are used up and the task ends `failed`.

Jitter matters because failures cluster. When an EHR goes down, every task that called it
fails within the same second. Without jitter they would all retry at the same instant and
knock it over again. Each retry waits a random delay between half and all of its backoff.

A retry re-runs the whole phase, so a phase that throws after a side effect repeats it.
Throw before the side effect, or make it idempotent. Programming errors (committing to an
unknown phase, forgetting to commit) fail at once: retrying cannot fix them.

## The ownership tree

Tasks form a tree. A phase calls `rt.createTask` to start a child. The child records
`ownership: {kind: "task", id: parent}` and shares the parent's `rootTaskId` and trace, so
its spans nest under the parent's span and the whole tree reads as one trace.

```
root task (trace)
├── child A ── grandchild A1
└── child B
```

### Waiting on children without holding a lease

A parent that needs its children's results calls `rt.waitForTasks(ids)`. The harness
does not keep the parent's phase suspended in memory. That would hold a lease for as long
as the children take, and a crash would lose the in-memory continuation anyway. Instead
the parent commits `waiting`, gives up its lease, and its phase stops. When the children
settle, the parent goes back to `pending` and its phase **runs again from its
checkpoint**. This time `waitForTasks` finds the children settled and returns their
outcomes at once.

That re-run is why `rt.createTask` is idempotent within one attempt of a phase visit: the
second run gets the children the first run created, not duplicates. A retry is a fresh
attempt, so it starts fresh children. It also means work before the
wait runs twice, so keep it to reads and child creation, and do side effects in a later
phase. Events and sleeps (a later slice) use the same "commit `waiting`, re-run on wake"
shape.

`policy: "failFast"` resolves at the first failed or aborted child and aborts the
siblings still in flight. Use it when one failure makes the rest pointless (for example,
the allergy check failed, so the dosing calculation should stop).

### Abort runs bottom-up

`harness.abort(taskId)` stops a task and everything it owns. Order matters for
compensation: a parent's `abort` handler often undoes what it set up for its children, so
it must run after they have stopped and undone their own work. The harness:

1. Fences the whole subtree, top-down. Aborting tasks are never claimed again, and a
   running phase loses its lease token, so nothing it does afterwards can commit. Its
   `rt.signal` aborts so it can stop early.
2. Walks the tree **deepest first**. For each task it runs the `abort` handler, then
   commits `aborted` with an audit span.

Concurrent aborts of one task (an operator and a `failFast` sibling abort, say) run its
handler once. A failing handler does not stop the abort. A half-aborted tree would be worse than a
missed compensation, and the span records the failure for a human to follow up.

`background: true` marks a child that belongs to its owner but not to the owner's current
conversation turn. Conversations (a later slice) use it so that aborting a turn leaves
background work running.

## Runners

The engine stores everything in Mongo. A **runner** only decides who executes runnable
tasks. Switching runners needs no data migration.

| Runner | Status | Ownership |
| --- | --- | --- |
| `InProcessRunner` | Shipped | One process holds the `HarnessOwner` lease and drains `pending` tasks one at a time; others wait on standby and take over on lease expiry. |
| `JobsRunner` | Planned (Phase 2) | Each runnable phase becomes a `@terreno/jobs` job. The task lease is the authority. |

## Version pinning

Each task records `name` and `version`. A runner only claims tasks whose exact
`name@version` is in its registry. A process that registers only `v2` leaves `v1` rows
alone. Keep old versions registered until their in-flight tasks finish.
