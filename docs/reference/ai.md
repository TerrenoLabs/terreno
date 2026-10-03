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
    gptHistories.ts        # History CRUD, headless pendingAsks and turn actions
    aiRequestsExplorer.ts  # Admin request explorer
    files.ts               # File upload/signed URL/delete
    projects.ts            # Project CRUD + memories
    mcp.ts                 # MCP server status and tools
  service/
    aiService.ts           # Provider-agnostic AI service
    asks.ts                # Ask tools, reserved ask_ names, paused-turn replay
    chatTurn.ts            # Chat turn runner behind /gpt/prompt (SSE sink) and turn (buffered JSON)
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
- **Prompts:** `COMPACT_SURFACE_SYSTEM_PROMPT`, `CONTENT_SUMMARY_PROMPT`, `DEFAULT_GPT_MEMORY`, `JSON_VALUE_SYSTEM_PROMPT`, `REMIX_PROMPT`, `TERRENO_ASKS_SYSTEM_PROMPT`, `TITLE_GENERATION_PROMPT`, `TRANSLATION_PROMPT`
- **Asks:** `createAskTools({kinds, surface?})`, `TERRENO_ASKS_SYSTEM_PROMPT`, `COMPACT_SURFACE_SYSTEM_PROMPT`, types `AsksOptions`, `ApprovalAskInput`, `AskOrigin`, `GptHistoryPendingAsk`, `GptHistoryPromptAsk`, `GptHistoryAskStatus`, and `Ask`, `AskKind`, `AskResponse`, `AskValidationError`, `SimpleCard`, `SimpleCardButton` re-exported from `@terreno/blocks` ([Agent UI Asks](agent-ui-asks.md))
- **Web search:** `WebSearchProvider`, `WebSearchResult` types

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
| `/gpt/prompt` | POST | `IsAuthenticated` | SSE streaming chat turn; [body](#gptprompt-body) and [events](#sse-events) below |
| `/gpt/remix` | POST | `IsAuthenticated` | Non-streaming text remix; body: `{text}` |
| `/gpt/histories/:id/rating` | PATCH | `IsAuthenticated` | Rate a prompt; body: `{promptIndex, rating: "up" \| "down" \| null}` |
| `/gpt/histories/:id/stream` | GET | `IsAuthenticated` (owner) | SSE resume of an in-flight reply; query: optional `streamId`, `offset` |
| `/gpt/tools` | GET | `IsAuthenticated` | List builtin + MCP tools (ask tools are not listed) |
| `/gpt/datasets/:id` | GET | owner (`IsOwner`; another user is 404) | Read a stored dataset. Mounted only when `uiBlocks` is on. Query: `grain` (`hour` \| `day` \| `week` \| `month`), `limit` (default 500, max 1000), `page`. Response `data`: `{columns, rows, rowCount, page, more}`. `grain` buckets the first date column in UTC. An offset is converted before `startOf`. A date with no zone is that UTC day. Null date cells are skipped. Number columns are summed. Without `page`, a series longer than `limit` is LTTB-downsampled and `more` is false. With `page`, rows are a page and `more` is true when another page remains. |
| `/gpt/actions` | POST | `IsAuthenticated` plus history owner (another user is 403) | Run a host callback. Mounted only when `uiBlocks` is on, on the `/gpt` path. Body: `{historyId, messageId, blockId, elementId, name, payload?}`. Unknown `name` is 404. A payload that fails the host schema is 400 with `meta.fields`. The handler has 10 seconds (`actionTimeoutMs` can set another cap) and then 504. Response `data`: `{text?, blocks?, replace?}`. An invalid `blocks` document is 500. Logged as `AIRequest` `requestType: "ui_action"`. |

Generated images (image-output models such as `gemini-3-pro-image`) arrive as SSE `image` events: `{image: {mimeType, url}}` with a base64 data URL. Each image is sent once, even when the model reports it both as a stream file part and in the final `result.files`. The saved assistant prompt stores one `image` content part per image and `text: ""` when there is no text. On later turns, `buildMessages` sends an image-only assistant prompt to the model as the text `[Generated image]`, because providers reject empty assistant turns.

AI resolution order: `x-ai-api-key` header + `createModelFn` → `createServerModelFn(modelId)` → configured `aiService`. When none resolves, `/gpt/prompt` streams a canned demo reply and `/gpt/remix` returns it. This happens whether or not `demoMode` is set.

Pass `asks: true` (or `{kinds: ["choice"]}`) to let the model ask the user typed questions in the chat. Asks are off by default; with them off, tools, system prompt, and SSE events are unchanged. See [Agent UI Asks](agent-ui-asks.md).

Pass `uiBlocks: true` (or `{hostActions, html, imageHosts, repair, datasetTtlDays, datasetMaxRows}`) to require each assistant reply to be a block document. `html: true` allows `html` blocks and sanitizes them before they are stored. `imageHosts` lists hostnames allowed on `https` image sources. A changed document is sent as `{replace: "text", text}` before `{blocks}`. `datasetTtlDays` defaults to `0` (keep the dataset). `datasetMaxRows` defaults to 50,000. Off by default; with it off, the system prompt, SSE events, `/gpt/datasets`, and `/gpt/actions` are unchanged. When it is on, the system prompt gains `TERRENO_UI_BLOCKS_SYSTEM_PROMPT` (host callback names included when `hostActions` is set). After the final text, the route validates it and sends `{blocks: {ok, errors, warnings}}` before `{done}`. `hostActions` is the callback allowlist: a name outside it fails with `UNKNOWN_HOST_ACTION`. `{repair: true}` runs one repair call when validation fails and stores that reply. A document that is still invalid is stored with a `Block validation errors:` note so the next turn sees it. See [Validate a block document locally](../how-to/agent-ui-blocks.md).

With asks on, a host tool with the AI SDK's `needsApproval: true` runs only after the user approves it: the turn pauses on a server-made `confirm` ask. `asks.approvals` sets that ask's input per tool name, as `(input) => ConfirmAskInput` (`ApprovalAskInput`); without an entry, the ask is "Allow &lt;toolName&gt;?" with the tool's description. With asks off, such a tool never runs. See [Approval asks](agent-ui-asks.md#approval-asks).

With `asks` on, pass the same options to `addGptHistoryRoutes` as `chat` to add the non-streaming [headless endpoints](#addgpthistoryroutesrouter-options) for clients that do not read server-sent events.

#### `/gpt/prompt` body

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | string | The user's message. Required unless `askResponse` is sent. |
| `historyId` | string? | Continue this conversation; omit to start one. Required with `askResponse`. |
| `askResponse` | object? | The answer to the pending ask: `{toolCallId, action, content?, reason?}`. Read only when `asks` is on. Send it instead of `prompt`, without `attachments`. See [Answer an ask](agent-ui-asks.md#answer-an-ask). |
| `surface` | `"full"` \| `"compact"`? | Where the user reads and answers. Default `"full"`. `"compact"` is a watch or another small screen: the model gets only button-sized asks and is asked for replies of at most two short sentences. Any other value returns 400. See [Compact surface](agent-ui-asks.md#compact-surface). |
| `systemPrompt` | string? | System prompt for this turn; project context and the Langfuse prompt are prepended |
| `attachments` | array? | `{type: "image" \| "file", url, mimeType, filename?}` items added to the user message |
| `model` | string? | Model id passed to `createModelFn` or `createServerModelFn` |
| `projectId` | string? | Project whose context and memories are prepended to the system prompt; saved on a history that has none |

#### SSE events

`/gpt/prompt` streams `data: <json>` lines, one event object per line. `{askResolved}` is sent when an answer is stored, before the model runs. `{started}` is sent when the model produces its first part and the reply row is saved, before any text from that part. On a prompt that is not answering an ask, `{started}` is first. `{ask}` and `{done}` come last, and the rest arrive as the model streams.

| Event | Shape | When |
|-------|-------|------|
| `{started}` | `{started: true, historyId, streamId}` | Sent when the model produces its first part and the reply row is saved. A reload can resume this `streamId`. It comes before text from that part. A model that fails before any part sends no `{started}`. The demo reply does not send it. |
| `{askResolved}` | `{askResolved: {toolCallId, action}}` | The turn answered the pending ask, or cancelled it because a new `prompt` arrived. Asks only. |
| `{text}` | `{text: string}` | A step's text, sent when the step ends. Text from a step that calls a tool is dropped, unless that text parses as a block document and the turn has no other text. A trailing JSON `"action"` blob is stripped. |
| `{toolCall}` | `{toolCall: {toolCallId, toolName, args}}` | The model called a host tool (route, request, or MCP). Never sent for ask tools. |
| `{file}` | `{file: {filename, mimeType, url}}` | A host tool result had a `fileData` data URL. Sent before its `{toolResult}`. `filename` defaults to `document` and `mimeType` to `application/octet-stream`. |
| `{toolResult}` | `{toolResult: {toolCallId, toolName, result}}` | A host tool returned. `fileData` is removed from `result`. For a tool whose approval was denied, `result` is `{approved: false, reason}`. Never sent for ask tools. |
| `{image}` | `{image: {mimeType, url}}` | The model generated an image; `url` is a `data:` URL. Each data URL is sent once. |
| `{ask}` | `{ask: {toolCallId, kind, input, simple, origin?, toolName?}, historyId}` | The turn paused on an ask. Sent after the turn is saved. `historyId` is the conversation that waits on the ask, so a new chat's ask can be answered before `{done}`. An [approval ask](agent-ui-asks.md#approval-asks) adds `origin: "approval"` and the host `toolName`. Asks only. |
| `{error}` | `{error: string}` | The model stream reported an error, or the turn failed after the stream started. `{done}` still follows. |
| `{replace}` | `{replace: "text", text}` | The assistant document after the server changed it: a missing actions `id` was filled in, `repair: true` rewrote the document, or `uiBlocks.html` sanitized it. Replaces the text already streamed. Sent before `{blocks}`. |
| `{blocks}` | `{blocks: {ok, errors, warnings}}` | The final assistant text checked as a block document. Sent after the text and before `{done}`, only when `uiBlocks` is on and the turn produced text. |
| `{done}` | `{done: true, historyId?, title?, pendingAsk?}` | Last event of every turn that started streaming, also after `{error}`. `historyId` is missing only in the demo response and when a failed new chat could not be saved. `title` is set once the conversation has one. `pendingAsk: {toolCallId}` when the turn waits on an ask. |

When a turn fails after the stream starts, before the model's first chunk or partway through, the stream sends `{error}` then `{done}` with `historyId`. The turn keeps what the client already saw: the user's message, host tool rows, and any partial assistant text, saved with `status: "error"`. An empty placeholder is removed. An ask the failed stream had started is dropped. When the model call after an answer fails before the client gets any text, tool result, or ask, the answer is undone: the stream is `{askResolved}`, `{error}`, `{done, pendingAsk}`, the ask is pending again, and the same answer can be sent again. When it fails later, the stream is `{askResolved}`, `{error}`, `{done}` and the answer is kept: the ask stays answered and sending it again returns 409. Send a new `prompt` to continue. See [Agent UI Asks](agent-ui-asks.md#answer-an-ask).

Errors raised before the stream starts return JSON `{status, title, detail, fields?}` instead: 400 for an invalid body, 403 for another user's history, 404 for an unknown `historyId`, 409 for an answer to an ask that is not pending, and 500 otherwise. A `prompt` never gets 409: when another request resolved the ask it meant to cancel, it goes ahead as a normal message. [Agent UI Asks error responses](agent-ui-asks.md#error-responses) lists the ask cases.

#### Attachments

Each `attachments` item is `{type: "image" | "file", url, mimeType, filename?}`. The `url` must be `http(s):` or `data:`. Client-only URLs (`blob:`, `file:`, `content:`, `ph:`) return `400` before streaming starts, because neither the model provider nor a later page load can read them. Upload the file with `POST /files/upload` first, or send it as a `data:` URL.

When `fileStorageService` is set, `data:` attachments are uploaded with `FileStorageService.upload`. The saved user prompt then stores the storage `url` plus `gcsKey`, not the base64 payload. The model still receives the original data for that turn. On later turns, parts with a `gcsKey` are sent to the model as 1-hour signed URLs. A failed upload returns `502 Attachment upload failed`. Without storage, attachments are saved as sent.

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

Query filtered by `userId`; sort `-updated`; query fields `userId`, `projectId`. Create sets `userId` to the caller, so `{}` is a valid create body even when the app validates request bodies. Create and update bodies drop `pendingAsk` (including dotted `pendingAsk.*` paths), so only a chat turn writes it; the OpenAPI spec marks it `readOnly` on create and update.

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
| `demoMode` | Not read. The routes send a canned demo reply whenever no AI service resolves |
| `fileStorageService` + `gcsBucket` | Enable file upload routes, durable `/gpt/prompt` attachments, and `files` ask answers that name uploads by `fileId` |
| `fileUploadsEnabled` | `false` or a function returning `false` rejects uploads and chat attachments with `403`. Omit to leave uploads enabled |
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

await storage.upload({buffer, filename, mimeType, userId}); // {id, filename, gcsKey, mimeType, size, url}
await storage.download(gcsKey);      // the upload's bytes, as a Buffer
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
const model = vertex.languageModel("gemini-3.8-flash");
```

Env fallbacks: `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION` (default `global`).

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
