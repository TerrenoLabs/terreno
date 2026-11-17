# In-app AI feedback: thumbs, comments, and passive signals

Terreno's AI observability already has the downstream half of the feedback loop: a score attaches to a trace, operators send traces to a human review queue, add them to datasets, and run experiments on those datasets. The upstream half is missing. A user's thumbs in chat are saved on the chat history and nowhere else, the product cannot learn which trace an AI answer came from, and the `POST /ai/observability/traces/:id/feedback` route that the how-to and reference docs describe does not exist. This plan closes that gap. Users can rate any AI output, explain the rating in their own words, and implicitly signal what they did with it (accepted, dismissed, copied, edited, regenerated). Thumbs down queues the trace for human review automatically. Operators can filter traces by that feedback and pull them into datasets without mistaking a bad output for a gold label. Flourish product teams get the signal they need to decide which prompt version to promote.

## The idea

Five contract changes, each building on the one before:

1. **Callers know the trace id up front.** `GenerateObservabilityOptions.traceId?: string` (mint it with the exported `createTraceId()`). `AIService` writes the trace under that id, and `LocalTraceStore` stores it as the trace's `_id`. Routes return it next to the AI output, and chat stores it on each assistant prompt row (`GptHistory.prompts[n].traceId`).
2. **One owner-scoped feedback route.** `POST /ai/observability/traces/:id/feedback` takes `{thumbs?, comment?, outcome?, signal?, flagDataset?}`. The trace's own user (or an admin) may call it.
3. **Two score sources.** Explicit feedback (`thumbs_up`, `outcome`, plus an optional free-text comment) is `source: "user-feedback"`. Passive signals are `source: "user-signal"`, a new enum value, so filters and triage keep "the user said it was bad" apart from "the user closed it". User-feedback and user-signal scores are upserted per trace and name: changing a vote replaces the old one, and deselecting deletes it.
4. **Thumbs down queues review.** When `ObservabilityApp` is given `feedbackReview: {evaluatorName}`, a thumbs down enqueues the trace with `reason: "feedback"` against that human evaluator, unless the trace already has an open item for it.
5. **Feedback follows the trace into datasets.** Adding a trace that has negative user feedback creates the item with `proofread: false`, a `user:thumbs-down` (or `user:dismissed`) tag, and the feedback in `metadata.userFeedback`, so experiments skip it until a human labels the expected output.

Rejected: a separate `ObsSignal` collection for passive signals. It keeps scores clean, but signals would then miss every place scores already reach (sinks, filters, sorts, trace detail). Per D2, the new score source gives the same separation without a parallel model.

Per D1, comments travel with the score to every ScoreSink, the same as any other score field. The plan adds no redaction. Apps that register an external sink are responsible for its data agreement.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Caller-supplied trace ids; example summarize returns its trace id and runs without a model key | none | ai, example-backend | `generateText({traceId})` writes `ObsTrace._id === traceId`; `/ai/example-summarize` returns `traceId`, using the demo model when no key is set |
| T2 | Tracer: owner-scoped feedback route for thumbs and comment | T1 | ai | The owner's thumbs down plus comment creates one `user-feedback` score; a stranger gets 403 |
| T3 | Outcome, flag-for-dataset, and passive signals (`user-signal`) | T2 | ai | `signal: "dismissed"` creates a `user-signal` score; `flagDataset` sets `flaggedForDataset` |
| T4 | Thumbs down enqueues human review | T3 | ai | With `feedbackReview` set, a thumbs down creates one pending `feedback` review item; repeating it does not add another |
| T5 | Trace list filters for thumbs, signal, and comment | T3 | ai | `GET /traces?thumbs=down` returns only thumbs-down traces |
| T6 | Chat stores trace ids; chat ratings and comments become scores | T2, T4, T5 | ai | Rating a chat reply writes the history rating and a `thumbs_up` score on that reply's trace |
| T7 | Dataset intake carries user feedback | T3 | ai | A thumbs-down trace added to a dataset lands `proofread: false` with a tag and `metadata.userFeedback` |
| T8 | ThumbsUpDownFeedback optional comment | none | ui, demo | After a selection, a comment field appears; Send calls `onCommentSubmit` with the text |
| T9 | GPTChat rating comments and a copy signal | T8 | ui | Thumbs down on a reply shows the comment field; Copy message calls `onMessageSignal(index, "copied")` |
| T10 | Admin traces: feedback filters, sources, and comments | T5 | admin-frontend, docs | The Thumbs filter set to Down narrows the list; trace detail shows each score's source and comment |
| T11 | Example summary card: thumbs, comment, Keep / Dismiss / Copy signals, auto-review wiring, e2e | T4, T6, T8, T10 | example-frontend, example-backend | E1 passes: a thumbs down plus comment shows in admin Traces and in the Review queue; Keep and Dismiss write `accepted` / `dismissed` |
| T12 | Example chat: send rating comments and copy signals | T9, T11 | example-frontend | E2 passes: a chat thumbs down plus comment shows on the trace in admin |
| T13 | Feedback loop docs: how-to, explanation, reference | T7, T11 | docs | Docs describe only shipped routes and fields; the stale `feedback (phase 2.6)` claims are gone |

