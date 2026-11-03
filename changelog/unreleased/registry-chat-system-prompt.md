---
category: Added
---

- `addGptRoutes` accepts `systemPromptName` and `systemPromptLabel`. A chat turn prepends that observability registry prompt to the system prompt and records its version on the trace.
- The example chat reads `chat-assistant` and the `generate_joke` tool reads `joke-generator` from the observability prompt registry.
- `bun run backend:seed` fills every AI Observability screen: labelled prompt versions for `example-summarize`, `joke-generator`, and `chat-assistant`, golden datasets, finished experiments, traces with scores, and review items in every status. Run it on an existing database with the `seedAiObservabilityDemo` admin script.
