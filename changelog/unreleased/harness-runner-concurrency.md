---
category: Changed
---

`@terreno/ai/harness`: `InProcessRunner` now runs up to 8 claimed tasks at once (new `concurrency` option, default 8), each under its own task lease, and `stop()` waits for all of them. Expect parallel model calls (watch provider rate limits and cost) and more stream-counter transaction retries. Turns of one conversation stay serial. Pass `new InProcessRunner({concurrency: 1})` to keep the previous one-at-a-time behavior. See [AI harness reference → InProcessRunner](docs/reference/ai-harness.md#inprocessrunner).
