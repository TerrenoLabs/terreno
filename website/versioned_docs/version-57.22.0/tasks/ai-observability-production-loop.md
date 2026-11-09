# Task List: AI observability production loop

**Status:** approved 2026-10-18. Start with T1 (or T2, which is independent).
**IP:** [`docs/implementationPlans/ai-observability-production-loop.md`](../implementationPlans/ai-observability-production-loop.md). The contracts, acceptance criteria (AC1–AC21; AC9 was dropped with T10), and open questions live there. T10 moved to Expansions (X9) during cut, so the IDs skip it.
**Supporting skills:** `terreno-backend-api`, `mongoose-schema-safety`, `ai-prompt-governance`, `backend-test-env`, `building-admin-interfaces`, `terreno-ui`, `dataviz`, `update-docs`, `verify-ui-changes`, `accessibility-testing`.

Shared files force three write chains:

- **Backend chain:** T1 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T11 → T12 → T13 → T14 → T15.
  - Shared files: `ai/src/observability/observabilityApp.ts` (route mounting and options),
    `ai/src/observability/local/localPlugin.ts` (model registration), `ai/src/index.ts`,
    `example-backend/src/__snapshots__/openapi.test.ts.snap`, and `docs/reference/ai.md`.
  - Each backend task updates the reference rows for what it ships.
- **UI chain:** T19 → T21 → T22 → T23 → T24.
  - Shared files: `ai/src/observability/adminScreens.ts`, `shell/AiObservabilityScreenWidgets.tsx`,
    `shell/aiObservabilityNav.ts`, and `isolated/aiObservabilityScreens.isolated.tsx`.
  - Each UI task writes the operator how-to page for its feature.
- **Jobs chain:** T16 → T17. Shared files: `ai/src/observability/jobsRunners.ts`, `example-backend/src/server.ts`, and `docs/how-to/background-jobs.md`. They plug into runner options that T1, T8, and T9 define, so they never edit `observabilityApp.ts`.
- **Example server and jobs:** `example-backend/src/server.ts` is written by T1, T16, T17, and T25, in that order; the example jobs files by T16 and T17.

Parallel work: T2 (api RBAC), T16 (after T1), T18 (CLI, after T13), T19 (after T5), and T20 (after T6).
UI tasks prove themselves with data they create through their own API; T25 seeds the demo last and re-captures every screen.
Every UI task runs `verify-ui-changes` against the seeded example and `accessibility-testing`
before Roast. Every user-visible task adds a `changes/unreleased/*.md` note.

Paths below are relative to the repo root. `obs/` means `ai/src/observability/`; `widgets/` means
`admin-frontend/src/widgets/aiObservability/`.

### Phase 1: Tracer

- [ ] **T1** — Live evaluation scores a sampled production trace
  - Depends on: none
  - Files: `ai/src/service/aiService.ts`, `obs/observabilityAppRegistry.ts`, `obs/observabilityApp.ts`, `obs/liveEval.ts` (new), `obs/liveEval.test.ts` (new), `obs/evaluate.ts`, `obs/evaluate.test.ts`, `ai/src/service/prompts.ts` (`LIVE_JUDGE_*`), `obs/local/models/obsScore.ts` (`origin`), `obs/local/models/obsEvalRun.ts` (new), `obs/local/localPlugin.ts`, `obs/types.ts`, `ai/src/types/observability.ts`, `ai/src/index.ts`, `example-backend/src/server.ts` (`sampleRate` from `AI_OBS_SAMPLE_RATE`), `docs/reference/ai.md`, `docs/explanation/ai-observability.md`.
  - Delivers:
    - The trace export seam: `logRequestAndTrace` calls `app.exportTrace`, and `exportTrace` calls `liveEval.schedule` after the local sink persists.
    - The `liveEvalRunner` option (default in-process) that T16 plugs into.
    - `ObsEvalRun` with a unique `{traceId, evaluatorId}` index, a 10-minute `pending` lease that can be reclaimed, and judge tokens and cost. Live scores are upserted on `{traceId, evaluatorId, name, origin}` (partial unique index).
    - The scheduler: evaluator selection with a 30 s cache, the effective rate, the deterministic roll, the error, no-output, and sensitive skips, and the in-process runner (concurrency 2, cap 500).
    - Trace-worded judge prompt via `subject: "trace"`.
    - Scores fan out through `scoreSinks` with `origin: "live"`, and each run writes an `ObsEvalRun`.
    - With no server `aiService`, live eval logs once and stays off.
  - Acceptance: AC1, AC2. The new tests fail on the base branch.

