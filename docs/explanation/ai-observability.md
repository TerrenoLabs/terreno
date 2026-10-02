# AI observability

Terreno ships Langfuse-like prompt versioning, nested traces, evaluators, datasets, experiments, and a local human review queue **inside `@terreno/ai`**, with operator UI in **`admin-frontend` only**.

## Why not Langfuse-only

Apps must iterate prompts without a required vendor account. `LangfuseApp` stays a second plugin. Traces and scores **fan out** to every registered sink (local Mongo, Langfuse, OTLP/OpenInference). Prompts, datasets, experiments, and the review queue have **one writer** each (a primary). The review queue is **local-only**.

That split is the two planes:

| Plane | Write | Admin read |
| --- | --- | --- |
| Telemetry (traces, scores) | All sinks, best-effort | Local if the local plugin is on, else Langfuse |
| Control (prompts, datasets, experiments, queue) | One primary per capability | That primary |

`experiments.primary` must equal `datasets.primary`. Defaults are all `local`.

`ObservabilityApp` fails boot (constructor throws) when:

| Error | Cause |
| --- | --- |
| `experiments.primary must equal datasets.primary` | Mixed dataset/experiment writers |
| `reviewQueue.primary must be local` | `reviewQueue` set to `langfuse` |
| `<capability> primary "<id>" has no plugin` | No registered plugin with that `id`, capability, and store |

Telemetry sinks still fan out even when a control primary is local-only.

Admin chrome lives in `admin-frontend`. One sidebar group **AI Observability** holds Prompts,
Traces, and Review (Review is omitted when the local plugin is off). Existing **AI Requests**
stays under **Screens**. Every observability screen shows breadcrumbs
`Admin / AI Observability / <Section> / <leaf>` and a status chip from `GET /ai/observability/status`.
Prompts are edited as immutable versions in admin (`Save as vN+1`); apps never inline the string.

## Why this shape for product work

Flourish AI features follow an 8-step loop: gold dataset → labels → prompt versions → evaluators → experiments with gates → `production` label → live traces and in-app feedback → weak traces back into the dataset.

That loop is the product requirement, not an optional dashboard. Operator steps: [Develop an AI feature](../how-to/ai-feature-development.md). Registration and env: [Observe LLM calls](../how-to/observe-llm-calls.md). Models and routes: [AI reference](../reference/ai.md). Design lock: [implementation plan](../implementationPlans/ai-observability.md).

## RBAC (domain-neutral)

