# @terreno/ai

AI service layer for Terreno backends: provider-agnostic chat via the Vercel AI SDK, request logging, GPT history, projects, file uploads, MCP tools, and optional Langfuse integration.

> `@terreno/ai` is provider-agnostic via the Vercel AI SDK (the `ai` package and its `@ai-sdk/*` providers). That is a model library, unrelated to Vercel hosting; on this page "Vercel" means the AI SDK unless it says hosting. To host on Vercel, see [Deploy to Vercel](../how-to/deploy-to-vercel.md).

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
- [Cost and abuse limits](#cost-and-abuse-limits)
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
  aiAdminApp.ts            # AIAdminApp: AI Requests screen + global Skills admin model
  configuration.ts         # aiConfigurationSchema, configurationPromptGetter
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
    gptSkill.ts            # Skills (SKILL.md format) with user and global scopes
  routes/
    gpt.ts                 # Streaming chat, remix, tools, ratings
    gptHistories.ts        # History CRUD, headless pendingAsks and turn actions
    aiRequestsExplorer.ts  # Admin request explorer
    files.ts               # File upload/signed URL/delete
    projects.ts            # Project CRUD + memories
    mcp.ts                 # MCP server status and tools
    skills.ts              # /gpt/skills CRUD + upload
  service/
    aiService.ts           # Provider-agnostic AI service
    asks.ts                # Ask tools, reserved ask_ names, paused-turn replay
    chatTurn.ts            # Chat turn runner behind /gpt/prompt (SSE sink) and turn (buffered JSON)
    fileStorage.ts         # GCS upload helper
    generateImageTool.ts   # Built-in generate_image chat tool
    skillPackage.ts        # Parse an uploaded SKILL.md or .zip skill package
    skills.ts              # Skill catalog, load_skill tool, /name activation
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
  `getMCPTools`, `runBufferedChatTurn` (one chat turn to completion without HTTP: the same system
  prompt, tools, and block checks as `/gpt/histories/:id/turn`; takes `{body: {historyId, prompt},
  options, req}` where `req` carries `user` and `headers`)
- **Models:** `AIRequest`, `GptHistory`, `FileAttachment`, `GptSkill` (plus `setSkillFileStorage`), `Project` (lazy; prefer `getProjectModel()`)
- **Routes:** `addGptRoutes`, `addGptHistoryRoutes`, `addAiRequestsExplorerRoutes`, `addFileRoutes`, `addProjectRoutes`, `addMcpRoutes`, `addSkillRoutes`
- **Configuration:** `aiConfigurationSchema`, `configurationPromptGetter` ([Default system prompt](#default-system-prompt))
- **Skills and images:** `parseSkillPackage`, `createGenerateImageTool`, `GENERATE_IMAGE_TOOL_NAME`, types `SkillPackage`, `SkillPackageFile`, `GptSkillDocument`, `GptSkillFile`, `GptSkillModel`, `GptSkillScope`, `ImageGenerationOptions`, `ImageStylePrompt`, `DefaultSystemPrompt` ([Skills in chat](#skills-in-chat), [Image generation](#image-generation))
- **Structured output:** `parseAiJson`, `normalizeLlmJsonTextForStructuredOutput`, re-exported `Output`, `jsonSchema`, `JSONValue`, `FlexibleSchema` from `ai`
- **Langfuse:** `initLangfuseClient`, `getLangfuseClient`, `shutdownLangfuseClient`, `compilePrompt`, `createPrompt`, `getPrompt`, `createTelemetryConfig`, `preparePromptForAI`, `initTracing`, `shutdownTracing`, `LangfuseCache`, cache helpers
- **Gemini / Vertex:** `listGeminiApiModels`, `normalizeGeminiModelId`, `GEMINI_API_BASE_URL`, `createVertexProvider`, `listEnabledVertexModels`, `verifyVertexModelsEnabled`, `assertVertexModelsEnabled`, `isVertexModelAllowed`, `normalizeVertexModelId`, `DEFAULT_VERTEX_LOCATION`
- **Prompts:** `COMPACT_SURFACE_SYSTEM_PROMPT`, `CONTENT_SUMMARY_PROMPT`, `DEFAULT_GPT_MEMORY`, `JSON_VALUE_SYSTEM_PROMPT`, `REMIX_PROMPT`, `TERRENO_ASKS_SYSTEM_PROMPT`, `TITLE_GENERATION_PROMPT`, `TRANSLATION_PROMPT`
- **Block host actions:** `scaleStepperHostAction`, `toggleChecklistHostAction`, `findAgentBlock`, types `HostAction`, `HostActionContext`, `HostActionResult` ([Host actions](#host-actions))
- **Asks:** `createAskTools({kinds, surface?})`, `TERRENO_ASKS_SYSTEM_PROMPT`, `COMPACT_SURFACE_SYSTEM_PROMPT`, types `AsksOptions`, `ApprovalAskInput`, `AskOrigin`, `GptHistoryPendingAsk`, `GptHistoryPromptAsk`, `GptHistoryAskStatus`, and `Ask`, `AskKind`, `AskResponse`, `AskValidationError`, `SimpleCard`, `SimpleCardButton` re-exported from `@terreno/blocks` ([Agent UI Asks](agent-ui-asks.md))
- **Web search:** `WebSearchProvider`, `WebSearchResult` types
- **Harness (subpath `@terreno/ai/harness`):** `Harness`, `defineTask`, `defineAgent`, `defineTool`, `defineExtension`, `section`, `hook`, `wrapTool`, `HarnessExtensionError`, `HARNESS_HOOK_KINDS`, `HarnessConversationHandle`, `HarnessConversationBusyError`, `HarnessConversationOwnedError`, `HARNESS_EVENT_TYPES`, `HARNESS_SUBMIT_DISPOSITIONS`, `HARNESS_WHEN_BUSY`, `HarnessModelCallError`, `HarnessSubagentError`, `isRetryableModelError`, `AGENT_TURN_TASK_NAME`, `AGENT_TOOL_TASK_NAME`, `HARNESS_AGENT_DEFAULT_MAX_STEPS`, `HARNESS_CONVERSATION_STATUSES`, `HARNESS_INTERRUPT_ACTIONS`, `HARNESS_MESSAGE_ROLES`, `HARNESS_MODEL_RETRY_DEFAULTS`, `InProcessRunner`, `HarnessCommitConflictError`, `HARNESS_RESOLVE_ACTIONS`, `HARNESS_RETRY_DEFAULTS`, `HARNESS_TASK_STATUSES`, `HARNESS_WAIT_KINDS`, `HARNESS_WAIT_POLICIES`, `HARNESS_WAIT_RESOLUTIONS`, `IN_PROCESS_RUNNER_ROLES`, `approvalGate`, `approvalTaskInput`, `HarnessApp`, `HarnessApprovalConflictError`, `HARNESS_APPROVAL_STATUSES`, `HARNESS_DEFAULT_APPROVERS` — see [AI harness reference](ai-harness.md)

## AIService

Provider-agnostic wrapper around a Vercel AI SDK `LanguageModel`. The consuming app supplies the model instance.

```typescript
import {AIService} from "@terreno/ai";
import {google} from "@ai-sdk/google";

const aiService = new AIService({
  model: google("gemini-3.8-flash"),
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
| `generateBlocks(options)` | One block document via `Output.object(blocksJsonSchema)`, then `validateBlocks`. Temperature is always `TemperaturePresets.DETERMINISTIC` (0). Logs as `"ui_blocks"`. |
| `generateJsonArray(options)` | Typed array via `Output.array()`; logs as `"json_array"` |
| `generateTextStream(options)` | Async generator of text chunks; logs full response after stream completes |
| `generateRemix(options)` | Reword text using `REMIX_PROMPT` at `TemperaturePresets.BALANCED` |
| `generateSummary(options)` | Summarize text using `CONTENT_SUMMARY_PROMPT` at `TemperaturePresets.LOW` |
| `translateText(options)` | Translate text using `TRANSLATION_PROMPT` at `TemperaturePresets.LOW` |
| `buildMessages(prompts)` | Convert `GptHistoryPrompt[]` to Vercel AI SDK `ModelMessage[]`. Skips host tool-call/result rows and approval ask rows (`ask.origin: "approval"`). Keeps each answered or cancelled ask as an assistant tool call plus its tool result; consecutive ask calls share one assistant message. Skips asks still waiting for an answer. |
| `generateChatStream(options)` | Stream multi-turn chat with optional tools; logs prompt as joined message text |

All generation methods log to `AIRequest` via private `logRequest()`. Logging failures never throw.

## Structured JSON output

`generateBlocks({prompt, systemPrompt?, userId?, repair?})` asks for one block document:

- Uses `TERRENO_UI_BLOCKS_SYSTEM_PROMPT` when `systemPrompt` is omitted.
- Temperature is `TemperaturePresets.DETERMINISTIC` (0).
- Checks the object with `validateBlocks`. When `repair` is omitted or true, one retry appends the error list to the user prompt. `repair: false` skips that retry.
- A second validation failure throws `APIError` 422 (`title: "Block document failed validation"`, `meta.fields` keyed by error code) and stores `metadata.errorCodes` on the `AIRequest`. A model or network error throws 502 (`title: "Block generation failed"`) and is not repaired.

`generateJsonValue`, `generateJsonObject`, and `generateJsonArray`:

- Default to `TemperaturePresets.DETERMINISTIC` when `temperature` is omitted.
- Use `JSON_VALUE_SYSTEM_PROMPT` when `systemPrompt` is omitted.
- Run model text through `normalizeLlmJsonTextForStructuredOutput` before the Vercel AI SDK's `Output.*` parsing (strips fences, preamble, balanced JSON slice, trailing commas, smart-quote repair).
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
| `requestType` | string | e.g. `general`, `remix`, `summarization`, `translation`, `json_value`, `json_object`, `json_array`, `ui_action`, `ui_blocks` |
| `response` | string? | Response text |
| `responseTime` | number? | Milliseconds |
| `tokensUsed` | number? | Total tokens |
| `userId` | ObjectId? | Requesting user |
| `error` | string? | Error message |
| `metadata` | Mixed? | Extra data (e.g. structured-output debug; `ask` and `nextAsk` for [asks](agent-ui-asks.md#stored-state)) |
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
| `title` | string? | Auto-generated on the first chat turn's reply (`/gpt/prompt` or `turn`) when empty |
| `projectId` | ObjectId? | Optional project association |
| `prompts` | array | Messages: `text`, `type` (`user` \| `assistant` \| `system` \| `tool-call` \| `tool-result`), optional `content` parts, `model`, `rating`, tool fields (`toolCallId`, `toolName`, `args`, `result`), `ask: {kind, status}` on ask `tool-call` rows (`status`: `pending` \| `answered` \| `cancelled`), and on assistant replies `status` (`streaming` \| `complete` \| `error`) plus `streamId`. `text` is required unless `content` has parts or `status` is set; an image-only assistant response saves `text: ""` |
| `pendingAsk` | object? | The ask the conversation waits on: `toolCallId`, `kind`, `input`, `simple`, `promptIndex`, `responseMessages`, `created`, and for an approval ask `origin`, `approvalId`, `toolName`. `/gpt/histories` responses leave out `promptIndex` and `responseMessages`. Only a chat turn (`/gpt/prompt` or the `turn` action) sets and clears it; see [Agent UI Asks](agent-ui-asks.md#stored-state). |

Assistant replies from `/gpt/prompt` carry `streamId` and `status`: `streaming` while partial text is persisted, then `complete` or `error`. A paused ask's reply is `complete`, and `pendingAsk` is set beside it. `buildMessages` skips `streaming` replies and `error` replies with no output. Attachment `content` parts carry an optional `gcsKey` when the file was uploaded to durable storage.

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

### GptSkill

A skill in Anthropic's `SKILL.md` shape: a name, a one-line description, markdown instructions, and optional reference files. Collection `gptskills`. Registered on import of `@terreno/ai`.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Required. `^[a-z0-9-]{1,64}$` |
| `description` | string | Required, 1–1024 characters. Listed in the chat's skill catalog |
| `instructions` | string | Required markdown, at most 50,000 characters. Returned by `load_skill` and `/name` |
| `files` | array | `{filename, mimeType, size, gcsKey}`. At most 20 files and 10 MB total. MIME types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `application/pdf`, `text/plain`, `text/csv`, `application/json`, `text/markdown`. `gcsKey` never leaves the server |
| `scope` | `"user"` \| `"global"` | Required. `user` skills are visible to their owner; `global` skills to every user |
| `userId` | ObjectId? | Owner of a `user` skill (required then); unset on a `global` skill |
| `enabled` | boolean | Default `true`. A disabled skill is left out of the catalog, `load_skill`, and `/name` |

**Plugins:** `createdUpdatedPlugin`, `isDeletedPlugin`. **Virtual:** `ownerId` aliases `userId`.

Rules enforced on the model, so `/gpt/skills` and the admin routes both get them:

- A skill saved with neither `scope` nor `userId` becomes `global` (the admin create path). A `global` skill never keeps a `userId`.
- A name is unique per (`scope`, `userId`) among non-deleted skills: 409 `Skill <name> already exists`. A `user` skill may not take a global skill's name: 409 `A global skill named <name> already exists`. A unique partial index on (`name`, `scope`, `userId`) backs the same-scope check against concurrent creates; the user-versus-global check has no index.
- A soft delete (through `doc.save()` or an `updateOne` / `updateMany` / `findOneAndUpdate` that sets `deleted: true`) removes the skill's files from storage. The model reads the storage service from `setSkillFileStorage(service)`, which `addSkillRoutes` calls at registration.

### Project

GPT project with persistent context and memories. Registered lazily: `getProjectModel()`
(or any use of the deprecated `Project` export) registers it.

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
| `/gpt/prompt` | POST | `IsAuthenticated` | SSE streaming chat turn; [body](#gptprompt-body) and [events](#sse-events) below |
| `/gpt/remix` | POST | `IsAuthenticated` | Non-streaming text remix; body: `{text}` |
| `/gpt/histories/:id/rating` | PATCH | `IsAuthenticated` | Rate a prompt; body: `{promptIndex, rating: "up" \| "down" \| null}` |
| `/gpt/histories/:id/stream` | GET | `IsAuthenticated` (owner) | SSE resume of an in-flight reply; query: optional `streamId`, `offset` |
| `/gpt/tools` | GET | `IsAuthenticated` | List builtin + MCP tools (ask tools are not listed) |
| `/gpt/datasets/:id` | GET | owner (`IsOwner`; another user is 404) | Read a stored dataset. Mounted only when `uiBlocks` is on. Query: `grain` (`hour` \| `day` \| `week` \| `month`), `limit` (default 500, max 1000), `page`. Response `data`: `{columns, rows, rowCount, page, more}`. `grain` buckets the first date column in UTC. An offset is converted before `startOf`. A date with no zone is that UTC day. Null date cells are skipped. Number columns are summed. Without `page`, a series longer than `limit` is LTTB-downsampled and `more` is false. With `page`, rows are a page and `more` is true when another page remains. |
| `/gpt/actions` | POST | `IsAuthenticated` plus history owner (another user is 403) | Run a host callback. Mounted only when `uiBlocks` is on, on the `/gpt` path. Body: `{historyId, messageId, blockId, elementId, name, payload?}`. Unknown `name` is 404. A payload that fails the host schema is 400 with `meta.fields`. The handler has 10 seconds (`actionTimeoutMs` can set another cap) and then 504. Response `data`: `{text?, blocks?, replace?}`. An invalid `blocks` document is 500. Logged as `AIRequest` `requestType: "ui_action"` with an ids-only prompt and the response; an action with `logResponse: false` adds a numeric `payload.value` to the prompt and logs no response. |

Generated images (image-output models such as `gemini-3-pro-image`) arrive as SSE `image` events: `{image: {mimeType, url}}` with a base64 data URL. Each image is sent once, even when the model reports it both as a stream file part and in the final `result.files`. The saved assistant prompt stores one `image` content part per image and `text: ""` when there is no text. On later turns, `buildMessages` sends an image-only assistant prompt to the model as the text `[Generated image]`, because providers reject empty assistant turns.

AI resolution order: `x-ai-api-key` header + `createModelFn` → `createServerModelFn(modelId)` → configured `aiService`. When none resolves, `/gpt/prompt` streams a canned demo reply and `/gpt/remix` returns it. This happens whether or not `demoMode` is set.

#### Default system prompt

`defaultSystemPrompt` (on `addGptRoutes` and `AiApp`) is an app-wide system prompt for every chat turn, on `/gpt/prompt` and the headless `turn` action. It is a string, or a function `({req}) => string | undefined | Promise<string | undefined>` called once per turn with the signed-in `req.user`. The system prompt order is:

1. the default system prompt
2. the Langfuse prompt (`langfuseSystemPromptName`)
3. project context and memories
4. the request's `systemPrompt`
5. the `## Skills` catalog, when `skills` is on ([Skills in chat](#skills-in-chat))
6. one `## Active skill: <name>` section per leading `/name` in the prompt
7. the asks, blocks, and compact sections, when those options are on

The value is trimmed. An empty or whitespace-only value, or `undefined`, adds nothing. A function that throws is logged with `logger.warn` and the turn continues without it. An admin `promptName` override replaces layers 1–6, the default included. Image-output models receive the default too, but never the skill sections.

To let admins edit it, mount `aiConfigurationSchema` on the app's `configurationPlugin` model and read it per turn with `configurationPromptGetter`:

```typescript
import {AiApp, aiConfigurationSchema, configurationPromptGetter} from "@terreno/ai";
import {configurationPlugin} from "@terreno/api";
import mongoose, {Schema} from "mongoose";

const appConfigSchema = new Schema({ai: aiConfigurationSchema /* , ...other sections */});
appConfigSchema.plugin(configurationPlugin);
const AppConfig = mongoose.model("AppConfig", appConfigSchema);

new AiApp({aiService, defaultSystemPrompt: configurationPromptGetter(AppConfig, "ai.systemPrompt")});
```

`aiConfigurationSchema` (`_id: false`) has `systemPrompt` ("Default system prompt for every GPT chat") and `imageStylePrompt` ("Style guidance added to every generated image prompt"), both strings defaulting to `""`. `configurationPromptGetter(model, path)` returns a function that reads `model.getConfig(path)` on each turn and returns `undefined` for an empty value.

#### Skills in chat

`skills: true` (on `addGptRoutes` and `AiApp`) offers the caller's skills in every chat turn whose model can call tools (`/gpt/prompt` and the headless `turn` action). Off by default; with it off, the system prompt and tools are unchanged. An image-output model (an id containing `image`) gets no catalog and no tool. Why the design looks this way: [Skills and image generation](../explanation/ai-skills.md).

| Piece | Behavior |
|-------|----------|
| `## Skills` catalog | Appended after the request's `systemPrompt`. One line per skill: `- <name>: <description>`. Enabled, non-deleted skills only. Global skills first by name, then the caller's skills by `updated` descending, at most 50 lines. A user skill whose name a global skill uses is left out. With no visible skill there is no heading and no `load_skill` tool. |
| `load_skill` tool | Input `{name}`. Returns `{name, description, instructions, files: [{ref, filename, mimeType}]}` where `ref` is `skill:<name>/<filename>`, or `{error: "Unknown skill: <name>"}`. Resolves any visible skill, including one beyond the 50-line catalog. A global skill wins over the caller's skill of the same name. |
| `/name` | Up to 3 leading `/name` tokens in `prompt` (`/brand-voice /poster make…`) each add a `## Active skill: <name>` section with the instructions and a `Files:` line of refs. Resolved before the turn starts: an unknown name returns 400 `Unknown skill: <name>` and saves nothing. The stored prompt text is unchanged. |

A host tool (route, request, or MCP) named `load_skill` or `generate_image` is replaced by the built-in one, with a `logger.warn`.

#### Image generation

`imageGeneration` (on `addGptRoutes` and `AiApp`) adds the built-in `generate_image` tool to tool-capable turns. Off by default.

| Option | Type | Description |
|--------|------|-------------|
| `model` | `({req, modelId}) => LanguageModel \| undefined` | The image-output language model for this request (for example Nano Banana, `gemini-3-pro-image`). Called once per turn. `undefined` leaves the tool out of that turn. It is a `LanguageModel`, not an AI SDK `ImageModel`. |
| `modelId` | string | Passed to `model`. |
| `stylePrompt` | `string \| ({req}) => string \| undefined \| Promise<…>` | Put before every image prompt with a blank line between. Trimmed; empty adds nothing. A function that throws logs `logger.warn` and the image is made from the prompt alone. Use `configurationPromptGetter(AppConfig, "ai.imageStylePrompt")` to let admins edit it. |
| `maxCallsPerTurn` | number | Default 4. Every call counts, failed ones included. |

`generate_image` input is `{prompt: string (1–4000), references?: string[] (≤ 4)}`. Each reference is one of:

- `skill:<name>/<filename>`: an image file of a skill the caller can see (own or global).
- `attachment:<gcsKey>`: an image `FileAttachment` the caller uploaded (or one this tool generated for them).

Both are read server-side with `fileStorageService.download`. The tool never fetches a URL; any other string, or a reference without storage configured, is `Unknown reference`.

The tool calls `generateText` on the model with one user message: the style prompt, a blank line, the prompt, then each reference as an image part. It keeps the first image in `result.files`.

| Result | When |
|--------|------|
| `{images: [{id, mimeType}]}` | An image was made. The model gets ids, never bytes. |
| `{error: "Unknown reference: <ref>"}` | A reference did not resolve. |
| `{error: "The image model returned no image"}` | `result.files` held no image. The turn continues. |
| `{error: "Image limit reached for this turn"}` | The call is over `maxCallsPerTurn`. |

Each image is sent as an SSE `{image: {mimeType, url}}` event and saved on the assistant reply as an `image` content part. With a `fileStorageService` that can upload, the image is stored under `generated/<userId>/…` with a `FileAttachment` owned by the chat user; the saved part carries `gcsKey`, the event `url` is a 1-hour signed URL, and the owner's history reads re-sign it (when `addGptHistoryRoutes` gets `chat` with that storage, as `AiApp` does). Without storage, `url` is a `data:` URL saved as is.

Pass `asks: true` (or `{kinds: ["choice"]}`) to let the model ask the user typed questions in the chat. Asks are off by default; with them off, tools, system prompt, and SSE events are unchanged. See [Agent UI Asks](agent-ui-asks.md).

Pass `uiBlocks: true` (or `{hostActions, html, imageHosts, repair, richBlocks, datasetTtlDays, datasetMaxRows}`) to require each assistant reply to be a block document. `html: true` allows `html` blocks and sanitizes them before they are stored. `imageHosts` lists hostnames allowed on `https` image sources in `image`, `gallery`, and `list` blocks; Markdown images in `text` blocks and plain replies are not checked against it (see [Agent UI asks](../explanation/agent-ui-asks.md)). The client receives that document once, after missing action ids are filled, `repair: true` rewrites it, and html is sanitized, and before `{ask}`. `{replace: "text", text}` is sent only when text was already streamed and then changed. `datasetTtlDays` defaults to `0` (keep the dataset). `datasetMaxRows` defaults to 50,000. Off by default; with it off, the system prompt, SSE events, `/gpt/datasets`, and `/gpt/actions` are unchanged. When it is on, the system prompt gains `TERRENO_UI_BLOCKS_SYSTEM_PROMPT` (host callback names included when `hostActions` is set). After the final text, the route validates it and sends `{blocks: {ok, errors, warnings}}` before `{done}`. `hostActions` is the callback allowlist: a name outside it fails with `UNKNOWN_HOST_ACTION`. A stepper or checklist `callback.name` must also name an action whose `handles` is that block; a stepper that names any other registered action fails with `UNKNOWN_HOST_ACTION`. `{repair: true}` runs one repair call when validation fails and stores that reply. A document that is still invalid is stored with a `Block validation errors:` note so the next turn sees it. See [Validate a block document locally](../how-to/agent-ui-blocks.md).

`uiBlocks.richBlocks` defaults to `true`: the prompt offers the rich blocks, and `stepper` when a host action has `handles: "stepper"`. The `checklist` line names the `handles: "checklist"` actions as its callback, or, without one, tells the model to leave `callback` out so ticks stay local. This is a behaviour change on upgrade: every host with `uiBlocks` on gets the new blocks in its prompt. Set `richBlocks: false` while shipped clients (for example older native builds) cannot render them; the prompt is then the same as before rich blocks, even with a stepper action registered. The opt-out changes only what the model is told to write. Validation accepts the rich blocks either way.

#### Host actions

Each `uiBlocks.hostActions` entry is a `HostAction`:

| Field | Type | Description |
|-------|------|-------------|
| `handler` | `(context) => HostActionResult` | Gets `{blockId, elementId, history, messageId, payload, user}`. Returns `{text?, blocks?, replace?}`; `blocks` is a whole `{v: 1, blocks}` document |
| `payload` | Zod-like schema? | Checked with `safeParse` before the handler runs. A failure is 400 `Invalid payload` with `meta.fields` |
| `handles` | `"stepper"` \| `"checklist"`? | The interactive block this action serves. The prompt offers `stepper` only when some action has `handles: "stepper"`, and names those actions as its callbacks. Validation accepts a stepper or checklist only when its `callback.name` is such an action. |
| `logResponse` | boolean? | Default `true`. `false` keeps the returned document out of the `ui_action` log and adds a numeric `payload.value` to its ids-only prompt |

`scaleStepperHostAction` is an opt-in `stepper` action: `{handler, payload, handles: "stepper", logResponse: false}`. Register it under the name the agent writes in `callback.name`:

```typescript
addGptRoutes(router, {
  aiService,
  uiBlocks: {hostActions: {scaleStepper: scaleStepperHostAction}},
});
```

Its payload schema is `z.object({value: z.number()}).passthrough()`, so extra keys from the agent's `callback.payload` pass. The handler:

1. Loads the agent's stepper with `findAgentBlock` (below), not from the request.
2. Checks that `value` is within `min` and `max` and on the `step` grid from the agent's `value`. Otherwise 400 `Invalid stepper value`.
3. Returns `{replace: "block", blocks: {v: 1, blocks: [stepper]}}`. The stepper has the new `value`, and each item's `amount` is `amount × value / agent value`, rounded to its `decimals` (`round: up` rounds up). A stepper the agent wrote with `value: 0` keeps its amounts.

Steps 2 and 3 are `isStepperValueAllowed` and `scaleStepperBlock` from `@terreno/blocks`, so a client without a server (the demo playground) scales the same way. Scaling always starts from the stored original, so rounding does not drift tap after tap. The owner of a history can edit its stored prompts with `PATCH /gpt/histories/:id`, so an app whose numbers matter (prices, stock) registers its own `handles: "stepper"` action over its own data.

`toggleChecklistHostAction` is an opt-in `checklist` action: `{handler, payload, handles: "checklist", logResponse: false}`. Register it under the name the agent writes in `callback.name`; the prompt then tells the model to set a checklist's `callback` to that name:

```typescript
addGptRoutes(router, {
  aiService,
  uiBlocks: {hostActions: {toggleChecklist: toggleChecklistHostAction}},
});
```

Its payload schema is `z.object({itemId: z.string(), checked: z.boolean(), state: z.record(z.string(), z.boolean())}).passthrough()`, so extra keys from the agent's `callback.payload` pass. The handler:

1. Loads the agent's checklist with `findAgentBlock` (below), not from the request.
2. Checks that `itemId` and every `state` key are item ids of that checklist. Otherwise 400 `Unknown checklist item`.
3. Returns `{replace: "block", blocks: {v: 1, blocks: [checklist]}}`. Each item's `checked` is its `state` value; an item missing from `state` is unchecked (the client always sends every item). The ticked `itemId` always takes `checked`.

Steps 2 and 3 are `unknownChecklistItemIds` and `applyChecklistState` from `@terreno/blocks`. It saves nothing, and its `ui_action` log row holds only the ids (no `itemId`, `checked`, or `state`). An app that records progress registers its own `handles: "checklist"` action.

`findAgentBlock({history, messageId, blockId, type})` returns the block of `type` with id `blockId` that an assistant prompt holds, including inside `card` and `columns`. When `messageId` is `msg-<n>` it reads `history.prompts[n]` first (stored prompts have no ids). Otherwise, or when that prompt does not hold the block, it uses the only assistant prompt that does. Several matches throw 409 `Block is ambiguous`; none throws 404 `Block not found`.

With asks on, a host tool with the AI SDK's `needsApproval: true` runs only after the user approves it: the turn pauses on a server-made `confirm` ask. `asks.approvals` sets that ask's input per tool name, as `(input) => ConfirmAskInput` (`ApprovalAskInput`); without an entry, the ask is "Allow &lt;toolName&gt;?" with the tool's description. With asks off, such a tool never runs. See [Approval asks](agent-ui-asks.md#approval-asks).

With `asks` on, pass the same options to `addGptHistoryRoutes` as `chat` to add the non-streaming [headless endpoints](#addgpthistoryroutesrouter-options) for clients that do not read server-sent events.

#### `/gpt/prompt` body

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | string | The user's message. Required unless `askResponse` is sent. |
| `historyId` | string? | Continue this conversation; omit to start one. Required with `askResponse`. |
| `askResponse` | object? | The answer to the pending ask: `{toolCallId, action, content?, reason?}`. Read only when `asks` is on. Send it instead of `prompt`, without `attachments`. See [Answer an ask](agent-ui-asks.md#answer-an-ask). |
| `surface` | `"full"` \| `"compact"`? | Where the user reads and answers. Default `"full"`. `"compact"` is a watch or another small screen: the model gets only button-sized asks and is asked for replies of at most two short sentences. Any other value returns 400. See [Compact surface](agent-ui-asks.md#compact-surface). |
| `systemPrompt` | string? | System prompt for this turn; the default system prompt, the Langfuse prompt, and project context are prepended |
| `attachments` | array? | `{type: "image" \| "file", url, mimeType, filename?}` items added to the user message |
| `model` | string? | Model id passed to `createModelFn` or `createServerModelFn` |
| `projectId` | string? | Project whose context and memories are prepended to the system prompt; saved on a history that has none |

#### SSE events

`/gpt/prompt` streams `data: <json>` lines, one event object per line. `{askResolved}` is sent when an answer is stored, before the model runs. `{started}` is sent when the model produces its first part and the reply row is saved, before any text from that part. On a prompt that is not answering an ask, `{started}` is first. `{ask}` and `{done}` come last. With `uiBlocks` on, `{text}` is the finished document and comes before `{ask}`.

| Event | Shape | When |
|-------|-------|------|
| `{started}` | `{started: true, historyId, streamId}` | Sent when the model produces its first part and the reply row is saved. A reload can resume this `streamId`. It comes before text from that part. A model that fails before any part sends no `{started}`. The demo reply does not send it. |
| `{askResolved}` | `{askResolved: {toolCallId, action}}` | The turn answered the pending ask, or cancelled it because a new `prompt` arrived. Asks only. |
| `{text}` | `{text: string}` | A step's text, sent when the step ends. Text from a step that calls a tool is dropped, unless that text parses as a block document and the turn has no other text. A trailing JSON `"action"` blob is stripped. With `uiBlocks` on, this is the final document: sent once, after id-fill, repair, and sanitizing, and before `{ask}`. |
| `{toolCall}` | `{toolCall: {toolCallId, toolName, args}}` | The model called a host tool (route, request, or MCP). Never sent for ask tools. |
| `{file}` | `{file: {filename, mimeType, url}}` | A host tool result had a `fileData` data URL. Sent before its `{toolResult}`. `filename` defaults to `document` and `mimeType` to `application/octet-stream`. |
| `{toolResult}` | `{toolResult: {toolCallId, toolName, result}}` | A host tool returned. `fileData` is removed from `result`. For a tool whose approval was denied, `result` is `{approved: false, reason}`. Never sent for ask tools. |
| `{image}` | `{image: {mimeType, url}}` | The model generated an image; `url` is a `data:` URL. Each data URL is sent once. |
| `{ask}` | `{ask: {toolCallId, kind, input, simple, origin?, toolName?}, historyId}` | The turn paused on an ask. Sent after the turn is saved. `historyId` is the conversation that waits on the ask, so a new chat's ask can be answered before `{done}`. An [approval ask](agent-ui-asks.md#approval-asks) adds `origin: "approval"` and the host `toolName`. Asks only. |
| `{error}` | `{error: string}` | The model stream reported an error, or the turn failed after the stream started. `{done}` still follows. |
| `{replace}` | `{replace: "text", text}` | The assistant document after the server changed text the client already has: a missing actions `id` was filled in, `repair: true` rewrote the document, or `uiBlocks.html` sanitized it. Sent before `{blocks}`. With `uiBlocks` on, the first send is `{text}` of that finished document, so `{replace}` is not sent for it. |
| `{blocks}` | `{blocks: {ok, errors, warnings}}` | The final assistant text checked as a block document. Sent after the text and before `{done}`, only when `uiBlocks` is on and the turn produced text. |
| `{done}` | `{done: true, historyId?, title?, pendingAsk?}` | Last event of every turn that started streaming, also after `{error}`. `historyId` is missing only in the demo response and when a failed new chat could not be saved. `title` is set once the conversation has one. `pendingAsk: {toolCallId}` when the turn waits on an ask. |

When a turn fails after the stream starts, before the model's first chunk or partway through, the stream sends `{error}` then `{done}` with `historyId`. The turn keeps what the client already saw: the user's message, host tool rows, and any partial assistant text, saved with `status: "error"`. An empty placeholder is removed. An ask the failed stream had started is dropped. When the model call after an answer fails before the client gets any text, tool result, or ask, the answer is undone: the stream is `{askResolved}`, `{error}`, `{done, pendingAsk}`, the ask is pending again, and the same answer can be sent again. When it fails later, the stream is `{askResolved}`, `{error}`, `{done}` and the answer is kept: the ask stays answered and sending it again returns 409. Send a new `prompt` to continue. See [Agent UI Asks](agent-ui-asks.md#answer-an-ask).

Errors raised before the stream starts return JSON `{status, title, detail, fields?}` instead: 400 for an invalid body, 403 for another user's history, 404 for an unknown `historyId`, 409 for an answer to an ask that is not pending, and 500 otherwise. A `prompt` never gets 409: when another request resolved the ask it meant to cancel, it goes ahead as a normal message. [Agent UI Asks error responses](agent-ui-asks.md#error-responses) lists the ask cases.

#### Attachments

Each `attachments` item is `{type: "image" | "file", url, mimeType, filename?}`. The `url` must be `http(s):` or `data:`. Client-only URLs (`blob:`, `file:`, `content:`, `ph:`) return `400` before streaming starts, because neither the model provider nor a later page load can read them. Upload the file with `POST /files/upload` first, or send it as a `data:` URL.

When `fileStorageService` is set, `data:` attachments are uploaded with `FileStorageService.upload`. The saved user prompt then stores the storage `url` plus `gcsKey`, not the base64 payload. The model still receives the original data for that turn. On later turns, a part whose `gcsKey` names a live `FileAttachment` owned by the conversation's owner is sent to the model as a 1-hour signed URL; any other part keeps its stored `url` and is not signed. A custom `fileStorageService` whose `upload` does not create `FileAttachment` records therefore gets no signed URLs on later turns. A failed upload returns `502 Attachment upload failed`. Without storage, attachments are saved as sent.

`fileUploadsEnabled` turns uploads off without removing storage. Pass `false`, or a function that returns `false`, and any prompt that includes attachments returns `403 File uploads are disabled` before streaming. Omit it, or pass `true`, to leave uploads enabled. The example app wires this to the `file-uploads` feature flag.

#### Stream events and resume

`/gpt/prompt` saves the user turn and a `status: "streaming"` assistant placeholder when the model produces its first part. Waiting until then lets two turns on one history both load it before either writes. While the reply streams, partial text is persisted about every second (`streamPersistIntervalMs`), plus a heartbeat every 10 seconds. A text reply replaces that placeholder in place with `status: "complete"`. On failure, partial text is kept with `status: "error"`; an empty placeholder is removed.

| Event | Sent by | Meaning |
|-------|---------|---------|
| `{historyId, started: true, streamId}` | prompt | The reply row is saved and resumable; before any text from the model's first part |
| `{historyId, resumed: true, streamId?}` | resume | First event; `streamId` is absent when nothing is streaming |
| `{text}` | both | Text delta |
| `{replace: true, text}` | resume | Authoritative whole reply: sent first when the client provides `offset`, and whenever persisted text was rewritten (for example, a step became a tool call) |
| `{image: {mimeType, url}}` | both | Generated image |
| `{file}`, `{toolCall}`, `{toolResult}` | prompt | File and tool events |
| `{error}` | both | Error; resume sends it when the reply ended as `error` or went stale |
| `{done: true, historyId, title?}` | both | Reply finished |

`GET /gpt/histories/:id/stream` re-attaches after a reload or remount. Pass `offset` as the number of characters the client already shows, usually the stored placeholder `text`. The endpoint polls the stored history (`streamResumePollIntervalMs`, default 500 ms), so it works across server instances. A `streaming` reply with no update for `streamStaleAfterMs` (default 60 s) is marked `error`.

### addGptHistoryRoutes(router, options?)

CRUD at `/gpt/histories` via `modelRouter`:

| Operation | Permission |
|-----------|------------|
| Create, List | `IsAuthenticated` |
| Read, Update, Delete | `IsOwner` |

Query filtered by `userId`; sort `-updated`; query fields `userId`, `projectId`. Create sets `userId` to the caller, so `{}` is a valid create body even when the app validates request bodies. Create and update bodies drop `pendingAsk` (including dotted `pendingAsk.*` paths), so only a chat turn writes it; the OpenAPI spec marks it `readOnly` on create and update. Create and update bodies also drop any `gcsKey` on `prompts[].content[]` parts (including dotted `prompts.N.content.M.gcsKey` paths) that the history does not already store, so a client can send stored prompts back but cannot add an attachment key.

Pass `chat`, the options given to `addGptRoutes`, to add two headless actions for clients that do not read server-sent events, such as a watch app. Both exist only when `chat` turns `asks` on: without `chat`, or with `asks` off, neither action exists, so a host that never turned asks on gets no new endpoints. `AiApp` adds them when its `asks` option is set.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/gpt/histories/pendingAsks` | GET | `IsAuthenticated` | The caller's pending asks with their simple cards, newest first |
| `/gpt/histories/:id/turn` | POST | `IsOwner`; admins who do not own the history get 403 | Runs one chat turn to completion with the `chat` options and returns it as JSON. Body: one of `{prompt}`, `{askResponse}`, or `{toolCallId, buttonId}`, plus `surface`. The turn finishes and saves even if the client disconnects. |

Bodies, results, and errors: [Headless endpoints](agent-ui-asks.md#headless-endpoints).

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
| `/files/upload` | POST | `IsAuthenticated` | Multipart upload (`file` field); allowed MIME: images, PDF, plain text, CSV, JSON. Capped at `maxFileSize` (default 10 MB). Returns `403` when `fileUploadsEnabled` is off. Returns `{data: {id, filename, gcsKey, mimeType, size, url}}`; send `id` as the `fileId` of a [`files` ask](agent-ui-asks.md#files) answer. |
| `/files/*gcsKey` | GET | `IsAuthenticated` (owner) | Returns `{data: {url}}`, a signed read URL (1 hour), for the caller's own upload. Another user's file returns 404, the same as a missing one, so keys cannot be probed; admins get no exception. |
| `/files/*gcsKey` | DELETE | `IsAuthenticated` (owner) | Soft-delete attachment and remove from GCS. 404 for a missing file, 403 for another user's. |

`*gcsKey` is the full key with its slashes, such as `uploads/<userId>/<ms>-<name>`.

### addSkillRoutes(router, options?)

`modelRouter` over [`GptSkill`](#gptskill) at `/gpt/skills`, with `audit: true` (rows land when `AuditApp` is registered). Options: `fileStorageService` (needed for packages with files and for file cleanup on delete) and `openApiOptions`. `AiApp` calls it when `skills` is on, passing its storage only when both `fileStorageService` and `gcsBucket` are set.

| Endpoint | Method | Who | Result |
|----------|--------|-----|--------|
| `/gpt/skills` | GET | authenticated | The caller's user skills plus every global skill, sorted by name. Fields: `_id, name, description, scope, enabled, files[{filename, mimeType, size}], created, updated`. Never `instructions`. Query fields: `name`, `scope`, `enabled`. |
| `/gpt/skills/:id` | GET | owner, or anyone for a global skill | Adds `instructions`. Another user's skill is 403. |
| `/gpt/skills` | POST | authenticated | `{name, description, instructions, scope?}`. Saved as the caller's `user` skill. `scope: "global"` needs an admin: otherwise 403 `Only admins can create global skills`. |
| `/gpt/skills/:id` | PATCH | owner, or admin for a global skill | Only `name`, `description`, `instructions`, `enabled` are applied. |
| `/gpt/skills/:id` | DELETE | owner, or admin for a global skill | Soft delete; the skill's files are removed from storage. |
| `/gpt/skills/upload` | POST | authenticated | Multipart `file` (`.md` or `.zip`, at most 10 MB, else 413 `A skill package may be at most 10 MB`) and optional `scope`. No file is 400 `No file provided`. 201 with the skill (list fields plus `instructions`, and `userId` for a user skill). |

Upload rules (`parseSkillPackage({buffer, filename})`, exported):

- The file must end in `.md` or `.zip`, else 400 `Upload a SKILL.md file or a .zip skill package`.
- `SKILL.md` needs YAML frontmatter with `name` and `description`; the body is `instructions`. Otherwise 400 `SKILL.md frontmatter needs name and description`. In a zip it may be at most 1 MB (`SKILL.md may be at most 1 MB`).
- A `.zip` holds `SKILL.md` at its root or inside one top-level folder, plus up to 20 files beside it (subfolders allowed) totaling at most 10 MB. Allowed extensions: `png`, `jpg`, `jpeg`, `gif`, `webp`, `pdf`, `txt`, `csv`, `json`, `md`. Hidden files and `__MACOSX/` are skipped. 400s: `The skill package is not a valid zip file`, `No SKILL.md found in the package`, `Files must sit in the SKILL.md folder: <path>`, `Unsupported file type: <name>`, `Invalid file path: <path>` (`..`, absolute, or backslash), `A skill can hold at most 20 files`, `A skill's files may total at most 10 MB`.
- A package with files and no storage is 400 `File storage is not configured`.
- Files are stored with `keyPrefix: "skills/<skillId>"` under the uploader's id. The create is atomic: if any upload or the save fails, uploaded keys are deleted and nothing is saved (500 `Could not store the skill's files` for a storage failure).
- Any other file type, scripts included, is rejected with 400 `Unsupported file type: <name>`. Nothing in a package is ever run.

`AIAdminApp` (from `@terreno/ai/admin`) contributes `GptSkill` to the admin panel as **AI → Skills** at `/gpt/skills`: `adminFilter` limits it to `scope: "global"`, and `scope`, `userId`, and `files` are hidden, so an admin create saves a global skill and admins never see users' personal skills.

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

const aiService = new AIService({model: google("gemini-3.8-flash")});

new AiApp({
  aiService,
  fileStorageService: new FileStorageService({bucketName: "my-bucket"}),
  gcsBucket: "my-bucket",
  mcpService: new MCPService([{name: "tools", transport: {type: "sse", url: "..."}}]),
  tools: myToolDefinitions,
  demoMode: false,
  createModelFn: (apiKey, modelId) => google(modelId ?? "gemini-3.8-flash", {apiKey}),
  openApiOptions: options,
}).register(app);
```

| Option | Description |
|--------|-------------|
| `aiService` | Pre-configured server-wide AI service |
| `asks` | Let the model ask the user typed questions in chat: `true` or `{approvals, kinds, maxFileSizeBytes}`. `approvals` sets the [approval ask](agent-ui-asks.md#approval-asks) for host tools with `needsApproval`. Passed to `addGptRoutes`, and adds the headless `pendingAsks` and `turn` actions to `/gpt/histories`; see [Agent UI Asks](agent-ui-asks.md). `maxFileSizeBytes` also caps `/files/upload`. |
| `createModelFn` | Build model from per-request `x-ai-api-key` |
| `createServerModelFn` | Server-side model factory (e.g. Vertex ADC) without per-request key |
| `defaultSystemPrompt` | App-wide default system prompt, put first in every chat turn. A string, or `({req}) => string \| undefined` (sync or async), such as `configurationPromptGetter(AppConfig, "ai.systemPrompt")`. See [Default system prompt](#default-system-prompt) |
| `demoMode` | Not read. The routes send a canned demo reply whenever no AI service resolves |
| `fileStorageService` + `gcsBucket` | Enable file upload routes, durable `/gpt/prompt` attachments, and `files` ask answers that name uploads by `fileId` |
| `fileUploadsEnabled` | `false` or a function returning `false` rejects uploads and chat attachments with `403`. Omit to leave uploads enabled |
| `mcpService` | Enable MCP routes and tool discovery in chat |
| `tools` | Static Vercel AI SDK tool definitions for chat |
| `toolChoice` | `"auto"` \| `"none"` \| `"required"` (default `"auto"` when tools present) |
| `maxSteps` | Max tool-calling steps (default 5) |
| `titleModelId` | Cheaper model for conversation title generation |
| `openApiOptions` | Passed to route OpenAPI builders |
| `projects` | Default `true`. `false` skips the `/gpt/projects` routes, so `AiApp` never registers the `Project` model |
| `skills` | `true` mounts [`/gpt/skills`](#addskillroutesrouter-options) and offers skills in chat ([Skills in chat](#skills-in-chat)). Default off |
| `imageGeneration` | `{model, modelId, stylePrompt?, maxCallsPerTurn?}` adds the built-in `generate_image` tool ([Image generation](#image-generation)). Default off |

## Cost and abuse limits

`@terreno/ai` sets no per-user limit on concurrent turns, tokens, or spend for `/gpt/prompt`
or the headless turn action (`POST /gpt/histories/:id/turn`). Any signed-in user can start as
many turns as the host lets through, and each one calls the model with the app's server-side
key unless the request brings its own `x-ai-api-key`.

A reply keeps running after the client disconnects. This is by design: `/gpt/prompt` saves the
reply as a `streaming` prompt so a reload can resume it through `GET /gpt/histories/:id/stream`,
and the turn action finishes and saves the turn whether or not the client waits. Closing the tab
does not stop the model call or its cost.

Before exposing AI routes to users, do both:

1. Enable HTTP rate limiting on `TerrenoApp`. It is off unless you pass `rateLimit`. AI routes
   fall in the `api` bucket, which counts requests, not tokens:

   ```typescript
   new TerrenoApp({
     userModel: User,
     rateLimit: {
       store: "redis", // "memory" (default) | "redis" | "mongo"; use a shared store with more than one instance
       trustProxy: 1, // behind a load balancer such as Cloud Run
       limits: {
         windowMs: 15 * 60 * 1000, // default 15 minutes
         apiMax: 600, // default; lower it to bound chat turns per user or IP
         authMax: 20, // default
       },
     },
   });
   ```

   For a tighter limit on chat alone, add `createRouteRateLimitMiddleware({name, max, windowMs,
   store, keyBy})` from `@terreno/api` in front of the AI routes. See
   [Rate limiting](../how-to/rate-limiting.md).
2. Set a budget, quota, or spend alert with the model provider (for example a Google Cloud
   budget alert and Vertex AI or Gemini API quotas), so a runaway caller or bug is caught by the
   provider even when the app's own limits are loose.

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
it on boot outside deployed (`NODE_ENV=production`) processes, which ignore the flag. Invalid price JSON or negative/non-numeric prices
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
| `ObsTrace` | Root trace: user, session, status, `errorSummary`, `sensitive`, `prompts[]`, `scope`, `tags[]`, usage |
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
| GET | `/ai/observability/traces` | Admin list. Query `from`, `to`, `prompt`, `status`, `userId`, `sessionId`, `scope`, `hasScore`, `sensitive`, `flaggedForDataset`, `page`, `limit`. Body is `{data, page, limit, more, total}` so pagination survives RTK `{data}` unwrap. Each row includes `spanCount` and `scoreCount`. `prompts.length` is the `N prompts` count |
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
`defineExtension` bundles prompt sections, tools, tool wraps, and hooks
(`beforeModelRequest`, `beforeTool` with block or rewrite, `afterTool`); `rt.memo` stores
first-write-wins decisions that survive restarts. `rt.waitFor(event, {timeout})` and
`rt.sleep(duration)` park a task without a lease; `harness.sendEvent` stores the event
durably and wakes the task, even when no runner is up. `rt.approval(key, {...})` waits for
a human decision; `approvalGate` requires one before named tool calls; `HarnessApp` serves
`GET /harness/approvals` (only what the caller may approve) and `approve` / `reject`
instance actions, each decision audited in an `approval:<key>` span. Clients watch runs
over SSE (`GET /harness/conversations/:id/events`, `GET /harness/tasks/:id/events`),
resumable from any instance with `Last-Event-ID`; turns stream coalesced text deltas, and
`POST /harness/conversations/:id/submit` queues or steers a message while a turn runs.
API: [AI harness reference](ai-harness.md).
Why: [Durable agent harness](../explanation/durable-agent-harness.md).
How-to: [Build a durable workflow](../how-to/build-a-durable-workflow.md),
[Ship a new task version](../how-to/ship-a-new-task-version.md).

## Langfuse integration

Low-level exports (also used by `addGptRoutes` when `langfuseSystemPromptName` is set):

- **Client:** `initLangfuseClient`, `getLangfuseClient`, `isLangfuseInitialized`, `shutdownLangfuseClient`
- **Prompts:** `getPrompt`, `createPrompt`, `compilePrompt`, `invalidatePromptCache`, `preparePromptForAI`
- **Tracing:** `initTracing`, `shutdownTracing`, `createTelemetryConfig`
- **Cache:** `LangfuseCache`, `getCached`, `setCached`, `invalidateCache`

Subpath imports for tree-shaking: `@terreno/ai/langfuseClient`, `@terreno/ai/langfuseApp`.

## Subpath exports

Import these instead of `dist/` paths. Deep `dist/` imports break when a bundler (such as
Vercel hosting's build) inlines them and their bare `@terreno/api` imports no longer resolve. Each
subpath shares module instances with `@terreno/ai/harness`.

| Subpath | Exports |
| --- | --- |
| `@terreno/ai/harness` | Harness public API; see [AI harness reference](ai-harness.md) |
| `@terreno/ai/harness/jobsRunner` | `JobsRunner` |
| `@terreno/ai/harness/agentLoop` | `createAgentTasks` and the agent turn internals |
| `@terreno/ai/harness/commit` | `createTaskRecords`, `HarnessModels`, and other commit helpers, for custom commits that write domain records inside a task's fenced commit |
| `@terreno/ai/harness/events` | `insertMessages`, `resolveStreamingOptions` |
| `@terreno/ai/harness/internalRuntime` | `internalRuntime` |
| `@terreno/ai/admin` | `AIAdminApp` |
| `@terreno/ai/observability/observabilityApp` | `ObservabilityApp` |
| `@terreno/ai/observability/localPlugin` | `createLocalObservabilityPlugin`, `createLocalObservabilityBundle` |
| `@terreno/ai/observability/promptStore` | `LocalPromptStore` |

The internals subpaths follow the harness's own changes; they carry no compatibility
promise beyond the release they ship in.

The root `@terreno/ai` entry registers the `Project` model on first use
(`getProjectModel()` or the `Project` export), not on import. `AiApp` uses it for
`/gpt/projects` by default; an app that owns a model named `Project` passes
`new AiApp({projects: false})` and does not call `addProjectRoutes`.

## FileStorageService

Google Cloud Storage helper for uploads referenced by `addFileRoutes`.

```typescript
const storage = new FileStorageService({
  bucketName: "my-bucket",
  storageOptions: {}, // optional @google-cloud/storage options
});

await storage.upload({buffer, filename, mimeType, userId, keyPrefix}); // {id, filename, gcsKey, mimeType, size, url}
await storage.download(gcsKey);      // the upload's bytes, as a Buffer
await storage.getSignedUrl(gcsKey);  // 1-hour v4 signed URL
await storage.delete(gcsKey);        // GCS delete + soft-delete FileAttachment
```

The key is `<keyPrefix>/<userId>/<ms>-<name>`. `keyPrefix` defaults to `uploads`. Skill files use `skills/<skillId>` and generated images use `generated`. Every upload creates a `FileAttachment` owned by `userId`.

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

`getTools()` merges every connected server's tools by name. When two servers offer the same name, the first server in the config keeps it and the later one is dropped with a warning. In a chat turn, MCP tools never replace a route tool or a `createRequestTools` tool of the same name: the MCP tool is dropped with a warning, so a host tool keeps its `execute` and its `needsApproval` policy.

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
const model = vertex.languageModel("gemini-3.8-flash");
```

Env fallbacks: `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION` (default `global`).

`languageModel`, `imageModel`, and `isModelAllowed` accept only a plain model id: letters, digits, `.`, `_`, and `-`, with an optional `publishers/google/models/` or `models/` prefix and an optional `@version`. Any other id (one with another `/`, `:`, `?`, or `#`) is refused with `400 Model not permitted`, with or without `allowedModels`. With `allowedModels` set, the id without its prefix and `@version` must match an entry. The provider is given the checked id without its prefix, so a model id sent in a request body cannot name a different model than the one the allow-list checked.

## Web search types

`WebSearchProvider` and `WebSearchResult` define a pluggable search interface for custom Vercel AI SDK tools. The package does not ship a default provider — implement `search(query)` and wire it into a `tool()` passed to `AiApp` `tools`.

## Integration example

```typescript
import {TerrenoApp} from "@terreno/api";
import {AiApp, AIService, LangfuseApp} from "@terreno/ai";
import {google} from "@ai-sdk/google";

const aiService = new AIService({model: google("gemini-3.8-flash")});

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

Legacy `setupServer` pattern: call `addGptHistoryRoutes`, `addGptRoutes`, etc. inside `addRoutes`. With `asks` on, pass the chat options to `addGptHistoryRoutes` as `chat` to keep the headless endpoints.

## Environment variables

| Variable | Used by | Description |
|----------|---------|-------------|
| `GOOGLE_VERTEX_PROJECT` | `createVertexProvider` | GCP project for Vertex models |
| `GOOGLE_VERTEX_LOCATION` | `createVertexProvider` | Vertex region (default `global`) |
| `AI_OBS_PRICE_MAP_JSON` | `ObservabilityApp` | JSON model map with non-negative `inputPerMTok` / `outputPerMTok`; omitted models have tokens but no USD cost || `LANGFUSE_PUBLIC_KEY` | `LangfuseApp` | Langfuse public key |
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
