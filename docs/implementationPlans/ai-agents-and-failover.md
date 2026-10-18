# Implementation plan: AI agents and provider failover

**Status:** Draft  
**Roadmap:** Area=`ai`, Target=`Future`, Impact=`Feature`  
**Branch:** `cursor/ai-agents-and-failover-ip-97fd`  
**Owner:** unassigned  
**Created:** 2026-08-24  
**Package:** `@terreno/ai`  
**Related:** Laravel AI SDK comparison (items 1 and 3): named Agent reuse + LanguageModel failover on 429/503  

## Goal

Add two additive library seams to `@terreno/ai` so app code can:

1. Define a reusable **Agent** (`name`, `instructions`, `tools`, optional `schema`, optional `middleware`) that runs through existing `AIService` logging.
2. Wrap one or more Vercel AI SDK `LanguageModel`s in **`createFailoverModel`** so 429/502/503/overloaded failures try the next model. Every `AIService` method inherits failover without per-method changes.

Destination: a consuming app can write a typed agent, pass a failover chain as `model`, and prove with mocks that the second model serves after the first throws a failoverable error.

## Non-Goals

- Embeddings, pgvector/Atlas Vector, RAG, `SimilaritySearch` (comparison item 2).
- Image generation, TTS, STT, reranking, provider file/vector stores.
- New HTTP routes, `AiApp` options, or GPT chat rewrite.
- Human-in-the-loop tool approval / resume.
- First-class sub-agents (keep existing `parentRequestId` / `subRequestIds` only).
- Queued generation, Echo-style broadcast, `Agent.fake()` Laravel helpers.
- Changing `AIService` constructor (`model` stays a single `LanguageModel`).
- Mid-stream failover after the client has received text deltas.

## Decisions

Grow recorded these as executable defaults from the comparison plus current `@terreno/ai` shape (`AIService` + injected `LanguageModel` in `ai/src/service/aiService.ts`). Change a row before Approve if Pick should do something else.

| ID | Question | Decision |
| --- | --- | --- |
| D1 | Scope | Agent API + failover wrapper only. No embeddings, no multimodal generation, no new routes. |
| D2 | Agent shape | Class `Agent` wrapping an `AIService` instance. Not a replacement for `AIService`. Laravel-style PHP agent classes are the DX target, not the type system. |
| D3 | HTTP | No new routes in v1. Chat stays `addGptRoutes`. Apps call `agent.run()` from their own services/routes. |
| D4 | Failover seam | `createFailoverModel({models, isFailoverable?})` returns a `LanguageModel`. Pass it as `AIService` `model`. Do not add `models[]` to the constructor. |
| D5 | Failover triggers | Default: HTTP 429, 502, 503, 529; SDK/provider errors whose `statusCode` matches; messages matching rate-limit / overloaded / capacity. Not 400/401/403/404. Not structured-output parse failures (`NoObjectGeneratedError`). |
| D6 | Same-model retry | Each listed model is tried once per call. No extra retries on the same model. |
| D7 | Streaming | Fail over only if `doStream` **rejects before returning a stream**. After the stream exists, errors propagate. No replay of partial output. |
| D8 | Logging | Successful `AIRequest.aiModel` is the model that served. `metadata.failover` records `{attempts: [{modelId, error?}], servedModelId}`. Failures still never throw from logging. |
| D9 | Instructions | Agent `instructions` are prompts. Named constants (app `prompts.ts` or `ai/src/service/prompts.ts`). `ai-prompt-governance` applies. |
| D10 | Schema + tools | v1 allows tools on text/chat runs. `schema` uses `generateJsonObject` and **does not** combine with tools in the same `run`. Streaming `runStream` is text-only (no schema). |
| D11 | Middleware | Array of `(input, next) => Promise<output>` around `run` / `runStream` only. Not Express middleware. |
| D12 | Example app | Optional tracer in `example-backend` if two providers are already configured; otherwise tests-only tracer is enough. |
| D13 | Compatibility | Additive exports only. Existing `new AIService({model})` and `AiApp` stay valid. |

## Architecture