### Phase 2: Access and threads foundation

- [ ] **T2** — RBAC resources for alerts, test suites, and the optimizer
  - Depends on: none
  - Files: `api/src/rbac/statements.ts`, `api/src/rbac/roleModel.ts`, `api/src/rbac/*.test.ts` (catalog and seed tests), `obs/permissions.ts`, `example-backend/src/rbacRoles.ts`, `example-backend/src/rbacRoles.test.ts`, `docs/reference/api.md` (AI observability RBAC).
  - Delivers: the `aiAlert` and `aiTestSuite` resources and `aiPrompt.optimize`. The seeded admin, auditor, and superadmin grants are additive on re-seed, and the example viewer and operator roles get the matching grants.
  - Acceptance: AC16.

- [ ] **T3** — Traces record named groups
  - Depends on: T1
  - Files: `ai/src/service/aiService.ts` (`groups` option), `ai/src/service/chatTurn.ts` (`conversation` group), `obs/types.ts` (`TraceRecord.groups`), `obs/traceGroups.ts` (new: validation), `obs/traceGroups.test.ts` (new), `obs/local/models/obsTrace.ts` (field + index), `obs/local/traceStore.ts` (persist, list filter, detail map), `obs/routes/traces.ts`, `obs/routes/traces.test.ts`, `ai/src/types/index.ts` (generate option type), `example-backend/src/__snapshots__/openapi.test.ts.snap`, `docs/reference/ai.md`.
  - Delivers: the Groups contract rows for shape, validation, `session`, chat, the index, and the trace-list filter.
  - Acceptance: AC4.

### Phase 3: Online evaluation and threads API

- [ ] **T4** — Live sampling filters by prompt and lets sensitive traces opt in
  - Depends on: T3
  - Files: `obs/local/models/obsEvaluator.ts` (`livePromptNames`, `includeSensitive`), `obs/local/evaluatorStore.ts`, `obs/routes/evaluators.ts`, `obs/routes/evaluators.test.ts`, `obs/liveEval.ts`, `obs/liveEval.test.ts`, `ai/src/types/observability.ts`, `example-backend/src/__snapshots__/openapi.test.ts.snap`, `docs/reference/ai.md`.
  - Delivers: the required prompt list when a write sets the rate above 0 (400 otherwise), production-label prompt matching, and the `includeSensitive` opt-in (D2). Stored evaluators with a rate but no prompt list are not sampled and stay editable.
  - Acceptance: AC3, and the sensitive half of AC2.

- [ ] **T5** — Groups list and timeline API
  - Depends on: T4
  - Files: `obs/local/groupStore.ts` (new), `obs/routes/groups.ts` (new), `obs/routes/groups.test.ts` (new), `obs/observabilityApp.ts` (mount), `example-backend/src/__snapshots__/openapi.test.ts.snap`, `docs/reference/ai.md`, `docs/explanation/model-router-actions.md` (observability plugin routes join the documented exceptions).
  - Delivers: `GET /groups/kinds`, `GET /groups`, and `GET /groups/:kind/:id`, with rollups and an ordered timeline; `session` reads `sessionId`.
  - Acceptance: AC5.

- [ ] **T6** — Evaluator live stats and sampling ceiling in status
  - Depends on: T5
  - Files: `obs/local/evaluatorStore.ts` (live stats from `ObsEvalRun` and live scores), `obs/routes/evaluators.ts`, `obs/routes/evaluators.test.ts`, `obs/status.ts`, `obs/routes/status.ts`, `ai/src/types/observability.ts`, `example-backend/src/__snapshots__/openapi.test.ts.snap`, `docs/reference/ai.md`.
  - Delivers: evaluator detail `live` and status `liveEval: {available, ceilingPercent, misconfiguredEvaluatorIds}`.
  - Acceptance: a route test seeds `ObsEvalRun` rows and live scores and reads back the counts and means; a status test covers both `available` values and lists an evaluator with a rate but no prompt list (AC3).

