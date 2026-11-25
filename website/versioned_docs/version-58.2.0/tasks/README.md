# Task lists

Bot-consumable execution checklists. Most files pair with an implementation plan (IP)
as described in [`docs/implementationPlans/README.md`](../implementationPlans/README.md):

- **IP** (`docs/implementationPlans/<slug>.md`) — the design: what and why.
- **Task list** (`docs/tasks/<slug>.md`) — the steps: the concrete, ordered work.

The filename slug matches the IP it belongs to.

The loop's small-feature profile may use a task file with `**Feature profile:** true` and
no full IP when repository policy permits. The destination, scope, decisions, acceptance
criteria, tracer, and verification seam live in that durable contract so Pick can
implement one task, roast it, and continue to the next without conversation history.

## Task shape

Each task is a tracer-bullet vertical slice with explicit blocking edges:

```markdown
- [ ] **Task 1.1**: Short title
  - Delivers: the narrow end-to-end behavior this makes usable
  - Files: expected files to create or modify
  - Blocked by: none | other task IDs
  - Acceptance: observable proof, including focused Bun tests
```

Group tasks by phase (`### Phase 1: …`) and order them by dependency. Every normal task
cuts through the required data, API, UI, documentation, and test layers rather than
batching one layer across the whole feature. A completed task is demoable or independently
verifiable and small enough for one fresh agent context. Work the **frontier**: any task
whose blockers are complete.

Wide mechanical refactors that cannot land green as vertical slices use
**expand → migrate batches → contract**. The contract task is blocked by every migration
batch. Grow-style runs may append a **Plan vs Actual** log after each task.

## What lives here vs elsewhere

| Concern | Home |
| ------- | ---- |
| Design, scope, acceptance criteria | the IP (`docs/implementationPlans/`) |
| Concrete task steps and their status | this directory |
| Public status and target | GitHub roadmap issue / Project (roadmap-enabled repos) |
| Sprint estimates and assignees | Linear |
| Current stage/attempt/head/result | loop-owned execution state (default `.terreno/pipeline/<slug>.json`) |

Do not copy the full checklist into a GitHub issue or Linear. Create linked GitHub child
issues only for tasks that outside contributors should be able to claim independently; the
task file stays the source of truth for scope and acceptance.

The docs site excludes this directory, so link to task files with full GitHub URLs from
pages that render on the site.
