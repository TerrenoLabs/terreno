# Planning regression suite

Area: PLAN
Owner: Josh Gachnang
Last full run: never

Every case here is retired: they checked agent behavior, not the app, which the minimal
regression rule leaves out. The rows stay so their IDs are never reused.

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| PLAN-001 | Grow plans e2e and regression | In a fresh session in a repo that has `docs/testing/e2e.md`, run Grow on "add a due date to todos" and approve it | Retired: an agent-behavior check, not an app check | Claude Code, Cursor, Codex | manual | e2e-and-regression-testing |
| PLAN-002 | Grow without a guide | Repeat PLAN-001 in a repo with no `docs/testing/e2e.md` and no Testing conventions table | Retired: an agent-behavior check, not an app check | Claude Code | manual | e2e-and-regression-testing |
| PLAN-003 | Brew writes the suite | Take an approved IP with one regression case through Brew | Retired: an agent-behavior check, not an app check | Claude Code | manual | e2e-and-regression-testing |
| PLAN-004 | Pick writes, Roast enforces a planned spec | Run Pick on a PLAN-001 task that owns an `## E2E tests` row. Then delete the spec file and run Roast | Retired: an agent-behavior check, not an app check | Claude Code | manual | e2e-and-regression-testing |
| PLAN-005 | Taste renumbers a collision | On a branch that added `AUTH-00N`, merge a master commit that also added `AUTH-00N`, then run Taste | Retired: an agent-behavior check, not an app check | Claude Code | manual | e2e-and-regression-testing |
