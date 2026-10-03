# @terreno/ai

AI service layer for Terreno backends: provider-agnostic chat via the Vercel AI SDK, request logging, GPT history, projects, file uploads, MCP tools, and optional Langfuse integration.

## Table of Contents

- [Install](#install)
- [Commands](#commands)
- [Architecture](#architecture)
- [Key exports](#key-exports)
- [AIService](#aiservice)
- [Structured JSON output](#structured-json-output)
- [TemperaturePresets](#temperaturepresets)
- [Models](#models)
- [Route registrars](#route-registrars)
- [AiApp plugin](#aiapp-plugin)
- [LangfuseApp plugin](#langfuseapp-plugin)
- [Observability](#observability)
- [Durable agent harness](#durable-agent-harness)
- [Langfuse integration](#langfuse-integration)
- [FileStorageService](#filestorageservice)
- [MCPService](#mcpservice)
- [Gemini and Vertex helpers](#gemini-and-vertex-helpers)
- [Web search types](#web-search-types)
- [Integration example](#integration-example)
- [Environment variables](#environment-variables)
- [Conventions](#conventions)
- [Testing](#testing)

## Install

```bash
bun add @terreno/ai @terreno/api mongoose
```

Peer dependencies: `@terreno/api`, `mongoose` (^8.0.0). Consuming apps also install a Vercel AI SDK provider (e.g. `@ai-sdk/google`) for their chosen model.

## Commands

From the `@terreno/ai` package directory:

```bash
bun run compile    # Compile TypeScript
bun run dev        # Watch mode (tsc -w)
bun run test       # Run tests (with bunSetup preload)
bun run lint       # Lint code
bun run lint:fix   # Fix lint issues
```

## Architecture

```
src/
  index.ts                 # Public exports
  aiApp.ts                 # AiApp TerrenoPlugin
  langfuseApp.ts           # LangfuseApp TerrenoPlugin
  langfuseClient.ts        # Langfuse SDK client lifecycle
  langfuseCache.ts         # Prompt/trace caching
  langfusePrompts.ts       # Prompt compile/fetch helpers
  langfuseTracing.ts       # OpenTelemetry tracing setup
  langfuseVercelAi.ts      # Bridge Langfuse prompts to Vercel AI SDK
  models/
    aiRequest.ts           # AI request logging model
    gptHistory.ts          # Conversation history model
    fileAttachment.ts      # Uploaded file metadata
    project.ts             # GPT project + memories
  routes/
    gpt.ts                 # Streaming chat, remix, tools, ratings
    gptHistories.ts        # History CRUD
    aiRequestsExplorer.ts  # Admin request explorer
    files.ts               # File upload/signed URL/delete
    projects.ts            # Project CRUD + memories
    mcp.ts                 # MCP server status and tools
  service/
    aiService.ts           # Provider-agnostic AI service
    fileStorage.ts         # GCS upload helper
    getMCPTools.ts         # modelRouter MCP tools as Vercel AI SDK tools
    mcpService.ts          # MCP client connections
    parseAiJson.ts         # LLM JSON normalization/parsing
    prompts.ts             # System prompt constants
    gemini.ts              # Gemini Developer API model listing
    vertex.ts              # Vertex AI provider helpers
    webSearchTool.ts       # WebSearchProvider interface
  types/                   # Shared TypeScript types
```

## Key exports

- **Plugins:** `AiApp`, `LangfuseApp`
- **Service:** `AIService`, `TemperaturePresets`, `FileStorageService`, `MCPService`,
  `getMCPTools`
- **Models:** `AIRequest`, `GptHistory`, `FileAttachment`, `Project`
- **Routes:** `addGptRoutes`, `addGptHistoryRoutes`, `addAiRequestsExplorerRoutes`, `addFileRoutes`, `addProjectRoutes`, `addMcpRoutes`
- **Structured output:** `parseAiJson`, `normalizeLlmJsonTextForStructuredOutput`, re-exported `Output`, `jsonSchema`, `JSONValue`, `FlexibleSchema` from `ai`
- **Langfuse:** `initLangfuseClient`, `getLangfuseClient`, `shutdownLangfuseClient`, `compilePrompt`, `createPrompt`, `getPrompt`, `createTelemetryConfig`, `preparePromptForAI`, `initTracing`, `shutdownTracing`, `LangfuseCache`, cache helpers
- **Gemini / Vertex:** `listGeminiApiModels`, `normalizeGeminiModelId`, `GEMINI_API_BASE_URL`, `createVertexProvider`, `listEnabledVertexModels`, `verifyVertexModelsEnabled`, `assertVertexModelsEnabled`, `isVertexModelAllowed`, `normalizeVertexModelId`, `DEFAULT_VERTEX_LOCATION`
- **Prompts:** `CONTENT_SUMMARY_PROMPT`, `DEFAULT_GPT_MEMORY`, `JSON_VALUE_SYSTEM_PROMPT`, `REMIX_PROMPT`, `TITLE_GENERATION_PROMPT`, `TRANSLATION_PROMPT`
- **Web search:** `WebSearchProvider`, `WebSearchResult` types
- **Harness (subpath `@terreno/ai/harness`):** `Harness`, `defineTask`, `defineAgent`, `defineTool`, `HarnessConversationHandle`, `HarnessConversationBusyError`, `HarnessModelCallError`, `HarnessSubagentError`, `isRetryableModelError`, `AGENT_TURN_TASK_NAME`, `AGENT_TOOL_TASK_NAME`, `HARNESS_AGENT_DEFAULT_MAX_STEPS`, `HARNESS_CONVERSATION_STATUSES`, `HARNESS_INTERRUPT_ACTIONS`, `HARNESS_MESSAGE_ROLES`, `HARNESS_MODEL_RETRY_DEFAULTS`, `InProcessRunner`, `HarnessCommitConflictError`, `HARNESS_RESOLVE_ACTIONS`, `HARNESS_RETRY_DEFAULTS`, `HARNESS_TASK_STATUSES`, `HARNESS_WAIT_KINDS`, `HARNESS_WAIT_POLICIES`, `IN_PROCESS_RUNNER_ROLES` — see [AI harness reference](ai-harness.md)

## AIService

Provider-agnostic wrapper around a Vercel AI SDK `LanguageModel`. The consuming app supplies the model instance.

```typescript
import {AIService} from "@terreno/ai";
import {google} from "@ai-sdk/google";

const aiService = new AIService({
  model: google("gemini-2.5-flash"),
  defaultTemperature: 1.0,
});
```

### Constructor options

| Option | Description |
|--------|-------------|
| `model` | Vercel AI SDK `LanguageModel` instance (required) |
| `defaultTemperature` | Default temperature for text/stream calls (default: `TemperaturePresets.DEFAULT`) |

### Properties

| Property | Description |
|----------|-------------|
| `model` | Configured `LanguageModel` |
| `defaultTemperature` | Default temperature |
| `modelId` | Resolved model identifier string |

### Methods

| Method | Description |
|--------|-------------|
| `generateText(options)` | Non-streaming text generation; logs as `requestType: "general"` |
| `generateJsonValue(options)` | Any JSON value via `Output.json()`; logs as `"json_value"` |
| `generateJsonObject(options)` | Typed object from schema/Zod via `Output.object()`; logs as `"json_object"` |
| `generateJsonArray(options)` | Typed array via `Output.array()`; logs as `"json_array"` |
| `generateTextStream(options)` | Async generator of text chunks; logs full response after stream completes |
| `generateRemix(options)` | Reword text using `REMIX_PROMPT` at `TemperaturePresets.BALANCED` |
| `generateSummary(options)` | Summarize text using `CONTENT_SUMMARY_PROMPT` at `TemperaturePresets.LOW` |
| `translateText(options)` | Translate text using `TRANSLATION_PROMPT` at `TemperaturePresets.LOW` |
| `buildMessages(prompts)` | Convert `GptHistoryPrompt[]` to Vercel AI SDK `ModelMessage[]` (skips tool-call/result entries) |
| `generateChatStream(options)` | Stream multi-turn chat with optional tools; logs prompt as joined message text |

All generation methods log to `AIRequest` via private `logRequest()`. Logging failures never throw.

## Structured JSON output

`generateJsonValue`, `generateJsonObject`, and `generateJsonArray`:

- Default to `TemperaturePresets.DETERMINISTIC` when `temperature` is omitted.
- Use `JSON_VALUE_SYSTEM_PROMPT` when `systemPrompt` is omitted.
- Run model text through `normalizeLlmJsonTextForStructuredOutput` before Vercel `Output.*` parsing (strips fences, preamble, balanced JSON slice, trailing commas, smart-quote repair).
- On failure: `logger.error` records prompt, system prompt, raw model text, and error details; `AIRequest` stores `response` (raw text or sentinel), `error`, and `metadata` (`system`, `finishReason`, `errorStack`, `rawModelTextCaptured`).

Standalone helpers:

```typescript
import {parseAiJson, normalizeLlmJsonTextForStructuredOutput} from "@terreno/ai";

const result = parseAiJson<MyType>(rawLlmText);
if (result.success) {
  console.info(result.data);
}
```

Re-exported from `ai` for schema building: `Output`, `jsonSchema`, types `JSONValue`, `FlexibleSchema`.

## TemperaturePresets

```typescript
import {TemperaturePresets} from "@terreno/ai";

TemperaturePresets.DETERMINISTIC  // 0
TemperaturePresets.LOW            // 0.3
TemperaturePresets.BALANCED       // 0.7
TemperaturePresets.DEFAULT        // 1.0
TemperaturePresets.HIGH           // 1.5
TemperaturePresets.MAXIMUM        // 2.0
```

## Models

### AIRequest

Logs all AI calls for monitoring and admin explorer.

| Field | Type | Description |
|-------|------|-------------|
| `aiModel` | string | Model identifier (field name avoids Mongoose `model` conflict) |
| `prompt` | string | Input prompt |
| `requestType` | string | e.g. `general`, `remix`, `summarization`, `translation`, `json_value`, `json_object`, `json_array` |
| `response` | string? | Response text |
| `responseTime` | number? | Milliseconds |
| `tokensUsed` | number? | Total tokens |
| `userId` | ObjectId? | Requesting user |
| `error` | string? | Error message |
| `metadata` | Mixed? | Extra data (e.g. structured-output debug) |
| `parentRequestId` | ObjectId? | Parent in multi-agent workflow |
| `subRequestIds` | ObjectId[]? | Child request refs |
| `totalResponseTime` | number? | Combined sub-request time |
| `totalTokensUsed` | number? | Combined sub-request tokens |

**Statics:** `AIRequest.logRequest(params)`, `AIRequest.logMultiAgentRequest(params)`

**Plugins:** `createdUpdatedPlugin`, `isDeletedPlugin`, `findOneOrNone`, `findExactlyOne`

### GptHistory

Conversation history with multi-modal prompts.

| Field | Type | Description |
|-------|------|-------------|
| `userId` | ObjectId | Owner (required) |
| `title` | string? | Auto-generated on first `/gpt/prompt` response when empty |
| `projectId` | ObjectId? | Optional project association |
| `prompts` | array | Messages: `text`, `type` (`user` \| `assistant` \| `system` \| `tool-call` \| `tool-result`), optional `content` parts, `model`, `rating`, tool fields. `text` is required unless `content` has parts; an image-only assistant response saves `text: ""` |

**Virtual:** `ownerId` aliases `userId` for `Permissions.IsOwner`.

### FileAttachment

Metadata for files stored in GCS.

| Field | Type | Description |
|-------|------|-------------|
| `userId` | ObjectId | Uploader |
| `filename` | string | Original filename |
| `gcsKey` | string | Unique GCS object key |
| `mimeType` | string | MIME type |
| `size` | number | Bytes |
| `url` | string | Public GCS URL |

**Virtual:** `ownerId` aliases `userId`.

### Project

GPT project with persistent context and memories.

| Field | Type | Description |
|-------|------|-------------|
| `userId` | ObjectId | Owner |
| `name` | string | Project name |
| `systemContext` | string | Prepended to every chat in this project |
| `memories` | array | `{text, category?, source: "user" \| "auto"}` entries |

**Virtual:** `ownerId` aliases `userId`.

## Route registrars

### addGptRoutes(router, options)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/gpt/prompt` | POST | `IsAuthenticated` | SSE streaming chat; body: `prompt`, optional `historyId`, `systemPrompt`, `attachments`, `model`, `projectId`, `promptName`, `promptLabel`, `sensitive`, `sessionId`. Also reads `x-ai-session-id`. Passes `userId` from `req.user` into `AIService`. Client prompt-registry selection is admin-only; app routes select production prompts server-side. Client `sensitive: true` may upgrade handling, but `false` never downgrades a sensitive prompt version. |
| `/gpt/remix` | POST | `IsAuthenticated` | Non-streaming text remix. Client prompt-registry selection is admin-only and `sensitive: false` cannot downgrade a sensitive prompt. |
| `/gpt/histories/:id/rating` | PATCH | `IsAuthenticated` | Rate a prompt; body: `{promptIndex, rating: "up" \| "down" \| null}` |
| `/gpt/tools` | GET | `IsAuthenticated` | List builtin + MCP tools |

Generated images (image-output models such as `gemini-3-pro-image`) arrive as SSE `image` events: `{image: {mimeType, url}}` with a base64 data URL. Each image is sent once, even when the model reports it both as a stream file part and in the final `result.files`. The saved assistant prompt stores one `image` content part per image. On later turns, `buildMessages` sends an image-only assistant prompt to the model as the text `[Generated image]`, because providers reject empty assistant turns.

AI resolution order: `x-ai-api-key` header + `createModelFn` → `createServerModelFn(modelId)` → configured `aiService` → demo SSE response when `demoMode` and none available.

### addGptHistoryRoutes(router, options?)

CRUD at `/gpt/histories` via `modelRouter`:

| Operation | Permission |
|-----------|------------|
| Create, List | `IsAuthenticated` |
| Read, Update, Delete | `IsOwner` |

Query filtered by `userId`; sort `-updated`; query fields `userId`, `projectId`.

### addProjectRoutes(router, options?)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/gpt/projects/:id/memories` | POST | `IsAuthenticated` (owner) | Add memory; body: `{text, category?}` |
| `/gpt/projects/:id/memories/:memoryId` | DELETE | `IsAuthenticated` (owner) | Remove memory |
| `/gpt/projects` | CRUD | Create/List: `IsAuthenticated`; Read/Update/Delete: `IsOwner` | Standard modelRouter |

### addFileRoutes(router, options)

Requires `fileStorageService` and `gcsBucket` (registered by `AiApp` when both are set).

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/files/upload` | POST | `IsAuthenticated` | Multipart upload (`file` field); allowed MIME: images, PDF, plain text, CSV, JSON |
| `/files/*gcsKey` | GET | None | Returns signed read URL (1 hour) |
| `/files/*gcsKey` | DELETE | `IsAuthenticated` (owner) | Soft-delete attachment and remove from GCS |

### addMcpRoutes(router, options)

Requires `mcpService` (registered by `AiApp` when set).

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/mcp/servers` | GET | `IsAuthenticated` + admin | Server connection status |
| `/mcp/tools` | GET | `IsAuthenticated` | Available MCP tools |
| `/mcp/servers/:name/reconnect` | POST | `IsAuthenticated` + admin | Reconnect one server |

### addAiRequestsExplorerRoutes(router, options?)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/aiRequestsExplorer` | GET | `IsAuthenticated` + `user.admin` | Paginated AI request log; filters: `requestType`, `model`, `startDate`, `endDate` |

## AiApp plugin

`AiApp` registers all AI routes in one `TerrenoPlugin`:

```typescript
import {AiApp, AIService, FileStorageService, MCPService} from "@terreno/ai";
import {google} from "@ai-sdk/google";

const aiService = new AIService({model: google("gemini-2.5-flash")});

new AiApp({
  aiService,
  fileStorageService: new FileStorageService({bucketName: "my-bucket"}),
  gcsBucket: "my-bucket",
  mcpService: new MCPService([{name: "tools", transport: {type: "sse", url: "..."}}]),
  tools: myToolDefinitions,
  demoMode: false,
  createModelFn: (apiKey, modelId) => google(modelId ?? "gemini-2.5-flash", {apiKey}),
  openApiOptions: options,
}).register(app);
```

| Option | Description |
|--------|-------------|
| `aiService` | Pre-configured server-wide AI service |
| `createModelFn` | Build model from per-request `x-ai-api-key` |
| `createServerModelFn` | Server-side model factory (e.g. Vertex ADC) without per-request key |
| `demoMode` | Return canned responses when no AI service resolves |
| `fileStorageService` + `gcsBucket` | Enable file upload routes |
| `mcpService` | Enable MCP routes and tool discovery in chat |
| `tools` | Static Vercel AI SDK tool definitions for chat |
| `toolChoice` | `"auto"` \| `"none"` \| `"required"` (default `"auto"` when tools present) |
| `maxSteps` | Max tool-calling steps (default 5) |
| `titleModelId` | Cheaper model for conversation title generation |
| `openApiOptions` | Passed to route OpenAPI builders |

## LangfuseApp plugin

Optional Langfuse admin UI and tracing:

```typescript
import {LangfuseApp} from "@terreno/ai";

new LangfuseApp({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_BASE_URL,
  adminPath: "/admin/langfuse",
  enableTracing: true,
  enableAdminUI: true,
  evaluation: {enabled: true, scoringFunctions: [...]},
}).register(app);
```

| Option | Default | Description |
|--------|---------|-------------|
| `publicKey`, `secretKey` | — | Langfuse API keys (required) |
| `baseUrl` | — | Langfuse host |
| `adminPath` | `"/admin/langfuse"` | Admin route prefix |
| `organization` | maintainer default | Langfuse organization slug — set your own |
| `project` | `"terreno"` | Langfuse project slug — set your own |
| `enableTracing` | `true` | OpenTelemetry via `@langfuse/otel` |
| `enableAdminUI` | `true` | Prompt, trace, playground, evaluation routes |
| `evaluation.enabled` | — | Register evaluation scoring routes |
| `cache` | — | Prompt/trace TTL overrides |

Client construction failures log a warning and skip the plugin so the API process still listens. Tracing init failures log and leave admin routes mounted. example-backend does not register `LangfuseApp` when `MONGO_DB_NAME` is a PR preview database (`terreno-example-pr-*`). GitHub Actions preview deploys omit Langfuse secrets and use `secrets_update_strategy: overwrite` so a previous revision cannot merge those keys into the preview.

Calls `shutdownLangfuseClient()` and `shutdownTracing()` on `SIGTERM`.

## Observability

In-app prompt versions, nested traces, evaluators, datasets, experiments, review queue, and in-app feedback. Operator loop: [Develop an AI feature](../how-to/ai-feature-development.md). Register plugins: [Observe LLM calls](../how-to/observe-llm-calls.md). Why two planes: [AI observability](../explanation/ai-observability.md). Locked design: [implementation plan](../implementationPlans/ai-observability.md).

Register `ObservabilityApp` with at least a local plugin. Construction throws if `experiments.primary !== datasets.primary`, if `reviewQueue` is not `local`, or if a control primary has no matching plugin. Defaults for all four primaries are `local`. Construction also registers the app as the process singleton (`getObservabilityApp()`) through the dependency-free observability registry, so routes do not import the plugin class that registers them. Call `resetObservabilityApp()` in tests. `createLocalObservabilityPlugin()` registers the local Mongo models (`ObsPrompt`, `ObsPromptVersion`, `ObsPromptLabel`, `ObsTrace`, `ObsSpan`, `ObsScore`) on the default connection.

The example backend always registers `createLocalObservabilityPlugin()` and passes the
validated `AI_OBS_PRICE_MAP_JSON` object as `priceMap`. `bun run backend:seed` idempotently
creates `examples/example-summarize` with production on v1 and an experimental v2, installs
`correctness-human` and `schema-assert`, and creates a two-item proofread `example-gold`
dataset bound to the prompt input schema. The same seed creates `examples/chat-safety-screen`
(production v1 scores the new message alone; v2 reads earlier turns), `examples/chat-safety-judge`,
the `chat-safety-agreement` llm-judge, and the 12-item proofread synthetic dataset
`chat-safety-synthetic`. Each row is one new message plus earlier turns from a two-person chat,
labeled for 988 vs care-team routing, toxicity, a privacy leak, and a dismissive reply.
Admin → Scripts → `seedChatSafetyDataset`, or `bun run script seedChatSafetyDataset --wet` from
`example-backend`, loads that set into an already-running database. `SEED_DEFAULTS=true` loads
it on boot, including PR preview. Invalid price JSON or negative/non-numeric prices
fail startup with `AI_OBS_PRICE_MAP_JSON` in the error.

`POST /ai/example-summarize` (example backend) runs that seeded prompt with
`promptLabel: "production"`, `userId`, and `sessionId` from `x-ai-session-id`. It uses the
server `AIService` when configured, otherwise a request-scoped service built from
`x-ai-api-key`, and returns **503** when neither exists. The example frontend calls it from
**Todos → Summarize**.

### Local observability models

| Model | Role |
| --- | --- |
| `ObsPrompt` | Named prompt (`name` unique) with `folder` and `tags[]` |
| `ObsPromptVersion` | Immutable `vN` body, `variables[]`, schemas, `sensitive` (default false), `config` |
| `ObsPromptLabel` | Movable labels; unique `(promptId, label)` |
| `ObsTrace` | Root trace: user, session, status, `errorSummary`, `sensitive`, `prompts[]`, usage |
| `ObsSpan` | Nested span with `kind`, `status`, optional `error`, offsets, usage |
| `ObsScore` | Scores on a trace/span; many per trace, **no unique index** |
| `ObsEvaluator` | Evaluator: `type` (`human` \| `llm-judge` \| `json-assert`), `target`, `dimensions[]`, `runModes`, `instructions`, `judgePromptName` (judge), `assertion` (json-assert), `confidenceAlertBelow` (default 0.7) |
| `ObsReviewItem` | Review queue item: status, evaluator, trace, reason, scores, comment |
| `ObsDataset` | Named dataset with optional `inputSchemaPromptName` and `expectedOutputSchema` |
| `ObsDatasetItem` | Item with `input`, `expectedOutput`, `origin`, `proofread`, `tags`, `outcomeClass`, `sourceTraceId`, `metadata` |
| `ObsExperiment` | Compares 2–3 prompt versions on a dataset with thresholds and aggregates |
| `ObsExperimentItem` | Per dataset row: outputs per version, evaluator score maps, gate failure flags |

`POST /ai/observability/traces/review` requires a `human` `ObsEvaluator`. Its
`dimensions[]` render as reviewer score fields and `instructions` render above the review form.
Automatic evaluator types return **400** instead of entering the human queue. Submitting a review
requires every dimension marked `required`; omitted optional dimensions do not create empty score
rows. The local score store remains the fallback when no external score sink is configured.

`AIService` generate methods:

| Option | Default | Behavior |
| --- | --- | --- |
| `promptName` | unset | Resolve `PromptRegistry.get({name, label})` **before** the model call, even when `skipTrace` is true |
| `promptLabel` | `"production"` | Label used with `promptName` |
| `skipTrace` | `false` | Skip `TraceSink.export` only; prompt resolve and `AIRequest` still run |
| `sensitive` | inherited | Explicit value wins; otherwise the resolved prompt version's `sensitive` |
| `sessionId` / `userId` | unset | Copied onto the exported trace |
| `priceMap` | app `priceMap` | Per-call override; `costUsd` is omitted when the model is unpriced |

Missing registry, missing prompt, or missing label throws `APIError` 400 and does not call the model. Sink `export` failures are logged and never fail generate.

**GPT tool spans:** `/gpt/prompt` collects streamed `tool-call` / `tool-result` events into `TOOL` child spans (name = tool name, input = args, output = cleaned result with large `fileData` stripped). When any tool span is present, `AIService.recordGenerate` exports one trace with a `CHAIN` root plus `TOOL` children linked by `parentSpanId`. Ordinary `generateText` / JSON helpers without `childSpans` still emit a single `LLM` root span.

`ObservabilityApp.exportTrace(trace)` fans out to every `TraceSink` (best-effort) and returns the first persisted `{id}` from sinks that support it (for example `LocalTraceSink`). `TraceSink.export` may return `TraceExportResult` (`{id?: string}`) or `void`; `MemoryTraceSink` remains in-memory only.

When `prompts.primary` is `local`, `ObservabilityApp.register` mounts admin-only prompt routes at `/ai/observability`. Pass `aiService` on `ObservabilityApp` for playground runs and the multi-stage trace smoke endpoint. Apps that let an admin supply a per-request provider key may instead set `requestAiServiceFactory`; both the playground and the multi-stage smoke endpoint read the key from `x-ai-api-key`, while a configured server `aiService` remains preferred. `GET /ai/observability/status` is always mounted so admin chrome can read plugin ids, capabilities, primaries, `localOn`, and `playgroundAi.source` (`server` \| `request-key` \| `unavailable`). Admin UIs use that field to distinguish “save a provider key” from true backend misconfiguration.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/ai/observability/status` | Admin chrome. `{plugins, primaries, localOn, playgroundAi}` — drives the status chip, hides Review when `localOn` is false, and tells the prompt playground whether AI comes from `ObservabilityApp.aiService` (`server`), per-request `x-ai-api-key` via `requestAiServiceFactory` (`request-key`), or is not configured (`unavailable`) |

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/ai/observability/prompts` | List. Query `folder`, `search`, `include=usage7d` (7-day calls/cost). `production` is `"—"` until a production label exists |
| POST | `/ai/observability/prompts` | Create prompt in a folder as immutable v1 (`latest` label) |
| GET | `/ai/observability/prompts/:name` | Prompt + versions + labels |
| POST | `/ai/observability/prompts/:name/versions` | Create `vN+1`; never mutates an existing version |
| POST | `/ai/observability/prompts/:name/labels` | Move `production` or `staging`; `outgoingVersion` is the previous pointer |
| POST | `/ai/observability/prompts/:name/playground` | Compile `{{var}}` + one `AIService` call; returns compiled messages, output, latency, tokens, cost; creates no version. Uses `ObservabilityApp.aiService`, or `requestAiServiceFactory({apiKey, modelId})` when the server service is absent (`apiKey` comes from `x-ai-api-key`) |

`PromptRegistry.get({name, label})` (default label `production`) reads the labelled local version. `createLocalObservabilityPlugin()` wires `LocalPromptStore` as that registry and local `TraceSink` / `ScoreSink`.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/ai/observability/traces` | Admin list. Query `from`, `to`, `prompt`, `status`, `userId`, `sessionId`, `hasScore`, `sensitive`, `flaggedForDataset`, `page`, `limit`. Body is `{data, page, limit, more, total}` so pagination survives RTK `{data}` unwrap. Each row includes `spanCount` and `scoreCount`. `prompts.length` is the `N prompts` count |
| GET | `/ai/observability/traces/:id` | Span tree (kind, offsets, durations, I/O, cost) plus scores. `errorSummary` is the first span with `status: "error"` |
| POST | `/ai/observability/traces/:id/scores` | Persist a score and fan out to every `ScoreSink` |
| POST | `/ai/observability/traces/test-multi-stage` | Admin-only smoke workflow, registered only with the local trace sink. Uses `ObservabilityApp.aiService`, or `requestAiServiceFactory({apiKey})` when the server service is absent (`apiKey` comes from `x-ai-api-key`); answers **503** with the same missing-key title as playground when neither exists. Body `{input?: string}` (defaults to a built-in sample). Runs two `AIService.generateJsonObject` calls with `skipTrace: true` and named JSON output schemas (`obs-test-multi-stage-call-1` / `call-2`), a deterministic local `text-metrics` `TOOL` stage, then a final `generateJsonObject` synthesis against `obs-test-multi-stage-final`; exports exactly one parent trace with ordered child spans `LLM`, `LLM`, `TOOL`, `LLM` under a `CHAIN` root. LLM span input includes `outputSchema`. Returns `{traceId, output, stages[]}` where `output` is the final schema object (`sentence`, `phrase`, `keywords`, `metrics`). Child LLM failures export an error trace then rethrow |

`createLocalObservabilityPlugin()` registers `ObsEvaluator` with the other local models.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/ai/observability/evaluators/templates` | Seeded templates: `llm-judge` (`correctness`, `hallucination`, `helpfulness`, `toxicity`), `json-assert` (`schema-assert`), and human queue variants (`correctness-human`, …) |
| POST | `/ai/observability/evaluators/templates/:name` | Install a template by name as an immutable-named evaluator |
| GET/POST | `/ai/observability/evaluators` | List / create. Create accepts `target: "full trace"` only (`generation span` and `dataset item` → 400). Seeded template install can still store other targets. `llm-judge` requires `judgePromptName`; create rejects when the judge prompt `outputSchema` omits a required dimension (400 names the key). `json-assert` supports `assertion` (`path` + `constraint`) or built-in output-schema mode. Human + `liveSampleRate > 0` → 400. Numeric dimension `range` is `min-max` (for example `0-1`); categorical `range` is `label|label` |
| GET/PATCH/DELETE | `/ai/observability/evaluators/:id` | Read / update / soft-delete |
| POST | `/ai/observability/traces/review` | Enqueue one or many traces against a human evaluator (`reason: "manual"`) |
| GET | `/ai/observability/review` | Queue by `status` with counts; oldest-first. Response includes `more: false` so RTK preserves the count envelope. Rows include `traceName`, `promptName`, assignee, reason, and enqueue time |
| GET | `/ai/observability/review/:id` | Item + evaluator dimensions + `given` / `wrote` panels and `rawInput` / `rawOutput` for the Raw JSON disclosure |
| POST | `/ai/observability/review/:id` | `submit` (scores via ScoreSinks, status `done`), `skip`, or `assign` |

`createLocalObservabilityPlugin()` wires `LocalDatasetStore` and `LocalExperimentRunner` when datasets/experiments primaries are `local`.

| Method | Path | Behavior |
| --- | --- | --- |
| GET/POST | `/ai/observability/datasets` | List (includes `humanCount` for proofread items, `autoCount` for unreviewed trace or synthetic items, `needsReviewCount`) / create |
| GET/PATCH/DELETE | `/ai/observability/datasets/:id` | Detail (with counts) / update / soft-delete. PATCH `null` clears optional dataset fields; omitted fields stay unchanged |
| GET/POST | `/ai/observability/datasets/:id/items` | List / create items |
| PATCH/DELETE | `/ai/observability/datasets/:id/items/:itemId` | Update labels (`expectedOutput`, `proofread`, `tags`, `outcomeClass`) / delete (does not touch the source trace). PATCH `null` clears optional item fields |
| POST | `/ai/observability/datasets/:id/import` | **JSON:** body is an array of bare input objects, or structured rows with `input` / `expectedOutput` / `proofread` / `tags` / `outcomeClass` / `metadata`. **CSV:** `Content-Type: text/csv` with raw CSV body, or JSON `{format: "csv", content: "..."}`. Plain columns map to `input`; plain `input` / `expectedOutput` cells accept JSON values; `input.foo` and `expectedOutput.foo` nest fields; reserved `proofread`, `tags`, `outcomeClass` map metadata. Nested paths reject `__proto__`, `constructor`, and `prototype` segments. Rows validate against the dataset's bound prompt `inputSchema` when `inputSchemaPromptName` is set; 400 reports row number and JSON path |
| POST | `/ai/observability/traces/add-to-dataset` | `{datasetId, traceId \| traceIds[]}`. Copies span I/O; `origin: "trace"`; `sourceTraceId` set; **sensitive traces always `proofread: false`** |

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/ai/observability/experiments/estimate` | `{datasetId, promptName, versions[], evaluatorIds[], modelOverride?}` → generation count, USD, wall-clock estimate |
| GET/POST | `/ai/observability/experiments` | List / create. Body: dataset, 2–3 version numbers, evaluator ids, optional `thresholds[]` (defaults to `SOP_DEFAULT_THRESHOLDS`), `modelOverride`, `includeUnproofread` (default false). Evaluator ids must be `llm-judge` or `json-assert` (human → 400). Local primary always enqueues `BackgroundTask` (even one item) |
| GET | `/ai/observability/experiments/:id` | Status, progress, per-version aggregates, gate pass/fail (`gates[].version`), `outlierItemIds`, `lowConfidenceItemIds`, per-item side-by-side (**failed rows first**) |
| POST | `/ai/observability/experiments/:id/promote` | `{version}` moves the `production` label when **that version's** gates pass; **409** while any gate for the selected version fails |

Authenticated `POST /ai/observability/traces/:id/feedback` records thumbs, outcome class, and flag-for-dataset (phase 2.6).

## Durable agent harness

`@terreno/ai/harness` runs multi-phase tasks that survive restarts. Each phase commits a
checkpoint and its `ObsSpan` audit record in one Mongo transaction, so it needs a replica
set and `createLocalObservabilityPlugin()`. Owner and task leases resume crashed work on a
fresh process; phases that are not replay-safe park as `interrupted` until an operator calls
`resolveInterrupted`. A thrown phase retries with exponential backoff before it fails.
Phases can start child tasks (`rt.createTask`), wait on them (`rt.waitForTasks`), and
`harness.abort` stops a whole ownership tree bottom-up, running compensation handlers.
`defineAgent` / `defineTool` run durable agent conversations: each turn is a task whose
model requests retry 429/5xx and fall back to other models, and whose tool calls run as
child tasks with per-tool replay rules. `rt.runAgent` runs an agent as a subagent from a
phase (a task-owned conversation) and returns its text or schema-checked output.
API: [AI harness reference](ai-harness.md).
Why: [Durable agent harness](../explanation/durable-agent-harness.md).
How-to: [Ship a new task version](../how-to/ship-a-new-task-version.md).

## Langfuse integration

Low-level exports (also used by `addGptRoutes` when `langfuseSystemPromptName` is set):

- **Client:** `initLangfuseClient`, `getLangfuseClient`, `isLangfuseInitialized`, `shutdownLangfuseClient`
- **Prompts:** `getPrompt`, `createPrompt`, `compilePrompt`, `invalidatePromptCache`, `preparePromptForAI`
- **Tracing:** `initTracing`, `shutdownTracing`, `createTelemetryConfig`
- **Cache:** `LangfuseCache`, `getCached`, `setCached`, `invalidateCache`

Subpath imports for tree-shaking: `@terreno/ai/langfuseClient`, `@terreno/ai/langfuseApp`.

## FileStorageService

Google Cloud Storage helper for uploads referenced by `addFileRoutes`.

```typescript
const storage = new FileStorageService({
  bucketName: "my-bucket",
  storageOptions: {}, // optional @google-cloud/storage options
});

await storage.upload({buffer, filename, mimeType, userId});
await storage.getSignedUrl(gcsKey);  // 1-hour v4 signed URL
await storage.delete(gcsKey);        // GCS delete + soft-delete FileAttachment
```

## getMCPTools

Wraps registered `modelRouter` MCP tools as Vercel AI SDK `Tool` objects for
in-process `streamText` / `generateText`. HTTP MCP clients still use `POST /mcp`
from `@terreno/api`; this helper is the chat-route path.

```typescript
import {getMCPTools} from "@terreno/ai";

const tools = getMCPTools(req.user);
```

## MCPService

Manages SSE MCP client connections for tool calling.

```typescript
const mcp = new MCPService([
  {name: "my-server", transport: {type: "sse", url: "https://...", headers: {...}}},
]);
await mcp.connect();
const tools = await mcp.getTools();
const status = mcp.getServerStatus();
await mcp.reconnectServer("my-server");
await mcp.disconnect();
```

## Gemini and Vertex helpers

**Gemini Developer API** (API-key based):

```typescript
import {listGeminiApiModels, normalizeGeminiModelId, GEMINI_API_BASE_URL} from "@terreno/ai";

const models = await listGeminiApiModels({apiKey: "..."});
```

**Vertex AI / Gemini Enterprise:**

```typescript
import {
  createVertexProvider,
  listEnabledVertexModels,
  assertVertexModelsEnabled,
  DEFAULT_VERTEX_LOCATION,
} from "@terreno/ai";

const vertex = await createVertexProvider({project: "my-gcp-project"});
const model = vertex.languageModel("gemini-2.5-flash");
```

Env fallbacks: `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION` (default `us-central1`).

## Web search types

`WebSearchProvider` and `WebSearchResult` define a pluggable search interface for custom Vercel AI SDK tools. The package does not ship a default provider — implement `search(query)` and wire it into a `tool()` passed to `AiApp` `tools`.

## Integration example

```typescript
import {TerrenoApp} from "@terreno/api";
import {AiApp, AIService, LangfuseApp} from "@terreno/ai";
import {google} from "@ai-sdk/google";

const aiService = new AIService({model: google("gemini-2.5-flash")});

new TerrenoApp({userModel: User})
  .register(new AiApp({aiService, openApiOptions: {}}))
  .register(
    new LangfuseApp({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
      secretKey: process.env.LANGFUSE_SECRET_KEY!,
    })
  )
  .start();
```

Legacy `setupServer` pattern: call `addGptHistoryRoutes`, `addGptRoutes`, etc. inside `addRoutes`.

## Environment variables

| Variable | Used by | Description |
|----------|---------|-------------|
| `GOOGLE_VERTEX_PROJECT` | `createVertexProvider` | GCP project for Vertex models |
| `GOOGLE_VERTEX_LOCATION` | `createVertexProvider` | Vertex region (default `us-central1`) |
| `AI_OBS_PRICE_MAP_JSON` | `ObservabilityApp` | JSON model map with non-negative `inputPerMTok` / `outputPerMTok`; omitted models have tokens but no USD cost |
| `LANGFUSE_PUBLIC_KEY` | `LangfuseApp` | Langfuse public key |
| `LANGFUSE_SECRET_KEY` | `LangfuseApp` | Langfuse secret key |
| `LANGFUSE_BASE_URL` | Langfuse client | Langfuse host URL |

GCS credentials use standard Google Cloud Application Default Credentials for `FileStorageService`.

## Conventions

- Use `aiModel` on `AIRequest`, not `model` (Mongoose reserved name).
- `GptHistory`, `FileAttachment`, and `Project` use `userId` with `ownerId` virtual for `Permissions.IsOwner`.
- Gpt history list uses `queryFilter: (user) => ({userId: user?.id})`, not `OwnerQueryFilter`.
- Express user in routes: `(req.user as {_id?: ObjectId})` casting pattern.
- Throw `APIError` with appropriate status; check conditions early.
- Uses `Model.findOneOrNone` / `findExactlyOne` — never raw `findOne`.

## Testing

- Framework: `bun test` with preload `./src/tests/bunSetup.ts`
- HTTP: supertest against real routes
- DB: in-memory single-node replica set via `@terreno/test` (transactions work); `TERRENO_TEST_MONGODB_URI` overrides it and must point at a replica set
- Mock AI model: implement `doGenerate` and `doStream` on a fake `LanguageModel`

```typescript
const createMockModel = () => ({
  doGenerate: mock(async () => ({
    finishReason: "stop" as const,
    rawCall: {rawPrompt: "", rawSettings: {}},
    text: "response text",
    usage: {completionTokens: 10, promptTokens: 5},
  })),
  doStream: mock(async () => ({
    rawCall: {rawPrompt: "", rawSettings: {}},
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({type: "text-delta" as const, textDelta: "chunk "});
        controller.enqueue({
          type: "finish" as const,
          finishReason: "stop" as const,
          usage: {completionTokens: 10, promptTokens: 5},
        });
        controller.close();
      },
    }),
  })),
  modelId: "mock-model",
  provider: "mock-provider",
  specificationVersion: "v1" as const,
});
```

Never mock `@terreno/api` or Mongoose models — test against real functionality.