### Phase 4: Monitoring and alerts API

- [ ] **T7** — Metrics API returns time series and breakdowns
  - Depends on: T6
  - Files: `obs/local/metricsStore.ts` (new, window functions reused by T9), `obs/local/metricsStore.test.ts` (new), `obs/routes/metrics.ts` (new), `obs/routes/metrics.test.ts` (new), `obs/observabilityApp.ts`, `ai/src/types/observability.ts` (`MetricsResponse`), `example-backend/src/__snapshots__/openapi.test.ts.snap`, `docs/reference/ai.md`.
  - Delivers: the Metrics contract, including the range limits, `null` cost for unpriced buckets, `costPartial`, and `liveEvalCostUsd` from `ObsEvalRun`.
  - Acceptance: AC6.

- [ ] **T8** — Webhook destinations with signed, metadata-only delivery
  - Depends on: T7, T2
  - Files: `obs/local/models/obsWebhook.ts` (new), `obs/local/models/obsWebhookDelivery.ts` (new), `obs/webhooks.ts` (new: payload builder, signer, Slack renderer, URL guard, in-process retry), `obs/webhooks.test.ts` (new), `obs/routes/webhooks.ts` (new: CRUD, rotate secret, `POST /:id/test`, deliveries list), `obs/routes/webhooks.test.ts` (new), `obs/local/localPlugin.ts`, `obs/observabilityApp.ts` (`publicAdminUrl` and `webhookDeliveryRunner` options, mount), `obs/types.ts`, `example-backend/src/__snapshots__/openapi.test.ts.snap`, `docs/reference/ai.md`.
  - Delivers: the Webhooks contract and D1. The payload builder accepts only `ObsWebhookPayload`, the secret is returned once, `url` is never returned after create (`urlHost` only), delivery connects to the checked IP through an undici `Agent` lookup, and redirects are not followed.
  - Acceptance: AC7. A test seeds a trace whose input and output hold a marker string, fires a delivery, and asserts the body never contains the marker.

- [ ] **T9** — Alert rules evaluate and notify
  - Depends on: T8
  - Files: `obs/local/models/obsAlertRule.ts` (new), `obs/alertRules.ts` (new: evaluate, state machine, lease, interval scheduler), `obs/alertRules.test.ts` (new, fake clock), `obs/routes/alertRules.ts` (new: CRUD + `POST /:id/evaluate` dry run), `obs/routes/alertRules.test.ts` (new), `obs/local/localPlugin.ts`, `obs/observabilityApp.ts` (`alerts: {interval, scheduler}` options, mount), `obs/types.ts`, `example-backend/src/__snapshots__/openapi.test.ts.snap`, `docs/reference/ai.md`.
  - Delivers: every alert metric in the IP, the `minSamples` guard, `alert.firing` and `alert.resolved` once each (Q7), a single evaluator per tick via the lease, and the per-metric `traceIds` selection plus `adminUrl` in the payload.
  - Acceptance: AC8.

### Phase 5: CI test suites

- [ ] **T11** — Test suites and suite runs
  - Depends on: T9, T2
  - Files: `obs/local/models/obsTestSuite.ts` (new), `obs/local/models/obsExperiment.ts` (`suiteId`, `kind`), `obs/local/experimentRunner.ts` (one-version suite runs, candidate-only gates), `obs/local/experimentRunner.test.ts`, `obs/local/testSuiteStore.ts` (new), `obs/routes/testSuites.ts` (new), `obs/routes/testSuites.test.ts` (new), `obs/routes/experiments.ts` (`?kind` filter), `obs/routes/experiments.test.ts`, `obs/local/localPlugin.ts`, `obs/observabilityApp.ts`, `ai/src/types/observability.ts`, `example-backend/src/__snapshots__/openapi.test.ts.snap`, `docs/reference/ai.md`.
  - Delivers: suite CRUD with a required stored `target` and `maxCostUsd`; runs that use the stored target or one `{version}` / `{label}` override (Q3); a kind-aware `versions` validator; and the run status shape with `estimatedCostUsd`. The experiments list excludes `kind: "suite"` unless `?kind=suite`.
  - Acceptance: AC10 for version and label runs, the route half of AC21 (403 without `aiTestSuite:run`), plus a test that a normal experiment still needs 2–3 versions.

