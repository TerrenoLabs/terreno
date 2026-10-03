# @terreno/ai

AI service layer for Terreno apps - GPT chat, request logging, and admin tools.

AI service layer for Terreno backends — provider-agnostic chat, request logging, GPT history, projects, file uploads, MCP tools, and optional Langfuse integration.

## Install

```bash
bun add @terreno/ai @terreno/api mongoose
```

Also install a Vercel AI SDK provider in your app (e.g. `bun add @ai-sdk/google`).

## Quick start

```typescript
import {TerrenoApp} from "@terreno/api";
import {AiApp, AIService} from "@terreno/ai";
import {google} from "@ai-sdk/google";
import {User} from "./models/user";

const aiService = new AIService({model: google("gemini-3.8-flash")});

new TerrenoApp({userModel: User})
  .register(new AiApp({aiService}))
  .start();
```

This mounts GPT chat (`POST /gpt/prompt`), history CRUD (`/gpt/histories`), projects, and the admin AI request explorer. Add `LangfuseApp`, `FileStorageService`, and `MCPService` when you need those features.

## What's included

- `AIService` — text, streaming, structured JSON, remix, summary, and translation helpers
- `AiApp` — TerrenoPlugin that registers all AI routes in one call
- Mongoose models: `AIRequest`, `GptHistory`, `Project`, `FileAttachment`
- Route registrars: `addGptRoutes`, `addGptHistoryRoutes`, `addProjectRoutes`, `addFileRoutes`, `addMcpRoutes`, `addAiRequestsExplorerRoutes`
- `LangfuseApp` — optional Langfuse tracing and admin UI routes
- `FileStorageService` — GCS uploads with signed URLs
- `MCPService` — SSE MCP client for tool calling
- `getMCPTools` — wrap registered `modelRouter` MCP tools as Vercel AI SDK tools for in-process `streamText` / `generateText`
- Gemini and Vertex helpers: `listGeminiApiModels`, `createVertexProvider`

## Documentation

Full API reference: [docs/reference/ai.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/ai.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