```
App
  Agent({instructions, tools?, schema?, middleware?}, aiService)
    → AIService.generateText | generateChatStream | generateJsonObject
        → LanguageModel (optionally createFailoverModel)
            → primary.doGenerate / doStream
            → on failoverable error → next model
        → AIRequest.logRequest (served model id + failover metadata)
```

`AIService` stays the only path that talks to the Vercel SDK for logged calls. Agent does not call `generateText` / `streamText` from `ai` directly.

Failover is a `LanguageModel` Proxy (same idea as `withStrippedJsonFencesModel` in `aiService.ts`): intercept `doGenerate` and `doStream`, preserve other properties from the **primary** model (`specificationVersion`, `provider`, `supportedUrls`).

`modelId` on the wrapper: `failover(<primaryId>)` for identification. `AIService` logging must read **served** id via a small well-known slot on the wrapper (for example `lastServedModelId`) so explorer rows are not all `failover(...)`.

### Agent API (proposed)

```typescript
interface AgentContext {
  userId?: mongoose.Types.ObjectId;
}

interface AgentRunOptions extends AgentContext {
  prompt: string;
  messages?: Array<{content: string; role: "user" | "assistant" | "system"}>;
  temperature?: number;
}

interface AgentMiddleware<OUTPUT = string> {
  (
    input: AgentRunOptions,
    next: (input: AgentRunOptions) => Promise<OUTPUT>
  ): Promise<OUTPUT>;
}

interface AgentConfig<OUTPUT = string> {
  name: string;
  instructions: string | ((ctx: AgentContext) => string | Promise<string>);
  tools?: ToolSet | ((ctx: AgentContext) => ToolSet | Promise<ToolSet>);
  schema?: import("ai").FlexibleSchema<OUTPUT>;
  middleware?: Array<AgentMiddleware<OUTPUT>>;
  temperature?: number;
  maxSteps?: number;
  requestType?: string;
}

class Agent<OUTPUT = string> {
  constructor(config: AgentConfig<OUTPUT>, service: AIService);
  run(options: AgentRunOptions): Promise<OUTPUT | string>;
  runStream(options: AgentRunOptions): AsyncGenerator<string>;
}
```

Dispatch:

| Config | Implementation |
| --- | --- |
| `schema` set | `AIService.generateJsonObject` with `systemPrompt` = resolved instructions. Ignore tools. |
| `tools` set, no schema | Collect `generateChatStream` with `stopWhen: stepCountIs(maxSteps ?? 5)` (same default as `AiApp.maxSteps`). |
| neither | `AIService.generateText` with `systemPrompt` = instructions. |

`requestType` defaults to `"agent"` (extend `AIRequestType` union / explorer filters). Store `metadata.agentName`.

Factory export `defineAgent(config)` that returns `(service) => new Agent(config, service)` is optional sugar; Pick may ship class-only if that is smaller.

### Failover API (proposed)

```typescript
interface CreateFailoverModelOptions {
  models: LanguageModel[];
  isFailoverable?: (error: unknown) => boolean;
}

createFailoverModel(options: CreateFailoverModelOptions): LanguageModel;
isFailoverableError(error: unknown): boolean;
```

- `models.length < 1` throws at construction (early return / guard).
- `isFailoverable` defaults to `isFailoverableError`.
- On failover: `logger.warn` with `fromModelId`, `toModelId`, `error` (no secrets).
- If every model fails: throw the **last** error (do not wrap in a generic message that hides the provider error).
- Structured-json path: `withStrippedJsonFencesModel(createFailoverModel(...))` still works because failover is a LanguageModel. Order: app wraps failover first, then `AIService` applies fence stripping on that wrapper for JSON methods.

### `getModelId` / logging

Update `getModelId` (or logging helpers) so if `model` has `lastServedModelId: string`, log that. Wrapper sets it on success. Tests assert `AIRequest.aiModel` equals the backup id after a primary 429.

## Models

No new Mongoose models. No schema migration.

`AIRequest.metadata` (already Mixed) gains optional:

```typescript
interface FailoverLogMetadata {
  attempts: Array<{modelId: string; error?: string}>;
  servedModelId: string;
}

interface AgentLogMetadata {
  agentName: string;
}
```