Observability HTTP routes use Terreno RBAC resources (`aiPrompt`, `aiTrace`, `aiReview`,
`aiDataset`, `aiExperiment`, `aiEvaluator`) instead of domain-specific approval vocabulary.
Pass `accessControl` on `ObservabilityApp` to enforce grants on the server; UI hiding ships in
a later phase. Seeded `admin` receives every observability action; `auditor` receives `list` and
`read` on each observability resource through the read-only sentinel (but not `admin:access` —
pair auditor with a shell grant in a composed consumer role); `superadmin` receives `*`. Existing
customized `admin` and `auditor` roles gain only missing observability actions on re-seed. Legacy
`user.admin` remains a full-access fallback when RBAC is enabled. See
[API reference](../reference/api.md#ai-observability-rbac).

`AIRequest` remains the cheap per-call log. Observability traces are the nested, scored, user/session/cost record used in the SOP.

## Prompt hub relationships (phase 4)

Prompts may carry an optional domain-neutral `description` (folder semantics stay consumer-defined). `GET /ai/observability/prompts/:name` composes bounded recent **traces** and **experiments** for that prompt name so the admin hub does not scan full trace or experiment lists on the client. Trace evidence is version-aware: list filters accept `prompt` plus optional `promptVersion`, and relationship trace rows include the matching `promptVersion` from `ObsTrace.prompts[]`. Experiment relationships filter server-side by `promptName` on `GET /ai/observability/experiments?promptName=…` (omit or pass an empty value for no filter). The experiment list endpoint returns summary rows without per-item hydration; use experiment detail for full item results. Reading relationships uses the same `aiPrompt:read` grant as prompt detail.

## Phase 1 reference loop

The example backend always registers the local plugin. Its idempotent seed creates
`examples/example-summarize` with production on v1 and an experimental v2, the human
`correctness-human` evaluator, the automatic `schema-assert` evaluator, and a two-item
`example-gold` dataset. It also creates `chat-safety-synthetic`, a proofread set of
two-person chats for routing, toxicity, privacy, and dismissive-reply experiments.
This makes the review and experiment loops walkable without Langfuse:
resolve the production prompt → emit a trace → inspect spans and sensitive I/O → send the
trace to Review → record a human score.

The example frontend supplies that first step from real product usage: **Todos → Summarize**
calls `/ai/example-summarize`, which resolves `example-summarize` by name and `production`
label server-side. Prompt selection stays on the server, while the client only contributes
identity (`x-ai-session-id`) and, when the backend has no provider credentials, the user's own
key.

`AI_OBS_PRICE_MAP_JSON` belongs to deployment configuration because prices change
independently of prompt versions. A missing model price preserves token counts and omits
USD cost; it never invents `$0`.

## Phase 2 backend (evaluators, datasets, experiments)

With the local plugin registered and primaries set to `local`, the control plane now includes:

- **`llm-judge` and `json-assert` evaluators** — judges call `AIService.generateJsonObject` through a named registry prompt (`judgePromptName`); create/update rejects a judge when the prompt `outputSchema` omits a required dimension (the error names that key). `json-assert` supports path/constraint checks and a built-in mode that validates output against the prompt version `outputSchema`. Parse or generation failures record an error outcome instead of throwing to the caller. Custom creates score a full trace; generation span and dataset item targets are reserved. Seeded templates install `correctness` / `hallucination` / `helpfulness` / `toxicity` as `llm-judge`, `schema-assert` as `json-assert`, and `*-human` variants for the review queue.
- **Human review evaluators** — sending traces to review requires a `human` evaluator. Its dimensions become the review item's score fields and its instructions tell the reviewer how to apply them. `llm-judge` and `json-assert` evaluators run automatically and are rejected from the human queue.
- **Datasets** — CRUD plus item provenance (`origin`, `proofread`, `sourceTraceId`, tags, outcome class). Import accepts **JSON** (bare objects or structured rows) and **CSV** (quoted fields; `input.*` / `expectedOutput.*` column prefixes). Rows validate against the bound prompt input schema when configured. Adding from a trace copies I/O; sensitive traces always land `proofread: false`. Deleting an item never mutates the trace.
- **Experiments** — compare 2–3 prompt versions on a dataset with optional `modelOverride` (requires `aiServiceFactory` on `ObservabilityApp`), evaluator thresholds (defaulting to the SOP gates), **per-version gate tiles** (`gates[].version`), outlier/low-confidence item ids, and version-scoped promote (**409** when the selected version's gates fail). Unproofread items are excluded unless `includeUnproofread` is true. Local runs compile exact prompt versions and call `AIService.generateText` with compiled `prompt` + `systemPrompt` (no `promptName`/`promptLabel`). `ObservabilityApp` wires the local experiment runner from `aiService` at register time.

Operator UI for datasets and experiments ships in tasks 2.7–2.9; routes and stores are live for API clients and tests today.

## GPT tool spans and nested traces

`/gpt/prompt` streams tool rounds to the client **and** records them in observability traces. Each provider `tool-call` / `tool-result` pair becomes a `TOOL` span (input args, cleaned output, timing, `parentSpanId` on the chain root). When tools run, the exported trace uses a `CHAIN` root wrapping those `TOOL` children instead of a lone `LLM` span. Plain `AIService.generate*` calls without tool children still log a single `LLM` root.

## Admin multi-stage trace smoke test

`POST /ai/observability/traces/test-multi-stage` (admin-only) exercises a real multi-stage workflow through the configured `ObservabilityApp.aiService`: two `generateJsonObject` LLM passes (`skipTrace: true`) with named output schemas, a deterministic local `text-metrics` tool stage, then a final synthesis `generateJsonObject` call against a combining schema. System prompts live in `OBS_TEST_MULTI_STAGE_*` constants in `ai/src/service/prompts.ts` (never inline). Each LLM span records `{prompt, schemaName, outputSchema}` as input and the parsed object as output. The handler exports one parent `TraceRecord` via `ObservabilityApp.exportTrace` with child span order `LLM`, `LLM`, `TOOL`, `LLM` and returns `{traceId, output, stages}` so operators can open the persisted trace in admin. Missing `aiService` → **503**; child failure exports an error trace then propagates the error.
