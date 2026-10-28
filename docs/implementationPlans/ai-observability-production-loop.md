# Implementation Plan: AI observability production loop

**Status:** approved 2026-10-18
**Created:** 2026-10-18
**Branch:** `ai-observability-production-loop` (cut from `seed-ai-observability-demo`, PR #1565; rebase onto `master` once #1565 merges)
**Task list:** [`docs/tasks/ai-observability-production-loop.md`](../tasks/ai-observability-production-loop.md)
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1593  
**Depends on:** [AI observability](ai-observability.md) phases 1–4 and PR #1565 (review batches, seeded demo data)
**Supporting skills:** `terreno-backend-api`, `mongoose-schema-safety`, `ai-prompt-governance`, `backend-test-env`, `building-admin-interfaces`, `terreno-ui`, `dataviz`, `update-docs`, `verify-ui-changes`, `accessibility-testing`

Terreno's AI observability already covers the build-time loop: versioned prompts, nested traces,
evaluators, datasets, experiments with gates, a human review queue, and review batches that check
LLM judges against people. Production is where it stops. Evaluators have a "live N%" setting that
nothing reads, nobody can see quality, cost, or latency over time, nothing pages anyone when
quality drops, a chat conversation is just a loose pile of traces, CI cannot block a prompt that
fails its gates, and improving a prompt is still done by hand. This plan closes that loop for
teams running AI features in production, Flourish first: watch quality live, get alerted, group
the traces of a conversation, gate prompt changes in CI, and let the system propose a better
prompt from the failures it saw.

## The idea

Six capabilities on the existing `ObservabilityApp`, all local (Mongo), all behind the existing
RBAC resources plus two new ones, with operator UI in `admin-frontend`:

| Capability | Contract that changes | Observable difference |
| --- | --- | --- |
| Online evaluation | `ObservabilityApp.exportTrace` gains a post-export hook; evaluator `runModes` gain `livePromptNames` and `includeSensitive` | A sampled production trace gets judge and assert scores (`origin: "live"`) seconds after the call |
| Threads | `TraceRecord.groups: Record<kind, id>`; `GET /groups`, `GET /groups/:kind/:id` | Traces of one conversation (or any app-chosen grouping) list and open as one timeline |
| Monitoring dashboard | `GET /metrics` time series + breakdowns | A Monitoring screen with volume, error rate, p50/p95 latency, cost, and score trends |
| Alert webhooks | `ObsAlertRule`, `ObsWebhook`, signed metadata-only deliveries | A threshold breach POSTs a signed payload, naming the breaching traces, to Slack or any URL |
| CI test suites | `ObsTestSuite`, suite runs over the experiment runner, `tobs_` service tokens, `terreno ai test` | CI exits non-zero when a prompt version or a prompt file fails its gates; operators run the same suite from admin |
| Prompt optimizer | `ObsOptimization` runs over the experiment scorer | An operator starts a run and gets a candidate prompt with train and hold-out scores, saved as `vN+1` on click |

Rejected: a single "analytics" rollup collection written at export time. Aggregating on read keeps
one writer per trace and needs no backfill; X10 keeps the rollup as a later escape hatch.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Live evaluation scores a sampled production trace (tracer) | none | ai | `liveEval.test.ts` |
| T2 | RBAC resources for alerts, test suites, optimizer | none | api, ai, example-backend | rbac tests |
| T3 | Traces record named groups | T1 | ai | `traceGroups.test.ts` |
| T4 | Live sampling filters by prompt; sensitive traces opt in | T3 | ai | `liveEval.test.ts` |
| T5 | Groups list and timeline API | T4 | ai | `routes/groups.test.ts` |
| T6 | Evaluator live stats and sampling ceiling in status | T5 | ai | `routes/evaluators.test.ts` |
| T7 | Metrics API: time series and breakdowns | T6 | ai | `routes/metrics.test.ts` |
| T8 | Webhook destinations with signed delivery | T7, T2 | ai | `webhooks.test.ts` |
| T9 | Alert rules evaluate and notify | T8 | ai | `alertRules.test.ts` |
| T11 | Test suites and suite runs | T9, T2 | ai | `routes/testSuites.test.ts` |
| T12 | Suite runs accept an inline candidate prompt | T11 | ai | `routes/testSuites.test.ts` |
| T13 | Observability service tokens for CI | T12 | ai | `serviceTokens.test.ts` |
| T14 | Prompt optimizer engine | T13 | ai | `promptOptimizer.test.ts` |
| T15 | Optimizer API | T14, T2 | ai | `routes/optimizations.test.ts` |
| T16 | Live evals run as durable jobs | T1 | ai, example-backend | `jobsRunners.test.ts` |
| T17 | Alert ticks and webhook deliveries run as jobs | T9, T16 | ai, example-backend | `jobsRunners.test.ts` |
| T18 | `terreno ai test` CLI command | T13 | cli | `commands/ai.test.ts` |
| T19 | Threads screens | T5 | admin-frontend | isolated tests + screenshots |
| T20 | Evaluator live controls and stats | T6 | admin-frontend | isolated tests + screenshots |
| T21 | Monitoring screen | T7, T19 | admin-frontend | isolated tests + screenshots |
| T22 | Alerts and webhooks screens | T9, T21 | admin-frontend | isolated tests + screenshots |
| T23 | Test suites screens, admin runs, and CI tokens | T13, T18, T22 | admin-frontend | isolated tests + screenshots |
| T24 | Optimizer screens | T15, T23 | admin-frontend | isolated tests + screenshots |
| T25 | Seeded demo data, SOP docs, and full walkthrough | T15, T17, T20, T24 | example-backend, docs | seed test + screenshots |

Tracer: `AIService` trace export → `ObservabilityApp.exportTrace` → live-eval scheduler →
`runEvaluator` → `ScoreSink`. Every later backend feature reads traces or scores this path writes.
Out of scope: thread-level evaluators, backfill, budgets, JUnit, more optimizer algorithms, email
alerts, custom dashboards, MCP tools, non-alert webhook events (see Expansions). T10 moved to X9
during cut, so the IDs skip it.
Open risks:
- Live judges bill per sampled call. Mitigation: `AI_OBS_SAMPLE_RATE` ceiling defaults to 0.
- `$percentile` needs MongoDB 7.0+ (confirmed in D7).
- Outbound webhooks are an SSRF and PHI surface. Mitigation: metadata-only payload type, masked
  URLs, and URL checks at save time and at delivery (T8).
- The optimizer sends dataset items to an LLM and writes prompt text served to every user.
  Mitigation: human-written or signed items only, plus verbatim-copy guards (T14, D6).

## Contracts

### Trace export seam (T1)

`AIService.logRequestAndTrace` stops fanning out to `app.traceSinks` itself and calls
`app.exportTrace(record)` (added to `RegisteredObservabilityApp`). `exportTrace` keeps its
best-effort fan-out, then calls `liveEval.schedule({record, traceId})` once the local sink returns
the persisted id. A throwing scheduler is logged and never fails the generate. T1 also adds the
`liveEvalRunner?: LiveEvalRunner` option (default in-process), so T16 plugs in the jobs runner
without touching `ObservabilityApp`. The example backend passes
`sampleRate: Number(process.env.AI_OBS_SAMPLE_RATE ?? 0)`; it already passes `aiService` when
Vertex or Gemini credentials are set.

### Online evaluation (T1, T4, T6, T16)

| Rule | Value |
| --- | --- |
| Eligible evaluators | `llm-judge` and `json-assert` with `runModes.liveSampleRate > 0`, not deleted. The list is cached for 30 s |
| Effective rate | `min(liveSampleRate, sampleRate × 100)`. `sampleRate` is `ObservabilityApp.sampleRate` (`AI_OBS_SAMPLE_RATE`, default 0) |
| Roll | Deterministic: `fnv1a(traceId + ":" + evaluatorId) % 10000 < rate × 100` |
| Idempotency | `ObsEvalRun` has a unique index on `{traceId, evaluatorId}`. The runner inserts a `pending` row with `leaseUntil = now + 10 min` and skips on a duplicate key, unless the existing row is `error` or its lease expired; then it reclaims the row atomically. Live scores get a deterministic key `{traceId, evaluatorId, name, origin: "live"}` with a partial unique index and are upserted, so a crash between writing scores and marking `ok` cannot duplicate them |
| Skips | Trace `status: "error"`, missing `output`, `sensitive` unless the evaluator sets `includeSensitive: true` (D2), prompt not in `livePromptNames` with label `production` (T4) |
| Judge client | `ObservabilityApp.aiService`. When it is absent, live eval is off and status reports `liveEval.available: false` |
| Judge prompt | `runLlmJudgeEvaluator` gains `subject: "datasetItem" \| "trace"`; trace wording lives in a `LIVE_JUDGE_*` constant (`ai-prompt-governance`) |
| Output | Scores through every `ScoreSink` with `source` `llm-judge` or `code`, `evaluatorId`, and the new `ObsScore.origin: "live"`. Plus one `ObsEvalRun {traceId, evaluatorId, status: pending \| ok \| error, error?, durationMs, startedAt, leaseUntil, inputTokens?, outputTokens?, costUsd?}`. Judge cost uses `priceMap`, so live-eval spend shows on Monitoring (`liveEvalCostUsd` series) and can be alerted on |
| In-process runner | Concurrency 2, queue cap 500; over cap it drops and `logger.warn`s once per minute |
| Durable runner | `@terreno/ai/observability/jobsRunners` subpath, job `ai-observability/live-eval`, 3 attempts. `@terreno/jobs` is never reachable from `ai/src/index.ts` |

`livePromptNames: string[]` is required (non-empty) when a create or update sets
`liveSampleRate > 0`; otherwise it returns 400 `livePromptNames required when liveSampleRate > 0`
(Q2). Existing evaluators that already store a rate but no prompt list are **not live**. They
keep working, edits that leave the rate unchanged are allowed, and status lists them in
`liveEval.misconfiguredEvaluatorIds` so the evaluator screen can warn. Evaluator detail adds
`live: {runs24h, errors24h, lastRunAt, means: Record<dimension, number>}`. Status adds
`liveEval: {available, ceilingPercent, misconfiguredEvaluatorIds}`.

### Groups (T3, T5)

```typescript
await aiService.generateText({
  groups: {conversation: historyId, episode: episodeId},
  promptName: "chat-assistant",
  sessionId,
});
```

| Rule | Value |
| --- | --- |
| Shape | `groups?: Record<string, string>` on generate options and `TraceRecord`; stored as `ObsTrace.groups: [{kind, id}]` |
| Validation | ≤ 10 entries; kind `^[a-z][a-zA-Z0-9_-]{0,39}$`; id 1–200 chars; `session` reserved. Invalid entries are dropped with one `logger.warn`; the generate never fails |
| `session` | Derived from `sessionId`; never stored twice |
| Chat | `chatTurn` adds `conversation: <GptHistory id>` automatically |
| Index | `{"groups.kind": 1, "groups.id": 1, startedAt: -1}` (additive; no backfill) |
| Trace list | Filters `groupKind` + `groupId` |
| `GET /groups/kinds` | Distinct kinds over the last 30 days plus `session` |
| `GET /groups?kind&from&to&page&limit` | Rows `{kind, id, traceCount, firstAt, lastAt, durationMs, costUsd \| null, inputTokens, outputTokens, errorCount, userCount}`, newest `lastAt` first |
| `GET /groups/:kind/:id` | Totals plus traces ordered by `startedAt` (cap 500), each with status, prompt refs, latency, cost, score summary |
| Access | `aiTrace:list` / `aiTrace:read` |

### Metrics (T7)

`GET /ai/observability/metrics?from&to&bucket=hour|day&tz&prompt&promptVersion` (`aiTrace:list`).
Range ≤ 90 days; `hour` buckets ≤ 7 days; otherwise 400.

```typescript
interface MetricsResponse {
  buckets: Array<{start: string; traces: number; errors: number; errorRate: number;
    latencyP50Ms: number | null; latencyP95Ms: number | null; inputTokens: number;
    outputTokens: number; costUsd: number | null; costPartial: boolean; liveEvalCostUsd: number | null}>;
  scores: Array<{evaluatorId?: string; name: string; dataType: "boolean" | "numeric";
    aggregate: "trueRate" | "mean"; points: Array<{start: string; value: number; n: number}>}>;
  byPrompt: Array<{name: string; version: number; traces: number; errorRate: number;
    latencyP95Ms: number | null; costUsd: number | null}>;
  byModel: Array<{model: string; traces: number; inputTokens: number; outputTokens: number;
    costUsd: number | null}>;
  totals: {traces: number; errorRate: number; latencyP95Ms: number | null; costUsd: number | null};
}
```

Built with `$dateTrunc` and `$percentile` (MongoDB 7.0+, D7). `costUsd` is `null` when no trace in
the bucket is priced and `costPartial` is `true` when some are not. It never reports a made-up `$0`.
Alert rules (T9) reuse the same window functions.

### Webhooks and alerts (T8, T9, T17)

| Model | Fields |
| --- | --- |
| `ObsWebhook` | `name`, `url` (`select: false`; responses return only `urlHost`, because a Slack URL is itself a credential), `format: "json" \| "slack"`, `events: string[]`, `enabled`, `secret` (`select: false`; returned once on create and on rotate) |
| `ObsWebhookDelivery` | `webhookId`, `event`, `payload`, `status: pending \| delivered \| failed`, `attempts`, `httpStatus?`, `error?`; TTL 30 days |
| `ObsAlertRule` | `name`, `enabled`, `metric`, `filter {promptName?, promptVersion?, evaluatorId?, dimension?}`, `comparator: gt \| lt`, `threshold`, `windowMinutes` (5–1440), `minSamples` (default 20), `webhookIds`, state `{state: ok \| firing, since?, lastValue?, leaseUntil?}` |

Metrics: `errorRate`, `latencyP95Ms`, `costUsd`, `traceCount`, `scoreMean`, `scoreTrueRate`,
`liveEvalErrorRate`, `liveEvalCostUsd`. Events: `alert.firing` and `alert.resolved`. The dispatcher takes any event
name, so X9 adds more without changing it.

**Matching traces** (`traceIds`, ≤ 10, newest first within the window and filter):

| Metric | Traces sent |
| --- | --- |
| `errorRate` | Error traces |
| `latencyP95Ms` | Slowest traces |
| `costUsd` | Costliest traces |
| `scoreMean`, `scoreTrueRate` | Lowest-scored traces on that dimension |
| `liveEvalErrorRate` | Traces whose live eval errored |
| `traceCount` | None |

**Payload (D1: metadata only).** The builder accepts only this type. It never reads trace
`input` or `output`:

```typescript
interface ObsWebhookPayload {
  event: string; deliveryId: string; occurredAt: string;
  rule?: {id: string; name: string; metric: string; comparator: "gt" | "lt"; threshold: number;
    value: number; samples: number; window: {from: string; to: string}};
  prompt?: {name: string; version?: number};
  traceIds?: string[];   // ≤ 10, ids only
  adminUrl?: string;     // when ObservabilityApp.publicAdminUrl is set
}
```

- **`json` format** posts the payload with these headers:
  - `X-Terreno-Event`
  - `X-Terreno-Delivery`
  - `X-Terreno-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`
- **`slack` format** posts `{text}` rendered from the same payload, with the same fields and no
  extra data.
- **Delivery:** 10 s timeout; attempts at 0 s, 10 s, and 60 s.
- **URL checks:**
  - Production requires `https`. `http` is allowed only for `localhost` outside production.
  - In production, hosts that resolve to loopback, private, link-local, or metadata ranges are
    rejected. The check runs on save **and** at every delivery. Delivery connects to the IP that
    passed the check, through an undici `Agent` with a custom `connect.lookup`, and keeps the
    original `Host` and SNI. A second DNS answer (rebinding) is never used.
  - Delivery uses `redirect: "manual"`; a 3xx counts as a failed attempt.
- **Alert state** (Q7):
  - `ok → firing` sends `alert.firing` once; `firing → ok` sends `alert.resolved` once.
  - Below `minSamples` the state stays unchanged.
  - A Mongo lease (`findOneAndUpdate` on `leaseUntil`) means only one instance evaluates a rule
    per tick.
- **Scheduling:**
  - In-process: `ObservabilityApp({alerts: {interval: true}})` ticks every 60 s.
  - Durable: the `ai-observability/alerts-tick` cron job (T17).
  - T8 and T9 add the `webhookDeliveryRunner` and `alerts.scheduler` options, so T17 plugs in jobs
    without touching `ObservabilityApp`.

### Test suites and CI (T11–T13, T18)

| Model / route | Contract |
| --- | --- |
| `ObsTestSuite` | `name` (slug, unique), `description?`, `promptName`, `target: {version} \| {label}` (required; what a plain `terreno ai test <suite>` tests), `datasetId`, `evaluatorIds`, `thresholds` (default SOP gates), `includeUnproofread` (false), `modelOverride?`, `baselineLabel` (`production`), `maxCostUsd` (default 5; a run whose estimate exceeds it gets 400) |
| CRUD | `/ai/observability/testSuites` (`aiTestSuite` CRUD) |
| `POST /testSuites/:name/runs` | Empty body runs the suite's stored `target`. At most one override: `{version}`, `{label}`, or `{candidate: PromptVersionFields}`; several gives 400 (Q3). Returns 202 `{runId}`. Requires `aiTestSuite:run`. The admin **Run** button and the CLI call the same route |
| `GET /testSuites/:name/runs/:runId` | `{status, passed, gates, baselineGates, failedItems: [{itemId, evaluator, dimension}], estimatedCostUsd, adminUrl?}` |
| Run engine | An `ObsExperiment` with `suiteId` and `kind: "suite"` (default `"experiment"`). Versions are `unique([baseline, candidate])`, so a suite run may have one version. Gates decide on the candidate only; baseline gates are informational. An inline candidate uses version number `0` (real versions start at 1), with its body in a new `candidateBody` field, and creates no prompt version. `versions` stays `[Number]`; its validator becomes kind-aware (experiment 2–3, suite 1–2). That validator change is the only non-additive schema edit, and existing experiment documents still pass it |
| `ObsServiceToken` | `tobs_` + 32 random bytes; SHA-256 hash stored; `name`, `userId`, `expiresAt` (required; default 90 days, max 365), `lastUsedAt`, `revokedAt`; ≤ 10 active per user; minted, listed, and revoked under `/serviceTokens` with `aiTestSuite:manageTokens`. Mint, revoke, and each use go to `AuditApp` when registered, otherwise `logger.info` |
| Token scope | Accepted only on suite list, read, run, and run-status routes; every other route returns 401. The scope check runs **before** the legacy-admin shortcut in `observabilityRouteAccess.ts`, so an admin's token is still limited to suites. Access is the minting user's grants (RBAC when `accessControl` is set, else `admin: true`) intersected with `aiTestSuite:list/read/run`. A disabled or deleted user gets 401. Runs are limited to 10 per hour per token (429) (D5) |

```bash
TERRENO_API_URL=https://staging.example.com TERRENO_TOKEN=$OBS_CI_TOKEN \
  terreno ai test summarize-gold
terreno ai test summarize-gold --candidate-file prompts/example-summarize.json --json
```

- **Flags:**
  - With no flag it runs the suite's stored `target`. At most one override: `--version N`,
    `--label L`, or `--candidate-file path` (Q3). In CI, `--candidate-file` tests the prompt file
    the PR changed.
  - `--timeout` (s, default 900), `--poll` (s, default 5), `--json`, `--base-url`, `--token`.
- **Output:** one row per gate (evaluator, dimension, value, threshold, verdict), the failed-item
  count, and the admin URL.
- **Exit codes:**
  - `0`: passed.
  - `1`: gates failed, run error, timeout, HTTP error, or usage error. The message, and the
    `--json` `reason`, says which.

### Prompt optimizer (T14, T15)

| Input | Rule |
| --- | --- |
| `promptName`, `baseVersion` | Required |
| `datasetId`, `evaluatorIds`, `thresholds` | Same validation as experiments |
| `rounds` | 1–5, default 3 |
| `candidatesPerRound` | 1–3, default 2 |
| `maxCostUsd` | Required; the run stops before a round whose estimated cost exceeds the remaining budget |
| `validationShare` | 0.3; items split deterministically by item id hash; at least 2 validation items, or 400 |

**Algorithm: reflective rewrite** (Q5).

1. Score the base version on the train items with `scoreVersionOnItems`, extracted from
   `executeExperiment`.
2. Each round:
   1. Send up to 8 of the worst train items (failed gates first, then lowest scores) to the
      optimizer prompt.
   2. The optimizer prompt is the registry's `terreno-prompt-optimizer` production version, falling
      back to the `PROMPT_OPTIMIZER_*` constant. It returns
      `{candidates: [{system, template, rationale}]}` through `generateJsonObject`.
   3. Reject candidates that change the template variable set or the `outputSchema`.
   4. Score the remaining candidates on train.
   5. Keep the best: most gates passed, then highest mean of the gated dimensions.
3. Stop early when every gate passes on train.
4. Score the base and the best candidate on the validation items.

**PHI guards** (D6):

- Only items a person wrote or checked are used: `origin: "manual"`, or `annotatedBy` set.
  `origin: "trace"` items are auto-proofread from non-sensitive traces
  (`datasetStore.ts:397`), and Flourish's non-sensitive traces can still hold PHI, so they are
  excluded unless an annotator signed them. `synthetic` items count only when proofread.
- Before **Save as vN+1**, the operator ticks "I reviewed this prompt for personal data". The
  confirmation is stored on the new version's audit entry.
- A candidate is rejected, and recorded as `rejected: "verbatim"`, when its `system`, `template`,
  or `rationale` shares a verbatim run of 8 or more words with any item's input or expected output.
  It is also rejected when it contains an item token of 4+ characters, or any digit run, that is
  absent from the base prompt (names, dates, record numbers).
- The run detail shows which candidates were rejected and why.

`ObsOptimization` stores status, progress, every candidate with its train scores and rationale,
`bestCandidateId`, validation scores, and `estimatedCostUsd`. Cost is estimated from token usage
and `priceMap`: `scoreVersionOnItems` returns `{inputTokens, outputTokens}` per call when the AI
client reports usage, and falls back to the experiment estimator when it does not. The UI
labels every cost "estimated". Runs go through the experiment
`BackgroundTaskRunner`.

| Route | Contract |
| --- | --- |
| `POST /optimizations/estimate` | Calls and USD for the worst case |
| `POST /optimizations` | `aiPrompt:optimize`; 202 `{id}` |
| `GET /optimizations?promptName` and `GET /optimizations/:id` | `aiPrompt:read` |
| `POST /optimizations/:id/cancel` | `aiPrompt:optimize` |
| `POST /optimizations/:id/saveVersion {candidateId}` | `aiPrompt:update`. Creates `vN+1` from the candidate through `createVersion`. That moves only `latest`, as every save does; `production` and `staging` never move (Q4). Returns `{version}` |

### RBAC (T2)

| Resource | Actions |
| --- | --- |
| `aiAlert` (new) | `create`, `list`, `read`, `update`, `delete`, `test` |
| `aiTestSuite` (new) | `create`, `list`, `read`, `update`, `delete`, `run`, `manageTokens` |
| `aiPrompt` | adds `optimize` |

Webhooks fall under `aiAlert`. Seeded `admin` gets all of these; `auditor` gets `list` and `read`;
`superadmin` keeps `*`. The example `aiObservabilityViewer` and `aiObservabilityOperator` roles
gain the matching grants. Re-seeding adds only the missing actions, as phase 4 does.

### Admin UI (T19–T24)

New sidebar entries under **AI Observability**: Threads, Monitoring, Alerts, Test suites, and
Optimizer. Each gets breadcrumbs and the status chip, and is hidden without `list` on its resource.
New data hooks use `adminRequest` (admin-frontend rule: no new `injectEndpoints`). Existing
observability hooks (evaluators, status chip) gain only additive response-type fields; they add no
new endpoints. Charts use `@terreno/ui` `LineChart`, `Scorecard`, and
`DashboardGrid`.

| Screen | Requirements |
| --- | --- |
| Threads / thread detail | Kind picker; table (id, traces, first/last, duration, cost, errors); timeline of traces with status, prompt, latency, cost, scores; trace detail shows group chips that link to the thread |
| Evaluator (existing) | Live panel: prompt multi-select, include-sensitive toggle with a warning, effective-rate note from `status.liveEval`, 24 h runs, errors, and means |
| Monitoring | Range 24 h / 7 d / 30 d, prompt filter; Scorecards (traces, error rate, p95, cost); line charts for volume, error rate, latency, cost; a score-trend chart per evaluator dimension; by-prompt and by-model tables; `tokens only` where unpriced |
| Alerts / Webhooks | Rule list with state badge, editor, metric/filter pickers; webhook list, create (secret shown once), **Send test**, last 20 deliveries |
| Test suites | List; editor; **Run** (version or label picker, shown with `aiTestSuite:run`); run history with pass/fail; run detail linking to experiment results; **CI tokens** panel (create, shown once; revoke) |
| Optimizer | Wizard (prompt, base version, dataset, evaluators, rounds, budget, estimate); run detail with per-round best-score chart, candidate list, base vs best diff, train and validation scores, **Save as vN+1**; **Optimize** button on the prompt hub |

## Acceptance criteria

AC9 belonged to T10 and moved to X9 with it.

| ID | Criterion | Verification |
| --- | --- | --- |
| AC1 | With `sampleRate: 1` and an evaluator at 100%, a generate writes live scores (`origin: "live"`) and one `ObsEvalRun` | `cd ai && bun test --preload ./src/tests/bunSetup.ts src/observability/liveEval.test.ts` |
| AC2 | `sampleRate: 0` makes no judge call; error, no-output, and sensitive traces are skipped unless `includeSensitive`; a throwing judge records `ObsEvalRun.status: "error"` and the generate still resolves; scheduling the same trace twice, retrying a run, or crashing between the score write and `ok` leaves exactly one score set; an expired `pending` lease is reclaimed | same file |
| AC3 | `livePromptNames` is required when a write sets the rate > 0; only matching production-label traces are sampled; a stored evaluator with a rate but no list is not sampled, stays editable, and appears in `status.liveEval.misconfiguredEvaluatorIds` | `liveEval.test.ts`, `routes/evaluators.test.ts` |
| AC4 | A generate with `groups` stores them, invalid entries are dropped, chat turns carry `conversation`, and trace list filters by group | `traceGroups.test.ts`, `routes/traces.test.ts` |
| AC5 | `/groups` lists groups with rollups and `/groups/:kind/:id` returns an ordered timeline; `session` works without stored groups | `routes/groups.test.ts` |
| AC6 | `/metrics` returns the bucketed series, p50/p95, score trends, and breakdowns for seeded fixtures; unpriced buckets are `null` and never `0`; range limits give 400 | `routes/metrics.test.ts` |
| AC7 | A webhook delivery carries a valid signature; a payload never contains trace input or output (type plus a test that seeds I/O and asserts its absence); retries stop after 3; disallowed URLs are rejected on save; when the lookup answers public then private, the socket connects to the checked public IP (asserted on the agent's connect target); a 3xx is not followed; list and read responses never contain `url` | `webhooks.test.ts`, `routes/webhooks.test.ts` |
| AC8 | An alert rule fires once when a breach meets `minSamples`, resolves once, and is evaluated by one instance when two tick at once; the `alert.firing` body has the matching `traceIds` per metric and `adminUrl` when `publicAdminUrl` is set | `alertRules.test.ts` |
| AC10 | A suite run on a passing version reports `passed: true`; a failing one reports failed gates and items; an empty body runs the stored target; an inline candidate runs without creating a version; two overrides give 400; a run whose estimate exceeds the suite's `maxCostUsd` gives 400; existing 2–3-version experiments still validate | `routes/testSuites.test.ts`, `experimentRunner.test.ts` |
| AC11 | A `tobs_` token runs and reads suites, gets 401 on every other observability route (including when minted by a legacy admin, with and without `accessControl`), stops working when revoked, expired, or its user is disabled, cannot be minted without `expiresAt` ≤ 365 days, returns 429 on the 11th run in an hour, and each use writes an audit entry | `serviceTokens.test.ts` |
| AC12 | `terreno ai test <suite>` with no flag runs the stored target; it exits 0 on pass and 1 on gate failure, timeout, HTTP error, or two override flags; `--json` prints `{ok, reason, gates}` | `cd cli && bun test src/commands/ai.test.ts` |
| AC13 | With a deterministic fixture model, the optimizer improves a failing base on train, reports validation scores, rejects variable-changing candidates, rejects a candidate that copies 8+ words, or a new item token or digit run, of an item verbatim, never sends `origin: "trace"` items without `annotatedBy` to the optimizer prompt, and stops within `maxCostUsd` by estimate | `promptOptimizer.test.ts` |
| AC14 | `saveVersion` creates `vN+1`, moves `latest` only, and leaves `production` and `staging` unchanged; it returns 400 without `reviewedForPersonalData: true`; RBAC denies `optimize` without the grant | `routes/optimizations.test.ts` |
| AC15 | With JobsApp registered, live evals, alert ticks, and deliveries run as jobs, and the import guard keeps `@terreno/jobs` out of the root entry | `jobsRunners.test.ts`, `jobsRunner.test.ts` guard |
| AC16 | New RBAC resources and actions seed correctly and compose for the example roles | `api` rbac tests, `example-backend` rbac test |
| AC17 | Each new screen renders loading, empty, error, and data states, hides write controls without the grant, and passes the sorted-screen-keys assertion | `admin-frontend` isolated tests |
| AC18 | Each UI task attaches `verify-ui-changes` screenshots to `/opt/cursor/artifacts/`, using data it creates through its own API in the walkthrough, and passes `accessibility-testing` keyboard and focus checks. T25 re-captures every screen on the seeded demo | screenshots + a11y report |
| AC19 | `bun run backend:seed` fills Threads, Monitoring, Alerts, Test suites, and Optimizer with demo data idempotently | `seedAiObservabilityDemo.test.ts` |
| AC20 | Docs pages listed per task exist and match shipped routes, options, and env | `update-docs` checklist in Roast |
| AC21 | An operator with `aiTestSuite:run` starts a suite run from admin; it appears in run history with its gate verdict; without the grant the **Run** button is hidden and the route returns 403 | `admin-frontend` isolated test + `routes/testSuites.test.ts` + screenshot |

## Rollout

- Everything is additive. New fields are optional, new collections are local-plugin only, and no
  migration or backfill is needed (`mongoose-schema-safety`: additive type only).
- Evaluators saved before this plan may store a live rate but no prompt list. They stay
  unsampled, stay editable, and are flagged in status and the evaluator screen until an operator
  picks prompts.
- Live evaluation stays off until an operator raises `AI_OBS_SAMPLE_RATE` above 0 **and** sets an
  evaluator's rate and prompt list.
- Alerts deliver only to webhooks an operator created; there is no default destination.
- Release notes: one `changes/unreleased/*.md` per user-visible task, as the seed branch does.

## Assumptions

- PR #1565 merges first; this branch rebases onto `master` after it.
- New admin hooks use `adminRequest`, per the admin-frontend rule; the sibling observability hooks
  keep `injectEndpoints` until a separate migration.
- Production MongoDB is 7.0+ (D7); local tests run 8.2.
- The example backend passes `aiService` only when Vertex or Gemini credentials are set. Without
  them, status reports `liveEval.available: false` and the demo relies on seeded data.
- `publicAdminUrl` is a new optional `ObservabilityApp` option (T8). The example sets it from
  `PUBLIC_APP_URL` in T25.
- Observability routes keep their own routers, matching the existing `obs/routes/*.ts` files. T5
  adds the observability plugin to the documented exceptions in
  `docs/explanation/model-router-actions.md`, so the rule and the code agree.
- Backend tasks form one ordered chain (T1 → T3 → … → T15). They share `observabilityApp.ts` route
  mounting, `localPlugin.ts` model registration, the example-backend OpenAPI snapshot, and
  `docs/reference/ai.md`. UI tasks T19 → T21 → T22 → T23 → T24 share the admin screen registries.
  Parallel work: T2, T16, T17, T18, and T20.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q2 | Which traces does a live evaluator sample? | Only traces whose prompt is in `livePromptNames` with the `production` label; the list is required | A judge written for summaries would score chat traffic as nonsense and still bill | "All traces" removes the required list and the filter from T4; add a label picker instead if staging traffic should be judged | T4, T20 |
| Q3 | What does a run with no override test? | The suite's stored `target` (your answer: a suite holds the prompt version/label); flags and the admin picker override it for one run | Keeps `terreno ai test <suite>` a one-liner. A PR's own prompt change is tested with `--candidate-file`, because `createVersion` moves `latest` on every save (`promptStore.ts:178`) | Making overrides mandatory removes `target` from the model and adds a usage error | T11, T18, T23 |
| Q4 | What happens to the optimizer's best candidate? | Saved as `vN+1` only when an operator clicks; `production` and `staging` never move (`latest` moves, as on every save) | The phase-1 rule is that promotion is an explicit admin action, and it keeps the registry clean | Auto-saving with the `staging` label removes a click but adds versions for every run | T15, T24 |
| Q5 | Which optimizer algorithm ships first? | Reflective rewrite from failing items | It needs only the evaluators, datasets, and judge client that already exist | Few-shot selection (X5) needs per-item exemplars and a different candidate shape | T14 |
| Q6 | Which webhook formats? | Signed generic JSON plus Slack text | Slack incoming webhooks reject arbitrary JSON, and Slack is a common alert channel; JSON covers PagerDuty-style receivers | JSON only drops the Slack renderer in T8 | T8, T22 |
| Q7 | How often does a firing alert notify? | Once on firing and once on resolve | It avoids pager noise; the admin shows current state | Repeating every N minutes adds a `renotifyMinutes` field to T9 | T9, T22 |
| Q8 | Does `terreno ai test` need JUnit output for CI summaries? | No; ship `--json` now (X4) | Exit code plus JSON is enough to gate | Adding `--junit` is one small task after T18 | T18 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Thread-level evaluators (score a whole conversation after it goes idle) | Groups make it possible; conversational metrics are the next quality signal | L | T3, T5 |
| X2 | Backfill: run a live evaluator over the last N traces | Operators will want scores before sampling accumulates | S | T1 |
| X3 | Per-evaluator daily live-eval budget | The global ceiling is coarse | S | T1, T6 |
| X4 | `--junit` output for `terreno ai test` | CircleCI test summaries | S | T18 |
| X5 | Few-shot and parameter optimizers, chaining | Other optimization strategies | L | T14 |
| X6 | Email alert destination via `@terreno/comms` | Teams without Slack | M | T8 |
| X7 | Saved dashboard views and custom charts | Monitoring screen is fixed | M | T21 |
| X8 | MCP tools over traces, suites, and optimizations for coding agents | Agents debugging prompts from real data | M | T5, T11 |
| X9 | Non-alert webhook events: `prompt.production.moved` (was T10), `testSuite.run.passed/failed`, `experiment.gates.failed`, `optimization.completed` | The request was webhooks for alerts; these came up while planning | S | T9, T11 |
| X10 | Pre-aggregated hourly rollups if `/metrics` gets slow | Read-time aggregation over large trace counts | M | T7 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 (durable) | What should a webhook payload include? | Metadata only: rule, metric, value vs threshold, window, prompt name/version, trace ids, admin deep link; never trace input or output | T8 payload type and test; T9 alert payloads |
| D2 | Should online evaluation score `sensitive` traces? | Opt in per evaluator (`includeSensitive`, default false) | T1 skip rule, T4 field, T20 toggle |
| D3 (durable) | Data model for arbitrary grouping ids? | Named group map `groups: {[kind]: id}`; `sessionId` surfaces as built-in kind `session` | T3, T5, T19 |
| D4 | How do CI suites run? | Stored suites (dataset + prompt version/label + evaluators + gates); `terreno ai test <suite>` calls a running backend (e.g. staging) with a service token, waits, and exits non-zero on gate failure; also runnable from admin | T11–T13, T18, T23 (admin **Run**, AC21) |
| D5 (durable) | Q1: What credential does CI use to call the backend? | A new `tobs_` observability service token, accepted only on suite routes (required expiry ≤ 365 days, 10 runs/hour, audited) | T13, T18, T23 as written |
| D6 (durable) | Q10: What data may the optimizer send to its LLM, and what may it write into a prompt? | Only person-written or annotator-signed items; reject candidates that copy 8+ words or a new item token or digit run; personal-data review tick before saving | T14, T15, T24 as written |
| D7 | Q9: Is production MongoDB 7.0+? | Yes | T7 and T9 use `$percentile` |

## Sign-off

Status: approved 2026-10-18 (chat; answers in D5–D7; Q2–Q8 stand on their recommendations)
Cut: 2 rounds, 24 findings: 21 fixed, 3 moved to questions or expansions (round 1: F4 → Q1 asked at sign-off, F8 → X9; round 2: F9 → Q1 asked at sign-off), 0 rebutted
