# Develop an AI feature

Work this loop in **Terreno admin** when observability primaries are `local`. If prompts/datasets/experiments are Langfuse, the same screens proxy the vendor, or use **Open in Langfuse**.

Architecture: [AI observability](../explanation/ai-observability.md). Routes and models: [AI reference](../reference/ai.md). Register plugins: [Observe LLM calls](./observe-llm-calls.md).

Volume targets (how many gold items, class balance) live in the operator spreadsheet, not in Terreno. Use **tags** and **outcome class** so you can filter for balance.

For a walkable example, run `bun run backend:seed`: it installs
`examples/example-summarize` with production on v1 and candidate v2, the human
`correctness-human` and automatic `schema-assert` evaluators, and the proofread
`example-gold` dataset. It also installs `chat-safety-synthetic`, twelve proofread
synthetic chats between two people. Each item is the new message plus a few earlier
turns. Gold labels cover 988 (immediate danger to self), care-team follow-up,
toxicity, a privacy leak, and a dismissive reply. Compare `chat-safety-screen` v1
(new message only) with v2 (earlier turns) using evaluator `chat-safety-agreement`.
These fixtures are proofread on purpose so experiments include them. The Generate
button still lands drafts as `proofread: false` until a human accepts them. Load the
same set into a running database, including a PR preview, with Admin → Scripts →
`seedChatSafetyDataset` (wet run).

## 1. Gather a gold dataset

1. Open **Datasets** → create a named set. Optionally set `inputSchemaPromptName` to a registry prompt whose `inputSchema` should validate imported rows, and `expectedOutputSchema` if product has agreed a label shape.
2. Add items in three ways:
   - **From production traces** (preferred for open-ended features): Traces list → filter → **Add to dataset** (`POST /ai/observability/traces/add-to-dataset`). Sensitive traces always land `proofread: false`.
   - **Import JSON or CSV** (`POST /ai/observability/datasets/:id/import`): JSON can be an array of bare input objects or structured rows with `input`, `expectedOutput`, `proofread`, `tags`, `outcomeClass`, and `metadata`. CSV accepts `Content-Type: text/csv` or `{format: "csv", content: "..."}`; plain columns map to `input`, `input.foo` nests fields, `expectedOutput.foo` maps labels, and reserved `proofread` / `tags` / `outcomeClass` columns map metadata. Invalid rows against the bound input schema return 400 with the row number and JSON path.
   - **Manual**: `POST /datasets/:id/items` with a production-shaped `input`.
   - **Synthetic** (phase 2.4): **Generate** drafts. They land as `origin: synthetic` and `proofread: false`. Do not run experiments on them until a human proofreads and sets `proofread: true`.
3. Prefer a mix of true/false positives and negatives on classification features. Tag critical cases.

In-app **thumbs** / **false positive|negative** on a live feature write feedback scores and can **flag for dataset** (step 7). Those traces show up with `flaggedForDataset`.

## 2. Label expected output

1. Open the dataset item.
2. Fill `expectedOutput` to match the schema from step 1.
3. Set `outcomeClass` (`tp` / `fp` / `tn` / `fn`) when the feature is a flag.
4. Add `tags` for categories you will filter on later.
5. Set `proofread: true` on synthetic items you accept.

Skip unlabeled items in experiments unless you only need generation smoke (still prefer labels before scoring).

## 3. Create the prompt

1. Open **Admin → AI Observability → Prompts**. The folder rail shows counts; search filters name and folder.
2. **Create prompt** (folder, name, system, user template with `{{variables}}`). That write is immutable **v1**. Open the row to the editor.
3. Edit system/template/variables/temperature, then **Save as vN+1**. There is no in-place save. **Playground → Run once** compiles and calls the model; it does **not** create a version.
4. Do not paste that string into app routes. Apps call `AIService` with `promptName` + `promptLabel` (step 6).

Judge prompts for evaluators are named constants or registry prompts — never inline in `AIService`.

## 4. Set up evaluators

**Evaluators** → **Create from template** (`POST /ai/observability/evaluators/templates/:name`) or custom (`POST /ai/observability/evaluators`):

| Feature shape | Template | Score |
| --- | --- | --- |
| Boolean flags (urgent, etc.) | `correctness` (`llm-judge`) or `correctness-human` (review queue) | boolean `correct` |
| Open-ended text | `hallucination` / `hallucination-human` | boolean `hallucinated` / `contains_hallucination` |
| Open-ended text | `helpfulness` / `helpfulness-human` | numeric 0–1 |
| Open-ended text | `toxicity` / `toxicity-human` | boolean `is_toxic` / `toxic` |
| Structured JSON output | `schema-assert` (`json-assert`) | boolean `schema_valid` |
| Open-ended text (if useful) | `conciseness` | numeric 0–1 (human) |

`llm-judge` templates require a registry judge prompt (`eval-judge-*`) whose `outputSchema` declares every required dimension. Create returns 400 naming any missing key. `confidenceAlertBelow` defaults to **0.7**.

A human evaluator with `runModes.liveSampleRate > 0` is rejected (400). Live sampling for judges is task 2.2, capped by `AI_OBS_SAMPLE_RATE`.

