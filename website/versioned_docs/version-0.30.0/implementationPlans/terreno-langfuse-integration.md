# @terreno/langfuse

A TerrenoApp plugin that integrates [Langfuse](https://langfuse.com) into Terreno backends and frontends. Provides prompt management with MongoDB caching, OpenTelemetry tracing, Vercel AI SDK helpers, React hooks, and an admin UI — all wired up via `.install()`.

> **Prerequisite:** This package relies on the new TerrenoApp plugin system (see [PR #149](https://github.com/TerrenoLabs/terreno/pull/149)). TerrenoApp must support `.install()` before this package can be used.

## Why

LLM apps need prompt versioning, observability, and iteration tools. Langfuse provides all of this, but integrating it requires boilerplate (client setup, caching, tracing config, admin endpoints). This package eliminates that — one `.install()` call on the backend, one `<Provider>` on the frontend.

## Architecture

```
Backend (.install)                    Frontend (<Provider>)
─────────────────                     ────────────────────
• Langfuse client init                • usePrompt(name) → cached prompt
• MongoDB prompt cache (via Mongoose) • usePrompts() → list all
• OpenTelemetry tracing setup         • useTrace() → telemetry helpers
• Admin API routes (/api/prompts,     • useEvaluation() → submit scores
  /api/traces, /api/playground)       • Admin UI pages (prompts, traces,
• Vercel AI SDK helpers                 playground, dashboard)
```

The backend proxies Langfuse's API behind authenticated admin routes. The frontend talks to those routes, never directly to Langfuse. MongoDB sits in front of all prompt fetches with configurable TTL, reusing the existing Mongoose connection from `@terreno/api`.

## Data Models

```typescript
interface LangfuseAppOptions {
  secretKey: string;
  publicKey: string;
  baseUrl?: string;              // default: Langfuse Cloud EU
  adminPath?: string;            // default: '/admin/langfuse'
  enableAdminUI?: boolean;       // default: true
  enableTracing?: boolean;       // default: true
  serviceName?: string;          // default: 'terreno-app'
  cache?: {
    promptTtlSeconds?: number;   // default: 60
    traceTtlSeconds?: number;    // default: 300
  };
  evaluation?: {
    enabled?: boolean;
    scoringFunctions?: ScoringFunction[];
  };
}

interface ScoringFunction {
  name: string;
  description: string;
  scoreType: 'numeric' | 'categorical' | 'boolean';
  categories?: string[];
  range?: { min: number; max: number };
}
```

## Package Structure

```
langfuse/src/
├── backend/
│   ├── LangfuseApp.ts       # TerrenoApp plugin class (.install entry point)
│   ├── client.ts             # Langfuse SDK wrapper (singleton)
│   ├── cache.ts              # Mongoose model for cached entries with TTL index
│   ├── prompts.ts            # getPrompt, compilePrompt (cache-first → Langfuse fallback)
│   ├── tracing.ts            # NodeSDK + LangfuseSpanProcessor setup/shutdown
│   ├── vercel-ai.ts          # preparePromptForAI(), createTelemetryConfig()
│   ├── types.ts
│   └── routes/
│       ├── prompts.ts        # CRUD + cache invalidation
│       ├── traces.ts         # List/view traces
│       ├── playground.ts     # Compile + test prompts
│       └── evaluations.ts    # Submit/retrieve scores (optional)
├── frontend/
│   ├── LangfuseProvider.tsx  # React context (apiBaseUrl, publicKey)
│   ├── hooks/                # usePrompt, usePrompts, useTrace, useEvaluation
│   ├── components/           # PromptEditor, PromptPlayground, TraceViewer, EvaluationForm
│   └── pages/                # PromptsPage, DashboardPage, TracesPage, PlaygroundPage
└── index.ts                  # Re-exports everything (backend + frontend)
```

## Implementation Phases

### Phase 1: Core package ✅ COMPLETED
Package scaffold (`package.json`, `tsconfig.json`, `index.ts` re-exports), Langfuse client singleton with Cloud EU/US and self-hosted URL support, MongoDB cache layer (Mongoose model with TTL index on `expiresAt` for automatic expiry — no Redis needed, reuses the existing Mongoose connection), prompt management (`getPrompt` cache-first with Langfuse fallback, `compilePrompt` with `{{variable}}` interpolation, write-through `createPrompt`/`updatePromptLabels` with cache invalidation), OpenTelemetry tracing (`@opentelemetry/sdk-node` + `LangfuseSpanProcessor`), Vercel AI SDK helpers (`preparePromptForAI` returning `{ prompt, telemetry, config }`), the `LangfuseApp` plugin class (`.install()` wires up client + cache + tracing + admin routes + `res.locals.langfuse`, `.shutdown()` for cleanup), React hooks (`usePrompt`, `usePrompts`, `useTrace`, `useEvaluation` — all talking to admin API routes, never Langfuse directly), and `LangfuseProvider`. Peer deps on `@terreno/api`, `@terreno/ui`, `react`, and optional `ai` (Vercel AI SDK).

### Phase 2: Admin UI ✅ COMPLETED
Built with `@terreno/ui` components. Pages: prompt list, prompt detail/editor, playground (compile + test with LLM), trace explorer, dashboard with counts. Components are also exported individually for embedding in custom admin pages.

## Usage

```typescript
// Backend — one line to install
TerrenoApp.create({ ... })
  .install(LangfuseApp, {
    secretKey: process.env.LANGFUSE_SECRET_KEY!,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  })
  .start();

// Backend — use in route handlers
const { prompt, telemetry, config } = await preparePromptForAI({
  promptName: 'answer-question',
  variables: { query },
  userId,
});
const result = await generateText({ model, prompt, ...config, experimental_telemetry: telemetry });

// Frontend — wrap app
<LangfuseProvider apiBaseUrl="/admin/langfuse/api">
  <App />
</LangfuseProvider>

// Frontend — use hooks
const { prompt, compile, isLoading } = usePrompt('chat-assistant');
```

## Key Decisions

- **MongoDB is used for caching** via a Mongoose model with a TTL index. No Redis dependency — reuses the existing Mongoose connection from `@terreno/api`, keeping infrastructure simple.
- **Frontend never talks to Langfuse directly.** All access goes through the backend admin routes, keeping keys server-side.
- **Evaluation is opt-in** via `evaluation.enabled`. Scoring functions are configured at install time.
- **Vercel AI SDK is an optional peer dep.** The `preparePromptForAI` helper is the primary integration point.

## Dependencies

| Package | Purpose |
|---------|---------|
| `langfuse` | Langfuse Node.js SDK (client, prompts, scoring) |
| `@langfuse/otel` | Langfuse OpenTelemetry span processor |
| `@opentelemetry/sdk-node` | OpenTelemetry Node SDK |
| `mongoose` | MongoDB ODM (peer dep from @terreno/api) |

## Files to Modify Outside This Package ✅ COMPLETED

- **Root `package.json`**: Add `langfuse` to workspaces, add deps to catalog ✅
- **`api/src/TerrenoApp.ts`**: TerrenoPlugin interface already supported via `register()` ✅
- **`example-backend/`** and **`example-frontend/`**: Usage examples added ✅

## References

- [Langfuse TypeScript SDK](https://langfuse.com/docs/observability/sdk/typescript/overview)
- [Langfuse Prompt Management](https://langfuse.com/docs/prompt-management/get-started)
- [Vercel AI SDK Integration](https://langfuse.com/integrations/frameworks/vercel-ai-sdk)
- [TypeScript SDK v4](https://langfuse.com/changelog/2025-08-28-typescript-sdk-v4-ga)
- [TerrenoApp PR #149](https://github.com/TerrenoLabs/terreno/pull/149)
