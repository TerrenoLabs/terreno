# Tasks: AI observability (Langfuse replacement)

IP: [ai-observability](../implementationPlans/ai-observability.md)
Design: [AI Observability Prototype](https://claude.ai/design/p/36eec001-f2f0-4161-b60d-20dace4d0a9c?file=AI+Observability+Prototype.dc.html)

Supporting skills (every task as applicable): `mongoose-schema-safety`, `terreno-backend-api`, `backend-test-env`, `ai-prompt-governance`, `update-docs`, `generate-sdk`, `verify-ui-changes`, `terreno-ui`, `terreno-data-fetching`, `building-terreno-apps`.

---

# Phase 1 — MVP: prompt library, tracing, review queue

Ships design screens: Prompts, Prompt editor (+ Playground), Traces, Trace detail, Review queue, Review item.

## 1A — Contracts and tracer

- [x] **Task 1.1**: Observability types + `ObservabilityApp` config validation
  - Delivers: `ObservabilityPlugin` / `TraceSink` / `ScoreSink` / `PromptRegistry` / `ReviewQueue` interfaces; `ObservabilityControlConfig`; boot throws on `experiments.primary !== datasets.primary`, on `reviewQueue !== "local"`, and on a primary whose plugin is missing
  - Files: `ai/src/observability/types.ts`, `ai/src/observability/observabilityApp.ts`, `ai/src/observability/observabilityApp.test.ts`, `ai/src/index.ts`
  - Blocked by: none
  - Docs: `docs/explanation/ai-observability.md` (two planes + config errors)
  - Acceptance: unit tests for local-only valid config, illegal mix, langfuse review queue, missing plugin for a primary

- [x] **Task 1.2**: In-memory sinks + `AIService` emit + production prompt resolve
  - Delivers: `promptName` + `promptLabel` resolves via `PromptRegistry` **before the model call**, even when `skipTrace` is true or no trace sink is registered; missing registry/label/version returns 400 without a model call; resolved-version `sensitive` applies unless the generate option overrides it; every `generate*` exports a trace unless `skipTrace`; sink failures logged not thrown; `AIRequest` still written; `userId` / `sessionId` / `sensitive` / `promptRef` / `priceMap` on options; `costUsd` omitted for unpriced models
  - Files: `ai/src/observability/memorySinks.ts`, `ai/src/service/aiService.ts`, `ai/src/types/index.ts`, `ai/src/service/aiService.test.ts`
  - Blocked by: 1.1
  - Docs: `docs/reference/ai.md` — `skipTrace`, `promptName`, `promptLabel`, `sensitive`, usage/cost fields
  - Acceptance: tests for emit, `skipTrace`, throwing sink, cost from price map, **no `costUsd` when the model is unpriced**, multi-step still logs `AIRequest`, resolved prompt body reaches the model with `skipTrace`, and missing registry/production label → 400 with no model call

- [x] **Task 1.3**: GPT routes pass identity and sensitivity
  - Delivers: `/gpt/prompt` sets `userId` from `req.user`, `sessionId` from body/header `x-ai-session-id`, and may upgrade sensitivity with request `sensitive: true`; client `false` never downgrades a sensitive prompt version. Client `promptName` / `promptLabel` selection is admin-only; app routes select production prompts server-side
  - Files: `ai/src/routes/gpt.ts`, route tests
  - Blocked by: 1.2
  - Docs: `docs/reference/ai.md` GPT section
  - Acceptance: an authenticated prompt produces a memory-sink trace carrying that `userId` and `sessionId`

## 1B — Local store: prompts, traces, review

- [x] **Task 1.4**: Local Mongo models — prompts, versions, labels, traces, spans, scores
  - Delivers: schemas with a description on every field, standard plugins, the indexes in the IP; models registered only when the local plugin constructs; `ObsPromptVersion` carries `variables[]` (`key`, `required`, `label?`, `reviewerNote?`), `inputSchema`, `outputSchema`, `outputFieldNotes`, **`sensitive` (default false)**, `config`; `ObsPrompt` carries `folder` + `tags[]`; `ObsTrace` carries `sensitive`, `errorSummary`, `prompts[]`; `ObsSpan` carries `status` and optional short `error`
  - Files: `ai/src/observability/local/models/*.ts`, `ai/src/types/observability*.ts`, model tests
  - Blocked by: 1.1
  - Docs: `docs/reference/ai.md` model tables
  - Acceptance: version immutability; unique `(promptId, label)`; `findExactlyOne` / `findOneOrNone` only; no unique index on scores

- [x] **Task 1.5**: Local `PromptRegistry` + prompt HTTP + playground
  - Delivers: create prompt in a folder; immutable `vN+1` create; move `production` / `staging` returning the outgoing version; `{{var}}` compile; `get({name, label})`; `POST /prompts/:name/playground` runs one `AIService` call and returns compiled messages, output, latency, tokens, cost without creating a version; list supports folder filter, search, and `include=usage7d`
  - Files: `ai/src/observability/local/promptStore.ts`, `ai/src/observability/routes/prompts.ts`, tests
  - Blocked by: 1.4, 1.1
  - Docs: `docs/how-to/observe-llm-calls.md` — create a prompt and pin production
  - Acceptance: v1 unchanged after v2; `get production` returns the labelled version; playground creates no version; usage rollup returns calls/cost for the last 7 days and `—` for a prompt with no production label

- [x] **Task 1.6**: Local `TraceSink` / `ScoreSink` + trace HTTP
  - Delivers: persist the fan-in; list with time / prompt / status / user / session / `hasScore` / `sensitive` / `flaggedForDataset` filters and pagination; detail returns the span tree with kinds, offsets, durations, per-span I/O and cost; derive `errorSummary` from the first span where `status: "error"` using its `error`; `prompts[]` length drives the `N prompts` display; `POST /traces/:id/scores`
  - Files: `ai/src/observability/local/traceStore.ts`, `ai/src/observability/routes/traces.ts`, tests
  - Blocked by: 1.4, 1.2
  - Docs: `docs/reference/ai.md` routes
  - Acceptance: nested spans round-trip; every filter tested; a trace with two prompts reports both; unpriced model returns no `costUsd`

- [x] **Task 1.7**: Human evaluator model + templates
  - Delivers: `ObsEvaluator` with `type`, `target`, typed `dimensions[]`, `runModes`, `instructions`, `confidenceAlertBelow`; CRUD routes; `GET /evaluators/templates` returning the seeded set; `human` + `liveSampleRate > 0` rejected on save
  - Files: `ai/src/observability/local/evaluatorStore.ts`, `ai/src/observability/evaluatorTemplates.ts`, `ai/src/observability/routes/evaluators.ts`, tests
  - Blocked by: 1.4
  - Docs: `docs/how-to/ai-feature-development.md` step 4 (human half)
  - Acceptance: numeric / boolean / categorical dimensions persist; human evaluator with live sampling is a 400; a template installs by name

- [x] **Task 1.8**: Local review queue API
  - Delivers: `POST /traces/review` enqueues one or many traces against a human evaluator (`reason: "manual"`); `GET /review` by status with counts, oldest-first; `GET /review/:id` returns the item, its evaluator dimensions, and rendered `given` / `wrote` panels built from the prompt version's `variables[]` labels/notes and `outputSchema` + `outputFieldNotes`, falling back to raw keys; `POST /review/:id` submit / skip / assign
  - Files: `ai/src/observability/local/reviewStore.ts`, `ai/src/observability/reviewPanels.ts`, `ai/src/observability/routes/review.ts`, tests
  - Blocked by: 1.6, 1.7
  - Docs: `docs/how-to/observe-llm-calls.md` — the review flow
  - Acceptance: submit writes dimension-keyed scores through the ScoreSink fan-out and leaves pending; skip and assign move status; panels fall back cleanly for a prompt with no labels; a submitted item is absent from pending

## 1C — Admin UI and example app

- [x] **Task 1.9**: Admin chrome — nav group, breadcrumbs, status chip
  - Delivers: one `AI Observability` sidebar group; `Admin / AI Observability / <Section> / <leaf>` breadcrumbs; status chip reading `GET /status` (local state, primaries); **Review queue hidden when the local plugin is off**; existing `AI Requests` untouched
  - Files: `admin-frontend/src/widgets/aiObservability/shell/*.tsx`, `builtInWidgets.ts`
  - Blocked by: 1.1
  - Docs: `docs/reference/admin-frontend.md` screen names
  - Acceptance: widget tests for chip states and for the hidden review entry

- [x] **Task 1.10**: Prompts list + prompt editor + playground screens
  - Delivers: folder rail with counts and search; table with type badge, latest, production, last used, calls 7d, cost 7d and the latest-vs-production tooltips; editor with full-width version history rows (`vN`, attached labels, creation time, selected highlight), Editor/Playground tabs, system + template + variables + schema summary, temperature preset and model hint, **Save as vN+1**, **Set vN as production…** confirm modal naming the outgoing version; playground variable inputs, Run once with a running state, compiled-messages disclosure, output, latency/tokens/cost, and a **Save this run to dataset** button disabled until phase 2
  - Files: `admin-frontend/src/widgets/aiObservability/prompts/*.tsx`
  - Blocked by: 1.5, 1.9
  - Docs: `docs/how-to/ai-feature-development.md` steps 3 and 6
  - Acceptance: widget tests empty/loading/loaded; no in-place save control exists; `verify-ui-changes` walks create → save v2 → set production

- [x] **Task 1.11**: Traces list + trace detail screens
  - Delivers: filter bar; row selection with the bulk bar (**Send to review queue**, sensitive-count warning, Clear; Add to dataset disabled until phase 2); status dot, `sensitive` badge, error line, `N prompts`, spans/tokens/cost/latency/scores columns; pagination footer; detail header with actions, left span list (kind badge, indent, duration bar), right span detail with **collapsed** sensitive I/O disclosures, and the scores panel with value + source
  - Files: `admin-frontend/src/widgets/aiObservability/traces/*.tsx`
  - Blocked by: 1.6, 1.8, 1.9
  - Docs: `docs/how-to/ai-feature-development.md` steps 7–8 (observe half)
  - Acceptance: widget tests for empty, error row, sensitive badge, and bulk bar; `verify-ui-changes` selects traces and sends them to the queue

- [x] **Task 1.12**: Review queue + review item screens
  - Delivers: tabs Pending / In progress / Done / Skipped with counts; oldest-first table (item, what the AI did, prompt, assignee, waiting, status); **Start reviewing — oldest first**; empty state naming both intake paths; item screen with "Item N of M pending" and prev/next, read-only given/wrote panels (long fields collapsed with word count, structured output as key/value rows, per-field reviewer notes), raw JSON disclosure, dimension-driven score form (slider / Pass-Fail / pills) headed by the evaluator instructions, comment, **Submit & next** / Skip / Assign to me, and a toast reporting the remaining count
  - Files: `admin-frontend/src/widgets/aiObservability/review/*.tsx`
  - Blocked by: 1.8, 1.9
  - Docs: `docs/how-to/ai-feature-development.md` — the review loop
  - Acceptance: widget tests for each dimension control type and the empty state; `verify-ui-changes` reviews an item end to end and reaches "Queue clear"

- [x] **Task 1.13**: example-backend registration + seed + phase-1 docs
  - Delivers: `ObservabilityApp` with the local plugin always on; `AI_OBS_PRICE_MAP_JSON` wiring; seed prompt `example-summarize` v1 labelled production in folder `examples`; seed the human evaluator template so the queue is walkable on a fresh DB; `.env.example`
  - Files: `example-backend/src/server.ts`, seed script, `.env.example`, `docs/explanation/ai-observability.md`, `docs/how-to/observe-llm-calls.md`, `docs/how-to/ai-feature-development.md`, `docs/reference/ai.md`
  - Blocked by: 1.10, 1.11, 1.12
  - Docs: (this task)
  - Acceptance: server boots local-only with no Langfuse keys; a stranger can follow the how-to to create a prompt, pin production, trace a call, and review it; `bun run --filter=@terreno/ai compile test lint` green

---

# Phase 2 — Evaluation loop: evaluators, datasets, experiments

Ships design screens: Evaluators, Evaluator detail, New evaluator, Datasets, Dataset detail, Experiments, New experiment, Experiment results.

- [x] **Task 2.1**: `llm-judge` + `json-assert` evaluator types with the schema contract
  - Delivers: judge execution via `AIService.generateJsonObject` against a registry judge prompt; `json-assert` in-process assertion (`path`, `constraint`, plus the built-in "validate against the prompt version `outputSchema`" mode); **create/save rejects a judge whose prompt output schema omits a required dimension, naming that dimension**; parse failure records an error score rather than throwing to the caller
  - Files: `ai/src/observability/evaluate.ts`, `ai/src/observability/local/evaluatorStore.ts`, `ai/src/observability/evaluatorTemplates.ts`, tests
  - Blocked by: 1.7, 1.5
  - Docs: explanation — dimensions and the schema contract; how-to step 4
  - Acceptance: mismatch rejected with the dimension key in the message; a judge writes exactly its declared keys; `confidenceAlertBelow` defaults to 0.7; templates for correctness / hallucination / helpfulness / toxicity / schema-assert install (`*-human` variants preserved for the review queue)

- [ ] **Task 2.2**: Live sampling execution
  - Delivers: after trace export, roll each evaluator's `liveSampleRate` (capped by `AI_OBS_SAMPLE_RATE`) and enqueue the eval on the same `BackgroundTask` path experiments use; never throws from generate
  - Files: `ai/src/observability/liveEval.ts`, `ai/src/observability/observabilityApp.ts`, tests
  - Blocked by: 2.1, 1.2
  - Docs: how-to — the sampling ceiling and its cost
  - Acceptance: rate 0 → no task; rate 100 with ceiling 0 → no task; rate 100 with ceiling 100 → task created

- [x] **Task 2.3**: Datasets and items with provenance
  - Delivers: dataset CRUD with `inputSchemaPromptName` + `expectedOutputSchema`; item CRUD with `origin`, `proofread`, `annotatedBy`, `tags`, `outcomeClass`; `POST /datasets/:id/import` (**JSON** array of bare objects or structured rows, plus **CSV** via `Content-Type: text/csv` or `{format: "csv", content}`; validates against the bound input schema); `POST /traces/add-to-dataset` single and bulk copying the I/O snapshot with `sourceTraceId`; **a `sensitive` trace always lands `proofread: false`**
  - Files: `ai/src/observability/local/datasetStore.ts`, `ai/src/observability/routes/datasets.ts`, tests
  - Blocked by: 1.6
  - Docs: how-to steps 1–2 and 8
  - Acceptance: sensitive rule enforced; item keeps `sourceTraceId`; deleting an item does not touch the trace; import rejects schema-invalid rows with the failing path

- [ ] **Task 2.4**: Synthetic dataset generation + playground save-to-dataset
  - Delivers: `POST /datasets/:id/generate` drafting items via `AIService` and a named generator prompt, `origin: "synthetic"`, `proofread: false`; the phase-1 playground **Save this run to dataset** button wired
  - Files: generate route, `ai/src/service/prompts.ts` generator constant, `admin-frontend/.../prompts/*`, tests
  - Blocked by: 2.3, 1.5
  - Docs: how-to step 1 (synthetic)
  - Acceptance: generated items are excluded from a default experiment run; a playground run lands as an unproofread item with its input and output

- [x] **Task 2.5**: Experiment runner, gates, and gate-blocked promote
  - Delivers: `POST /experiments/estimate` (generations, USD, wall clock); `POST /experiments` comparing 2–3 versions on a dataset with optional `modelOverride`, always via `BackgroundTask` locally; per-item results per version; aggregates vs `thresholds[]` (defaulting to `SOP_DEFAULT_THRESHOLDS`); outlier and low-confidence item ids; failed items ordered first; `POST /experiments/:id/promote` returning **409 while any gate fails**
  - Files: `ai/src/observability/local/experimentRunner.ts`, `ai/src/observability/routes/experiments.ts`, tests
  - Blocked by: 2.3, 2.1, 1.5
  - Docs: how-to steps 5–6
  - Acceptance: a 1-item dataset still uses `BackgroundTask`; gate pass/fail computed for boolean (`trueRate`) and numeric (`mean`) dimensions; promote 409s on a failing gate and moves the label when gates pass; unproofread items excluded unless `includeUnproofread`

- [ ] **Task 2.6**: Authenticated trace feedback
  - Delivers: `POST /traces/:id/feedback` — thumbs / outcome class / flag-for-dataset; `source: "user-feedback"` score; owner (`trace.userId`) or admin; sets `flaggedForDataset`; optional review enqueue with `reason: "feedback"`
  - Files: `ai/src/observability/routes/feedback.ts`, tests
  - Blocked by: 1.6, 1.8
  - Docs: how-to step 7; `docs/reference/ai.md`
  - Acceptance: owner thumbs-down + flag succeeds; a stranger gets 403; an admin succeeds; the trace list `flaggedForDataset` filter finds it

- [ ] **Task 2.7**: Evaluator screens (list, detail, new)
  - Delivers: list with type badge, dimension summary, target, run-mode chips and the footnote; detail with the dimensions table, type-specific panel (judge prompt link + model + schema-match check, assertion path/constraint, reviewer instructions), run modes with the live-sampling slider and cost warning, and the **Used by** list with 30-day runs and cost; new-evaluator screen with type/target pickers, dimension builder, and the **inline schema mismatch error naming the undeclared dimension**
  - Files: `admin-frontend/src/widgets/aiObservability/evaluators/*.tsx`
  - Blocked by: 2.1, 1.9
  - Docs: `docs/reference/admin-frontend.md`
  - Acceptance: widget tests for each type's panel and for the mismatch error; `verify-ui-changes` creates a judge evaluator

- [ ] **Task 2.8**: Dataset screens (list, detail)
  - Delivers: list with the human/auto legend, provenance bar, source and updated columns; detail with human/auto counts, the input-schema binding line, Add item, Run experiment, tabs All / Human / Auto / **Needs review** (red count), and the items table with attribution lines and trace links
  - Files: `admin-frontend/src/widgets/aiObservability/datasets/*.tsx`
  - Blocked by: 2.3, 2.4, 1.9
  - Docs: `docs/reference/admin-frontend.md`
  - Acceptance: widget tests for each tab and the empty dataset; `verify-ui-changes` bulk-adds traces and sees them under Needs review

- [ ] **Task 2.9**: Experiment screens (list, wizard, results)
  - Delivers: list with status badge, running progress bar and cost, plus the BackgroundTask/Langfuse footnote; 4-step wizard with a completed-step rail, dataset picker showing counts and schema match, version checkboxes tagged latest/production/superseded, evaluator checkboxes with per-item cost, and a Review & run step showing the estimate; results with gate tiles, "N gates failing", the **Promote blocked** state naming the failing gate, the outliers list with reason chips, the side-by-side table with failed rows floated and highlighted, and the promote confirm modal
  - Files: `admin-frontend/src/widgets/aiObservability/experiments/*.tsx`
  - Blocked by: 2.5, 2.8, 1.9
  - Docs: how-to steps 5–6
  - Acceptance: widget tests for running progress, gate-fail results, and blocked promote; `verify-ui-changes` runs an experiment and promotes a passing version

- [ ] **Task 2.10**: Phase-2 example seeds + docs
  - Delivers: seed judge/assert evaluator templates and dataset `example-gold` with an input-schema binding; docs updated for evaluators, datasets, experiments, feedback, and `AI_OBS_SAMPLE_RATE`
  - Files: `example-backend` seed, docs listed in the IP, `.rulesync/skills/ai-prompt-governance/SKILL.md` + `bun run skills:sync`
  - Blocked by: 2.7, 2.8, 2.9, 2.6
  - Docs: (this task)
  - Acceptance: the full SOP loop is runnable from `docs/how-to/ai-feature-development.md` without Langfuse

---

# Phase 3 — Analytics and pluggable backends

Ships design screens: Sessions, Session timeline, Users, User AI profile, Costs, plus sink health and Open in Langfuse.

- [ ] **Task 3.1**: Session, user, and cost aggregates + screens
  - Delivers: `GET /sessions`, `/sessions/:id`, `/users`, `/users/:id`, `/costs`; Sessions list with the Traces/Sessions toggle and the timeline detail; Users list subtitled "AI cost and usage per user — not the user CRUD table" and the profile with masked email, **no prompt content**, and 7d/30d/all-time rollups; Costs with the KPI row, by-model table showing **tokens only** for unpriced models plus the "no $0 lie" note, and the by-prompt table
  - Files: `ai/src/observability/routes/analytics.ts`, `ai/src/observability/local/traceStore.ts`, `admin-frontend/src/widgets/aiObservability/analytics/*.tsx`, tests
  - Blocked by: 1.6, 1.9
  - Docs: `docs/reference/ai.md` routes; `docs/reference/admin-frontend.md`
  - Acceptance: an unpriced model renders `tokens only` and never `$0`; no prompt or output text appears in any users response; widget tests for each screen

- [ ] **Task 3.2**: Langfuse `TraceSink` + `ScoreSink`
  - Delivers: adapters wrapping the existing `getLangfuseClient()`; **no second OTel SDK**; best-effort with logged failures
  - Files: `ai/src/observability/langfuse/traceAdapter.ts`, tests with a mocked client
  - Blocked by: 1.2
  - Docs: explanation — `LangfuseApp` vs `ObservabilityApp`
  - Acceptance: one generate dual-writes; a throwing Langfuse mock leaves the local row intact and the caller unaffected

- [ ] **Task 3.3**: Langfuse `PromptRegistry` / `DatasetStore` / `ExperimentRunner` + primaries
  - Delivers: `AI_OBS_*_PRIMARY` env wiring; Terreno HTTP facade delegating to the existing Langfuse admin routes; **Open in Langfuse** deep-link bases on `GET /status`
  - Files: `ai/src/observability/langfuse/*.ts`, tests
  - Blocked by: 3.2, 1.5, 2.5
  - Docs: how-to — switching primaries by env
  - Acceptance: prompts primary `langfuse` reads through the client; experiments primary `langfuse` starts no `BackgroundTask`; the illegal mixes still fail boot

- [ ] **Task 3.4**: `OtelTraceSink` (OpenInference)
  - Delivers: OTLP exporter behind `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`; `openinference.span.kind` set from the span kind; model and token attributes
  - Files: `ai/src/observability/otel/otelTraceSink.ts`, tests with a mock exporter
  - Blocked by: 1.2
  - Docs: how-to — pointing at Phoenix or a generic collector
  - Acceptance: the mock exporter receives an `LLM` span with model and token attributes

- [ ] **Task 3.5**: Sink health chip, example wiring, and phase-3 docs
  - Delivers: last-error-per-sink on `GET /status`; the chip renders Langfuse health and active primaries and shows **Open in Langfuse** only when that plugin is registered; example-backend adds the Langfuse and OTel sinks conditionally; docs and the `terreno-langfuse-integration.md` pointer finalized
  - Files: `ai/src/observability/routes/status.ts`, `admin-frontend/.../shell/*.tsx`, `example-backend/src/server.ts`, docs
  - Blocked by: 3.1, 3.3, 3.4
  - Docs: (this task)
  - Acceptance: chip states covered by widget tests; a Langfuse-less boot shows no deep link; `verify-ui-changes` evidence attached

---

# Phase 4 — Domain-neutral RBAC and prompt relationship hub

The user approved this phase on 2026-10-02. It adds no domain-specific vocabulary or
in-app approval workflow. Supporting skills: `building-admin-interfaces`,
`terreno-backend-api`, `terreno-ui`, `terreno-data-fetching`, `mongoose-schema-safety`,
`update-docs`, and `verify-ui-changes`.

- [x] **Task 4.1**: Observability RBAC vocabulary, compatibility grants, and route enforcement
  - Delivers: resources `aiPrompt`, `aiTrace`, `aiReview`, `aiDataset`, `aiExperiment`, `aiEvaluator` with the actions approved in Q62/Q63; statement descriptions; full seeded Admin grants, read-only Auditor expansion, Super Admin wildcard; existing stored Admin roles gain only missing observability grants; optional `accessControl` on `ObservabilityApp`; every route maps to one resource/action while legacy admin fallback remains
  - Files: `api/src/rbac/statements.ts`, `api/src/rbac/roleModel.ts`, `ai/src/observability/observabilityApp.ts`, `ai/src/observability/routes/*.ts`, route/RBAC tests, public exports as needed
  - Blocked by: none
  - Docs: `docs/reference/api.md`, `docs/reference/ai.md`, `docs/explanation/ai-observability.md`
  - Acceptance: catalog and role tests prove exact actions; a read-only RBAC caller can GET but receives 403 for writes; denied mutations fail even when called directly; legacy admin tests remain green

- [x] **Task 4.2**: Prompt descriptions and prompt-scoped relationship APIs
  - Delivers: optional prompt `description` in Mongo/types/create/detail/list; trace list accepts prompt version in addition to name; experiment list accepts `promptName`; prompt detail API composes bounded recent traces and experiments for the selected prompt without client-side full-list scans
  - Files: prompt/trace/experiment models, stores, routes, types, tests
  - Blocked by: 4.1
  - Docs: `docs/reference/ai.md`, `docs/explanation/ai-observability.md`
  - Acceptance: description round-trips; prompt v2 filtering excludes v1-only traces; prompt detail relationships contain only the named prompt's traces and experiments; old prompts without descriptions still load

- [x] **Task 4.3**: Caller-filtered navigation and read-only prompt hub
  - Delivers: each custom screen declares its read/list permission; unauthorized screens disappear from `/admin/config`; prompt detail renders Overview, Versions, Traces, and Experiments with description/folder/tags; controls are hidden independently for denied `update`, `promote`, and `playground`; direct API calls remain protected by Task 4.1
  - Files: `ai/src/observability/adminScreens.ts`, admin contribution tests, `admin-frontend/src/widgets/aiObservability/prompts/*`, permission helpers/tests
  - Blocked by: 4.1, 4.2
  - Docs: `docs/reference/admin-frontend.md`, `docs/how-to/ai-feature-development.md`
  - Acceptance: admin-config tests cover mixed grants; widget tests prove a read-only prompt hub shows relationships and no write controls; an operator sees all controls; `verify-ui-changes` captures both roles

- [ ] **Task 4.4**: Phase-4 integration and documentation gate
  - Delivers: example roles demonstrating read-only and operator composition; all architecture/reference/how-to pages aligned; generated SDK updated only if the public OpenAPI shape requires it
  - Files: `example-backend` access/seed files, docs named above, generated SDK when required
  - Blocked by: 4.3
  - Docs: (this task)
  - Acceptance: example boots with existing admin access intact; a consumer can configure a domain-neutral read-only role from docs; focused package tests, compile, lint, static analysis, and mandatory UI walkthrough pass