Add more dimensions with product/engineering. Attach them to the experiment in step 5.

## 5. Run experiments

1. **Experiments** → `POST /ai/observability/experiments` with dataset id, **2–3 prompt version numbers**, evaluator ids, optional `modelOverride`, and optional `thresholds[]`.
2. Thresholds default to the SOP gates (override per run if product disagrees):

| Dimension | Gate |
| --- | --- |
| correctness true-rate | = 100% |
| hallucination true-rate | = 0% |
| helpfulness mean | ≥ 90% |
| toxicity true-rate | = 0% |

3. Wait for the run (`BackgroundTask` when local — even for a one-item dataset).
4. `GET /ai/observability/experiments/:id` returns gate pass/fail, aggregates (`trueRate` for booleans, `mean` for numerics), `outlierItemIds`, `lowConfidenceItemIds`, and per-item outputs (**failed rows first**).
5. Skim **per-item outputs**. If they are nonsense, fix the prompt before trusting aggregates.
6. Read **pass/fail vs thresholds**. Open outliers and low-confidence items (default alert below 0.7). Use those items to rewrite the prompt.
7. Save a new prompt version. Repeat this step until gates pass (or product accepts a documented override).
8. `POST /ai/observability/experiments/:id/promote` with `{version}` moves `production` when all gates pass; **409** while any gate fails. Experiments never auto-promote without this call.

Unproofread synthetic items are excluded unless you set `includeUnproofread`.

## 6. Deploy to production

1. In the prompt editor, select the winning version and **Set vN as production…**. The confirm modal names the **outgoing** production version (or none). Experiments never auto-promote.
2. In the app, resolve that label at call time:

```typescript
await aiService.generateText({
  prompt: text,
  promptLabel: "production",
  promptName: "example-summarize",
  userId: req.user?.id,
});
```

Missing `production` fails the request (400). Do not fall back to a hardcoded string.

## 7. Production tracing and feedback

Do this in parallel with steps 1–6 once the feature is reachable.

1. Register `ObservabilityApp`. Every `generate*` emits a trace unless `skipTrace`.
2. Pass `userId` and `sessionId` from the request.
3. From the product UI, call `POST /ai/observability/traces/:id/feedback` as the signed-in user:
   - `kind: "thumbs"` + `up` / `down` (helpfulness of suggestions)
   - `kind: "outcome"` + `tp` / `fp` / `tn` / `fn` (flags)
   - `flagDataset: true` to queue the trace as a dataset candidate
4. In **Admin → AI Observability → Traces**, filter by time, prompt dropdown, status, user, session, score presence, or data sensitivity. Score and sensitivity dropdowns include both positive and negative states. Rows show a status dot, `sensitive` badge, error line, `N prompts`, tokens, cost, and latency. Open a row for the span tree (kind, indent, duration bar). Sensitive I/O disclosures start **collapsed**.
5. Select one or more traces. The bulk bar warns when any selected row is `sensitive`. Choose **Send to human review**, read the queue explanation, and pick a human evaluator. The evaluator's dimensions become the score fields and its instructions guide the reviewer. Confirming posts `POST /ai/observability/traces/review` with `reason: "manual"`. Automatic (`llm-judge` / `json-assert`) evaluators cannot enter this queue.
6. Open **Review queue**. Tabs show Pending / In progress / Done / Skipped counts, and pending
   items are oldest-first. Select **Start reviewing — oldest first**.
7. On each item, compare **What the AI was given** with **What the AI wrote**. Long fields begin
   collapsed with a word count; structured outputs retain field labels and reviewer notes. Use
   **Raw JSON** only when the field view is insufficient.
8. Score every required evaluator dimension: numeric dimensions use the declared range slider,
   boolean dimensions use Pass / Fail, and categorical dimensions use pills. Add an optional
   comment, then **Submit & next**. **Skip** records no score. For the second phase-1 intake path,
   use **Assign to me** to manually claim an item and move it to In progress. Continue until the
   toast says **Queue clear**.

Feedback is a score (`source: "user-feedback"`) fanned out to every ScoreSink. Non-owners who are not admin get 403.

## 8. Add weak production traces back to the dataset

1. **Traces**: filter `thumbs=down`, `flaggedForDataset`, `failedEval`, or `lowConfidence` (filters land with task 2.6 feedback).
2. **Add to dataset** (`POST /ai/observability/traces/add-to-dataset`, bulk allowed).
3. Label the new items (step 2).
4. Repeat steps 5–8.

Phase 1 also supports **Send to review queue** from the Traces bulk bar (step 7) when human scoring is enough before dataset intake.

## Checklist (one feature)

- [ ] Gold set exists with mixed origins and labels
- [ ] Prompt versions in the registry, not inlined in routes
- [ ] SOP (or custom) evaluators attached
- [ ] Experiment gates green or explicitly overridden
- [ ] `production` label on the winning version
- [ ] App calls `promptName` + `promptLabel`
- [ ] Live traces include user/session
- [ ] Product can send thumbs / outcome / flag-for-dataset
- [ ] Human review queue reaches Queue clear
- [ ] Weak traces can be added back to the dataset
