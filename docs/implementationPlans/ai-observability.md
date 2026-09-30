# Implementation Plan: AI observability (Langfuse replacement, pluggable)

**Status:** Approved  
**Roadmap:** Area=`ai`, Target=`Future`, Impact=`Feature`  
**Created:** 2026-08-24  
**Updated:** 2026-08-31 (re-scoped to three phases against the Claude design)  
**Owner:** unassigned  
**Branch:** `cursor/ai-observability-ip-64ca`  
**Task list:** [docs/tasks/ai-observability.md](../tasks/ai-observability.md)  
**Design:** [AI Observability Prototype](https://claude.ai/design/p/36eec001-f2f0-4161-b60d-20dace4d0a9c?file=AI+Observability+Prototype.dc.html) — 21 screens, normative for UI and for the field/badge vocabulary below  
**Linear:** none  
**Roadmap issue:** none yet (handoff after Approved)

**Depends on:** current `@terreno/ai` (`AIService`, `AIRequest`, `LangfuseApp`, `AIAdminApp`).

**Related:** [terreno-langfuse-integration.md](./terreno-langfuse-integration.md) (`LangfuseApp` stays). [FH-48](https://linear.app/flourish-health/issue/FH-48/ai-improvements).

## Goal

Replace Langfuse as the **primary** AI observability product for Terreno apps: prompt versioning with a
production label, nested traces with per-span cost, multidimensional evaluators, datasets, experiments with
gates, and a **human review queue** — all local (Mongo) with an operator UI in `admin-frontend`, and Langfuse
demoted to an optional **extra sink** an app can keep.

The design prototype is the destination. Its 21 screens divide cleanly into three shippable products:

| Phase | Ships | Design screens |
| --- | --- | --- |
| **1 — MVP** | Prompt library + production label, tracing, human review queue | Prompts, Prompt editor (+ Playground), Traces, Trace detail, Review queue, Review item |
| **2** | Evaluation loop: evaluators, datasets, experiments, in-app feedback | Evaluators (+ detail, new), Datasets (+ detail), Experiments (+ new, results) |
| **3** | Analytics + pluggable backends: Langfuse/OTel fan-out | Sessions (+ timeline), Users (+ AI profile), Costs, status chip primaries, Open in Langfuse |

Phase 1 alone must let a team stop copying prompt strings into route code, see what every AI call did and cost,
and get a clinician's judgement recorded against a real output. Phases 2 and 3 are additive — no Phase 1
schema or route is rewritten later.

## Non-goals

- Removing or rewriting `LangfuseApp`.
- `admin-spa` screens (spa already embeds `admin-frontend` widgets).
- First-class Braintrust, Helicone, LangSmith, Weave, Opik, Portkey adapters (document how they fit; do not code stubs).
- Langfuse **annotation queues** as `reviewQueue.primary` (local Mongo queue only).
- Dual-write of prompt versions, datasets, or review items.
- Retention / redaction / retry **jobs** (full I/O stored; see Risks).
- Replacing `AIRequest` (cheap call log remains).
- Pixel-clone of Langfuse Cloud chrome.
- A "minimum datapoints" calculator. Operators keep their volume spreadsheet; Terreno stores provenance/tags so they can filter for balance.
- Auto-promoting a prompt to `production` when experiment gates pass. Promote stays an explicit admin action.

## Decisions

### Carried forward

| ID | Question | Choice |
| --- | --- | --- |
| Q1 | System of record | Mongo **local plugin** + **pluggable** backends, not wrap-only |
| Q2 | Package | Grow `@terreno/ai` |
| Q3 | Existing Langfuse | **Two plugins**: keep `LangfuseApp`; add `ObservabilityApp` |
| Q4 | Operator UI | **`admin-frontend` only** |
| Q7 | SDK | Capability interfaces + `capabilities` (comms-style) |
| Q8 | Adapters | `local` (full) + `langfuse` (mapped, phase 3) + `otel` TraceSink (phase 3) |
| Q9 | PHI / I/O | Persist **full I/O**; no retention job in this IP |
| Q12/Q16/Q21 | Primaries | Four flags: `prompts`, `datasets`, `experiments`, `reviewQueue` |
| Q22 | Mix rule | `experiments.primary` **must equal** `datasets.primary` (fail config) |
| Q23 | Defaults | All four primaries **`local`**; Langfuse/OTel are extra **sinks** |
| Q25 | Review queue | **Local-only**; `reviewQueue.primary: "langfuse"` is a config error |
| Q13 | Secondary down | Primary write **succeeds**; secondary sink errors **logged, never thrown** |
| Q14/Q17 | Experiments | Local → always **`BackgroundTask`**; Langfuse → Langfuse experiment API |
| Q15 | Mongo | **New collections**; keep `AIRequest` |
| Q19 | Cost | `inputTokens` / `outputTokens` / `model`; USD from config price map (missing model → **tokens only**, never `$0`) |
| Q20 | Instrumentation | If observability is registered, `AIService` emits traces on every `generate*` (opt-out per call) |
| Q31 | Deploy plumbing | `AIService` `promptName` + `promptLabel` (default `"production"`) resolves via `PromptRegistry` before generate |

### New — from the design prototype

| ID | Question | Choice |
| --- | --- | --- |
| Q34 | Prompt organization | Prompts live in a **folder** (`clinical-notes`, `safety`, …) plus free tags. Folder rail with counts is the primary filter; search matches name and tags |
| Q35 | Prompt list columns | Name (`folder/name`), type, latest, production, last used, **calls 7d**, **cost 7d** — the usage columns are a rollup over `ObsTrace`, computed on read with a short cache, not denormalized onto the prompt |
| Q36 | Version immutability affordance | The editor never edits in place: the only save action is **"Save as vN+1"**, and **"Set vN as production"** is a separate confirm modal naming the outgoing version. One production label per prompt |
| Q37 | Playground | Compiles the selected version with operator-supplied variables and runs **one** `AIService` call. Shows compiled messages, output, latency / tokens / cost, and **"Save this run to dataset"** (phase 2 wires the save) |
| Q38 | Sensitive content | Traces and spans carry `sensitive: boolean` (set per call, or inherited from the prompt version). Drives the `sensitive` badge, collapsed-by-default I/O disclosures, and the bulk-add warning. **Never** shown on the Users screen |
| Q39 | Evaluator shape | An evaluator declares `target` (`generation span` \| `full trace` \| `dataset item`) and **typed dimensions** `{key, dataType: numeric\|boolean\|categorical, range, required}`. Scores written by it carry exactly those keys |
| Q40 | Judge schema check | For `llm-judge`, the judge prompt version's `outputSchema` **must declare every required dimension**. Validated on create and on save, with the failing dimension named in the error. Not a runtime-only surprise |
| Q41 | Run modes | Per-evaluator, not global: `liveSampleRate` (0–100%, **default 0**), `availableInExperiments`, `allowManualRun`. Human evaluators **cannot** sample live traffic (rejected at save). Replaces the single global `AI_OBS_SAMPLE_RATE`, which becomes a **ceiling** |
| Q42 | Dataset provenance | Two operator-facing states: **human-annotated** (a person wrote or approved the expected output) and **auto-captured** (a rule or bulk add wrote it, unreviewed). Backed by `origin` (`manual` \| `trace` \| `synthetic`) + `proofread` + `annotatedBy`. Dataset detail tabs: All / Human / Auto / **Needs review** |
| Q43 | Sensitive → needs review | Adding a `sensitive` trace to a dataset always lands the item as auto-captured / needs review, whatever the bulk action was. The bulk bar states the count before the operator confirms |
| Q44 | Dataset input schema | A dataset may bind to a prompt (`inputSchemaPromptName`); items validate against that prompt version's `inputSchema` on add, and the detail header says so |
| Q45 | Experiment shape | Compare **2–3 prompt versions** on one dataset, not a strict A/B. Results show gate tiles, an outliers list, and a per-item side-by-side table with **failed items floated to the top** |
| Q46 | Promote gating | **Promote is blocked while any gate fails** — the button renders disabled with the failing gate named. Passing gates do not auto-promote; promote stays an explicit click plus a confirm modal |
| Q47 | Experiment wizard | Four steps — Dataset → Prompt versions → Evaluators → Review & run — with a completed-step rail, per-evaluator cost hints, and a **pre-run estimate** (generations, USD, wall clock) on the last step |
| Q48 | Review item presentation | The review screen is plain-language, not a JSON viewer: **"What the AI was given"** and **"What the AI wrote"** panels, per-field labels and reviewer notes, long fields collapsed with a word count, structured outputs as key/value rows, raw JSON behind a disclosure |
| Q49 | Review field metadata | Those labels and notes come from the prompt version: `variables[].label` / `.reviewerNote` for the given panel, `outputSchema` field titles + `outputFieldNotes` for the wrote panel. Falls back to raw keys when absent |
| Q50 | Review score form | Generated from the evaluator's dimensions: numeric → slider with end labels, boolean → Pass/Fail, categorical → pills. Plus an optional comment. Actions: **Submit & next**, Skip, Assign to me |
| Q51 | Queue flow | Tabs Pending / In progress / Done / Skipped with counts; oldest-first; **"Start reviewing — oldest first"**; item screen shows "Item N of M pending" with prev/next; explicit empty state naming both intake paths |
| Q52 | Queue intake | Two paths in phase 1: **"Send to human review"** on a trace (single and bulk) and manual assignment. Queue intake requires a human evaluator; its dimensions become reviewer score fields and its instructions guide scoring. Phase 2 adds experiments and in-app feedback flags |
| Q53 | Chrome | Breadcrumb `Admin / AI Observability / <Section> / <leaf>` on every screen, plus a status chip: local plugin state · Langfuse sink health · active primaries. **Open in Langfuse** appears only when the Langfuse plugin is registered (phase 3) |
| Q54 | Nav | One `AI Observability` sidebar group. **Review queue is hidden when the local plugin is off.** Existing `AI Requests` stays in its own group, untouched |
| Q55 | Evaluator templates | Seeded: `correctness`, `hallucination`, `helpfulness`, `toxicity` (llm-judge), `schema-assert` (json-assert, validates against the prompt version `outputSchema`, free/in-process), and one **human** review template. Custom evaluators still allowed |
| Q56 | Trace errors | A failed trace shows `error` status plus a one-line human cause on the row (`failed at span 3 of 4 — escalation-notify timed out`), derived from the first failed span |
| Q57 | Multi-prompt traces | A trace touching more than one prompt shows `N prompts` in the prompt column rather than one `name@version` |

### Competitor coverage (why the SDK is split)

| Backend | TraceSink | PromptRegistry | Dataset / experiment | ScoreSink | ReviewQueue |
| --- | --- | --- | --- | --- | --- |
| Local Mongo | yes (P1) | yes (P1) | yes (P2) | yes (P1) | yes (P1) |
| Langfuse | yes (P3) | yes (P3) | yes (P3) | yes (P3) | never |
| OTLP / OpenInference | yes (P3) | no | no | no | no |
| Phoenix / Laminar / Datadog | via OTel | no | no | no | no |
| Helicone / Portkey | later (gateway) | no | no | no | no |
| Braintrust / LangSmith | later | later | later | later | later |

Traces use **OpenTelemetry + OpenInference** span kinds (`LLM`, `AGENT`, `CHAIN`, `TOOL`, `RETRIEVER`,
`EVALUATOR`). That is the honest "works with competitors" layer. Prompt/dataset/queue APIs stay vendor CRUD
behind Terreno interfaces.

## Operator workflow (AI Feature Development SOP)

Normative operator path; how-to lives in [ai-feature-development.md](../how-to/ai-feature-development.md).

| SOP step | Operator action | Terreno provides | Phase |
| --- | --- | --- | --- |
| 1 Gather gold set | Live traces; bulk add to dataset; manual items; AI drafts | Tracing (P1); add-from-trace, import JSON, synthetic generate (P2) | 1 / 2 |
| 2 Label expected output | Hand-label outcomes; input/output schema | Dataset items, provenance, needs-review tab | 2 |
| 3 Create prompt | Product + optional AI draft | Prompt editor + playground; immutable versions | **1** |
| 4 Evaluators | Flags → correctness; open-ended → hallucination, helpfulness, toxicity, custom | Template install + evaluator builder | 2 (human type in **1**) |
| 5 Experiments | Run versions on a dataset; gates; outliers; iterate | Experiment wizard + results | 2 |
| 6 Deploy | Label winning version `production` | Label API + `promptName`/`promptLabel` resolution | **1** |
| 7 Live tracing + feedback | Watch production; thumbs and outcome class from the app | Auto-trace (P1); `POST feedback` (P2) | 1 / 2 |
| 8 Deficient traces → dataset | Filter weak traces; add; relabel; repeat 5–8 | Trace filters (P1); bulk add-to-dataset (P2) | 1 / 2 |

Phase 1 covers SOP steps 3, 6, 7 (tracing half) and the human-judgement loop; phase 2 closes 1, 2, 4, 5, 8.

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

Mirrors `@terreno/comms`: interfaces in `ai/src/observability/types.ts`; adapters add no vendor SDKs to core
beyond what `LangfuseApp` already uses. The OTLP exporter is an optional adapter file.

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

type SpanKind = "AGENT" | "CHAIN" | "EVALUATOR" | "LLM" | "RETRIEVER" | "TOOL";

interface TraceRecord {
  id: string;
  name: string;
  startedAt: string;
  endedAt?: string;
  userId?: string;
  sessionId?: string;
  status: "error" | "ok";
  /** First failing span rendered as one human line on the trace row (Q56). */
  errorSummary?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  /** Collapses I/O disclosures and forces dataset items to needs-review (Q38, Q43). */
  sensitive: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    model?: string;
    /** Absent when the price map has no entry for `model` — render "tokens only", never $0. */
    costUsd?: number;
  };
  /** Multiple entries render as "N prompts" in the trace list (Q57). */
  prompts: {name: string; version: number; label?: string}[];
  flaggedForDataset?: boolean;
  spans: SpanRecord[];
}

interface ScoreRecord {
  /** Must be a declared dimension key of `evaluatorId` when one is set (Q39). */
  name: string;
  dataType: "boolean" | "categorical" | "numeric";
  value: boolean | number | string;
  comment?: string;
  /** 0–1. Experiment outlier if below the evaluator's `confidenceAlertBelow` (default 0.7). */
  confidence?: number;
  source: "code" | "human" | "llm-judge" | "user-feedback";
  evaluatorId?: string;
  traceId: string;
  spanId?: string;
}

interface EvaluatorDimension {
  dataType: "boolean" | "categorical" | "numeric";
  key: string;
  /** Numeric bounds, categorical values, or a free-text hint. Drives the review form control (Q50). */
  range?: string;
  required: boolean;
}

interface EvaluatorRunModes {
  allowManualRun: boolean;
  availableInExperiments: boolean;
  /** 0–100. Default 0. Rejected as non-zero for `human` evaluators (Q41). */
  liveSampleRate: number;
}

interface EvaluatorRecord {
  confidenceAlertBelow?: number; // default 0.7
  description?: string;
  dimensions: EvaluatorDimension[];
  /** json-assert only. */
  assertion?: {constraint: string; path: string};
  /** human only — shown atop the review score form. */
  instructions?: string;
  /** llm-judge only; its version's outputSchema must declare every required dimension (Q40). */
  judgePromptName?: string;
  name: string;
  runModes: EvaluatorRunModes;
  target: "dataset item" | "full trace" | "generation span";
  type: "human" | "json-assert" | "llm-judge";
}

interface DatasetItemRecord {
  /** Who wrote/approved the expected output; renders the provenance sub-line (Q42). */
  annotatedBy?: {label: string; reviewItemId?: string; userId?: string};
  datasetId: string;
  expectedOutput?: unknown;
  input: unknown;
  metadata?: Record<string, unknown>;
  origin: "manual" | "synthetic" | "trace";
  outcomeClass?: "fn" | "fp" | "tn" | "tp";
  /** true → "human-annotated"; false → "auto-captured" / needs review (Q42). */
  proofread: boolean;
  sourceTraceId?: string;
  tags: string[];
}

interface ScoreThreshold {
  aggregate: "mean" | "trueRate";
  dimension: string;
  evaluatorName: string;
  op: "eq" | "gte" | "lte";
  value: number;
}

/** Defaults applied to a new experiment. Boolean dimensions use trueRate; numeric use mean. */
const SOP_DEFAULT_THRESHOLDS: ScoreThreshold[] = [
  {aggregate: "trueRate", dimension: "correct", evaluatorName: "correctness", op: "eq", value: 1},
  {
    aggregate: "trueRate",
    dimension: "hallucinated",
    evaluatorName: "hallucination",
    op: "eq",
    value: 0,
  },
  {aggregate: "mean", dimension: "helpfulness", evaluatorName: "helpfulness", op: "gte", value: 0.9},
  {aggregate: "trueRate", dimension: "toxic", evaluatorName: "toxicity", op: "eq", value: 0},
];

interface TraceFeedback {
  comment?: string;
  /** When true, mark trace `flaggedForDataset` and optionally enqueue review. */
  flagDataset?: boolean;
  kind: "flag_dataset" | "outcome" | "thumbs";
  value: "down" | "fn" | "fp" | "tn" | "tp" | "up";
}
```

`ObservabilityApp` (new `TerrenoPlugin`):

- Validates config (Q22, Q25, plugin present for each primary) and fails boot loudly.
- Holds the sink lists and primaries.
- Contributes admin screens for the capabilities that are actually available.
- Does **not** replace `LangfuseApp.register()`. The Langfuse **adapter** wraps the existing client from
  `LangfuseApp` / `getLangfuseClient()` and must not start a second OTel SDK.

### `AIService` prompt resolution and trace hook

Before every generate path:

1. If `options.promptName` is set, resolve `PromptRegistry.get({name, label: options.promptLabel ?? "production"})`
   **before calling the model**, independent of `skipTrace` and trace-sink registration. Use the resolved body and
   retain its ref. Missing registry, missing label, or missing version → `APIError` 400 and no model call.
2. Inherit `sensitive` from the resolved prompt version unless the generate option explicitly sets it.

After each successful or failed generate path (same place as `logRequest`):

1. Skip **trace export only** if no `ObservabilityApp` or `options.skipTrace === true`; prompt resolution above still ran.
2. Build a root span (`CHAIN` or `LLM`) plus children for tool rounds when present.
3. Attach `userId`, `sessionId`, and resolved/effective `sensitive` from generate options.
4. Attach the resolved ref to `trace.prompts`.
5. Compute `costUsd` from `options.priceMap ?? observability.priceMap` keyed by `model`; leave undefined when absent.
6. Set each span `status` and, for failures, its short `error` cause; derive trace `errorSummary` from the first failed
   span in execution order.
7. `Promise.allSettled` on each `TraceSink.export`; log rejections; **never throw**.
8. Phase 2: for each evaluator with `liveSampleRate > 0` (capped by `AI_OBS_SAMPLE_RATE`), roll and enqueue a
   live eval on the same `BackgroundTask` path experiments use.

`AIRequest` keeps `parentRequestId` / `subRequestIds`. Traces use `traceId` + `parentSpanId`. Multi-agent
`logMultiAgentRequest` also emits a parent `AGENT`/`CHAIN` span wrapping children.

## Models (local plugin)

All new models: `createdUpdatedPlugin`, `isDeletedPlugin`, `findOneOrNone`, `findExactlyOne`, **description on
every field**. Types in `ai/src/types/` (five-type pattern). Default mongoose connection. Not registered when
the local plugin is absent.

| Model | Phase | Role |
| --- | --- | --- |
| `ObsPrompt` | 1 | Named prompt (`name` unique). **`folder`**, `tags[]`. |
| `ObsPromptVersion` | 1 | Immutable version: `type` text\|chat, `system`, `template`, `variables[]` (`{key, required, label?, reviewerNote?}`), `inputSchema`/`outputSchema` (JSON Schema), `outputFieldNotes` (Q49), **`sensitive: boolean`** (default false, inherited by calls), `config` (temperature preset, model hint). |
| `ObsPromptLabel` | 1 | Movable labels: `production`, `latest`, optional `staging`. Unique `(promptId, label)`. |
| `ObsTrace` | 1 | Root trace: user, session, status, `errorSummary`, `sensitive`, usage, `prompts[]`, timestamps. |
| `ObsSpan` | 1 | Nested spans: `traceId`, `parentSpanId`, OpenInference `kind`, input/output, model, tokens, cost, `sensitive`, **`status` (`ok`\|`error`) and optional short `error`**, `startOffsetMs`/`durationMs` for the waterfall. |
| `ObsScore` | 1 | Scores on trace/span. Many per trace — **no unique index**. |
| `ObsEvaluator` | 1 (human) / 2 (judge, assert) | `type`, `target`, `dimensions[]`, `runModes`, judge/assertion/instructions, `confidenceAlertBelow`. |
| `ObsReviewItem` | 1 | Queue: `status` pending\|in_progress\|done\|skipped, `evaluatorId`, `traceId`, `spanId?`, `datasetItemId?`, `assigneeId`, `reason` (`manual` \| `eval` \| `feedback` \| `dataset_candidate`), scores payload, `comment`, `enqueuedAt`. |
| `ObsDataset` | 2 | Name, tags, `inputSchemaPromptName`, `expectedOutputSchema`. |
| `ObsDatasetItem` | 2 | `input`, `expectedOutput`, `sourceTraceId`, `origin`, `proofread`, `annotatedBy`, `tags[]`, `outcomeClass`, `metadata`. |
| `ObsExperiment` / `ObsExperimentItem` | 2 | Run metadata + per-item outputs/scores per version. `versions[]` (2–3), optional `modelOverride`, `thresholds[]`, status, `backgroundTaskId`, aggregates incl. gate pass/fail, outlier ids, low-confidence ids, `estimate`. |

Indexes: `{created: -1, userId: 1}`, `{sessionId: 1, created: -1}` and `{status: 1, created: -1}` on traces;
`{"prompts.name": 1, "prompts.version": 1}` on traces (prompt rollups, Q35); `{traceId: 1}` on spans and scores;
`{status: 1, enqueuedAt: 1}` on review items; `{flaggedForDataset: 1, created: -1}` on traces;
`{datasetId: 1, proofread: 1, origin: 1}` on dataset items.

No backfill: new collections. `AIRequest` unchanged.

## APIs

Admin-only unless noted (`Permissions.IsAdmin`). OpenAPI via `createOpenApiBuilder`. Base path
`/ai/observability`.

### Phase 1

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/status` | Plugin ids, capabilities, primaries, local-on flag (drives chip + nav, Q53/Q54) |
| GET/POST | `/prompts` | List (folder, search, `include=usage7d` for calls/cost rollups) / create |
| GET | `/prompts/:name` | Prompt + versions + labels |
| POST | `/prompts/:name/versions` | Creates `vN+1`; never mutates an existing version |
| POST | `/prompts/:name/labels` | Move `production` / `staging`; returns the outgoing version for the confirm modal |
| POST | `/prompts/:name/playground` | Compile + one `AIService` call; returns compiled messages, output, latency, tokens, cost. Creates no version |
| GET | `/traces` | Filters: time range, prompt, status, user or session id, `hasScore`, `sensitive`, `flaggedForDataset`. Paginated |
| GET | `/traces/:id` | Span tree (kind, offsets, durations) + per-span I/O + scores |
| POST | `/traces/review` | Enqueue one or many traces against a human evaluator (Q52) |
| POST | `/traces/:id/scores` | Human or code score → all ScoreSinks |
| CRUD | `/evaluators` | Human type in phase 1; `GET /evaluators/templates` lists the seeds |
| GET | `/review` | Queue by status with counts; oldest-first |
| GET | `/review/:id` | Item + rendered `given` / `wrote` panels (Q48/Q49) + evaluator dimensions for the form |
| POST | `/review/:id` | `submit` (scores + comment), `skip`, or `assign` |

### Phase 2

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/traces/:id/feedback` | **IsAuthenticated** (owner or admin). Thumbs / outcome / flag-for-dataset → ScoreSinks; optional review enqueue |
| POST | `/traces/add-to-dataset` | `{datasetId, traceIds[]}`. Copies I/O; `origin: "trace"`; sensitive traces forced to `proofread: false` (Q43) |
| CRUD | `/datasets` + `/datasets/:id/items` | Item PATCH for expectedOutput / tags / outcomeClass / proofread |
| POST | `/datasets/:id/import` | JSON or CSV upload; validates against `inputSchemaPromptName` when set. CSV: `text/csv` body or `{format: "csv", content}` |
| POST | `/datasets/:id/generate` | Synthetic drafts via named generator prompt; `proofread: false` |
| POST | `/experiments/estimate` | Wizard step 4: generation count, USD, wall-clock estimate |
| POST | `/experiments` | 2–3 versions × dataset × evaluators + thresholds; local → `BackgroundTask` |
| GET | `/experiments/:id` | Status, progress, aggregates, gate pass/fail, outliers, per-item side-by-side |
| POST | `/experiments/:id/promote` | **409 while any gate fails** (Q46); otherwise moves the production label |

### Phase 3

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/sessions`, `/sessions/:id` | Session list + timeline |
| GET | `/users`, `/users/:id` | AI usage per user; masked identifiers, **no prompt content** (Q38) |
| GET | `/costs` | KPI row + by-model (`tokens only` when unpriced) + by-prompt |
| GET | `/status` | Extended with sink health (last error per sink) and Langfuse deep-link bases |

GPT routes pass `userId` / `sessionId` into `AIService`; request `sensitive: true` may upgrade handling,
but `false` never downgrades a sensitive registry version. Client `promptName` + `promptLabel`
selection is admin-only; application routes select production prompts server-side.
Langfuse-primary prompt/dataset/experiment routes **proxy** the existing Langfuse admin routes rather than
duplicating HTTP.

## UI (`admin-frontend`)

New screens registered in `AI_ADMIN_WIDGETS` / `customScreens`, same pattern as `AIRequestsScreenWidget`.
Chrome for every screen: breadcrumb `Admin / AI Observability / <Section> / <leaf>` and the status chip (Q53).
Built from `@terreno/ui` (`Page`, `Box`, `DataTable`, `Modal`, `TextField`, `Badge`, `Banner`) — the design's
palette is already the Terreno theme (`#2B6072` rail, `#0E9DCD` primary, Titillium/Nunito).

### Phase 1

| Screen | Name | Design requirements |
| --- | --- | --- |
| Prompts | `ai-prompts` | Folder rail with counts, search, table (folder/name, type badge, latest, production, last used, calls 7d, cost 7d). Column tooltips explain latest vs production. `—` when no production label |
| Prompt editor | `ai-prompt-editor` | Full-width version history with one selectable row per version (`vN`, all attached labels, creation time, selected highlight); Editor / Playground tabs; system + user template; variables and output schema summary; temperature preset + model hint; **Save as vN+1**; **Set vN as production…** modal naming the outgoing version; "one production label per prompt" hint |
| Playground | (tab) | Variable inputs from `variables[]`; Run once with running state; compiled-messages disclosure; output; latency / tokens / cost; **Save this run to dataset** (disabled until phase 2) |
| Traces | `ai-traces` | Filter bar (time, prompt/status/score/sensitivity dropdowns, user/session); checkbox selection with a bulk bar — **Send to human review** opens an explanatory human-evaluator picker, Add to dataset (phase 2), sensitive count warning, Clear; rows show status dot, `sensitive` badge, error line, `N prompts` for multi-prompt, spans / tokens / cost / latency / scores; pagination footer |
| Trace detail | `ai-trace-detail` | Header (name, status, sensitive, ids, user/session links, span/token/cost/latency summary) + actions; left span list with kind badge, indent, and duration bar; right span detail (model, prompt link, tokens, cost, latency) with **collapsed** Input/Output disclosures marked sensitive; scores panel with value + source |
| Review queue | `ai-review` | Tabs Pending / In progress / Done / Skipped with counts; table (item, what the AI did, prompt, assignee, waiting, status); **Start reviewing — oldest first**; empty state naming both intake paths. **Hidden when the local plugin is off** |
| Review item | `ai-review-item` | Header with position "Item N of M pending" + prev/next; read-only **What the AI was given** / **What the AI wrote** panels (long fields collapsed with word count and expand, structured output as key/value rows, per-field reviewer notes); raw JSON disclosure; score form generated from the evaluator's dimensions (slider / Pass-Fail / pills) with the evaluator's instructions on top; comment; **Submit & next**, Skip, Assign to me; toast reports remaining count and "Queue clear" at zero |

### Phase 2

| Screen | Name | Design requirements |
| --- | --- | --- |
| Evaluators | `ai-evaluators` | Table (name, type badge, dimensions summary, target, run-mode chips) + the "schema is checked on save / live N% bills judge calls" footnote |
| Evaluator detail | `ai-evaluator-detail` | Dimensions table (key, data type, range, required); type-specific panel (judge prompt link + model + **schema-match check**, assertion path/constraint, reviewer instructions); run modes with the live-sampling slider and its cost warning; **Used by** list with 30-day runs and cost |
| New evaluator | `ai-evaluator-new` | Intro explaining what an evaluator is; type and target pickers with per-choice helper text; dimension builder (key, data type pills, range, required, remove) with field helpers; type-specific panel with helpers; **inline schema mismatch error naming the undeclared dimension**; run modes; Create |
| Datasets | `ai-datasets` | Legend for human-annotated vs auto-captured; table (name, items, provenance bar + counts, source, updated); Import JSON or CSV; New dataset |
| Dataset detail | `ai-dataset-detail` | Header with human/auto counts and the input-schema binding line; Add item; Run experiment; tabs All / Human / Auto / **Needs review** (red count); items table (id, input, expected output, provenance + attribution line, trace link) |
| Experiments | `ai-experiments` | Table (id, name, dataset, status badge, progress bar for running, cost); footnote on BackgroundTask / Langfuse deep-link |
| New experiment | `ai-experiment-new` | 4-step rail with completed summaries; dataset picker showing item counts and schema match; version checkboxes tagged latest/production/superseded; **Next and later rail steps disabled until 2–3 versions are selected**; evaluator checkboxes with per-item cost; **Review & run** summary with the estimate |
| Experiment results | `ai-experiment-results` | Gate tiles (value, gate verdict); "N gates failing" badge; **Promote blocked** state naming the failing gate; outliers list with reason chips; side-by-side per-item table with failed rows floated and highlighted; promote confirm modal |

### Phase 3

| Screen | Name | Design requirements |
| --- | --- | --- |
| Sessions | `ai-sessions` | Traces/Sessions toggle; table (session, user, started, traces, duration, total cost) |
| Session timeline | `ai-session-detail` | Header totals; vertical timeline of traces with time, name, human note, cost, latency |
| Users | `ai-users` | Subtitle "AI cost and usage per user — not the user CRUD table"; table (id, name, traces 7d, tokens 7d, cost 7d) |
| User AI profile | `ai-user-detail` | Avatar + masked email + "no raw prompt content on this page"; 7d / 30d / all-time rollups; recent sessions and recent traces |
| Costs | `ai-costs` | KPI row (today, 7d, 30d, avg/trace); by-model table with **tokens only** for unpriced models plus the "no $0 lie" note; by-prompt table |
| Chip / deep links | chrome | Sink health in the chip; **Open in Langfuse** when the Langfuse plugin is present |

Keep the existing **AI Requests** explorer as-is.

## Example app

`example-backend`:

- Register `ObservabilityApp` with the **local plugin always** (phase 1).
- Seed prompt `example-summarize` v1 labelled production, in folder `examples`.
- Seed the human evaluator template so the review queue is walkable on a fresh DB (phase 1).
- Seed the judge/assert evaluator templates and one dataset `example-gold` (phase 2).
- Add Langfuse sinks when `LANGFUSE_*` is set and `OtelTraceSink` when `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is set (phase 3).

`example-frontend`: admin-only; regenerate the SDK only if it ends up calling new routes.

## Feature flags & env

Registration is the flag — no OpenFeature gate.

| Variable | Phase | Role |
| --- | --- | --- |
| `AI_OBS_PRICE_MAP_JSON` | 1 | `{"gemini-2.5-flash": {"inputPerMTok": 0.1, "outputPerMTok": 0.4}}` |
| `AI_OBS_SAMPLE_RATE` | 2 | Global **ceiling** on per-evaluator `liveSampleRate`; default `0` |
| `AI_OBS_PROMPTS_PRIMARY` | 3 | `local` \| `langfuse` (default `local`) |
| `AI_OBS_DATASETS_PRIMARY` | 3 | default `local` |
| `AI_OBS_EXPERIMENTS_PRIMARY` | 3 | must equal datasets |
| existing Langfuse keys | 3 | unchanged |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | 3 | optional OTLP |

Validate dataset/experiment primary equality and reject a `langfuse` review queue at boot with a clear
`logger.error` + throw, the way a missing SendGrid key fails.

## Activity log

No `UserUpdate` spam per trace. Admin audit only for prompt **production** label moves and experiment
**promote** (reuse `onAdminAudit` when AdminApp is present; otherwise `logger.info` with prompt name + version).

## Testing

- Bun tests, `expect`, `@terreno/test` Mongo preload. **Never mock `@terreno/api` or models.**
- Fake TraceSink / ScoreSink in unit tests (in-memory).
- `AIService`: emit called; `skipTrace`; a throwing sink does not fail generate; `AIRequest` still written; cost undefined for unpriced models.
- Config: illegal experiment/dataset mix; langfuse review queue; missing plugin for a primary.
- Prompts: v1 unchanged after v2; label move; `promptName` resolve uses the production body; missing label → 400.
- Review: enqueue from trace, submit writes dimension-keyed scores, skip, assign, position/counts, empty state.
- Evaluators (P2): judge output schema missing a required dimension is rejected on save with that key named; human evaluator with non-zero `liveSampleRate` rejected.
- Experiments (P2): 1-item dataset still uses `BackgroundTask`; gate pass/fail; promote 409 while a gate fails; unproofread items excluded unless opted in.
- Langfuse/OTel (P3): mock client and mock exporter; secondary failure never surfaces to the caller.
- `verify-ui-changes` on the admin screens each phase, before Brew.

## Documentation (same slices as code)

| Page | Kind |
| --- | --- |
| `docs/explanation/ai-observability.md` | Why two planes, plugins, vs `LangfuseApp` / `AIRequest` |
| `docs/how-to/observe-llm-calls.md` | Register the plugin, price map, sampling ceiling, primaries, Open in Langfuse |
| `docs/how-to/ai-feature-development.md` | SOP steps mapped to Terreno screens + APIs (operator source of truth) |
| `docs/reference/ai.md` | Models, routes, `AIService` `promptName`/`promptLabel`/`skipTrace`/`sensitive`, env |
| `terreno-langfuse-integration.md` | Pointer: the native path is this IP; `LangfuseApp` remains the vendor plugin |
| `ai-prompt-governance` skill | Runtime prompts come from the registry's production label; judge bodies are registry prompts or named constants — never inline |

## Phases

### Phase 1 — MVP: prompt library, tracing, review queue

Contracts, `ObservabilityApp`, `AIService` trace emit and production-label resolution, the local Mongo plugin
for prompts / traces / spans / scores / human evaluators / review items, the phase-1 routes, and the seven
phase-1 admin screens. Example-backend registers the plugin and seeds one prompt plus the human evaluator.

Exit: an operator can create a prompt, save v2, pin production, watch real traced calls with per-span cost,
send a weak one to the review queue, and record a clinician's dimension scores against it — with no Langfuse
keys anywhere.

### Phase 2 — Evaluation loop: evaluators, datasets, experiments

llm-judge and json-assert evaluator types with the dimension/schema contract and per-evaluator run modes; live
sampling execution; datasets with provenance, import, add-from-trace, and synthetic generation; the experiment
wizard, `BackgroundTask` runner, gates, outliers, side-by-side results, and gate-blocked promote; authenticated
in-app trace feedback. Eight more admin screens.

Exit: the full SOP loop runs end to end in Terreno — gather → label → prompt → evaluators → experiment →
promote → observe → add deficient traces back.

### Phase 3 — Analytics and pluggable backends

Sessions, Users, and Costs screens over the trace store; the Langfuse adapter (trace, score, prompt, dataset,
experiment) with the four primary flags and **Open in Langfuse**; the OpenInference `OtelTraceSink`; sink
health in the status chip.

Exit: an existing Langfuse app can register both plugins, keep Langfuse as an extra sink or flip individual
primaries to it, and a third-party collector receives OpenInference spans.

## Acceptance criteria

### Phase 1

- [ ] `AIService.generateText` with `ObservabilityApp` registered writes a nested-capable trace to every `TraceSink`; a throwing sink does not fail the generate; `AIRequest` still exists.
- [ ] Creating prompt v2 does not mutate v1; the editor offers no in-place save; moving `production` is an explicit labelled action that names the outgoing version.
- [ ] `generateText({promptName, promptLabel: "production"})` uses the labelled body; a missing label fails with 400 and no model call.
- [ ] Prompt list groups by folder with counts and shows calls 7d / cost 7d rolled up from traces; a prompt with no production label shows `—`.
- [ ] Playground compiles and runs one call, shows compiled messages plus latency / tokens / cost, and creates no version.
- [ ] Trace list filters by time, prompt, status, user, session, and has-score; a failed trace shows a one-line human cause; a multi-prompt trace shows `N prompts`; cost is blank (not `$0`) for models missing from the price map.
- [ ] Trace detail renders the span tree with OpenInference kinds and per-span cost; `sensitive` I/O is collapsed by default and badged.
- [ ] Selecting traces and choosing **Send to review queue** enqueues them; the queue lists pending oldest-first with per-status counts.
- [ ] The review item screen renders given/wrote panels from prompt-version metadata, generates the score form from the evaluator's dimensions (numeric / boolean / categorical), and **Submit & next** advances, writes dimension-keyed scores, and decrements the pending count to an explicit empty state.
- [ ] Review queue and its nav entry are hidden when the local plugin is off.
- [ ] Docs for phase 1 match shipped behavior; `bun run --filter=@terreno/ai compile test lint` green; `verify-ui-changes` evidence attached.

### Phase 2

- [ ] An `llm-judge` evaluator whose judge prompt output schema omits a required dimension is rejected on save with that dimension named; a `human` evaluator with `liveSampleRate > 0` is rejected.
- [ ] Per-evaluator `liveSampleRate` drives live evals, capped by `AI_OBS_SAMPLE_RATE`; default 0 produces no judge calls.
- [ ] Dataset items distinguish human-annotated from auto-captured, carry attribution, and the Needs-review tab counts unproofread items; adding a `sensitive` trace always lands as needs-review.
- [ ] Import JSON and add-from-trace (single and bulk) validate against the bound prompt's `inputSchema` and retain `sourceTraceId`.
- [ ] An experiment compares 2–3 versions on a dataset, always via `BackgroundTask` locally (even for one item), reports gate pass/fail plus outliers and low-confidence items, and floats failed items to the top of the side-by-side table.
- [ ] Promote returns 409 and renders disabled while any gate fails; with gates passing it moves the production label after an explicit confirm.
- [ ] Owner `POST feedback` (thumbs down + flagDataset) writes a `user-feedback` score and sets `flaggedForDataset`; a non-owner non-admin gets 403.
- [ ] The wizard's pre-run estimate reports generation count and USD before the run starts.

### Phase 3

- [ ] With both plugins registered, one generate dual-writes traces and scores; prompts stay on the configured primary; boot fails if `experiments.primary !== datasets.primary` or the review queue is `langfuse`.
- [ ] The OTel sink's mock exporter receives an OpenInference `LLM` span carrying model and token attributes.
- [ ] Costs shows `tokens only` for unpriced models; Users shows masked identifiers and no prompt content; Sessions renders a timeline.
- [ ] The status chip reflects local state, Langfuse sink health, and active primaries, and **Open in Langfuse** appears only when the Langfuse plugin is registered.

## Risks

| Risk | Mitigation |
| --- | --- |
| Phase 1 review queue needs evaluator dimensions before evaluators ship | Human evaluator type lands in phase 1; judge and assert types are additive fields, not a rewrite |
| Prompt-version metadata for the review panels is easy to skip | `variables[].label` / `reviewerNote` / `outputFieldNotes` are optional with raw-key fallback, so a bare prompt still reviews |
| Langfuse experiment API vs Terreno dataset | Config equality rule; no sync job |
| Double OTel SDK vs LangfuseApp | Adapter shares the existing tracing init |
| PHI in Mongo | `sensitive` flag, collapsed I/O, no content on the Users screen; retention is a follow-on IP |
| Live eval cost | Per-evaluator rate defaults 0 and is capped by a global ceiling; wizard shows cost before running |
| Admin SPA drift | Widgets in admin-frontend appear in the spa shell automatically |

## Files to create / modify (expected)

- `ai/src/observability/**` — types, `observabilityApp.ts`, `local/` models + stores, `evaluate.ts`, `experimentRunner.ts`, `otel/`, `langfuse/`
- `ai/src/service/aiService.ts` — trace emit; resolve `promptName`/`promptLabel`; `sensitive`, `skipTrace`
- `ai/src/routes/gpt.ts` — pass user / session / sensitive; optional prompt name
- `ai/src/aiAdminApp.ts` (or new `observabilityAdmin.ts`) — screen contributions
- `ai/src/index.ts` — exports
- `admin-frontend/src/widgets/aiObservability/*` — the screens above + registry
- `example-backend/src/server.ts` + seed script + `.env.example`
- docs listed above; tests colocated
