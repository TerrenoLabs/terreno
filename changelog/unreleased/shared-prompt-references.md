---
category: Added
---

- Observability registry prompts can reference other prompts with `{{> base-rules}}`, `{{> base-rules label=staging}}`, or `{{> base-rules version=3}}` (default label `production`). Shared instructions live in one prompt; `PromptRegistry.get`, the playground, experiments, and judges use the resolved text.
- Every reference must resolve when it is saved. Creating a prompt, saving a version, and moving a label return 400 `Invalid prompt reference` for a malformed tag, an unknown prompt or version, or a label the referenced prompt does not have yet, 400 `Prompt reference cycle` when the change would make prompts include each other, and 400 `Prompt references nested too deeply` when it would nest the prompt, or any prompt that includes it, more than 5 levels.
- Traces stay named after the called prompt. `ObsTrace.prompts` lists it first, then each shared prompt version it pulled in, marked with `includedBy`. `PromptVersionRef.includes` and harness prompt refs carry the same list.
