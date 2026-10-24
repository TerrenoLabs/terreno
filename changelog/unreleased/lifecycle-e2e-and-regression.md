---
category: Added
---

The `terreno-planning` lifecycle plugin (2.13.0) plans e2e tests and manual regression cases in every IP:

- Grow requires `## E2E tests` and `## Regression cases` sections (either may be `None — <reason>`), read from the e2e guide at `docs/testing/e2e.md` or a `## Testing conventions` override in AGENTS.md or CLAUDE.md.
- Pick writes each planned spec in the task that delivers it, and Roast runs it; a missing or failing row is `FAIL`.
- Brew gates on every planned spec and merges regression cases into `docs/regression/<area>.md` with the next free ID.
- Taste re-checks both sections after behaviour-changing fixes and renumbers regression ID collisions with `master`.
- `bun run check:lifecycle-skills` enforces these phrases in every stage.
