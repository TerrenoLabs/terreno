---
category: Added
---

- Review batches: pick a human question set and press **Grab 10 recent traces** to give reviewers a fixed set of inputs and outputs (`POST /ai/observability/review/batches`).
- The review item screen shows one input, one output, and every question as Yes / No rows. On web, `Y` / `N` answer the highlighted question, `Enter` submits and moves to the next batch item, and `S` skips. Evaluator dimensions accept a reviewer `question`.
- Run any LLM judge over a batch and see overall and per-question agreement with the human answers, plus a list of disagreements (`POST /ai/observability/review/batches/:id/judgeRuns`).
- The AI observability seed adds the `summary-review-questions` question set, two judges for it, and a 10-item batch with 8 answers where one judge agrees 97% and the other 78%.