- [ ] **T12** — Suite runs accept an inline candidate prompt
  - Depends on: T11
  - Files: `obs/local/experimentRunner.ts` (`"candidate"` version key with an inline body), `obs/local/experimentRunner.test.ts`, `obs/routes/testSuites.ts`, `obs/routes/testSuites.test.ts`, `obs/local/models/obsExperiment.ts` (stored candidate), `example-backend/src/__snapshots__/openapi.test.ts.snap`, `docs/reference/ai.md`.
  - Delivers: `{candidate: PromptVersionFields}` stored as version `0` with `candidateBody`, validated like `createVersion`, with a 400 when its variable set differs from the base prompt's production version. No prompt version is created. `mongoose-schema-safety` risk matrix recorded in the PR.
  - Acceptance: AC10 (inline half).

- [ ] **T13** — Observability service tokens for CI
  - Depends on: T12
  - Files: `obs/local/models/obsServiceToken.ts` (new), `obs/serviceTokens.ts` (new: mint, verify, revoke), `obs/serviceTokens.test.ts` (new), `obs/routes/observabilityRouteAccess.ts` (accepts `tobs_` only where a route opts in with `serviceToken: true`), `obs/routes/serviceTokens.ts` (new), `obs/routes/testSuites.ts` (opt in on list, read, run, and run status; rate limit), `obs/local/localPlugin.ts`, `obs/observabilityApp.ts`, `example-backend/src/__snapshots__/openapi.test.ts.snap`, `docs/reference/ai.md`.
  - Delivers: the token contract (D5): hash only, shown once, a required expiry of at most 365 days, at most 10 active per user, scope checked before the legacy-admin shortcut, 401 everywhere else and for a disabled user, 10 runs per hour per token, and audit entries.
  - Acceptance: AC11.

### Phase 6: Prompt optimizer

- [ ] **T14** — Prompt optimizer engine
  - Depends on: T13
  - Files: `obs/local/experimentRunner.ts` (extract `scoreVersionOnItems`), `obs/local/experimentRunner.test.ts`, `obs/local/promptOptimizer.ts` (new), `obs/local/promptOptimizer.test.ts` (new, deterministic fixture model), `obs/local/models/obsOptimization.ts` (new), `obs/local/localPlugin.ts`, `ai/src/service/prompts.ts` (`PROMPT_OPTIMIZER_*`), `ai/src/types/observability.ts`, `docs/reference/ai.md`.
  - Delivers: the reflective-rewrite loop (Q5), the train/validation split, variable and schema guards, the PHI guards (D6: only person-written or annotator-signed items; rejection of 8-word verbatim runs and of new item tokens or digit runs), estimated-cost tracking from returned token usage, budget stops, and early stop. Existing experiment tests stay green after the extraction.
  - Acceptance: AC13.

- [ ] **T15** — Optimizer API
  - Depends on: T14, T2
  - Files: `obs/routes/optimizations.ts` (new), `obs/routes/optimizations.test.ts` (new), `obs/observabilityApp.ts`, `example-backend/src/__snapshots__/openapi.test.ts.snap`, `docs/reference/ai.md`.
  - Delivers: estimate, create, list, detail, cancel, and `saveVersion` (Q4: only `latest` moves; requires `reviewedForPersonalData: true`, recorded in the audit entry).
  - Acceptance: AC14.

### Phase 7: Durable jobs (parallel)

