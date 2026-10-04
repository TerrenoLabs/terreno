---
category: Added
---

`@terreno/ai/harness/jobsRunner`: `JobsRunner` runs durable harness phases as `@terreno/jobs` jobs (`terreno.harness.phase`) on every instance, for multi-instance deploys such as Cloud Run. The task lease decides who commits, so duplicate or late jobs are harmless. `@terreno/jobs` is an optional peer; importing `@terreno/ai` never loads it. Adds `HarnessTask.claims` (default 0, no migration). See [Run the harness on multiple instances](docs/how-to/run-harness-on-multiple-instances.md).
