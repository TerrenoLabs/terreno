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
| `prompts` | array | Messages: `text`, `type` (`user` \| `assistant` \| `system` \| `tool-call` \| `tool-result`), optional `content` parts, `model`, `rating`, tool fields, `status`, `streamId`. `text` is required unless `content` has parts or `status` is set; an image-only assistant response saves `text: ""` |

Assistant replies from `/gpt/prompt` carry `streamId` and `status`: `streaming` while partial text is persisted, then `complete` or `error`. `buildMessages` skips `streaming` replies and `error` replies with no output. Attachment `content` parts carry an optional `gcsKey` when the file was uploaded to durable storage.

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
| `/gpt/prompt` | POST | `IsAuthenticated` | SSE streaming chat; body: `prompt`, optional `historyId`, `systemPrompt`, `attachments`, `model`, `projectId` |
| `/gpt/remix` | POST | `IsAuthenticated` | Non-streaming text remix; body: `{text}` |
| `/gpt/histories/:id/rating` | PATCH | `IsAuthenticated` | Rate a prompt; body: `{promptIndex, rating: "up" \| "down" \| null}` |
| `/gpt/histories/:id/stream` | GET | `IsAuthenticated` (owner) | SSE resume of an in-flight reply; query: optional `streamId`, `offset` |
| `/gpt/tools` | GET | `IsAuthenticated` | List builtin + MCP tools |

Generated images (image-output models such as `gemini-3-pro-image`) arrive as SSE `image` events: `{image: {mimeType, url}}` with a base64 data URL. Each image is sent once, even when the model reports it both as a stream file part and in the final `result.files`. The saved assistant prompt stores one `image` content part per image. On later turns, `buildMessages` sends an image-only assistant prompt to the model as the text `[Generated image]`, because providers reject empty assistant turns.

#### Attachments

Each `attachments` item is `{type: "image" | "file", url, mimeType, filename?}`. The `url` must be `http(s):` or `data:`. Client-only URLs (`blob:`, `file:`, `content:`, `ph:`) return `400` before streaming starts, because neither the model provider nor a later page load can read them. Upload the file with `POST /files/upload` first, or send it as a `data:` URL.

When `fileStorageService` is set, `data:` attachments are uploaded with `FileStorageService.upload`. The saved user prompt then stores the storage `url` plus `gcsKey`, not the base64 payload. The model still receives the original data for that turn. On later turns, parts with a `gcsKey` are sent to the model as 1-hour signed URLs. A failed upload returns `502 Attachment upload failed`. Without storage, attachments are saved as sent.

#### Stream events and resume

`/gpt/prompt` saves the user turn and a `status: "streaming"` assistant placeholder before streaming. While the reply streams, partial text is persisted about every second (`streamPersistIntervalMs`), plus a heartbeat every 10 seconds. The final reply replaces the placeholder with `status: "complete"`. On failure, partial text is kept with `status: "error"`; an empty placeholder is removed.

| Event | Sent by | Meaning |
|-------|---------|---------|
| `{historyId, started: true, streamId}` | prompt | First event; the turn is saved and resumable |
| `{historyId, resumed: true, streamId?}` | resume | First event; `streamId` is absent when nothing is streaming |
| `{text}` | both | Text delta |
| `{replace: true, text}` | resume | Persisted text was rewritten (a step became a tool call); `text` is the whole reply |
| `{image: {mimeType, url}}` | both | Generated image |
| `{file}`, `{toolCall}`, `{toolResult}` | prompt | File and tool events |
| `{error}` | both | Error; resume sends it when the reply ended as `error` or went stale |
| `{done: true, historyId, title?}` | both | Reply finished |

`GET /gpt/histories/:id/stream` re-attaches after a reload or remount. Pass `offset` as the number of characters the client already shows, usually the stored placeholder `text`. The endpoint polls the stored history (`streamResumePollIntervalMs`, default 500 ms), so it works across server instances. A `streaming` reply with no update for `streamStaleAfterMs` (default 60 s) is marked `error`.

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
| `fileStorageService` + `gcsBucket` | Enable file upload routes and durable `/gpt/prompt` attachments |
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
- DB: memory Mongo via `@terreno/test` (`TERRENO_TEST_USE_MEMORY_MONGO` or `TERRENO_TEST_MONGODB_URI`)
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