- [ ] **T16** — Live evals run as durable jobs
  - Depends on: T1
  - Files: `obs/jobsRunners.ts` (new subpath), `obs/jobsRunners.test.ts` (new), `ai/package.json` (`exports["./observability/jobsRunners"]`), `ai/src/harness/runners/jobsRunner.test.ts` (extend the import guard to the new subpath's reachability from `ai/src/index.ts`), `example-backend/src/server.ts` (pass the jobs runner through the T1 `liveEvalRunner` option when JobsApp is registered), `example-backend/src/utils/observabilityConfig.ts` (add a shared `createExampleObservabilityApp()` that the server and the worker both call), `example-backend/src/jobs/createExampleJobsApp.ts`, `example-backend/src/jobs/defineExampleJobs.ts`, `example-backend/src/jobs/bootstrapJobsWorker.ts` (the standalone worker builds the same observability context, so job handlers have the `aiService` and score sinks), `docs/how-to/background-jobs.md`.
  - Delivers: the `ai-observability/live-eval` job with 3 attempts, relying on the T1 `ObsEvalRun` claim for idempotent retries, and the in-process fallback when no JobsApp is registered.
  - Acceptance: AC15 (live-eval half).

- [ ] **T17** — Alert ticks and webhook deliveries run as jobs
  - Depends on: T9, T16
  - Files: `obs/jobsRunners.ts`, `obs/jobsRunners.test.ts`, `example-backend/src/server.ts` (pass the jobs scheduler and delivery runner through the T8/T9 options), `example-backend/src/utils/observabilityConfig.ts`, `example-backend/src/jobs/defineExampleJobs.ts`, `docs/how-to/background-jobs.md`.
  - Delivers: the `ai-observability/alerts-tick` cron (every minute) and the `ai-observability/webhook-delivery` job, which keeps the 0 / 10 s / 60 s schedule. When jobs are used, the interval scheduler stays off.
  - Acceptance: AC15 (alerts half).

### Phase 8: CLI (parallel)

- [ ] **T18** — `terreno ai test` CLI command
  - Depends on: T13
  - Files: `cli/src/commands/ai.ts` (new), `cli/src/commands/ai.test.ts` (new, fake `io.fetch`), `cli/src/runCli.ts`, `cli/src/help.ts`, `docs/reference/cli.md`, `docs/how-to/run-ai-eval-suites-in-ci.md` (new: GitHub Actions and CircleCI snippets, each with the required-secret validation step).
  - Delivers: the CLI contract in the IP, including the gate table output, exactly one target flag (Q3), and exit codes.
  - Acceptance: AC12.

### Phase 9: Admin UI

- [ ] **T19** — Threads screens
  - Depends on: T5
  - Files: `widgets/threads/*` (new: list and detail screens and views, `useAiObservabilityThreadsApi.ts` via `adminRequest`, tests), `widgets/traces/AiTraceDetailView.tsx` (group chips), `widgets/shell/AiObservabilityScreenWidgets.tsx`, `widgets/shell/aiObservabilityNav.ts`, `admin-frontend/src/isolated/aiObservabilityScreens.isolated.tsx`, `obs/adminScreens.ts`, `obs/adminScreens.test.ts`, `docs/how-to/group-ai-traces.md` (new).
  - Delivers: the Threads row of the IP's Admin UI table.
  - Acceptance: AC17, AC18.

- [ ] **T20** — Evaluator live controls and stats
  - Depends on: T6
  - Files: `widgets/evaluators/AiEvaluatorPanels.tsx`, `widgets/evaluators/AiEvaluatorNewScreen.tsx`, `widgets/evaluators/evaluatorTypes.ts`, `widgets/evaluators/evaluatorTypes.test.ts`, `widgets/evaluators/useAiObservabilityEvaluatorsApi.ts` (additive response types only), `widgets/shell/AiObservabilityStatusChip.tsx` (additive `liveEval` status type), `admin-frontend/src/isolated/observabilityStatusFixtures.isolated.ts`, `admin-frontend/src/isolated/aiEvaluatorLive.isolated.tsx` (new), `docs/how-to/evaluate-production-traces.md` (new).
  - Delivers: the Evaluator row of the Admin UI table. Save is disabled while the rate is above 0 and no prompt is chosen; a warning shows when sensitive is on, and when status lists the evaluator as misconfigured.
  - Acceptance: AC17, AC18. With `GEMINI_API_KEY` set and `AI_OBS_SAMPLE_RATE=1`, a Summarize press in the example app shows a new live score on the evaluator screen (screenshot).

- [ ] **T21** — Monitoring screen
  - Depends on: T7, T19
  - Files: `widgets/monitoring/*` (new), `widgets/shell/AiObservabilityScreenWidgets.tsx`, `widgets/shell/aiObservabilityNav.ts`, `admin-frontend/src/isolated/aiObservabilityScreens.isolated.tsx`, `obs/adminScreens.ts`, `obs/adminScreens.test.ts`, `docs/how-to/monitor-ai-quality.md` (new).
  - Delivers: the Monitoring row of the Admin UI table, with charts per the `dataviz` skill.
  - Acceptance: AC17, AC18.

- [ ] **T22** — Alerts and webhooks screens
  - Depends on: T9, T21
  - Files: `widgets/alerts/*` (new), `widgets/shell/AiObservabilityScreenWidgets.tsx`, `widgets/shell/aiObservabilityNav.ts`, `admin-frontend/src/isolated/aiObservabilityScreens.isolated.tsx`, `obs/adminScreens.ts`, `obs/adminScreens.test.ts`, `docs/how-to/monitor-ai-quality.md`.
  - Delivers: the Alerts and Webhooks row of the Admin UI table.
  - Acceptance: AC17, AC18. A screenshot shows the secret-once modal and a delivery log entry from **Send test** against a local receiver.

- [ ] **T23** — Test suites screens, admin runs, and CI tokens
  - Depends on: T13, T18, T22
  - Files: `widgets/suites/*` (new), `widgets/shell/AiObservabilityScreenWidgets.tsx`, `widgets/shell/aiObservabilityNav.ts`, `admin-frontend/src/isolated/aiObservabilityScreens.isolated.tsx`, `obs/adminScreens.ts`, `obs/adminScreens.test.ts`, `docs/how-to/run-ai-eval-suites-in-ci.md`.
  - Delivers: the Test suites row of the Admin UI table, including the stored-target picker in the editor and the **Run** button with an optional version/label override (D4).
  - Acceptance: AC17, AC18, AC21. The walkthrough starts a run from admin, then mints a token in admin and runs `terreno ai test` against the local backend with it.

- [ ] **T24** — Optimizer screens
  - Depends on: T15, T23
  - Files: `widgets/optimizer/*` (new), `widgets/prompts/*` (the **Optimize** button on the prompt hub), `widgets/shell/AiObservabilityScreenWidgets.tsx`, `widgets/shell/aiObservabilityNav.ts`, `admin-frontend/src/isolated/aiObservabilityScreens.isolated.tsx`, `obs/adminScreens.ts`, `obs/adminScreens.test.ts`, `docs/how-to/optimize-a-prompt.md` (new).
  - Delivers: the Optimizer row of the Admin UI table, including rejected candidates with their reason and the personal-data review tick before **Save as vN+1**.
  - Acceptance: AC17, AC18.

### Phase 10: Demo and SOP

- [ ] **T25** — Seeded demo data, SOP docs, and full walkthrough
  - Depends on: T15, T17, T20, T24
  - Files: `example-backend/src/scripts/seedAiObservabilityDemo.ts`, `example-backend/src/scripts/seedAiObservabilityDemo.test.ts`, `example-backend/src/server.ts` (`publicAdminUrl` from `PUBLIC_APP_URL`), `docs/how-to/observe-llm-calls.md` (env `AI_OBS_SAMPLE_RATE` meaning, seed table), `docs/how-to/ai-feature-development.md` (SOP steps 5–8 use suites, live eval, alerts, and the optimizer), `docs/explanation/ai-observability.md` (production loop section), `docs/implementationPlans/ai-observability.md` (pointer to this plan).
  - Delivers:
    - `conversation` groups on seeded chat traces.
    - Live scores and `ObsEvalRun` rows over the last 7 days, with a dip on one prompt.
    - One firing alert rule and a disabled demo webhook.
    - The `summarize-gold` suite with one passed and one failed run.
    - One finished optimization run from the deterministic `seed-fixture` client.
    - The seed stays idempotent.
  - Acceptance: AC19, plus a `verify-ui-changes` pass that re-captures Threads, Evaluator live panel, Monitoring, Alerts, Webhooks, Test suites, and Optimizer on the seeded demo (AC18).
