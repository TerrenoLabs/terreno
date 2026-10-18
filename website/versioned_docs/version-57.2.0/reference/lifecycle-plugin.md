# Lifecycle plugin reference

Plugin: `terreno-planning` (`2.1.0`)

All five skills are explicitly invoked (`disable-model-invocation: true`) and implement
one bounded transition.

| Skill | Preconditions | Primary output | PASS next |
| --- | --- | --- | --- |
| `terreno-1-grow` | request/spec + repository | approved IP/tasks + criterion/verification map | Pick |
| `terreno-2-pick` | approved task + branch/state | implemented slice + tests/internal reviews | Roast |
| `terreno-3-roast` | Pick result + current diff | independent requirement/evidence verdict | Brew |
| `terreno-4-brew` | Roast PASS + branch/evidence | pushed head + PR + attached evidence | Taste |
| `terreno-5-taste` | PR + current state | one current-head reaction result | null or fresh Taste |

Every stage includes:

- Preconditions
- Inputs
- Procedure
- Supporting skills
- Evidence produced
- Success, failure, and blocked conditions
- Recommended next stage

Results use `PASS`, `FAIL`, `BLOCKED`, or `PENDING` and the compact `v: 2` schema
[`stage-result.schema.json`](https://github.com/TerrenoLabs/terreno/blob/master/plugins/terreno-planning/references/stage-result.schema.json)
(`v`, `stage`, `status`, `next`, `action`; omit empty keys). Loop state follows
[`execution-state.schema.json`](https://github.com/TerrenoLabs/terreno/blob/master/plugins/terreno-planning/references/execution-state.schema.json).
Chat and PRs show `status` / `next` / `action`; the YAML lives in a Details toggle.

The outer loop owns state persistence, waiting, stage invocation, retries, and escalation.
Brew exits after PR setup. Taste observes/acts once and exits.

GitHub communication follows a fixed attention budget: `Why`, `What changed`, and
`Verification` are the only visible PR sections; optional detail is expandable; comments
are reserved for blocked decisions or non-obvious review resolutions.

Every stage follows the
[documentation contract](https://github.com/TerrenoLabs/terreno/blob/master/plugins/terreno-planning/references/documentation-contract.md):
read architecture docs before acting, update them in the same slice, and fail the slice
when user-visible or architectural behavior ships without matching docs.

Install the published skill set (lifecycle stages plus repo and package skills):

```bash
npx skills add TerrenoLabs/terreno
```

Regenerate the committed `skills/` tree with `bun run skills:sync`. Package skills under
`<package>/.ai/skills/` overlay the repo copies.

Exact commands and domain conventions are supplied by repository-local skills discovered
at stage start; they are not bundled into the lifecycle plugin.

