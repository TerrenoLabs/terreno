# Tasks: Durable agent harness

IP: [durable-agent-harness.md](../implementationPlans/durable-agent-harness.md)  
**Feature profile:** false (full IP)  
**Base branch:** `cursor/ai-observability-ip-64ca` (rebase as it lands)  
**First PR scope:** Phases 1–2. Phases 3–5 ship in follow-up PRs.

Every task: bun tests in `ai/` against the in-memory replica set from `@terreno/test`; real
models are replaced by the mock model pattern in `.claude/rules/ai/00-ai.md`. Docs pages are
created in 1.1 and extended by every later task — never deferred.

## Phase 1 — Durable clinical tracer

- [x] **Task 1.1**: Harness subpath + `defineTask` + transactional checkpoint/span (tracer)
  - Delivers: `@terreno/ai/harness` export; `HarnessTask` model; `defineTask` with phases; `InProcessRunner` (no lease yet) runs a two-phase task to `completed`; `rt.commit` writes task + `ObsSpan` + root `ObsTrace` in one transaction; `Harness.open` throws without local observability plugin or without a replica set
  - Files: `ai/package.json`, `ai/src/harness/harness.ts`, `defineTask.ts`, `runtime.ts`, `commit.ts`, `runners/inProcessRunner.ts`, `models/harnessTask.ts`, `ai/src/types/harness.ts`, tests
  - Blocked by: none
  - Skills: `terreno-backend-api`, `mongoose-schema-safety`, `backend-test-env`
  - Docs: create `docs/explanation/durable-agent-harness.md` (concepts table), `docs/reference/ai-harness.md` (`defineTask`, `Harness.open`, `rt.commit`), link from `docs/reference/ai.md`
  - Acceptance: AC1 — bun test asserts one CHAIN span per phase; forced throw inside the transaction leaves neither task update nor span

- [x] **Task 1.2**: Owner lease, crash resume, replay semantics
  - Delivers: `HarnessOwner` lease + heartbeat; standby second process; task leases with fencing token; resume on `start()`; per-phase `replay`; `interrupted` status; `harness.resolveInterrupted(taskId, action)`
  - Files: `runners/inProcessRunner.ts`, `models/harnessOwner.ts`, `runtime.ts`, `commit.ts`, tests
  - Blocked by: 1.1
  - Skills: `terreno-backend-api`, `backend-test-env`
  - Docs: reference "Replay and interruption" table; explanation section on leases
  - Acceptance: AC2 + AC3 (phase rows) — simulate death by abandoning a harness mid-phase with an expired lease; new harness resumes safe phase and parks `never` phase as `interrupted`; stale-token commit rejected

- [x] **Task 1.3**: Retries, failure, abort + ownership tree
  - Delivers: task `retry` policy with backoff+jitter (Luxon), `failed` after `maxAttempts`; `rt.createTask` child ownership; `harness.abort` bottom-up with `abort` handlers; `rt.waitForTasks` (`all` / `failFast`); `background` flag
  - Files: `runtime.ts`, `retryBackoff.ts`, `ownership.ts`, tests
  - Blocked by: 1.2
  - Skills: `terreno-backend-api`
  - Docs: reference retry/abort/ownership; explanation ownership tree
  - Acceptance: AC4 (phase retries) + AC5 — ordering assertion on abort handlers; `failFast` aborts siblings

- [ ] **Task 1.4**: Agents, conversations, tools, model-call resilience
  - Delivers: `defineAgent`, `defineTool` (zod params, `replay`), `HarnessConversation` + `HarnessMessage`; built-in `terreno.agent.turn` task (`request` ⇄ `tools` phases, `maxSteps`); tools run as child tasks; interrupted `never` tools reported to the model; model calls retry 429/5xx then `fallbackModels`; interrupted model requests re-requested; LLM/TOOL spans with usage/cost; `ExecutionEnv` interface (types only) on `rt.env`
  - Files: `defineAgent.ts`, `defineTool.ts`, `agentLoop.ts`, `modelCall.ts`, `executionEnv.ts`, `models/harnessConversation.ts`, `models/harnessMessage.ts`, tests
  - Blocked by: 1.3
  - Skills: `terreno-backend-api`, `claude-api` (model ids), `ai-prompt-governance`
  - Docs: reference agents/tools/model resilience; explanation agent loop
  - Acceptance: AC3 (tool rows) + AC4 (model rows) — mock model returns 503 twice then succeeds; fallback used after exhaustion; span tree CHAIN→LLM→TOOL