Tracer: `AIService.generateText({traceId})` → `ObsTrace` with that id → `POST /traces/:id/feedback` → `ObsScore` (T1 → T2).
E2E: 2 specs (browser): `example-frontend/e2e/ai-feedback.spec.ts` (summary card → admin) and a new case in `example-frontend/e2e/ai-chat.spec.ts` (chat comment → trace).
Regression: None — no hard-to-automate change; every step runs in the browser.
User guide: 2 new pages (`todos/summarize-todos.md`, `admin/review-ai-feedback.md`), 1 updated (`ai/chat.md`).
Design: None — small additions built from existing components (a comment field under the thumbs; Keep, Dismiss, and Copy buttons on the summary card), described in T8 and T11 criteria; see Q3.
Out of scope: reviewer panel showing the user's comment, feedback analytics, per-user signal rate limits, sink-side redaction, an `edited` / `regenerated` producer in the example app (see Expansions).
Open risks: an app whose trace sinks do not include the local plugin (or whose trace export failed) has no `ObsTrace`, so feedback returns 404 and is lost (clients ignore it silently); comments may hold PHI and reach external sinks (accepted in D1); `/ai/example-summarize` stops returning 503 without a key and answers with the scripted demo reply instead (example app only).
Elephant: the existing `addTracesToDataset` copies a trace's output into `expectedOutput` and marks non-sensitive traces proofread. Today nobody pulls thumbs-down traces into datasets because nothing writes those scores. Once T2 ships, the obvious triage flow ("filter thumbs down → Add to dataset") would label known-bad outputs as gold and feed them straight into experiment gates. T7 fixes it, so T7 must not slip out of this release.

## E2E tests

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `example-frontend/e2e/ai-feedback.spec.ts` | browser | With no model key on the backend (the e2e setup), a user summarizes todos against the real `/ai/example-summarize` (demo model, real trace), taps Thumbs down, types a comment, and taps Send. An admin then sees that trace under Traces with Thumbs = Down, with the comment in its Scores section, and as a pending `feedback` item in the Review queue | T11 |
| E2 | `example-frontend/e2e/ai-chat.spec.ts` (new test) | browser | Against the unmocked backend demo agent (no `mockGptStream*` helper, so `/gpt/prompt` writes a real history and trace), a user gives a chat reply Thumbs down with a comment. The reply's trace in admin shows a `thumbs_up` = false `user-feedback` score carrying that comment | T12 |

The copy signal is proven in-process (T9 and T11 component tests, T3 route test) rather than end to end, because clipboard access in headless Chromium needs permission flags the suite does not set. Keep and Dismiss are proven in the T11 component test against the generated hook.

## Regression cases

None — no hard-to-automate change. Every new control is built from existing cross-platform `@terreno/ui` components, and the component tests render them with the React Native renderer. Native copy reuses GPTChat's existing Copy message path.

## User guide

| ID | Page | Change | Audience | Written in |
| --- | --- | --- | --- | --- |
| G1 | `docs/user-guide/todos/summarize-todos.md` | new | user | T11 |
| G2 | `docs/user-guide/ai/chat.md` | update | user | T12 |
| G3 | `docs/user-guide/admin/review-ai-feedback.md` | new | admin | T10 |

## Design

None — no canvas. The visible changes are: a comment field and Send button that appear under the existing thumbs after a selection (T8, reused by GPTChat in T9), and Keep, Dismiss, and Copy buttons in a row under the summary on the example summary card (T11). All are built from `TextField` and `Button`. GPTChat's existing Copy message button (`gpt-copy-msg-{index}`) is reused, not redrawn. Q3 offers to draw them first.

## Assumptions

- The feedback route lives in `ai/src/observability/routes/traces.ts` beside `/traces/:id/scores`, built with `createOpenApiBuilder`. Observability routes are not a `modelRouter`, and the original design (`docs/implementationPlans/ai-observability.md`, line 424) put it there. Unlike every other route in that file, it does **not** use `observabilityRouteMiddleware` (which 403s every non-admin, `observabilityRouteAccess.ts:37-44`). It mounts `authenticateMiddleware()` plus the owner check in `recordTraceFeedback`, with or without `accessControl`.
- Score names: `thumbs_up` (boolean; matches the demo seed), `outcome` (categorical `tp`/`fp`/`tn`/`fn`), and one boolean `true` score per signal named `accepted`, `dismissed`, `copied`, `edited`, or `regenerated`. Signals are a fixed list; unknown names get 400.
- One feedback score per (trace, source, name) in the local store: a newer write replaces the older one. The local plugin is itself a ScoreSink (`LocalScoreSink`, `ai/src/observability/local/localPlugin.ts:80`), so the upsert lives in `LocalTraceStore.exportScore` for `user-feedback` and `user-signal` sources and the route writes through the sinks once, never separately. The upsert is one atomic `findOneAndUpdate({traceId, source, name, deleted: false}, ..., {upsert: true})` backed by a partial unique index on (traceId, source, name) for those two sources, so double taps cannot leave two live scores. It applies to any write with those sources, including admin `POST /traces/:id/scores`. Other sinks receive every write as it happens. A deselect (`thumbs: null`) soft-deletes the local score and sends nothing to other sinks, because `ScoreSink` has no delete.
- `outcome` and `flagDataset` were in the overview the request extended ("It accepts thumbs, outcome and flagDataset"), so they stay in scope. `flagDataset` only sets a flag operators filter on; it moves no data.
- A comment attaches to the thumbs or outcome score sent in the same request. A comment with neither gets 400 (Q9). On a `sensitive` trace, admin trace detail collapses the comment the same way it collapses I/O (Q8). Comments are trimmed, capped at 2000 characters (400 above that), and stored as `ScoreRecord.comment`.
- Permission: only the trace's own user may call the feedback route (`trace.userId === caller id`). Admins get 403 like any other non-owner and record scores through `POST /traces/:id/scores` instead, so a `user-feedback` score always means the end user said it and an admin vote never auto-enqueues review (Q6). A trace with no `userId` → 403. Missing trace → 404. No token → 401.
- `createTraceId()` returns a new ObjectId hex string. A `traceId` that is not 24-character hex throws 400 before any model call. A duplicate id (the trace already exists) logs `logger.error` and drops the second trace, the same way sink failures are handled today.
- `feedbackReview` is unset by default, so frameworks consumers opt in. The example backend sets it to `output-quality-questions`, the human question set its seed migrates legacy `correctness-human` queue items to (`seedAiObservabilityDemo.ts:739-742`).
- Auto-enqueue failures (unknown evaluator, non-human evaluator) log an error and never fail the feedback request.
- Chat: `chatTurn` mints the trace id before the model call and writes it on the assistant prompt row when the row is created, so it syncs to the client with the reply.