`requestType` may be `"agent"` in addition to current defaults. Update admin explorer filters in `ai/src/routes/aiRequestsExplorer.ts`.

## APIs

No REST/OpenAPI changes.

Public package exports from `ai/src/index.ts`:

- `Agent`, type `AgentConfig`, type `AgentMiddleware`, type `AgentRunOptions`
- `createFailoverModel`, `isFailoverableError`, type `CreateFailoverModelOptions`

## Notifications

None.

## UI

None. Admin explorer already shows `requestType` / `aiModel` / `metadata`; document the new metadata shape in reference docs only.

## Phases

1. **Failover LanguageModel** — `createFailoverModel` + tests (tracer).
2. **Logging served model** — `lastServedModelId` into `AIRequest`.
3. **Agent** — class + dispatch + middleware + tests.
4. **Docs + agent rules** — reference, how-to, `.cursor/rules/ai`, prompt-governance mention.
5. **Optional example-backend** — one agent if dual providers exist without new env requirements.

## Feature Flags & Migrations

None. Additive API. No feature flag.

## Activity Log & User Updates

`AIRequest` remains the audit log. No user-facing activity feed.

## Not Included / Future Work

- RAG / embeddings (comparison item 2).
- Agent-as-tool / sub-agents.
- Human tool approval.
- `AiApp` `agent` option mounting a dedicated route.
- Failover on mid-stream errors.
- Combining structured schema with tool loops in one `run`.

## Files to Create / Modify

| File | Change |
| --- | --- |
| `ai/src/service/failoverModel.ts` | `createFailoverModel`, `isFailoverableError` |
| `ai/src/service/failoverModel.test.ts` | Mock `doGenerate` / `doStream`; 429 then success; non-failoverable does not switch; empty list throws; stream reject-before-return vs after-return |
| `ai/src/agent/agent.ts` | `Agent` class |
| `ai/src/agent/agent.test.ts` | Instructions sent as system; schema path; tools path; middleware order |
| `ai/src/service/aiService.ts` | Read `lastServedModelId` when logging; optional `requestType` passthrough only if needed (prefer Agent calling existing methods + metadata) |
| `ai/src/types/index.ts` | Types; `"agent"` request type |
| `ai/src/routes/aiRequestsExplorer.ts` | Filter includes `agent` |
| `ai/src/index.ts` | Exports |
| `docs/reference/ai.md` | Agent + failover sections |
| `docs/how-to/define-an-ai-agent.md` | New how-to |
| `docs/how-to/configure-ai-failover.md` | New how-to |
| `docs/how-to/README.md` | Links |
| `.cursor/rules/ai/00-ai.mdc` (source of truth for rules sync) | Public API notes |
| `skills/ai-prompt-governance/SKILL.md` | Agent instructions = named constants |
| `ai/README.md` | Short mention + link to reference |
| `docs/tasks/ai-agents-and-failover.md` | This plan's task list |
| `example-backend/src/api/ai.ts` | Optional Phase 5 only |

## Task List

[`docs/tasks/ai-agents-and-failover.md`](../tasks/ai-agents-and-failover.md)

## Acceptance Criteria

- [ ] `createFailoverModel` with two mocks: first `doGenerate` throws failoverable 429, second returns text; `AIService.generateText` returns the second text; `AIRequest.aiModel` is the second `modelId`; `metadata.failover.attempts` has length 2.
- [ ] First mock throws 400; second is never called; error propagates.
- [ ] `doStream` that **returns** a stream then errors does not call the next model.
- [ ] `Agent` with named instruction constant: mock receives that string as `system` (or equivalent SDK field); `AIRequest` has `requestType: "agent"` and `metadata.agentName`.
- [ ] `Agent` with `schema` returns a typed object via `generateJsonObject` (existing JSON normalization still applies).
- [ ] Middleware runs in order; a middleware that returns without `next` short-circuits (no model call).
- [ ] `docs/reference/ai.md` documents both APIs with one minimal example each.
- [ ] `bun test` in `ai/` passes; `bun run compile` for `ai` succeeds.
- [ ] No new Express routes; existing GPT tests still pass.
