# Implementation Plan: Durable agent harness (`@terreno/ai/harness`)

**Status:** Approved  
**Roadmap:** Area=`ai`, Target=`Next`, Impact=`Feature`  
**Branch:** `durable-agent-harness` (stacked on `cursor/ai-observability-ip-64ca`)  
**Owner:** unassigned  
**Created:** 2026-10-02  
**Task list:** [docs/tasks/durable-agent-harness.md](../tasks/durable-agent-harness.md)  
**Inspiration:** [Pi Durable](https://earendil.com/posts/pi-durable/) (concepts only; no dependency)  
**Depends on:** [ai-observability.md](./ai-observability.md) (`ObsTrace` / `ObsSpan`, `ObservabilityApp`), [job-queues.md](./job-queues.md) (`@terreno/jobs`, optional)  
**Supersedes in part:** [ai-agents-and-failover.md](./ai-agents-and-failover.md) — its `Agent` and failover ideas become harness primitives; its "no human-in-the-loop / no resume / no sub-agents" non-goals are reversed here.

## Goal

One easy-to-use harness inside `@terreno/ai` that runs long-lived agentic work durably:
deterministic multi-phase workflows, LLM agent loops, tools, subagents, human approvals,
retries, and crash recovery — all audited. It must be strong enough to build an
OpenClaw/Hermes-class personal agent, a coding agent, and a regulated clinical automation
on the same primitives.

Today a chat turn lives inside one HTTP request (`ai/src/routes/gpt.ts`), history is saved
only after the stream ends, and a crash loses the turn. `@terreno/jobs` is durable but a
job is one opaque handler with no checkpoints. The harness fills that gap.

## Non-Goals

- Depending on or wrapping `@earendil-works/pi-durable`.
- Journaled/replayed `step.run` workflows (Temporal/Inngest style). Phases only.
- Socket.io streaming for agent output. Streaming is SSE only.
- Auto-migrating in-flight runs across task versions.
- Pluggable non-Mongo storage (SQLite/JSONL/memory). Mongo for every runner.
- Field-level encryption, retention/redaction policies, e-signatures (future work).
- Changing `/gpt/prompt` behavior before Phase 4.

## Decisions

| Question | Decision |
|----------|----------|
| Build our own harness or adopt pi-durable? | Own harness on Mongo + Vercel `ai` SDK, copying Pi's concepts (tasks, checkpoints, replay-safe tools, hooks, memos, documents, compaction, forks). |
| Where should the harness live? | Inside `@terreno/ai`, as subpath `@terreno/ai/harness`. |
| How should the `@terreno/jobs` dependency be wired? | Optional peer. Jobs integration is optional; a single process can own execution. |
| Who executes a run? | Pluggable `Runner`: `InProcessRunner` (single owner, default) and `JobsRunner` (leased, multi-instance). |
| How do durable code steps resume after a crash? | Explicit phases (Pi-style `defineTask` state machine); each phase commits a checkpoint. |
| Where does state live for the single-process owner? | Mongo for both runners; switching runners needs no migration. |
| What compliance guarantees ship in v1? | Immutable step/event audit log, built on the AI observability branch's `ObsTrace` / `ObsSpan`. |
| How does the audit log relate to `ObsTrace` / `ObsSpan`? | `ObsSpan` **is** the audit log for harness work. |
| How do we guarantee a span exists for every checkpoint? | Checkpoint commit and its `ObsSpan` write happen in one Mongo transaction. Langfuse/OTel stay best-effort after commit. |
| How does this sequence against the observability branch? | Branch off `cursor/ai-observability-ip-64ca` and rebase as it lands. |
| What happens on resume when replay was not declared? | Never auto-replay. Interrupted tools are reported to the model; interrupted phases go to `interrupted`. Opt in with `replay: "safe"`. |
| Which features land in Phase 1 with the clinical tracer? | Tasks, phases, agent loop, tools + replay, retries, audit, **hooks + memos + approvals**, **subagents + ownership tree**. |
| How do clients watch runs live? | SSE only, resumable via `Last-Event-ID`; a separate submit endpoint sends input/steer. |
| How does a clinician sign off on an approval? | An approval inbox in `@terreno/admin-frontend`. |
| Who can see and act on an approval? | Per-approval `approvers` (modelRouter permission shape); inbox lists only what the user may approve; default `IsAdmin`; mountable outside admin chrome. |
| What happens to `/gpt/prompt`? | Untouched in Phase 1; rebuilt on the harness in Phase 4. |
| Where do coding-agent execution environments land? | Phase 1 defines the `ExecutionEnv` interface only; Phase 5 ships Node env, coding tools, sandbox adapter. |
| Task definition changes while runs are in flight? | Runs pin `name@version`; old versions must stay registered; startup fails loudly otherwise. |

### Recorded assumptions (low-risk, chosen by convention)

- **Interrupted model requests are re-requested.** A model call has no side effect, so a
  crash mid-stream marks the partial response aborted and the turn retries the request.
- **Model-call retries:** 429/5xx/network errors retry with exponential backoff + jitter
  (default 3 attempts), then an optional `fallbackModels` list. A thrown phase retries
  under the task's `retry` policy (default `maxAttempts: 3`); exhausted → `failed`.
- **Token deltas are persisted, coalesced** (~250 ms) as `HarnessEvent` rows with a TTL so
  any instance can serve an SSE resume. Committed messages are permanent.
- **Cross-instance SSE** tails `HarnessEvent` with a Mongo change stream (replica set is
  already required).
- **Non-local trace sinks** (Langfuse, OTel) receive the full trace once a root task is
  terminal, best-effort, via `ObservabilityApp.exportTrace`.
- **Approvals inbox filtering** evaluates `approvers` per pending approval in memory
  (pending sets are small); pagination applies after filtering.

## Architecture

```
            app code: defineTask / defineAgent / defineTool / defineExtension
                                     |
                          Harness (registry + storage)
         +-------------+-------------+--------------+----------------+
         |             |             |              |                |
     Task engine   Agent loop     Hooks/memos    Approvals       Event log
     (phases,      (built-in      (extensions)   (wait + inbox)  (SSE source)
      checkpoints,  task)
      ownership)
         |
     runtime.commit()  ── one Mongo transaction ──>  HarnessTask/Message/Memo/Event
                                                     + ObsSpan / ObsTrace (audit)
         |
       Runner:  InProcessRunner (owner lease)  |  JobsRunner (@terreno/jobs, optional)
```

### Core concepts

| Concept | What it is |
|---------|-----------|
| **Task** | Durable unit of work: `name@version`, `input`, `state`, `phase`, status, ownership. Everything (model request, tool call, workflow, subagent) is a task. |
| **Phase** | A named async function of a task. It does work and calls `rt.commit()` with the next phase or a terminal outcome. A phase is the replay boundary. |
| **Checkpoint** | The committed `{phase, state}`. Resume always starts the current phase from its checkpoint. |
| **Conversation** | A transcript plus agent config (model, instructions, tools, extensions). Root, or owned by a task (subagent). |
| **Agent** | `defineAgent` config. Running an agent = the built-in `terreno.agent.turn` task on a conversation. |
| **Tool** | `defineTool` with zod params and `replay: "safe" | "never"` (default `never`). Runs as a child task of the turn. |
| **Extension** | Named bundle of prompt sections, tools, hooks, and tool wraps. |
| **Hook** | `beforeModelRequest`, `beforeTool`, `afterTool`. Can rewrite, block, or annotate. |
| **Memo** | `rt.memo(key, value?)` — durable decision storage scoped to a task, survives restarts. |
| **Approval** | `rt.approval(key, {...})` — creates a `HarnessApproval`, waits for decision, audits the decider. |
| **Event** | Append-only `HarnessEvent` rows with per-conversation/task `seq`; the SSE source. |
| **Runner** | Decides who executes runnable tasks and when. |

### Commit and audit

`rt.commit(fn)` opens a Mongo transaction that, fenced by the task's lease token:

1. Updates `HarnessTask` (`phase`, `state`, status, `attempt`, outcome).
2. Inserts any `HarnessMessage`, `HarnessMemo`, `HarnessApproval`, `HarnessEvent` rows.
3. Inserts the `ObsSpan` for the finished work and updates the root `ObsTrace`.

If the lease token no longer matches (another owner took over) the transaction aborts and
the phase result is discarded. `Harness` construction throws when the local observability
plugin (`createLocalObservabilityPlugin`) is not registered or the connection is not a
replica set.

Span mapping: root task → `ObsTrace` + `CHAIN` root span; phase → `CHAIN`; model request →
`LLM` (usage, cost via `priceMap`); tool → `TOOL`; subagent → `AGENT`; approval decision →
`CHAIN` named `approval:<key>` with `decidedBy`, `decision`, `reason` in `output`. Spans
are never updated after insert except `endedAt`/`status` on the same commit.

### Replay and interruption

On resume, a task whose status is `running` with an expired lease was interrupted:

| Interrupted thing | `replay: "safe"` | default (`never`) |
|---|---|---|
| Phase | Re-run the phase from its checkpoint | Status `interrupted`; await `resolveInterrupted` (`retry` / `abort` / `complete`) |
| Tool call | Re-run the tool | Tool result = "interrupted, not retried"; agent loop continues |
| Model request | Always re-requested (assumption above) | — |

### Runners

| Runner | Ownership | Use |
|---|---|---|
| `InProcessRunner` (default) | One process holds the `HarnessOwner` lease (heartbeat). A second process gets `standby` and takes over on lease expiry. Polls runnable tasks; wakes on `runAt` and events. | Local agents, single-instance apps, tests |
| `JobsRunner` (`@terreno/ai/harness/jobsRunner`, optional peer `@terreno/jobs`) | Each runnable phase → job `terreno.harness.phase`, idempotency key `taskId:phase:attempt`. Handler acquires the task lease (fenced, heartbeat) and runs one phase. The task lease, not the job lock, is the authority. | Multi-instance Cloud Run |

### Ownership tree

Tasks are owned by a conversation or a task. `abort(taskId)` aborts owned tasks
bottom-up, running each task's `abort` handler (compensations) before marking it
`aborted`. `background: true` tasks belong to a conversation but are not part of its
current turn; a turn abort leaves them running.

### Versioning

Each task records `name` + `version`. The runner only resumes a task on a registered
handler for exactly that version. `Harness.start()` scans non-terminal tasks and throws
listing every unregistered `name@version`.

## Models

All in `ai/src/harness/models/`, types in `ai/src/types/harness.ts`. Every field has
`description`; `strict: "throw"`.

| Model | Key fields |
|---|---|
| `HarnessTask` | `name`, `version`, `input`, `state`, `phase`, `status` (`pending` \| `running` \| `waiting` \| `interrupted` \| `completed` \| `failed` \| `aborted`), `ownership {kind: conversation\|task\|root, id}`, `background`, `attempt`, `retry {maxAttempts, backoffMs, maxBackoffMs}`, `runAt`, `lease {owner, token, expiresAt}`, `waiting {kind: event\|tasks\|sleep, key, taskIds, policy, timeoutAt}`, `outcome {status, result, error}`, `traceId`, `rootTaskId`, `requestId` (unique sparse), `userId` |
| `HarnessConversation` | `ownership`, `agent {name, model, instructions, tools[], extensions[]}`, `status` (`idle` \| `busy`), `activeTurnTaskId`, `queued[]`, `userId`, `seq` |
| `HarnessMessage` | `conversationId`, `seq`, `role`, `parts[]`, `toolCallId`, `toolName`, `turnTaskId`, `aborted` |
| `HarnessMemo` | `taskId`, `key`, `value` — unique `(taskId, key)` |
| `HarnessApproval` | `taskId`, `rootTaskId`, `definitionKey` (`name@version:key`), `title`, `summary`, `payload`, `status` (`pending` \| `approved` \| `rejected` \| `expired`), `decidedBy`, `decidedAt`, `reason`, `expiresAt` |
| `HarnessEvent` | `streamId` (conversation or task), `seq`, `type`, `payload`, TTL for `delta` events |
| `HarnessOwner` | singleton lease for `InProcessRunner`: `owner`, `expiresAt` |

## APIs

### Library (`@terreno/ai/harness`)

```typescript
import {
  Harness, defineTask, defineAgent, defineTool, defineExtension, hook, section,
  approvalGate, InProcessRunner,
} from "@terreno/ai/harness";

const summarizer = defineAgent({
  name: "clinic.summarizer",
  model: {provider: "anthropic", modelId: "claude-sonnet-5-5"},
  instructions: "Summarize the chart for a clinician. Cite sources.",
  tools: [],
  fallbackModels: [{provider: "anthropic", modelId: "claude-haiku-4-5-20251001"}],
});

const intakeSummary = defineTask<{patientId: string}, IntakeState, {status: string}>({
  name: "clinic.intakeSummary",
  version: 1,
  initial: () => ({phase: "fetch"}),
  retry: {maxAttempts: 3},
  phases: {
    fetch: {
      replay: "safe",
      run: async (task, rt) => {
        const chart = await ehr.getChart(task.input.patientId);
        await rt.commit({phase: "summarize", state: {chart}});
      },
    },
    summarize: {
      replay: "safe",
      run: async (task, rt) => {
        const summary = await rt.runAgent(summarizer, {input: task.state.chart, output: SummarySchema});
        await rt.commit({phase: "review", state: {...task.state, summary}});
      },
    },
    review: {
      replay: "safe",
      run: async (task, rt) => {
        // Approvers are declared on the definition: approvals: {"clinician-signoff": {approvers: [Permissions.IsAdmin, isClinician]}}
        const decision = await rt.approval("clinician-signoff", {
          title: "Sign off intake summary",
          payload: task.state.summary,
          timeout: {hours: 24},
        });
        await rt.commit(decision.approved ? {phase: "write"} : {terminal: {status: "completed", result: {status: "rejected"}}});
      },
    },
    write: {
      // default replay: "never" — an interrupted EHR write goes to `interrupted`
      run: async (task, rt) => {
        await ehr.writeNote(task.input.patientId, task.state.summary, {idempotencyKey: `note-${task.id}`});
        await rt.commit({terminal: {status: "completed", result: {status: "filed"}}});
      },
    },
  },
  abort: async (task, rt) => { /* compensations */ },
});

const harness = await Harness.open({
  models: createModelFn,
  registry: [intakeSummary, summarizer, ClinicExtension],
  runner: new InProcessRunner(),
});
await harness.start();
const run = await harness.createTask(intakeSummary, {patientId}, {requestId: `intake-${patientId}`});
```

Runtime (`rt`) surface in Phase 1: `commit`, `memo`, `runAgent`, `createTask`,
`waitForTasks(ids, {policy: "all" | "failFast"})`, `waitFor(event, {timeout})`,
`sleep(duration)`, `approval`, `output` (stream text to the event log), `signal`, `env`
(`ExecutionEnv`, interface only in Phase 1).

Harness surface: `open`, `start`, `stop`, `createTask`, `conversation(id)`,
`createConversation`, `sendEvent(taskId, event, payload)`, `abort(taskId)`,
`resolveInterrupted(taskId, action)`.

### HTTP (`HarnessApp` plugin)

| Method | Path | Behavior |
|---|---|---|
| POST | `/harness/conversations/:id/submit` | instanceAction. `{content, requestId, whenBusy: "queue" \| "steer"}`; idempotent on `requestId` |
| GET | `/harness/conversations/:id/events` | SSE; honors `Last-Event-ID`; replays then tails |
| GET | `/harness/tasks/:id/events` | SSE for a task subtree |
| POST | `/harness/tasks/:id/abort` | instanceAction; owner or admin |
| POST | `/harness/tasks/:id/resolveInterrupted` | instanceAction; admin; `{action: "retry" \| "abort" \| "complete", reason}` |
| GET | `/harness/approvals` | list pending approvals the caller may approve |
| POST | `/harness/approvals/:id/approve` \| `/reject` | instanceActions; `{reason}` (required on reject); audited span |

SSE is a listed exception to the modelRouter-actions rule; everything else is
`modelRouter` collection/instance actions.

## Notifications

None in Phase 1. `rt.approval` accepts an optional `notify` callback so apps can send via
`@terreno/comms`; the harness does not depend on comms.

## UI

- **Approvals inbox** (`@terreno/admin-frontend`, `widgets/harness/`): list of pending
  approvals (title, task, age, expires), detail with `payload` rendered as JSON/markdown,
  Approve / Reject with reason. Registered as admin custom screen `harness-approvals`
  (group "AI Harness"), and exported as `HarnessApprovalInbox` for mounting outside admin
  chrome. Uses `@terreno/ui` only.
- **Runs screen** (Phase 2): task list/tree, status filters, abort, resolve interrupted.
- Spans render in the existing observability Traces screens.

## Phases

| Phase | Ships | Proof |
|---|---|---|
| **1 — Durable clinical tracer** | Engine, phases, checkpoints, `InProcessRunner`, transactional `ObsSpan` audit, replay semantics, retries, agent loop, tools, subagents + ownership tree, extensions/hooks/memos, waits/events, approvals + inbox, SSE + submit, version pinning, example-backend `clinic.intakeSummary` | Crash-and-resume e2e; inbox Playwright screenshots; span tree assertions |
| **2 — Multi-instance** | `JobsRunner`, two-worker fencing, Runs admin screen | Two-process race tests; screenshots |
| **3 — Long context** | Background compaction, `reset`/handoff, conversation forks, `defineDoc` documents (rewindable, fork `asOf`) | Bun tests on 10k-message conversations; fork isolation tests |
| **4 — Durable chat + multiplayer** | `/gpt` rebuilt on harness, `GptHistory` mapping, steering, foreground/background abort, `viewState` over SSE, rtk `useHarnessConversation`, `GPTChat` adapter | Kill backend mid-chat, reconnect resumes; two clients see same view |
| **5 — Coding agents + malleability** | `NodeExecutionEnv`, `CodingTools` (read/write/edit/bash), remote sandbox adapter, registry hot-replace | Coding agent fixes a failing test in a fixture repo after a crash |

## Feature Flags & Migrations

- No feature flag; the harness is opt-in by registering `HarnessApp`.
- New collections only. Phase 4 adds a migration mapping `GptHistory` → `HarnessConversation`/`HarnessMessage` (human gate at Phase 4 start: keep dual-read or one-shot migrate).

## Activity Log & User Updates

Audit lives in `ObsSpan`. Changelog entry per phase in `changelog/`.

## Not Included / Future Work

Field encryption, retention/redaction, e-signature approvals, Socket.io streaming,
non-Mongo storage, journaled steps, in-flight version migration.

## Files to Create / Modify

| Path | Change |
|---|---|
| `ai/src/harness/` | new: `harness.ts`, `defineTask.ts`, `runtime.ts`, `commit.ts`, `agentLoop.ts`, `defineAgent.ts`, `defineTool.ts`, `extensions.ts`, `approvals.ts`, `events.ts`, `modelCall.ts`, `runners/inProcessRunner.ts`, `runners/jobsRunner.ts`, `harnessApp.ts`, `routes/*.ts`, `models/*.ts` |
| `ai/src/types/harness.ts` | new model + API types |
| `ai/package.json` | `./harness`, `./harness/jobsRunner` exports; optional peer `@terreno/jobs` |
| `admin-frontend/src/widgets/harness/` | new approvals inbox (Phase 1), runs screen (Phase 2) |
| `example-backend/src/harness/` | `clinic.intakeSummary`, fake EHR, registration in `server.ts` |
| `example-frontend` | admin route for inbox; `bun run sdk` |
| `docs/explanation/durable-agent-harness.md` | new |
| `docs/reference/ai-harness.md` | new |
| `docs/how-to/build-a-durable-workflow.md` | new |
| `docs/reference/ai.md`, `docs/reference/admin-frontend.md` | link + inbox section |

## Task List

[docs/tasks/durable-agent-harness.md](../tasks/durable-agent-harness.md)

## Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| AC1 | A two-phase task runs to completion and every checkpoint has exactly one `ObsSpan`, written in the same transaction | bun test: abort the transaction mid-commit → neither task update nor span exists |
| AC2 | Killing the owner mid-run resumes from the last checkpoint on a fresh `Harness` | bun test: throw-on-signal simulation + new harness instance; e2e: kill example-backend during `summarize`, restart, run completes |
| AC3 | Default-replay phases and tools never re-run after interruption; `replay: "safe"` ones do | bun test matrix over phase/tool × replay |
| AC4 | Thrown phases retry with backoff and land `failed` after `maxAttempts`; model 429/5xx retries then falls back | bun test with fake model provider |
| AC5 | Aborting a root task aborts owned subtasks bottom-up and runs `abort` handlers | bun test ordering assertion |
| AC6 | `beforeTool` hook can block a tool; memo decision survives restart | bun test |
| AC7 | `rt.approval` blocks until a permitted user approves; unpermitted users get 403 and do not see it in the inbox; decision span records `decidedBy` | supertest |
| AC8 | Approvals inbox lists, approves, and rejects in admin-frontend | Playwright run with screenshots in `/opt/cursor/artifacts/` |
| AC9 | SSE reconnect with `Last-Event-ID` replays missed events exactly once, from any instance | bun test with two `HarnessApp` instances on one replica set |
| AC10 | Starting with an in-flight unregistered `name@version` throws listing it | bun test |
| AC11 | `JobsRunner`: two workers never run the same phase concurrently; stale lease owner's commit is rejected | bun test (Phase 2) |
| AC12 | Docs explain, reference, and how-to every public API in the slice that ships it | `docs-audit` skill run shows no undocumented harness exports; Roast reads each page against the shipped API |
