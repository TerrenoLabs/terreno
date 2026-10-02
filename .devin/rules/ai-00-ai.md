---
trigger: always_on
---
# @terreno/ai

AI service layer for Terreno apps providing GPT chat, request logging, and admin tools. Provider-agnostic via Vercel AI SDK. This is a **backend-only** package — no React, no UI components, no frontend code.

## Commands

```bash
bun run compile          # Compile TypeScript
bun run dev              # Watch mode
bun run test             # Run tests
bun run lint             # Lint code
bun run lint:fix         # Fix lint issues
```

## Architecture

### File Structure

```
src/
  index.ts               # All package exports
  models/
    aiRequest.ts         # AI request logging model
    gptHistory.ts        # Conversation history model
    index.ts             # Model exports
  routes/
    gpt.ts               # GPT chat streaming and remix endpoints
    gptHistories.ts      # GPT history CRUD via modelRouter
    aiRequestsExplorer.ts # Admin-only AI request explorer
    index.ts             # Route exports
  service/
    aiService.ts         # Provider-agnostic AI service class
    prompts.ts           # System prompt constants
    index.ts             # Service exports
  types/
    index.ts             # All type definitions
  tests/
    bunSetup.ts          # Test environment setup
```

## AIService

Provider-agnostic AI service using Vercel AI SDK's `LanguageModel` interface. Consuming apps provide their own model instance.

### Usage

```typescript
import {AIService} from "@terreno/ai";
import {google} from "@ai-sdk/google";

const aiService = new AIService({
  model: google("gemini-3.8-flash"),
  defaultTemperature: 1.0,  // optional
});
```

### Methods

| Method | Description |
|--------|-------------|
| `generateText(options)` | Generate text (non-streaming) |
| `generateJsonValue(options)` | Parse any JSON value via AI SDK `Output.json()` (logged as `json_value`) |
| `generateJsonObject(options)` | Typed object from `jsonSchema` / Zod / `FlexibleSchema` via `Output.object()` (`json_object`) |
| `generateJsonArray(options)` | Typed array via `Output.array()`; model emits `{"elements":[...]}` (`json_array`) |
| `generateTextStream(options)` | Stream text chunks (AsyncGenerator) |
| `generateRemix({text, userId?})` | Reword text naturally |
| `generateSummary({text, userId?})` | Summarize text |
| `translateText({text, targetLanguage, sourceLanguage?, userId?})` | Translate text |
| `generateChatStream({messages, systemPrompt?, userId?})` | Stream chat response |

Structured helpers default to `TemperaturePresets.DETERMINISTIC` and use `JSON_VALUE_SYSTEM_PROMPT` when `systemPrompt` is omitted. They run `doGenerate` text through `normalizeLlmJsonTextForStructuredOutput` (see `parseAiJson`: fences, preamble, first balanced `{`/`[` slice, trailing commas, smart-quote fallback) before Vercel `Output.*` parsing. On failure, `logger.error` records prompt, system, raw model text, and error details; `AIRequest` rows store `response` (raw text or a sentinel), `error`, and `metadata` (`system`, `finishReason`, `errorStack`, `rawModelTextCaptured`).

Re-exported from `@terreno/ai`: `parseAiJson`, `normalizeLlmJsonTextForStructuredOutput`, `ParseResult` types, plus `Output`, `jsonSchema`, and types `JSONValue`, `FlexibleSchema` (from the `ai` package) for building schemas in app code.

All methods automatically log requests to the AIRequest model.

### Temperature Presets

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

Logs all AI requests with metrics for monitoring and debugging.

```typescript
// Fields
aiModel: string          // Model identifier (e.g., "gemini-2.5-flash")
prompt: string           // Input prompt
requestType: string       // e.g. "general" | "remix" | "summarization" | "translation" | "json_value" | "json_object" | "json_array"
response?: string        // AI response text
responseTime?: number    // Response time in ms
tokensUsed?: number      // Total tokens consumed
userId?: ObjectId        // User who made the request
error?: string           // Error message if failed
metadata?: Mixed         // Additional data

// Static method
await AIRequest.logRequest({aiModel, prompt, requestType, ...});
```