- [ ] **Task 1.5**: Subagents
  - Delivers: `rt.runAgent(agent, {input, output})` creates a task-owned child conversation, idempotent on resume (finds existing by `ownerTaskId`), returns parsed structured output; AGENT span nests the child's spans
  - Files: `runtime.ts`, `agentLoop.ts`, tests
  - Blocked by: 1.4
  - Skills: `terreno-backend-api`
  - Docs: reference `runAgent`; explanation subagents
  - Acceptance: bun test — crash between child creation and completion resumes the same child conversation (no duplicate); abort of parent aborts child

- [ ] **Task 1.6**: Extensions, hooks, wraps, memos
  - Delivers: `defineExtension({name, sections, tools, hooks, wraps})`; `section` rebuilt per request and recorded in transcript; hooks `beforeModelRequest` / `beforeTool` (rewrite or `{block}`) / `afterTool`; `wrapTool`; `rt.memo(key, value?)` via `HarnessMemo`
  - Files: `extensions.ts`, `models/harnessMemo.ts`, `agentLoop.ts`, tests
  - Blocked by: 1.4
  - Skills: `terreno-backend-api`
  - Docs: reference extensions/hooks/memos
  - Acceptance: AC6 — blocked tool result reaches the model; memo value survives a new harness instance

- [ ] **Task 1.7**: Events, waits, sleep
  - Delivers: `rt.waitFor(event, {timeout})`, `rt.sleep(duration)`, `harness.sendEvent(taskId, event, payload)`; `waiting` status; runner wakes on event or `timeoutAt`; timeout resolves `undefined`
  - Files: `runtime.ts`, `runners/inProcessRunner.ts`, tests
  - Blocked by: 1.3
  - Skills: `terreno-backend-api`
  - Docs: reference waits/events
  - Acceptance: bun test with frozen Luxon clock — event before timeout resumes with payload; timeout path; event sent while owner is down is delivered after restart

- [ ] **Task 1.8**: Approvals backend
  - Delivers: `HarnessApproval` model; `rt.approval(key, {title, summary, payload, approvers, timeout, notify?})`; `approvalGate({tools, approvers})` extension (memo-backed); `HarnessApp` routes `GET /harness/approvals` (filtered by `approvers`), `approve` / `reject` instanceActions with reason; decision span with `decidedBy`
  - Files: `approvals.ts`, `models/harnessApproval.ts`, `harnessApp.ts`, `routes/approvals.ts`, tests
  - Blocked by: 1.6, 1.7
  - Skills: `terreno-backend-api`, `model-router-actions`
  - Docs: reference approvals + routes; how-to section "Require human approval"
  - Acceptance: AC7 — supertest: unpermitted user gets 403 and an empty list; permitted user approves; span `output.decidedBy` equals user id; reject without reason → 400

- [ ] **Task 1.9**: SSE event stream + submit
  - Delivers: `HarnessEvent` log (coalesced deltas with TTL, committed events permanent); `rt.output`; `GET /harness/conversations/:id/events` + `/harness/tasks/:id/events` SSE with `Last-Event-ID` replay then change-stream tail; `submit` instanceAction (`requestId` idempotent, `whenBusy: queue | steer`)
  - Files: `events.ts`, `models/harnessEvent.ts`, `routes/events.ts`, `routes/conversations.ts`, tests
  - Blocked by: 1.4
  - Skills: `terreno-backend-api`, `model-router-actions`
  - Docs: reference SSE contract (event types, ids, reconnect)
  - Acceptance: AC9 — two `HarnessApp` instances on one replica set; client disconnects mid-stream, reconnects to the other with `Last-Event-ID`, receives each missed event exactly once

- [x] **Task 1.10**: Version pinning
  - Delivers: runs resume only on exact `name@version`; `Harness.start()` throws listing unregistered in-flight versions
  - Files: `harness.ts`, `registry.ts`, tests
  - Blocked by: 1.2
  - Skills: `terreno-backend-api`
  - Docs: reference "Versioning"; how-to "Ship a new task version"
  - Acceptance: AC10

