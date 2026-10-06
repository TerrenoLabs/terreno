---
category: Added
---

`@terreno/ai` harness: `harness.createTask(def, input, {trace: {scope, tags}, prompts})` writes a scope (tenant, workspace), tags, and prompt versions onto the task's `ObsTrace`; child tasks and subagents share it. `ObsTrace` gains `scope` (indexed with `created`) and `tags`, and the admin trace list filters by `scope`. `rt.runAgent` takes `prompts` and accepts a registry `PromptVersionRef` as `instructions` (its `body` runs, its version is recorded). New subpath exports replace `dist/` deep imports: `@terreno/ai/admin`, `@terreno/ai/harness/{agentLoop,commit,events,internalRuntime}`, and `@terreno/ai/observability/{observabilityApp,localPlugin,promptStore}`. The root entry now registers the `Project` model on first use (`getProjectModel()`), and `new AiApp({projects: false})` skips the `/gpt/projects` routes, so apps can own a `Project` model. See [AI harness reference](docs/reference/ai-harness.md#trace-scope-and-prompt-versions). Closes #1533.
