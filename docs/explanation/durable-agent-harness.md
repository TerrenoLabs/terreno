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
never runs again. Crash resume (planned, with owner leases) restarts the **current phase**
from its last checkpoint. Today a task cut off mid-phase stays `running` at that
checkpoint until resume ships.

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

Shipped today: tasks, phases, checkpoints, the transactional audit span, and the
`InProcessRunner`. The other rows are the planned shape for later Phase 1 slices.

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

## Fencing

A commit only applies if the task is still `running` at the phase it started from. If
something else moved the checkpoint first, the commit aborts with
`HarnessCommitConflictError` and the phase result is discarded. Owner and task leases
build on this fence: the lease token joins the same filter.

## Runners

The engine stores everything in Mongo. A **runner** only decides who executes runnable
tasks. Switching runners needs no data migration.

| Runner | Status | Ownership |
| --- | --- | --- |
| `InProcessRunner` | Shipped (no lease yet) | Polls `pending` tasks in this process, one at a time, and runs phases until the task stops. |
| `InProcessRunner` with `HarnessOwner` lease | Planned | One process holds the owner lease. A second process waits on standby. |
| `JobsRunner` | Planned (Phase 2) | Each runnable phase becomes a `@terreno/jobs` job. The task lease is the authority. |

## Version pinning

Each task records `name` and `version`. A runner only claims tasks whose exact
`name@version` is in its registry. A process that registers only `v2` leaves `v1` rows
alone. Keep old versions registered until their in-flight tasks finish.
