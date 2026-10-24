# Planning regression suite

Area: PLAN
Owner: Josh Gachnang
Last full run: never

Walk these cases with this branch's planning plugin build in a scratch repository. Each case
starts from a fresh agent session.

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| PLAN-001 | Grow plans e2e and regression | In a fresh session in a repo that has `docs/testing/e2e.md`, run Grow on "add a due date to todos" and approve it | The IP has `## E2E tests` naming a spec path that follows the guide, and `## Regression cases` with at least one row in suite format | Claude Code, Cursor, Codex | manual | e2e-and-regression-testing |
| PLAN-002 | Grow without a guide | Repeat PLAN-001 in a repo with no `docs/testing/e2e.md` and no Testing conventions table | The IP includes a task that writes the e2e guide at `docs/testing/e2e.md` | Claude Code | manual | e2e-and-regression-testing |
| PLAN-003 | Brew writes the suite | Take an approved IP with one regression case through Brew | The PR diff adds that row to `docs/regression/<area>.md` with the next free ID, and the PR Verification section links it | Claude Code | manual | e2e-and-regression-testing |
| PLAN-004 | Pick writes, Roast enforces a planned spec | Run Pick on a PLAN-001 task that owns an `## E2E tests` row. Then delete the spec file and run Roast | Pick creates the spec at the row's path. Roast returns `FAIL` and names the missing row | Claude Code | manual | e2e-and-regression-testing |
| PLAN-005 | Taste renumbers a collision | On a branch that added `AUTH-00N`, merge a master commit that also added `AUTH-00N`, then run Taste | Taste renumbers the branch's row to the next free ID, and `check:regression-suites` passes before push | Claude Code | manual | e2e-and-regression-testing |