Plugins: `createdUpdatedPlugin`, `isDeletedPlugin`, `findOneOrNone`, `findExactlyOne`

### GptHistory

Persists conversation history with auto-generated titles.

```typescript
// Fields
title?: string                    // Auto-generated from first assistant response
userId: ObjectId                  // Owner (required)
prompts: Array<{                  // Conversation messages
  text: string,
  type: "user" | "assistant" | "system",
  model?: string
}>

// Virtual
ownerId                           // Alias for userId (Permissions.IsOwner compatibility)
```

Pre-save hook auto-generates title from first assistant response (first 50 chars).

## Routes

### addGptRoutes(router, options)

```typescript
import {addGptRoutes} from "@terreno/ai";

addGptRoutes(router, {aiService, openApiOptions: options});
```

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/gpt/prompt` | POST | SSE streaming chat with history persistence |
| `/gpt/remix` | POST | Non-streaming text remix |
| `/gpt/histories/:id/stream` | GET | SSE resume of an in-flight `/gpt/prompt` reply |

All require authentication. `/gpt/prompt` accepts `{prompt, historyId?, systemPrompt?, attachments?}` and streams via Server-Sent Events. Attachment URLs must be `http(s):` or `data:` (client-only `blob:`/`file:` URLs get 400); with `fileStorageService`, `data:` attachments are uploaded and history stores `url` + `gcsKey`. The reply is persisted as a `status: "streaming"` assistant prompt with throttled partial text, so clients can resume after a reload. See `docs/reference/ai.md`.

### addGptHistoryRoutes(router, options)

Standard modelRouter CRUD at `/gpt/histories`:
- **Create/List**: `IsAuthenticated`
- **Read/Update/Delete**: `IsOwner`
- Query filtered by `userId`
- Sorted by `-updated`

### addAiRequestsExplorerRoutes(router, options)

Admin-only endpoint at `GET /aiRequestsExplorer`:
- Paginated with `?page=1&limit=20`
- Filters: `requestType`, `model`, `startDate`, `endDate`
- Aggregation pipeline with user lookup
- Returns `{data, total, page, limit, more}`

## Integration

Consuming apps wire up routes in their `setupServer` call:

```typescript
import {AIService, addGptRoutes, addGptHistoryRoutes, addAiRequestsExplorerRoutes} from "@terreno/ai";
import {google} from "@ai-sdk/google";

const aiService = new AIService({model: google("gemini-3.8-flash")});

setupServer({
  addRoutes: (router, options) => {
    addGptHistoryRoutes(router, options);
    addGptRoutes(router, {aiService, openApiOptions: options});
    addAiRequestsExplorerRoutes(router, {openApiOptions: options});
  },
});
```

## Conventions

- Uses `aiModel` field name (not `model`) to avoid Mongoose internal property conflicts
- GptHistory uses `userId` field with `ownerId` virtual for `Permissions.IsOwner` compatibility
- Custom query filter `(user) => ({userId: user?.id})` instead of `OwnerQueryFilter`
- All AI calls are logged via private `logRequest()` — logging failures never break the main flow
- Express user accessed via `(req as any).user` casting pattern
- Error handling: `throw new APIError({status: 400, title: "..."})` — check conditions early

## Testing

- Framework: bun test with expect
- HTTP testing: supertest
- Mock AI model: Create mock with `doGenerate`/`doStream` methods returning `ReadableStream`
- Test DB: `mongodb://127.0.0.1/terreno-ai-test`
- Preload: `./src/tests/bunSetup.ts` (MongoDB connection, log silencing, Sentry mock)
- **Never mock @terreno/api or models** — test against real functionality

### Mock Model Pattern

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
        controller.enqueue({type: "finish" as const, finishReason: "stop" as const, usage: {completionTokens: 10, promptTokens: 5}});
        controller.close();
      },
    }),
  })),
  modelId: "mock-model",
  provider: "mock-provider",
  specificationVersion: "v1" as const,
});
```
