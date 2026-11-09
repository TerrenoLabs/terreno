# Tasks: AI agents and provider failover

IP: [ai-agents-and-failover](../implementationPlans/ai-agents-and-failover.md)

Instructions for Pick:

- TDD: failing test first on every task that ships code.
- Mock `LanguageModel` with `doGenerate` / `doStream` (see `ai/src/service/aiService.test.ts`). Never call a live provider.
- Agent instructions are named constants (`ai-prompt-governance`).
- Docs in the same slice as the public API they describe (`update-docs`).
- Import concrete files, not internal barrels.
- `bun test` from `ai/` after each task; `bun run compile` before considering a phase done.

## Phase 1 — Failover LanguageModel (tracer)

- [ ] **Task 1.1**: `isFailoverableError`
  - Delivers: shared predicate used by the wrapper and tests
  - Files: `ai/src/service/failoverModel.ts`, `ai/src/service/failoverModel.test.ts`
  - Blocked by: none
  - Acceptance: 429 / 502 / 503 / 529 → true; `{statusCode: 429}` → true; 400 / 401 / 404 → false; `NoObjectGeneratedError`-shaped errors → false
  - Docs: none (internal until 1.3)
  - Skills: none

- [ ] **Task 1.2**: `createFailoverModel` generate + stream
  - Delivers: LanguageModel that tries the next model on failoverable `doGenerate` / `doStream` rejection
  - Files: `ai/src/service/failoverModel.ts`, `ai/src/service/failoverModel.test.ts`
  - Blocked by: 1.1
  - Acceptance: two mocks, first 429, second succeeds; non-failoverable error does not call the second; empty `models` throws at construct; last error rethrown when all fail; `doStream` that returns then errors does **not** failover; `lastServedModelId` set on success
  - Docs: none until 1.3
  - Skills: none

- [ ] **Task 1.3**: Export failover helpers
  - Delivers: public package surface
  - Files: `ai/src/index.ts`
  - Blocked by: 1.2
  - Acceptance: `createFailoverModel` and `isFailoverableError` importable from `@terreno/ai`; `bun run compile` in `ai/` succeeds
  - Docs: none until Phase 4
  - Skills: none

## Phase 2 — Logging served model (tracer with AIService)

- [ ] **Task 2.1**: Log the model that actually served
  - Delivers: `AIRequest.aiModel` + `metadata.failover` after a failover generate
  - Files: `ai/src/service/aiService.ts`, `ai/src/service/aiService.test.ts` (or `failoverModel` integration test using `AIService`)
  - Blocked by: 1.2
  - Acceptance: `generateText` through `createFailoverModel` logs backup `modelId`; `metadata.failover.attempts` length 2; logging failure still does not throw
  - Docs: none until Phase 4
  - Skills: none

## Phase 3 — Agent

- [ ] **Task 3.1**: `Agent` text `run`
  - Delivers: named agent → `generateText` with instructions as `systemPrompt`
  - Files: `ai/src/agent/agent.ts`, `ai/src/agent/agent.test.ts`, `ai/src/types/index.ts`
  - Blocked by: none (can parallelize with Phase 1; logging assertions need 2.1)
  - Acceptance: mock sees named instruction constant as system; `requestType` `"agent"`; `metadata.agentName` set; constructor requires `name` + `instructions`
  - Docs: none until 3.4
  - Skills: `ai-prompt-governance`

- [ ] **Task 3.2**: `Agent` schema `run`
  - Delivers: `schema` path uses `generateJsonObject`
  - Files: `ai/src/agent/agent.ts`, `ai/src/agent/agent.test.ts`
  - Blocked by: 3.1
  - Acceptance: typed object returned; fence-stripping behavior unchanged; tools ignored when schema is set (asserted)
  - Docs: none until 3.4
  - Skills: `ai-prompt-governance`

- [ ] **Task 3.3**: `Agent` tools + `runStream` + middleware
  - Delivers: chat/tool loop, text stream, middleware chain
  - Files: `ai/src/agent/agent.ts`, `ai/src/agent/agent.test.ts`
  - Blocked by: 3.1
  - Acceptance: tools passed through to `generateChatStream`; `maxSteps` default 5; `runStream` yields chunks; middleware order outer-first; short-circuit skips the model
  - Docs: none until 3.4
  - Skills: none

- [ ] **Task 3.4**: Export Agent + explorer filter
  - Delivers: public export; admin explorer can filter `agent`
  - Files: `ai/src/index.ts`, `ai/src/routes/aiRequestsExplorer.ts`, explorer tests if present
  - Blocked by: 3.1
  - Acceptance: `Agent` importable from `@terreno/ai`; explorer query accepts `requestType=agent`
  - Docs: Phase 4
  - Skills: `update-docs`

## Phase 4 — Docs and agent rules

- [ ] **Task 4.1**: Reference + how-tos
  - Delivers: operators can use Agent and failover without reading the IP
  - Files: `docs/reference/ai.md`, `docs/how-to/define-an-ai-agent.md`, `docs/how-to/configure-ai-failover.md`, `docs/how-to/README.md`, `ai/README.md`
  - Blocked by: 1.3, 3.4
  - Acceptance: one minimal example per API; exports match `ai/src/index.ts`; how-to index links both pages
  - Skills: `update-docs`

- [ ] **Task 4.2**: Cursor rules + prompt-governance skill
  - Delivers: agents use named instruction constants and failover wrapper, not ad-hoc retries in routes
  - Files: `.cursor/rules/ai/00-ai.mdc` (or rulesync source), `skills/ai-prompt-governance/SKILL.md`; run `bun run rules` / `bun run skills:sync` if that is the repo workflow
  - Blocked by: 4.1
  - Acceptance: rule mentions `Agent` and `createFailoverModel`; prompt skill mentions agent instructions
  - Skills: `update-docs`, `update-agent-docs`

## Phase 5 — Optional example (skip if dual providers are not already wired)

- [ ] **Task 5.1**: example-backend agent **or skip with recorded reason**
  - Delivers: one in-repo Agent using existing Google/Vertex setup if both exist
  - Files: `example-backend/src/api/ai.ts` (or adjacent module), named prompt constant
  - Blocked by: 3.4, 1.3
  - Acceptance: either (a) example constructs `createFailoverModel` + `Agent` without new required env, tests or typecheck pass, **or** (b) PR notes why skipped
  - Skills: `ai-prompt-governance`
