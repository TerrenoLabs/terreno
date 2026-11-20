---
category: Added
---

- **@terreno/ai:** end users can give feedback on any AI output. `POST /ai/observability/traces/:id/feedback` (trace owner only) records thumbs with an optional comment and outcome class as `user-feedback` scores, passive signals (`accepted`, `dismissed`, `copied`, `edited`, `regenerated`) as the new `user-signal` score source, and `flagDataset`. `recordTraceFeedback` exposes the same logic to server code.
- **@terreno/ai:** `createTraceId()` and the `traceId` generate option let a route return an output's trace id. `/gpt/prompt` stores `traceId` on each assistant reply, and `PATCH /gpt/histories/:id/rating` accepts a `comment` and records the rating on the reply's trace.
- **@terreno/ai:** `ObservabilityApp({feedbackReview: {evaluatorName}})` queues every thumbs-down trace in the review queue with reason `feedback`.
- **@terreno/ai:** `GET /ai/observability/traces` filters by `thumbs`, `signal`, and `hasComment`. Adding a trace the user rejected to a dataset now lands it `proofread: false` with a `user:` tag and `metadata.userFeedback`, so known-bad outputs never become gold labels.
- **@terreno/ui:** `ThumbsUpDownFeedback` takes `onCommentSubmit` for an optional comment (new `FeedbackCommentField`), and `GPTChat` takes `onRateComment` and `onMessageSignal`.
- **@terreno/admin-frontend:** AI Observability Traces adds **Thumbs**, **Signal**, and **Has comment** filters, shows each score's source, and shows user comments (collapsed on sensitive traces).
- **@terreno/admin-frontend:** dataset items open with review steps and an explanation of the golden label. **Save and next** on a Needs review item opens the next unproofread item in list order (wrapping), and the last one returns to the Needs review tab. The dataset shows a golden-label note and a Needs review empty state, and `?tab=needsReview` opens that tab.