- [ ] **Task 1.11**: Approvals inbox (admin-frontend)
  - Delivers: `admin-frontend/src/widgets/harness/HarnessApprovalInbox.tsx` (list, detail, approve/reject with reason, loading/empty/error states) via `adminRequest`; admin custom screen `harness-approvals` (group "AI Harness"); standalone export; example-frontend admin route; `bun run sdk`
  - Files: `admin-frontend/src/widgets/harness/*`, `ai/src/harness/adminScreens.ts`, `example-frontend/app/admin/*`, tests
  - Blocked by: 1.8
  - Skills: `building-admin-interfaces`, `verify-ui-changes`
  - Docs: `docs/reference/admin-frontend.md` inbox section
  - Acceptance: AC8 — component tests + Playwright run on web: approve one item, reject one; screenshots in `/opt/cursor/artifacts/`

- [ ] **Task 1.12**: Clinical tracer in example-backend + how-to
  - Delivers: `clinic.intakeSummary` (fetch → `runAgent` summary → approval → EHR write with `replay: "never"`) against a fake EHR model; `HarnessApp` registered in `server.ts`; admin action to start a run; e2e script kills the backend during `summarize`, restarts, approves in the inbox, asserts `filed` and the span tree in Traces
  - Files: `example-backend/src/harness/*`, `example-backend/src/server.ts`, `example-frontend/e2e/harness-intake.spec.ts`
  - Blocked by: 1.5, 1.9, 1.10, 1.11
  - Skills: `verify-ui-changes`, `backend-test-env`
  - Docs: create `docs/how-to/build-a-durable-workflow.md` using this workflow as the one example
  - Acceptance: AC2 (e2e) — Playwright spec passes; screenshots of the inbox and the trace waterfall attached

## Phase 2 — Multi-instance

- [ ] **Task 2.1**: `JobsRunner`
  - Delivers: `@terreno/ai/harness/jobsRunner` with optional peer `@terreno/jobs`; job `terreno.harness.phase` keyed `taskId:phase:attempt`; harness task lease + heartbeat is the authority; importing the root `@terreno/ai` never loads jobs
  - Files: `ai/src/harness/runners/jobsRunner.ts`, `ai/package.json`, tests
  - Blocked by: 1.12
  - Skills: `terreno-backend-api`
  - Docs: reference "Runners"; how-to "Run on multiple instances"
  - Acceptance: AC11 — two workers race one phase; exactly one commit; stale owner rejected; knip clean without jobs installed

- [ ] **Task 2.2**: Runs admin screen
  - Delivers: task list/tree with status filters, abort, resolve-interrupted (retry/abort/complete + reason), link to trace
  - Files: `admin-frontend/src/widgets/harness/HarnessRuns*.tsx`, `ai/src/harness/routes/tasks.ts`
  - Blocked by: 2.1
  - Skills: `building-admin-interfaces`, `verify-ui-changes`
  - Docs: admin-frontend reference
  - Acceptance: Playwright resolves an interrupted EHR write; screenshots

## Phase 3 — Long context

- [ ] **Task 3.1**: Background compaction + manual `compact(instructions)`; originals stay searchable
- [ ] **Task 3.2**: `reset` / handoff tool control
- [ ] **Task 3.3**: Conversation forks at any message (parent history by reference)
- [ ] **Task 3.4**: `defineDoc` typed documents (`scope`, `history: rewindable`, `fork: asOf`), committed atomically with transcripts

Each 3.x task: Blocked by 1.12; Docs: reference + explanation sections; Acceptance: bun tests (10k-message conversation fits budget; fork isolation; doc rewind).

## Phase 4 — Durable chat + multiplayer

- [x] **Task 4.0**: Human gate — `GptHistory` migration strategy → **one-shot migration** script at deploy (decided 2026-10-02)
- [ ] **Task 4.1**: `/gpt/prompt` on the harness; history mapping
- [ ] **Task 4.2**: Steering, foreground/background abort, `viewState` over SSE
- [ ] **Task 4.3**: rtk `useHarnessConversation` SSE hook + `GPTChat` adapter in example-frontend

Acceptance: kill backend mid-chat, reconnect resumes; two browsers see the same view (Playwright, screenshots).

## Phase 5 — Coding agents + malleability

- [x] **Task 5.0**: Human gate — sandbox provider → **Cloud Run Jobs container** (decided 2026-10-02)
- [ ] **Task 5.1**: `NodeExecutionEnv` + `CodingTools` (read/write/edit/bash with replay classes)
- [ ] **Task 5.2**: Remote sandbox adapter
- [ ] **Task 5.3**: Registry hot-replace (running calls finish on old code)

Acceptance: a coding agent fixes a failing test in a fixture repo after a forced crash.