## Tasks

Shared contract from T2, extended by T3 and T4:

```typescript
// ai/src/observability/feedback.ts
export const FEEDBACK_SIGNALS = ["accepted", "dismissed", "copied", "edited", "regenerated"] as const;
export type FeedbackSignal = (typeof FEEDBACK_SIGNALS)[number];
export interface TraceFeedbackInput {
  comment?: string;             // ≤ 2000 chars after trim; needs thumbs or outcome
  flagDataset?: boolean;        // T3
  outcome?: "fn" | "fp" | "tn" | "tp"; // T3
  signal?: FeedbackSignal;      // T3
  thumbs?: "down" | "up" | null;
}
export interface TraceFeedbackResult {
  flaggedForDataset: boolean;
  reviewItemId?: string;        // T4
  scores: ScoreRecord[];        // the scores written by this call
  traceId: string;
}
export const recordTraceFeedback = async (args: {
  input: TraceFeedbackInput;
  traceId: string;
  user: {admin?: boolean; id: string};
}): Promise<TraceFeedbackResult>;
// POST /ai/observability/traces/:id/feedback → 200 {data: TraceFeedbackResult}
```

- [x] **T1** — Let callers choose the trace id and return it from example summarize
  - Depends on: none
  - Files: ai/src/types/index.ts, ai/src/service/aiService.ts, ai/src/service/aiService.observability.test.ts (new if absent), ai/src/observability/local/traceStore.ts, ai/src/observability/local/traceStore.test.ts, ai/src/index.ts, example-backend/src/api/ai.ts, example-backend/src/api/exampleSummarize.test.ts (new; resets the cached server service with a new `setAiService` export), docs/how-to/observe-llm-calls.md, example-backend/src/__snapshots__/openapi.test.ts.snap, docs/reference/ai.md
  - Criteria: `GenerateObservabilityOptions` gains `traceId?: string`; `createTraceId()` is exported from `@terreno/ai`. Every `generate*` method and `recordGenerate` (via its `observability` argument, so `resolveGenerateObservability({traceId})` carries it) pass it through to `TraceRecord.id` for the root trace. `LocalTraceStore.exportTrace` uses a valid ObjectId `trace.id` as `_id` and returns it; it keeps today's behavior when `id` is not an ObjectId. `/ai/example-summarize` mints an id and responds `{data: {output, traceId}}`. With no server model and no `x-ai-api-key`, it uses `createDemoAgentService()` instead of returning 503, the way chat already does. The OpenAPI snapshot is updated. Reference docs list the option and the response field.
  - Seam: `AIService.generateText` with the local plugin registered; `POST /ai/example-summarize` (HTTP)
  - Interface: `createTraceId(): string` (24 hex chars). `generateText({prompt, traceId, userId})` → string, unchanged. `POST /ai/example-summarize {text}` → `200 {data: {output: string, traceId: string}}`.
  - Cases:
    - `traceId = createTraceId()`, mock model → `ObsTrace.findById(traceId)` exists with that `userId`
    - no `traceId` → a trace is still written with a generated `_id` (today's behavior)
    - `traceId: "abc"` → throws 400 `traceId must be an object id`, and the model is not called
    - same `traceId` twice → second call returns its text; one `ObsTrace` exists; `logger.error` called once
    - `skipTrace: true` with `traceId` → no trace written, no error
    - `exportTrace({id: <uuid>})` → stored with a generated ObjectId (uuid ignored)
    - `resolveGenerateObservability({traceId})` then `recordGenerate({observability, ...})` → `ObsTrace._id === traceId`
    - summarize route with mock service → response `traceId` matches an `ObsTrace` whose `prompts[0].name` is `example-summarize`; empty `text` → 400
    - summarize route with no server model and no key header → 200 with the demo reply text and a `traceId` whose `ObsTrace` exists
  - Blast radius: span export reads the trace `_id` for `traceId` on spans → span case in traceStore.test.ts; the multi-stage smoke route passes its own trace through `exportTrace` → existing testMultiStage tests must stay green.
  - Test skills: terreno-backend-tests

- [x] **T2** — Record thumbs and comments through an owner-scoped feedback route (tracer)
  - Depends on: T1
  - Files: ai/src/observability/feedback.ts, ai/src/observability/feedback.test.ts, ai/src/observability/routes/traces.ts, ai/src/observability/routes/traces.test.ts, ai/src/observability/local/traceStore.ts, ai/src/index.ts, example-backend/src/__snapshots__/openapi.test.ts.snap, docs/reference/ai.md
  - Criteria: `POST /ai/observability/traces/:id/feedback` exists with the shared contract. Its OpenAPI request and response schemas declare the full contract (`thumbs`, `comment`, `outcome`, `signal`, `flagDataset`; `reviewItemId`) now, so T3 and T4 change behavior without touching the snapshot. This task implements thumbs and comment; the other fields get 400 `not supported yet` until T3. Only the trace's own user may call it. Thumbs writes `{name: "thumbs_up", dataType: "boolean", source: "user-feedback", value: thumbs === "up", comment}` to every ScoreSink, and the local store upserts on (traceId, source, name). `thumbs: null` soft-deletes the local `thumbs_up` score. The reference line that says the route records outcome and flag-for-dataset "(phase 2.6)" is replaced by the real contract for what ships.
  - Seam: `POST /ai/observability/traces/:id/feedback` (HTTP, with `ObservabilityApp` + local plugin)
  - Interface: body `TraceFeedbackInput` (thumbs, comment) → `200 {data: {traceId, scores, flaggedForDataset}}`; the request must carry at least one field.
  - Cases:
    - owner, `{thumbs: "down", comment: "  Dropped one of my todos  "}` → 200; one `ObsScore` with `value: false`, `source: "user-feedback"`, `comment: "Dropped one of my todos"`
    - owner then `{thumbs: "up"}` → still one `thumbs_up` score, now `value: true`, `comment` unset
    - owner `{thumbs: null}` → 200, `scores: []`; no live `thumbs_up` score remains
    - a registered extra ScoreSink receives each non-null write, comment included
    - owner who is not an admin → 200, both with no `accessControl` and with RBAC `accessControl` set on `ObservabilityApp`
    - other non-admin user → 403; legacy admin who is not the owner → 403; no token → 401
    - trace with no `userId` → 403
    - with only the local plugin registered, one thumbs write produces exactly one `ObsScore` (no double write through sink plus store)
    - two concurrent `{thumbs: "down"}` requests → exactly one live `thumbs_up` score
    - unknown trace id → 404; malformed id → 400
    - `{}` → 400; `{comment: "x"}` → 400 `comment needs thumbs or outcome`; `thumbs: "meh"` → 400; 2001-char comment → 400
  - Blast radius: the trace list's `hasScore` filter and `scores` sort read `ObsScore` → a list case asserting a thumbs-scored trace matches `hasScore=true` and a deselected one does not; trace detail lists scores → detail case shows the comment.
  - Test skills: terreno-backend-tests

- [x] **T3** — Add outcome, flag-for-dataset, and passive signals
  - Depends on: T2
  - Files: ai/src/observability/feedback.ts, ai/src/observability/feedback.test.ts, ai/src/observability/types.ts, ai/src/types/observability.ts, ai/src/observability/local/models/obsScore.ts, ai/src/observability/routes/traces.test.ts, docs/reference/ai.md
  - Criteria: `ScoreRecord.source` and the `ObsScore` enum gain `"user-signal"`. `outcome` writes a categorical `outcome` score (`user-feedback`, upserted, takes `comment`). `signal` writes a boolean `true` score named after the signal with `source: "user-signal"`, upserted. `flagDataset: true` sets `ObsTrace.flaggedForDataset`; `false` clears it. One request may combine fields. Reference docs list sources, names, and values.
  - Seam: `POST /ai/observability/traces/:id/feedback`
  - Interface: full `TraceFeedbackInput` minus review → `TraceFeedbackResult` without `reviewItemId`.
  - Cases:
    - `{signal: "dismissed"}` → score `{name: "dismissed", source: "user-signal", dataType: "boolean", value: true}`
    - `{signal: "copied"}` twice → one `copied` score
    - `{signal: "liked"}` → 400 listing the allowed signals
    - `{outcome: "fp", comment: "Not a crisis"}` → categorical `outcome` score `"fp"` with the comment; `outcome: "xx"` → 400
    - `{flagDataset: true}` → `flaggedForDataset: true` in the response and on `ObsTrace`; then `{flagDataset: false}` → false
    - `{thumbs: "down", signal: "regenerated", flagDataset: true}` → two scores and the flag, in one 200
    - an existing `POST /traces/:id/scores` call with `source: "user-signal"` is accepted (enum widened everywhere)
  - Blast radius: admin trace types render `source` (T10 owns the UI); the dataset store and review store do not read `source` today → none beyond the enum.
  - Test skills: terreno-backend-tests

- [ ] **T4** — Enqueue thumbs-down traces for human review
  - Depends on: T3
  - Files: ai/src/observability/feedback.ts, ai/src/observability/feedback.test.ts, ai/src/observability/types.ts, ai/src/observability/observabilityApp.ts, ai/src/observability/observabilityApp.test.ts, ai/src/observability/observabilityAppRegistry.ts, ai/src/observability/local/reviewStore.ts, ai/src/observability/local/reviewStore.test.ts, docs/how-to/observe-llm-calls.md
  - Criteria: `ObservabilityAppOptions.feedbackReview?: {evaluatorName: string}`. With it set, `thumbs: "down"` enqueues the trace (`reason: "feedback"`) for the named human evaluator and returns `reviewItemId`, unless a `pending` or `in_progress` item already exists for that trace and evaluator. Then it returns the existing item's id. Thumbs up, signals, and outcomes never enqueue. An unknown or non-human evaluator logs `logger.error` and the feedback still returns 200 without `reviewItemId`. Unset → no enqueue. The how-to documents the option.
  - Seam: `POST /ai/observability/traces/:id/feedback` with `ObservabilityApp({feedbackReview})`
  - Interface: `TraceFeedbackResult.reviewItemId?: string`; `LocalReviewStore.findOpen({traceId, evaluatorId}) → ReviewListItem | undefined`
  - Cases:
    - option set to a seeded human evaluator, thumbs down → one `ObsReviewItem` `{status: "pending", reason: "feedback"}`; response has its id
    - thumbs down again (or down → up → down) → still one open item; same id returned
    - existing item `done`, then thumbs down → a second, pending item
    - thumbs up → no item
    - option names a missing evaluator → 200, no `reviewItemId`, `logger.error` called
    - option names an `llm-judge` evaluator → 200, no item, error logged
    - option unset → no item
  - Blast radius: the review queue list and its counts read `ObsReviewItem` → a `GET /ai/observability/review` case shows the item under Pending with reason `feedback`.
  - Test skills: terreno-backend-tests

- [ ] **T5** — Filter traces by thumbs, signal, and comment
  - Depends on: T3
  - Files: ai/src/observability/local/traceStore.ts, ai/src/observability/local/traceStore.test.ts, ai/src/observability/routes/traces.ts, ai/src/observability/routes/traces.test.ts, example-backend/src/__snapshots__/openapi.test.ts.snap, docs/reference/ai.md
  - Criteria: `GET /ai/observability/traces` accepts `thumbs=up|down`, `signal=<FeedbackSignal>`, and `hasComment=true|false` (a live `user-feedback` score with a non-empty comment). They combine with every existing filter. Invalid values get 400. Reference docs list them.
  - Seam: `GET /ai/observability/traces` (HTTP)
  - Interface: query params above → existing list envelope `{data, limit, more, page, total}`
  - Cases:
    - traces A (thumbs down, comment), B (thumbs up), C (dismissed), D (none) → `thumbs=down` → [A]; `thumbs=up` → [B]; `signal=dismissed` → [C]; `hasComment=true` → [A]; `hasComment=false` → [B, C, D]
    - `thumbs=down&prompt=example-summarize` → only A when A is that prompt
    - deselected thumbs (soft-deleted score) does not match `thumbs=down`
    - `thumbs=sideways` → 400; `signal=liked` → 400
  - Blast radius: none (read-only filter).
  - Test skills: terreno-backend-tests

- [ ] **T6** — Store trace ids on chat replies and turn chat ratings into scores
  - Depends on: T2 (calls `recordTraceFeedback`), T4 (chat thumbs down must auto-enqueue through the registry), T5 (both write the OpenAPI snapshot and `docs/reference/ai.md`)
  - Files: ai/src/models/gptHistory.ts, ai/src/types/index.ts, ai/src/service/chatTurn.ts, ai/src/service/chatTurn.test.ts, ai/src/routes/gpt.ts, ai/src/routes/gpt.test.ts, ai/src/routes/gptHistories.ts, example-backend/src/__snapshots__/openapi.test.ts.snap, docs/reference/ai.md
  - Criteria: each assistant prompt row gains `traceId` (string, described). `chatTurn` mints one id per turn, passes it to `recordGenerate`, and writes it on the assistant row. `PATCH /gpt/histories/:id/rating` accepts optional `comment`. When the rated row has a `traceId` and the trace exists, it also calls `recordTraceFeedback` with `{thumbs, comment}` (so a down rating also auto-enqueues per T4). A missing trace never fails the rating. Reference docs cover the field and body.
  - Seam: `POST /gpt/prompt` (SSE) then `PATCH /gpt/histories/:id/rating` (HTTP)
  - Interface: rating body `{promptIndex: number, rating: "up" | "down" | null, comment?: string}` → `200 {data: {promptIndex, rating}}`
  - Cases:
    - chat turn with mock model and local plugin → assistant row has `traceId`; `ObsTrace.findById(traceId)` exists with the user's id
    - rate that row `down` with comment → history row `rating: "down"`; `thumbs_up` score `false` with the comment on that trace
    - rate `null` → history rating unset; score soft-deleted
    - with `feedbackReview` set on the registered `ObservabilityApp`, rating `down` → one pending `ObsReviewItem` with `reason: "feedback"` for that trace
    - row with no `traceId` (old history) → 200; history updated; no score
    - row whose `ObsTrace` was deleted (stands in for an app with no local trace sink) → 200; history updated; no score; no error to the client
    - another user rates → 403 `Not authorized to access this history`; comment over 2000 chars → 400
  - Blast radius: `gpt/histories` is a synced collection → `syncDbSdk` gets the new optional field after T11 regenerates; `GptHistory` `strict: "throw"` must accept `traceId` on create → model case; history PATCH by owners must not set `traceId` (drop it like `pendingAsk`) → route case.
  - Test skills: terreno-backend-tests

- [x] **T7** — Carry user feedback into dataset items
  - Depends on: T3
  - Files: ai/src/observability/local/datasetStore.ts, ai/src/observability/local/datasetStore.test.ts, ai/src/observability/routes/datasets.test.ts, docs/explanation/ai-observability.md
  - Criteria: `addTracesToDataset` reads each trace's live `user-feedback` and `user-signal` scores. A trace with `thumbs_up = false`, `outcome` `fp`/`fn`, or a `dismissed` signal lands `proofread: false` with tag `user:thumbs-down`, `user:false-positive`, `user:false-negative`, or `user:dismissed` (each that applies). Every item from a trace that has user feedback gets `metadata.userFeedback: {thumbs?, outcome?, comment?, signals: string[]}`. Traces without feedback behave as today. The explanation page says why.
  - Seam: `POST /ai/observability/traces/add-to-dataset` (HTTP)
  - Interface: unchanged request; items gain the tags and `metadata.userFeedback`
  - Cases:
    - non-sensitive trace with thumbs down plus comment "Too long" → item `proofread: false`, tags include `user:thumbs-down`, `metadata.userFeedback = {thumbs: "down", comment: "Too long", signals: []}`
    - non-sensitive trace with thumbs up and `copied` → `proofread: true`, no `user:` tags, `metadata.userFeedback = {thumbs: "up", signals: ["copied"]}`
    - trace with `dismissed` only → `proofread: false`, tag `user:dismissed`
    - trace with no scores → today's item exactly (`proofread: !sensitive`, `tags: []`, no `metadata.userFeedback`)
    - an experiment run on the dataset without `includeUnproofread` skips the thumbs-down item
  - Blast radius: the experiment runner reads `proofread` → the experiment-skip case above; the dataset detail view shows tags (no UI change needed).
  - Test skills: terreno-backend-tests

- [x] **T8** — Let ThumbsUpDownFeedback take an optional comment
  - Depends on: none
  - Files: ui/src/FeedbackCommentField.tsx, ui/src/FeedbackCommentField.test.tsx, ui/src/ThumbsUpDownFeedback.tsx, ui/src/ThumbsUpDownFeedback.test.tsx, ui/src/Common.ts, ui/src/index.tsx, demo/stories/ThumbsUpDownFeedback.stories.tsx, demo/story-config/ThumbsUpDownFeedback.config.tsx, docs/reference/ui.md
  - Criteria: new optional props `onCommentSubmit?: (comment: string) => void | Promise<void>`, `commentPlaceholder?: string` (default "Tell us more (optional)"), and `comment?: string` (already-sent text). With `onCommentSubmit` set and a value selected, a multiline `TextField` and a **Send** button render under the thumbs. The field is its own exported component, `FeedbackCommentField` (`ui/src/FeedbackCommentField.tsx`, props `{onSubmit, placeholder?, sentComment?, testID}`), which `ThumbsUpDownFeedback` renders and GPTChat reuses in T9. Send is disabled while the trimmed text is empty or a send is in flight, then shows "Thanks for the feedback" in place of the field. Deselecting hides the field. Without `onCommentSubmit` nothing changes. Built only from cross-platform `@terreno/ui` components (no web-only code). The demo story shows it, and the reference documents the props.
  - Seam: rendered component (`renderWithTheme`, React Native renderer)
  - Interface: props above; testIDs `{testID}-comment-input`, `{testID}-comment-send`, `{testID}-comment-sent`
  - Cases:
    - no `onCommentSubmit`, select negative → no comment input
    - `onCommentSubmit`, no value → no input; select negative → input visible
    - type "  Too long  ", press Send → called once with "Too long"; then `-comment-sent` visible
    - empty or whitespace text → Send disabled
    - `onCommentSubmit` rejects → input stays with the text; Send enabled again
    - deselect after selecting → input hidden
    - `comment="Too long"` with a value → shows the sent state, not the input
  - Blast radius: `AiSuggestionBox` and `Popover` render `ThumbsUpDownFeedback` without the new prop → their existing tests stay green.
  - Test skills: terreno-frontend-tests

- [x] **T9** — Add rating comments and a copy signal to GPTChat
  - Depends on: T8
  - Files: ui/src/GPTChat.tsx, ui/src/GPTChat.test.tsx, docs/reference/ui.md
  - Criteria: `GPTChat` gains `onRateComment?: (promptIndex: number, comment: string) => void | Promise<void>` and `onMessageSignal?: (promptIndex: number, signal: "copied") => void`. With `onRateComment`, a rated assistant message renders T8's `FeedbackCommentField` under GPTChat's own `RatingButtons` (`ui/src/GPTChat.tsx:893`), which stay as they are, so the existing rating testIDs do not change. `GPTChatMessage.ratingComment?: string` shows the sent state. The existing Copy message button (`handleCopyMessage`, `gpt-copy-msg-{index}`, `ui/src/GPTChat.tsx:926-946`) calls `onMessageSignal(index, "copied")` after a successful copy. Without the new props, rendering is unchanged.
  - Seam: rendered `GPTChat`
  - Interface: props above; testIDs `gpt-rating-comment-{index}-input`, `-send`, `-sent`
  - Cases:
    - `onRateComment` set, message rated down → comment input for that index; Send with "Wrong date" → called with (index, "Wrong date")
    - unrated message → no comment input
    - `ratingComment` set → sent state shown
    - Copy message with a mocked clipboard → `onMessageSignal(index, "copied")` once; clipboard failure → not called
    - no new props → no comment input; copy still works
  - Blast radius: message indexes must keep matching stored `prompts` rows (hidden ask tool-result rows) → a case with a hidden row before the rated message uses the stored index.
  - Test skills: terreno-frontend-tests

- [ ] **T10** — Show feedback filters, sources, and comments in admin Traces
  - Depends on: T5
  - Files: admin-frontend/src/widgets/aiObservability/traces/AiTracesListView.tsx, admin-frontend/src/widgets/aiObservability/traces/AiTraceDetailView.tsx, admin-frontend/src/widgets/aiObservability/traces/traceTypes.ts, admin-frontend/src/widgets/aiObservability/traces/traceTypes.test.ts, admin-frontend/src/widgets/aiObservability/traces/useAiObservabilityTracesApi.ts, admin-frontend/src/widgets/aiObservability/traces/useAiObservabilityTracesApi.test.ts, admin-frontend/src/widgets/aiObservability/traces/AiTraceDetailView.test.tsx, admin-frontend/src/isolated/aiObservabilityTraces.isolated.tsx, docs/how-to/ai-feature-development.md, docs/user-guide/admin/review-ai-feedback.md, docs/user-guide/README.md
  - Criteria: the Traces list gains **Thumbs** (Any / Up / Down), **Signal** (Any / each signal), and **Has comment** filters that send T5's params. Trace detail's Scores rows show a source badge (`User`, `Signal`, `Human`, `Judge`, `Code`) and the comment under the score when present. On a `sensitive` trace the comment starts collapsed, behind the same disclosure as I/O (`AiTraceDetailView.tsx:91`). The how-to's step 8 names the filters that now exist. G3 explains, in on-screen words, how an admin finds thumbs-down answers and their comments under **AI Observability → Traces** and works the **Review** queue items they create, and is indexed.
  - Seam: rendered list and detail views with the isolated fake API
  - Interface: `TRACE_FILTER_FIELDS` gains `thumbs`, `signal`, `hasComment`; `buildTraceListQuery` maps them to query params
  - Cases:
    - select Thumbs = Down → request has `thumbs=down`; Any → param absent
    - Signal = Dismissed → `signal=dismissed`
    - detail with a `user-feedback` score with comment "Too long" → badge `User`, text "Too long" visible (`ai-trace-score-comment-{i}`)
    - detail with a `user-signal` `copied` score → badge `Signal`, no comment row
    - no scores → "No scores on this trace." unchanged
    - `sensitive: true` trace with comment "Too long" → comment hidden until the disclosure is opened
  - Blast radius: none (UI reads only).
  - Test skills: terreno-frontend-tests

- [ ] **T11** — Wire feedback into the example summary card and prove the loop end to end
  - Depends on: T4, T6, T8, T10
  - Files: example-frontend/components/TodoSummaryCard.tsx, example-frontend/components/TodoSummaryCard.test.tsx, example-frontend/store/apiSdk.ts, example-frontend/store/syncDbSdk.ts, example-backend/src/server.ts, example-frontend/e2e/ai-feedback.spec.ts, docs/user-guide/todos/summarize-todos.md, docs/user-guide/README.md
  - Criteria: the backend passes `feedbackReview: {evaluatorName: "output-quality-questions"}`. After `bun run sdk` and `bun run sync-sdk`, the summary card shows, under a summary, thumbs plus the comment field and a row of **Keep**, **Dismiss**, and **Copy** buttons. They call the feedback route through a generated hook: thumbs, comment, `signal: "accepted"` (Keep), `signal: "dismissed"` (Dismiss, which also hides the summary), and `signal: "copied"` (Copy, via `expo-clipboard`, already a dependency of example-frontend). A new summary resets them. Feedback errors log `console.warn` and do not hide the summary. E1 passes. G1 is written to the guide bar and indexed.
  - Seam: rendered `TodoSummaryCard` with a mocked request client; E1 in the browser
  - Interface: generated `usePostAiObservabilityTracesByIdFeedbackMutation` (name as generated); testIDs `todos-summary-feedback`, `todos-summary-keep`, `todos-summary-dismiss`, `todos-summary-copy`
  - Cases:
    - summary shown → thumbs, Keep, Dismiss, and Copy visible; before a summary → none of them
    - Thumbs down → mutation called with `{id: traceId, body: {thumbs: "down"}}`; then Send "Missed a todo" → `{thumbs: "down", comment: "Missed a todo"}`
    - Keep → `{signal: "accepted"}`; Keep shows as pressed
    - Dismiss → `{signal: "dismissed"}`; `todos-summary-output` no longer visible
    - Copy → clipboard set to the summary; mutation called with `{signal: "copied"}`
    - mutation 404 → summary still visible; no error text
    - Summarize again → thumbs cleared
    - E1 as in the E2E table
  - Blast radius: `apiSdk.ts` / `syncDbSdk.ts` regeneration touches every generated hook → `bun run --cwd example-frontend compile` and the existing unit suite stay green; the seed's review items are unaffected (seed writes directly).
  - Test skills: terreno-frontend-tests

- [ ] **T12** — Send rating comments and copy signals from the example chat
  - Depends on: T9, T11
  - Files: example-frontend/app/(tabs)/ai.tsx, example-frontend/types/gptHistory.ts, example-frontend/e2e/ai-chat.spec.ts, docs/user-guide/ai/chat.md
  - Criteria: the chat screen passes `onRateComment` (re-posts the rating with `comment`) and `onMessageSignal` (posts `signal: "copied"` to the message's `traceId` when present). It maps `prompts[n].traceId` and the sent comment onto messages. E2 passes against the backend demo agent with no `mockGptStream*` helper. G2 adds the comment step.
  - Seam: E2 in the browser (the screen has no unit harness)
  - Interface: as T6 and T9
  - Cases: E2; a message with no `traceId` (older chat) copies without a network call (asserted in E2 by counting requests to `/feedback`)
  - Blast radius: the existing rating test in `ai-chat.spec.ts` (mock stream, rating 400) must still pass.
  - Test skills: terreno-frontend-tests

- [ ] **T13** — Document the feedback loop end to end
  - Depends on: T7, T11
  - Files: docs/how-to/ai-feature-development.md, docs/explanation/ai-observability.md, docs/reference/ai.md, docs/implementationPlans/ai-observability.md
  - Criteria: how-to steps 1, 7, and 8 describe the shipped route, sources, auto-review option, filters, and dataset intake rules, with one minimal client example (`createTraceId` → route returns `traceId` → feedback call). The explanation's 8-step loop names both sources and says why thumbs-down items land unproofread. Every "phase 2.6" or "filters land with task 2.6" placeholder is replaced or removed. `bun run check:links` (or the repo's docs check) passes.
  - Seam: docs
  - Interface: none
  - Cases: none (untestable: prose; Roast checks each named route, param, and field against the code)
  - Blast radius: none
  - Test skills: none

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q1 | Should a thumbs down without `feedbackReview` configured fall back to a default human evaluator (e.g. `correctness-human` if it exists)? | No — opt-in only | A framework default that silently fills a queue nobody watches is worse than none; the option is one line | T4 adds a lookup fallback and a test | T4, T11 |
| Q2 | Should `dismissed` (passive) also auto-enqueue review like thumbs down? | No | Dismissals are high-volume and ambiguous; they would flood the queue. They stay filterable (T5) | T4 enqueues on `dismissed` too, maybe behind a second option | T4 |
| Q3 | Draw the comment field on a design canvas before building? | No — build to the T8 criteria | It reuses `TextField` and `Button` under existing thumbs; the demo story and PR screenshots show it | Add a design checkpoint before T8; T8/T9 get `Design:` lines | T8, T9 |
| Q4 | Comments on thumbs up too, or only thumbs down? | Both | "Allow qualitative text" did not limit it, and praise tells you what to keep in the next version | T8 shows the field only for negative | T8, T9, T11 |
| Q5 | Should `edited` carry how much the user changed (e.g. 0–1 edit ratio) instead of `true`? | Boolean now | No surface in the repo edits AI output yet; a numeric shape is easy to add later without breaking `true` | T3 makes `edited` numeric and validates 0–1 | T3, T5 |
| Q6 | May an admin call the feedback route on someone else's trace? | No — owner only; admins use `POST /traces/:id/scores` | This reverses the locked design. It keeps `user-feedback` meaning "the end user said it", and stops admin test votes from filling the review queue. The original observability design (`docs/implementationPlans/ai-observability.md:424`) said owner or admin | T2 allows admins; T4 skips auto-enqueue when the caller is not the owner; two cases | T2, T4 |
| Q8 | On a sensitive trace, should the user's comment be collapsed in admin trace detail (like I/O) and still copied into `metadata.userFeedback` on dataset items? | Collapse in admin; copy into datasets | D1 covered sinks only. Collapsing matches how admin already treats sensitive I/O, and datasets already copy sensitive I/O and land it unproofread | T10 shows it plainly, or T7 omits the comment for sensitive traces | T7, T10 |
| Q9 | Should a user be able to leave a comment without a thumbs or outcome? | No — a comment attaches to a vote | The comment field appears after a vote, so every comment has a polarity to filter and triage on. Standalone text would need its own score shape | T2 accepts `{comment}` alone as a `comment` score (`user-feedback`, categorical); T8 shows the field before a vote | T2, T5, T8, T10 |
| Q7 | Should end users be able to set `flagDataset` at all? | Yes | It only sets a filterable flag; operators still choose what enters a dataset, and T7 marks negative items unproofread | T3 drops `flagDataset` from the user route (admins set it from Traces) | T3 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Review item screen shows the user's thumbs and comment next to the trace | Reviewers of `feedback` items need to know why the user objected | S | T4, T10 |
| X2 | Feedback analytics on the prompt hub: thumbs-up rate and signal rates per prompt version | Natural input to the promote decision | M | T5 |
| X3 | Signal rate limiting per user and trace | A buggy client could spam `copied` | S | T3 |
| X4 | Optional comment redaction hook for external ScoreSinks | D1 sends comments everywhere; a HIPAA app with a vendor sink may want a scrubber later | S | T2 |
| X5 | Wire `AiSuggestionBox` add/hide to `accepted`/`dismissed` in an example screen | The component already has the callbacks; the summary card (T11) now proves both signals, so this is only a second example | S | T3 |
| X6 | A producer for `edited` and `regenerated` in the example app (edit-before-save, Regenerate button) | The route accepts them (T3) but no example screen edits or regenerates AI output | M | T3 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 | User comments can contain PHI; should comments follow trace sensitivity, stay local only, or go to every ScoreSink? | Send everywhere | Comments are a normal `ScoreRecord.comment`; no redaction or sink filtering in T2; X4 parked |
| D2 (durable) | How should passive signals be recorded: new `user-signal` source, same `user-feedback` source, or a separate event model? | New source `user-signal` | T3 widens the source enum; T5 filters by signal; T10 shows a `Signal` badge |

## Sign-off

Status: approved 2026-11-17
Cut: 2 rounds, 20 findings: 17 fixed, 2 moved to questions (Q7, Q9), 1 rebutted (regression case: every new control is cross-platform `@terreno/ui` and component tests use the native renderer)
