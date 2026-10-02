# Implementation Plan: AI observability (Langfuse-light, pluggable)

**Status:** Draft  
**Roadmap:** Area=`ai`, Target=`Future`, Impact=`Feature`  
**Created:** 2026-08-24  
**Owner:** unassigned  
**Branch:** `cursor/ai-observability-ip-64ca`  
**Task list:** [docs/tasks/ai-observability.md](../tasks/ai-observability.md)  
**Linear:** none  
**Roadmap issue:** none yet (handoff after Approved)

**Depends on:** current `@terreno/ai` (`AIService`, `AIRequest`, `LangfuseApp`, `AIAdminApp`). The requested `ai-agents-and-failover` IP is **not in this repo**; this plan follows shipped AI code, not that missing doc.

**Related:** [terreno-langfuse-integration.md](./terreno-langfuse-integration.md) (`LangfuseApp` stays). [FH-48](https://linear.app/flourish-health/issue/FH-48/ai-improvements) (prompts in-app vs Langfuse).

## Goal

Ship **Langfuse-like** prompt versioning, nested traces (user / session / cost), multidimensional evaluators (LLM-as-judge + structured I/O), datasets, experiments, and a **local human review queue** — **inside Terreno**, as **plugins on `@terreno/ai`**, with an operator UI in **`admin-frontend` only**.

Apps can:

- Run **fully local** (Mongo) with zero Langfuse keys.
- Keep **`LangfuseApp` as a second plugin** (not deleted, not merged).
- Fan out **traces and scores** to local + Langfuse + **OTLP/OpenInference** (Phoenix, Laminar, Arize AX, generic collectors).
- Point **prompts, datasets, experiments** at local **or** Langfuse independently (with one mix rule).

## Non-goals

- Removing or rewriting `LangfuseApp`.
- `admin-spa` screens (spa already embeds `admin-frontend` widgets).
- First-class Braintrust, Helicone, LangSmith, Weave, Opik, Portkey adapters (document how they fit; do not code stubs).
- Langfuse **annotation queues** as `reviewQueue.primary` (local Mongo queue only in this IP).
- Dual-write of prompt versions, datasets, or review items.
- Retention / redaction / retry **jobs** (full I/O stored; Q9=C, Q13=A).
- Replacing `AIRequest` (cheap call log remains).
- Pixel-clone of Langfuse Cloud chrome.

## Decisions

| ID | Question | Choice |
| --- | --- | --- |
| Q1 | System of record | Mongo **local plugin** + **pluggable** backends (Langfuse and others), not wrap-only |
| Q2 | Package | Grow `@terreno/ai` |
| Q3 | Existing Langfuse | **Two plugins**: keep `LangfuseApp`; add local observability plugin |
| Q4 | Operator UI | **`admin-frontend` only** |
| Q5 | IP shape | **One IP**, full destination, **phased tasks** |
| Q6 / Q11 | Dual receive | **Traces + scores + OTel** fan-out. Not prompts/datasets/queue |
| Q7 | SDK | Capability interfaces + `capabilities` (comms-style) |
| Q8 | v1 adapters | `local` (full) + `langfuse` (mapped) + **`otel` TraceSink** |
| Q9 | PHI / I/O | Persist **full I/O**; **no** retention job in this IP |
| Q10 | Langfuse UI | Terreno screens + **Open in Langfuse** for playground / Langfuse experiments |
| Q12 / Q16 / Q21 | Primaries | Four flags: `prompts`, `datasets`, `experiments`, `reviewQueue` |
| Q22 | Mix rule | `experiments.primary` **must equal** `datasets.primary` (fail config) |
| Q23 | Defaults | All four primaries **`local`** when both plugins exist; Langfuse/OTel are extra **sinks** |
| Q24 | Local off | **Allowed** (Langfuse-only app; no Mongo observability collections) |
| Q25 | Review queue | **Local-only**; `reviewQueue.primary: "langfuse"` is a **config error** |
| Q13 | Secondary down | Local (or primary write) **succeeds**; Langfuse/OTel errors **logged, never thrown** |
| Q14 / Q17 | Experiments | Runner follows **`experiments.primary`**: local → always **`BackgroundTask`**; Langfuse → Langfuse experiment API |
| Q15 | Mongo | **New collections**; keep `AIRequest` |
| Q18 | Live evals | Interceptor with **`sampleRate` default `0`** |
| Q19 | Cost | `inputTokens` / `outputTokens` / `model`; **USD from config price map** (missing model → tokens only) |
| Q20 | Instrumentation | If observability is registered, **`AIService` emits traces** on every `generate*` (**opt-out per call**) |

### Competitor coverage (why the SDK is split)

| Backend | TraceSink | PromptRegistry | Dataset / experiment | ScoreSink | ReviewQueue |
| --- | --- | --- | --- | --- | --- |
| Local Mongo | yes | yes | yes | yes | yes (v1) |
| Langfuse | yes | yes | yes | yes | no in v1 |
| OTLP / OpenInference | yes | no | no | no | no |
| Phoenix / Laminar / Datadog | via OTel | no | no | no | no |
| Helicone / Portkey | later (gateway) | no | no | no | no |
| Braintrust / LangSmith | later | later | later | later | later |

Traces use **OpenTelemetry + OpenInference** span kinds (`LLM`, `AGENT`, `CHAIN`, `TOOL`, `EVALUATOR`, `PROMPT`). That is the honest “works with competitors” layer. Prompt/dataset/queue APIs stay vendor CRUD behind Terreno interfaces.

## Architecture

```
AIService.generate*
        │
        ├─ AIRequest.logRequest          (unchanged cheap log)
        └─ if observability registered and !opts.skipTrace
              Observability.traceSinks[]  →  local | langfuse | otel   (fan-out, best-effort)

PromptRegistry.get({name, label})     → primary prompts plugin only
DatasetStore / ExperimentRunner       → their primaries (must match each other)
ReviewQueue                           → local plugin only
ScoreSinks[]                          → fan-out with traces
```

**Two planes**

| Plane | Plugins | Write | Read (admin) |
| --- | --- | --- | --- |
| Telemetry | all registered `TraceSink` / `ScoreSink` | fan-out | **local** if local plugin on; else Langfuse |
| Control | primary per capability | **one** writer | that primary |

Mirrors `@terreno/comms`: interfaces in `ai/src/observability/types.ts`; adapters do not put extra vendor SDKs on core beyond what `LangfuseApp` already uses. OTLP exporter is an optional adapter file.

### Public types (normative)

```typescript
type ObservabilityCapability =
  | "traces"
  | "prompts"
  | "scores"
  | "datasets"
  | "experiments"
  | "reviewQueue";

type ControlPrimary = "local" | "langfuse";

interface ObservabilityControlConfig {
  datasets: ControlPrimary;
  experiments: ControlPrimary;
  prompts: ControlPrimary;
  reviewQueue: "local"; // langfuse rejected at register()
}

interface ObservabilityPlugin {
  readonly capabilities: ReadonlySet<ObservabilityCapability>;
  readonly id: string;
  datasetStore?: DatasetStore;
  experimentRunner?: ExperimentRunner;
  promptRegistry?: PromptRegistry;
  reviewQueue?: ReviewQueue;
  scoreSink?: ScoreSink;
  traceSink?: TraceSink;
}

interface TraceRecord {
  id: string;
  name: string;
  startedAt: string;
  endedAt?: string;
  userId?: string;
  sessionId?: string;
  status: "ok" | "error";
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    model?: string;
    costUsd?: number;
  };
  prompt?: {name: string; version: number; label?: string};
  spans: SpanRecord[];
}

interface ScoreRecord {
  name: string;
  dataType: "numeric" | "categorical" | "boolean";
  value: number | string | boolean;
  comment?: string;
  source: "human" | "llm-judge" | "code";
  evaluatorId?: string;
  traceId: string;
  spanId?: string;
}
```

`ObservabilityApp` (new `TerrenoPlugin`):

- Validates config (Q22, Q25, plugin present for each primary).
- Holds the sink lists and primaries.
- Contributes admin screens when local and/or Langfuse control APIs are on.
- Does **not** replace `LangfuseApp.register()` — example-backend may `.register(new LangfuseApp(...)).register(new ObservabilityApp({plugins: [local, langfuseAdapter, otel]}))`. The Langfuse **adapter** wraps the existing client from `LangfuseApp` / `getLangfuseClient()`; it must not start a second OTel SDK if `LangfuseApp` already did.

### `AIService` hook

After each generate path (same place as `logRequest`):

1. Skip if no `ObservabilityApp` or `options.skipTrace === true`.
2. Build a root span (`CHAIN` or `LLM`) plus children for tool rounds when present.
3. Attach `userId`, `sessionId` from generate options (GPT routes copy from `req.user` / body).
4. Attach prompt name/version when `options.promptRef` is set.
5. Compute `costUsd` from `options.priceMap ?? observability.priceMap` keyed by `model`.
6. `Promise.allSettled` on each `TraceSink.export`; log rejections; **never throw**.
7. If `sampleRate > 0` and `Math.random() < sampleRate`, enqueue live evaluators (same BackgroundTask path as experiments, one trace).

Parent/child workflows: `AIRequest` already has `parentRequestId` / `subRequestIds`. Traces use `traceId` + `parentSpanId`. Multi-agent `logMultiAgentRequest` should also emit a parent `AGENT`/`CHAIN` span wrapping children when observability is on.

## Models (local plugin)

All new models: `createdUpdatedPlugin`, `isDeletedPlugin`, `findOneOrNone`, `findExactlyOne`, **description on every field**. Types in `ai/src/types/` (five-type pattern). Connection: default mongoose connection (same as `AIRequest`). If local plugin is not registered, **do not** register these models.

| Model | Role |
| --- | --- |
| `ObsPrompt` | Named prompt (`name` unique). Tags. |
| `ObsPromptVersion` | Immutable version: `type` text\|chat, body, `variables[]`, `inputSchema`/`outputSchema` (JSON Schema objects), `config` (temperature preset name, model hint). |
| `ObsPromptLabel` | Movable labels: `production`, `latest`, optional `staging`. Unique `(promptId, label)`. |
| `ObsTrace` | Root trace: user, session, status, usage, prompt ref, timestamps. |
| `ObsSpan` | Nested spans: `traceId`, `parentSpanId`, OpenInference `kind`, input/output, model, tokens, cost. |
| `ObsScore` | Scores on trace/span. |
| `ObsEvaluator` | Named grader: dimensions[], type human\|llm-judge\|json-assert, judge `promptName` + schema. |
| `ObsDataset` / `ObsDatasetItem` | Items: input vars, optional expected output, `sourceTraceId`. |
| `ObsExperiment` / `ObsExperimentItem` | Run metadata + per-item outputs/scores. Status queued\|running\|completed\|failed. `backgroundTaskId`. |
| `ObsReviewItem` | Queue: pending\|in_progress\|done\|skipped, evaluatorId, traceId, assigneeId, scores payload. |

**Do not** put a unique index on fields that can duplicate (scores per trace are many). Index `{created: -1, userId: 1}`, `{sessionId: 1, created: -1}`, `{promptName: 1, promptVersion: 1}`, `{status: 1, created: 1}` on review items.

No backfill: new collections. `AIRequest` unchanged.

## APIs

Admin-only unless noted (`Permissions.IsAdmin`). OpenAPI via `createOpenApiBuilder`. Base path `/ai/observability` (stable, not `/admin/langfuse`).

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/ai/observability/status` | Plugin ids, capabilities, primaries, sink health (last error) |
| GET/POST | `/ai/observability/prompts` | List/create via **prompt primary** |
| GET/POST | `/ai/observability/prompts/:name/versions` | Immutable versions; POST creates `vN+1` |
| POST | `/ai/observability/prompts/:name/labels` | Move `production` / `staging` |
| POST | `/ai/observability/prompts/:name/playground` | Compile + one `AIService` call (not a new version) |
| GET | `/ai/observability/traces` | Filters: time, user, session, prompt, status, minCost, hasScore |
| GET | `/ai/observability/traces/:id` | Tree + scores |
| GET | `/ai/observability/sessions/:sessionId` | Timeline |
| GET | `/ai/observability/users/:userId` | Totals 7d/30d/all + recent traces |
| GET | `/ai/observability/costs` | Aggregates by model, prompt, user |
| CRUD | `/ai/observability/evaluators` | Dimension definitions |
| POST | `/ai/observability/traces/:id/scores` | Human or code score → **all ScoreSinks** |
| CRUD | `/ai/observability/datasets` + items | Dataset **primary** |
| POST | `/ai/observability/experiments` | Creates run; local → `BackgroundTask`; Langfuse → vendor API |
| GET | `/ai/observability/experiments/:id` | Status + aggregates |
| GET/POST | `/ai/observability/review` | Local queue only |

GPT routes: pass `userId` / `sessionId` / optional `promptRef` into `AIService`.

Langfuse-primary prompt/dataset/experiment routes **proxy** existing Langfuse admin routes where they already exist (`langfuseRoutesPrompts.ts` etc.) so we do not duplicate HTTP. ObservabilityApp may mount a thin facade that delegates.

## UI (`admin-frontend`)

New screens in `AI_ADMIN_WIDGETS` / `customScreens` (same pattern as `AIRequestsScreenWidget`):

| Screen | Name | Notes |
| --- | --- | --- |
| Prompts | `ai-prompts` | List + editor (new version, labels, JSON Schema I/O, playground) |
| Traces | `ai-traces` | List + detail waterfall |
| Sessions | `ai-sessions` | Optional v1: filter traces by session from detail |
| Costs | `ai-costs` | KPI + breakdown tables |
| Evaluators | `ai-evaluators` | Dimension builder |
| Datasets | `ai-datasets` | |
| Experiments | `ai-experiments` | Wizard; poll BackgroundTask; promote version |
| Review | `ai-review` | Split view; **hide** if local plugin off |
| Status chip | chrome | Active primaries; **Open in Langfuse** when Langfuse plugin id present |

Reuse `@terreno/ui` (`Page`, `Box`, `DataTable`, `Tabs`, `Modal`, `TextField`). Keep **AI Requests** explorer as-is (`AIRequest`).

Disabled tabs: if prompt primary is Langfuse, editor still works via API facade; if local off, Prompts/Datasets/Experiments/Review either hide or show Langfuse-backed lists + deep links (Q10). Review hidden when local off (Q25).

## Example app

`example-backend`:

- Register `ObservabilityApp` with **local plugin always**.
- If `LANGFUSE_*` already used for `LangfuseApp`, also pass Langfuse TraceSink/ScoreSink (and prompt adapter only if env `AI_OBS_PROMPTS_PRIMARY=langfuse`).
- Optional `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` → `OtelTraceSink`.
- Seed one prompt `example-summarize` v1 production, one evaluator `faithfulness` (numeric 0–1) + `safety` (boolean), empty dataset.

`example-frontend`: no product UI required (admin-only). Regen SDK if example-frontend calls new routes (likely admin-only; skip consumer SDK if unused).

## Feature flags & env

No OpenFeature flag required: **registration is the flag**.

Env (example-backend):

| Variable | Role |
| --- | --- |
| `AI_OBS_PROMPTS_PRIMARY` | `local` \| `langfuse` (default `local`) |
| `AI_OBS_DATASETS_PRIMARY` | default `local` |
| `AI_OBS_EXPERIMENTS_PRIMARY` | must equal datasets |
| `AI_OBS_SAMPLE_RATE` | `0`–`1`, default `0` |
| `AI_OBS_PRICE_MAP_JSON` | `{ "gemini-2.5-flash": { "inputPerMTok": 0.1, "outputPerMTok": 0.4 } }` |
| existing Langfuse keys | unchanged |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | optional OTLP |

Validate dataset/experiment primary equality and reject `reviewQueue` langfuse at boot with a clear `APIError` / logger.error + throw (fail fast like missing SendGrid key).

## Activity log

Do **not** add `UserUpdate` spam for every trace. Admin audit: prompt **production** label moves and experiment **promote** (reuse `onAdminAudit` if AdminApp is present; otherwise `logger.info` with prompt name + version).

## Testing

- Bun tests, `expect`, `@terreno/test` Mongo preload. **Never mock `@terreno/api` or models.**
- Fake TraceSink / ScoreSink in unit tests (in-memory).
- `AIService` tests: emit called; `skipTrace`; sink throw does not fail generate; `AIRequest` still written.
- Config tests: illegal experiment/dataset mix; langfuse reviewQueue; local-off + prompt primary local fails.
- Local experiment: POST creates `BackgroundTask`, items scored, aggregates.
- Langfuse adapter tests: mock `getLangfuseClient` (existing pattern in `langfuseClient.test.ts`).
- Admin widget tests: render list empty/loading (existing admin-frontend patterns).
- `verify-ui-changes` on admin-frontend screens before Brew.

## Documentation (same slices as code)

| Page | Kind |
| --- | --- |
| `docs/explanation/ai-observability.md` | Why two planes, plugins, vs `LangfuseApp` / `AIRequest` |
| `docs/how-to/observe-llm-calls.md` | Register plugins, primaries, price map, sampleRate, Open in Langfuse |
| `docs/reference/ai.md` | Models, routes, `AIService` trace options, env |
| `terreno-langfuse-integration.md` | Pointer: native path is this IP; LangfuseApp remains the vendor plugin |
| `ai-prompt-governance` skill | Prompt bodies for judges still named constants **or** `PromptRegistry` production label — not inline strings in `AIService` |

## Phases

1. **Contracts + ObservabilityApp + AIService emit + in-memory sinks** (tracer).
2. **Local Mongo plugin** (prompts, traces, scores, costs, users/sessions).
3. **Evaluators + live sampleRate + review queue**.
4. **Datasets + local experiments via BackgroundTask**.
5. **Langfuse adapter** (trace/score/prompt/dataset/experiment) + OTel TraceSink + admin UI + example-backend + docs.

## Acceptance criteria

- [ ] `AIService.generateText` with ObservabilityApp registered writes a nested-capable trace to **every** TraceSink; a throwing sink does **not** fail the generate; `AIRequest` still exists.
- [ ] Creating prompt v2 does not mutate v1; moving `production` is an explicit label API; `get({name, label: "production"})` returns v2.
- [ ] Trace list filters by `userId`, `sessionId`, prompt name/version; detail shows cost USD when price map has the model.
- [ ] Evaluator with two dimensions (numeric + boolean) can score a trace via LLM-judge (`AIService` + named judge prompt) and via human review queue.
- [ ] Dataset of N prior traces; experiment of production vs draft always uses `BackgroundTask` when local; promote sets production label.
- [ ] Langfuse plugin on: same generate dual-writes traces/scores; prompts stay on configured primary; boot fails if `experiments.primary !== datasets.primary` or `reviewQueue` is langfuse.
- [ ] OTel sink: one test asserts an OTLP payload / exporter mock received an OpenInference `LLM` span.
- [ ] Admin: prompts, traces, costs, review, experiments usable as admin; Review hidden without local plugin.
- [ ] Docs pages above match shipped behavior; `bun run --filter=@terreno/ai compile test lint` green.

## Risks

| Risk | Mitigation |
| --- | --- |
| Langfuse experiment API vs Terreno dataset | Config equality; no sync job |
| Double OTel SDK vs LangfuseApp | Adapter shares existing tracing init |
| PHI in Mongo | Document; retention is a follow-on IP |
| Live evals cost | `sampleRate` default 0 |
| Missing failover IP | Follow current `AIService` / parent-child `AIRequest` |
| Admin SPA drift | Widgets in admin-frontend automatically appear in spa shell |

## Files to create / modify (expected)

- `ai/src/observability/**` (types, app, local models/stores, otel sink, langfuse adapter)
- `ai/src/service/aiService.ts` — emit traces
- `ai/src/routes/gpt.ts` — pass user/session
- `ai/src/aiAdminApp.ts` / new `observabilityAdmin.ts` — screens
- `ai/src/index.ts` — exports
- `admin-frontend/src/widgets/*` — new screens + registry
- `example-backend/src/server.ts` — register ObservabilityApp
- docs listed above
- tests colocated
