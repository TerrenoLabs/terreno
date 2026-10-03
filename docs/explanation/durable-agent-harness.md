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
retries, child tasks with `rt.waitForTasks`, `harness.abort` over the ownership tree,
agents, tools, and conversations (see [The agent loop](#the-agent-loop)), subagents, and
extensions, hooks, and memos (see [Extensions, hooks, and memos](#extensions-hooks-and-memos)).
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
phase. Events and sleeps use the same "commit `waiting`, re-run on wake" shape.

### Waiting for the outside world: events and sleeps

`rt.waitFor(event, {timeout})` pauses a task until something outside it happens: a
webhook, an operator decision, a lab result. `rt.sleep(duration)` pauses it for a fixed
time. Neither holds a lease while it waits.

`harness.sendEvent(taskId, event, payload)` writes the event to the task's **inbox**
before it does anything else. So the sender never has to know where the task is:

- If the task is already waiting on that event, the same transaction sends it back to
  `pending`.
- If it has not reached the wait yet, the event stays buffered until it does.
- If no runner is up, the event is still stored, and the task resumes once one starts.

A timeout or a sleep is a `timeoutAt` on the wait. The runner claims a waiting task whose
`timeoutAt` has passed the same way it claims a retry whose `runAt` has passed. There is
no timer to lose in a crash.

When the phase re-runs, each wait call must return the same thing it returned before. The
harness records how each call resolved on the task, keyed by the phase visit and the
call's position, together with the event it received. A later run of that phase visit (a
retry, a crash replay, the wake for the next wait) reads the record and does not take
another event. A timeout is recorded too, so an event that arrives after the timeout can
never turn an earlier `undefined` into a payload.

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
alone. Keep old versions registered until their in-flight tasks finish. `Harness.start()`
refuses to start while any non-terminal task uses a version the registry lacks, so a
deploy that drops a version too early fails loudly instead of stranding work. See
[Ship a new task version](../how-to/ship-a-new-task-version.md).

## The agent loop

An agent turn is not special machinery. It is an ordinary registered task,
`terreno.agent.turn@1`, owned by its conversation, so everything above (leases, replay,
retries, the ownership tree, abort, version pinning) applies to it unchanged.

```
submit ──tx──> user message + conversation busy + turn task (pending)

turn: request ──tx──> assistant message + LLM span ──┐ tool calls?
        ▲                                            ▼
        └──tx── tool messages <── waitForTasks <── tools: one child task per call
                                                     (each call = TOOL span)
      request with no tool calls ──tx──> completed; conversation idle
```

### Two phases, both safe to replay

- **`request`** calls the model. A model call has no side effect, so if the process dies
  mid-call the phase simply runs again. Nothing from the cut-off call was written: the
  assistant message is only stored in the same transaction as the checkpoint.
- **`tools`** starts one child task per tool call and waits for all of them. Children
  are found again by key on a re-run, so a replay never doubles a call.

The side effects live in the tools, and each tool says whether it may run twice.

### Interrupted tools are reported, not hidden

A tool with the default `replay: "never"` might have done its work before the crash (a
note written, a message sent). The harness cannot know. Parking the call for an operator
would freeze the whole conversation, so instead the call ends with the result
"Interrupted, not retried" and the loop goes on. The model sees that result and can check
or ask the user. A tool marked `replay: "safe"` (a read, an idempotent write) just runs
again.

### Retries belong to the model call

Providers fail in two ways. Overload and outages (429, 5xx, dropped connections) usually
pass, so the `request` phase retries them with backoff and jitter, then tries each
fallback model. Anything else (a 400 for a bad prompt, a 401 for a bad key) will fail the
same way every time, so the turn fails at once instead of burning retries and fallbacks.
Every attempt is listed on the `LLM` span, so the audit shows which model answered and
what failed before it.

### Why the transcript shares the checkpoint transaction

The same rule as phase spans: a message written outside the commit could survive a crash
whose checkpoint did not, and the next request would replay a half-finished step. Each
commit writes the messages, the `LLM` span, and the checkpoint together, and each message
takes its `seq` from a counter on the conversation inside that transaction. The
transcript is therefore always exactly what the committed phases produced.

API: [Agents and conversations](../reference/ai-harness.md#agents-and-conversations).


## Subagents

A workflow often needs one focused model job inside a larger, deterministic flow:
summarize this chart, classify that note. `rt.runAgent` runs that job as a **subagent**
and returns its answer to the phase, as text or as a schema-checked object.

A subagent is built from parts that already exist, not new machinery:

```
caller phase ──tx──> subagent conversation (owned by the caller)
                     + user message
                     + turn task (child of the caller; AGENT span)
             ──> waitForTasks([turn]) ── caller waits, holds no lease

turn: request / tools ... ──tx──> completed ── wakes the caller

caller phase re-runs ──> same call finds the same turn ──> returns its answer
```

- **The conversation is owned by the task.** It is a normal transcript, so the
  subagent's prompt, answer, and tool results are kept and auditable like any chat.
- **The turn is a child task.** Waiting, waking, crash recovery, and abort all come from
  the ownership tree. Aborting the caller aborts the subagent's turn first.
- **The call is found again, not repeated.** The phase re-runs from its checkpoint after
  the wait. Each `runAgent` call has a key from its position in the phase, so the re-run
  finds the conversation and turn it created and gets the stored result. The
  conversation, its first message, and the turn are created in one transaction, so a
  crash can never leave one without the others.

### Why the caller checks the structured output

The schema is a zod object in the caller's code, and code cannot be stored. The turn
gets a JSON Schema copy: enough to ask the provider for JSON and to reject an answer that
is not JSON at all. Rules JSON Schema cannot carry (refinements, transforms) are checked
when the caller gets the result, with the real schema. An invalid answer fails the call,
and the caller's retry policy decides whether to ask again.

### Why only phases call subagents

A phase that waits re-runs from its checkpoint, and phases are written for that. A tool's
`execute` is not: re-running it from the top would repeat whatever it did before the
call. Tools therefore cannot call `runAgent`. A phase can run several subagents, one
after another; for parallel fan-out, start one child task per subagent and wait on all
of them.

API: [Subagents (rt.runAgent)](../reference/ai-harness.md#subagents-rtrunagent).

## Extensions, hooks, and memos

Apps need to shape an agent without forking it: add a policy paragraph to the prompt,
refuse a dangerous tool call, redact a result, log every chart lookup. An **extension**
bundles those changes under a name, and agents and conversations list the extensions
they use. Extensions are code in the registry; a conversation stores only their names.

```
request phase                         tool call task (child of the turn)
  instructions + sections ─┐            args ──> beforeTool ──┬─ {block} ──> error result
  beforeModelRequest ──────┤                                  └─ {args} ──> execute (wrapped)
  model call               │                                                 │
  commit: [system prompt   │                                            afterTool
          if changed] +    │                                                 │
          assistant + LLM  │            commit: tool result + TOOL span <────┘
```

### Hooks fail the step they run in

A hook is part of the step that runs it, so it fails like that step's own code. A
throwing `beforeModelRequest` hook or section fails the turn, as a model that never
answers would. A throwing tool hook fails the tool call, and the model gets the error
like any other tool failure and decides what to do. Nothing is retried: a hook that
failed once usually fails again, and a retry would call the model or the tool twice.

### Blocking is a tool result, not an exception

`beforeTool` returning `{block: reason}` does not stop the turn. The tool never runs and
the model receives `reason` as an error result. The model can then explain, ask for
something else, or stop. This keeps the transcript honest (every tool call has a result)
and lets policy code refuse without knowing how the turn continues.

### Sections are rebuilt, and recorded, every request

Sections are functions, so the prompt can change between requests: fresh vitals, a
policy that depends on the time of day. That makes "what did the model see?" a real
question for audit and resume. The turn answers it in the transcript: whenever the
effective system prompt differs from the last one recorded, the request's commit appends
a `system` message holding the exact text, and the `LLM` span points to it by hash and
seq. A prompt that does not change is recorded once, so long turns do not copy it into
every span.

### Later extensions win, and wraps decorate the winner

Tool names are resolved in a fixed order: the agent's tools, then each extension's, with
a later tool of the same name replacing an earlier one. Wraps apply after that, to the
tool that won. An audit wrap therefore keeps working when another extension swaps in a
different implementation of the tool it watches.

### Memos make a decision once

Phases and tool calls may run more than once (replay, retry, a second process after a
crash). A decision that must not change, such as "this call was approved" or "route to
the cardiology queue", goes in `rt.memo(key, value)`. The first write wins, atomically,
across concurrent calls and processes; every later call gets the stored value back. A
memo write commits on its own, fenced by the run's lease, so a crash right after the
decision still keeps it. Hook memos are scoped to the turn task: the turn outlives its
request re-runs and its tool calls, so their decisions are found again.

API: [Extensions](../reference/ai-harness.md#extensions), [Hooks](../reference/ai-harness.md#hooks), [Memos](../reference/ai-harness.md#memos).
