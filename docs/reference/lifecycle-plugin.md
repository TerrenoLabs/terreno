# Lifecycle plugin reference

Plugin: `terreno-planning` (`2.12.0`)

Planning skills are model-invocable: agents may select them from descriptions, not only
from slash commands. Grow, Brew, and Taste each implement one bounded transition. Pick continues an inner loop until the
approved task list is done. Roast proves the current task and returns.
`terreno-pick-roast-loop`, `terreno-planning-loop`, and `terreno-taste-sweep` are outer
loops that invoke those stages; they are not stages and must not appear as `stage` values.

| Skill | Preconditions | Primary output | PASS next |
| --- | --- | --- | --- |
| `terreno-1-grow` | request/spec + repository | approved IP/tasks + criterion/verification map + standalone approval brief | Pick (enters inner loop) |
| `terreno-2-pick` | approved task + branch/state | one implemented slice, then Roast, then the next task | Roast, or Brew when the list is done |
| `terreno-3-roast` | Pick result + current diff | independent requirement/evidence verdict for the current task | emit Pick if tasks remain, else Brew; never invoke Pick; pass a task-scoped briefing; do not spawn two unconstrained reviewers |
| `terreno-4-brew` | Roast PASS for every in-scope task + branch/evidence | pushed head + PR + product-CI trigger check + review-bot wait + attached evidence | Taste |
| `terreno-5-taste` | PR + current state | one current-head reaction; before push: fetch latest `master` (merge only when needed), re-verify last-run failed tests locally, run root `prepush` when present (otherwise affected-package checks) in a no-context subagent, then watch CI; invoked directly, repeats bounded reactions until terminal | null or fresh Taste |

Outer loops (not stages):

| Skill | What it walks | Default |
| --- | --- | --- |
| `terreno-pick-roast-loop` | Approved task list through Pick/Roast recovery | Continue every actionable engineering retry; report once when all tasks pass or a genuine human gate is reached. |
| `terreno-planning-loop` | Approved task list | Grow once, then Pick once (inner pick-roast loop). Pass `phases=` to restrict (`grow`, `pick`, `roast`, `brew`, `taste`). |
| `terreno-taste-sweep` | Author's open broken PRs | Isolate each conflicting or failing (any discovered CI host) non-draft PR and reinvoke Taste until mergeable or blocked. |

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
When the current PR has GitHub Deployments, those demo URLs are the last visible
section of every wait-for-human or done chat.

The outer loop owns state persistence, Taste `PENDING` reinvocation, Grow/Brew/Taste
invocation, retries, and escalation. Pick owns the
[pick-roast inner loop](https://github.com/TerrenoLabs/terreno/blob/master/plugins/terreno-planning/references/pick-roast-loop.md):
one task, roast it, next task. Roast never invokes Pick. Do not start the next task
until Roast PASS. Exactly one driver continues after each Roast. Brew and Taste wait
until async review bots (Bugbot, CodeQL, and similar) on the current head have reported,
preferring provider CLI watch hooks or harness event subscriptions over sleep polling.
Taste then waits in a loop for product CI using GitHub CLI (`gh pr checks --watch`,
`gh run watch`) or CircleCI CLI (`circleci run watch`) until jobs are terminal or the
wait times out. Before any push, Taste fetches latest `master` (merging it only when needed), records last-run
failed tests and re-verifies them locally, then spawns a
fresh subagent with no parent conversation. If the repository root defines a `prepush`
package script, Taste runs it as the authoritative local gate; otherwise it falls back
to lint, typecheck, and locally affected tests in each affected package. Taste then
pushes and watches product CI.
Taste observes product CI on every discovered host (GitHub Actions, CircleCI,
Buildkite, and similar), not only GitHub checks. A documented not-applicable host
counts as skipped; an unexplained untriggered host prevents Brew `PASS`. Brew still
does not execute Taste.

The focused Pick–Roast outer loop does not run Grow, Brew, Taste, or product CI. It
resumes only `pick` or `roast` from durable `next.stage`; a stored `brew` finishes the
loop without launching Brew, and `taste` or `grow` is `FAIL`. It keeps a
schema-defined execution-state `ledger` entry for every Pick/Roast task attempt,
including head/status/evidence and optional retry hypothesis, files, checks, artifacts,
docs, and risks, then presents that report once. It asks the human only
for an actual product/architecture/security/data/destructive/policy decision or
unreplaceable credential. Before asking, it gives the overall goal/state, completed
work, decisive evidence, two to four options with impact, and a recommendation; the
message ends with one exact question, then PR deployment URLs when a PR has them.

Grow's human-facing output is a standalone approval brief, not an index. It opens with a
paragraph on where the repository is and where the change takes it, adds background on
current state when a reviewer needs it, then the idea, then the plan (tasks, tracer,
verification, out of scope, risks). A Decisions table follows the plan with no row cap,
pairing every settled human decision with the question that prompted it; it is omitted
when grilling settled none. Paths to the IP and task files come last.

GitHub communication follows a fixed attention budget. The PR title is
`[ticket] Short feature title` (Linear `TEAM-n` or GitHub `#n`; omit brackets when
no ticket is attached) and names the feature only — never `feat:`, `IP Approved`,
or `Task list`. `Why` preserves the IP's initial justification, `What changed`
briefly describes the approved IP and intended outcomes, and `Verification` always
contains reproducible testing instructions. Brew updates verification as testing
changes but otherwise keeps the body stable instead of summarizing the latest turn.
These are the only visible PR sections; optional detail is expandable; comments are
reserved for blocked decisions or non-obvious review resolutions.

Every stage follows the
[documentation contract](https://github.com/TerrenoLabs/terreno/blob/master/plugins/terreno-planning/references/documentation-contract.md):
read architecture docs before acting, update them in the same slice, and fail the slice
when user-visible or architectural behavior ships without matching docs. Brew and Taste
observe product CI per
[product-ci.md](https://github.com/TerrenoLabs/terreno/blob/master/plugins/terreno-planning/references/product-ci.md).

Install the published skill set directly:

```bash
npx skills add TerrenoLabs/terreno
```

Or install the combined lifecycle and Terreno app plugin:

| Host | Plugin | Stage names | Invoke Pick–Roast loop |
| --- | --- | --- | --- |
| Cursor | `terreno-planning` | `terreno-1-grow` … `terreno-5-taste`, outer loops | `/terreno-pick-roast-loop` |
| Codex | `terreno-planning` | `terreno-1-grow` … `terreno-5-taste`, outer loops | `$terreno-pick-roast-loop` |
| Claude Code | `terreno` | `1-grow` … `5-taste`, outer loops | `/terreno:pick-roast-loop` |
| `npx skills` | — | Canonical stage and outer-loop names | `/terreno-pick-roast-loop` |

Cursor installs `terreno-planning` from [`.cursor-plugin/marketplace.json`](https://github.com/TerrenoLabs/terreno/blob/master/.cursor-plugin/marketplace.json). Codex:

```text
codex plugin marketplace add TerrenoLabs/terreno
codex plugin install terreno-planning --source terreno-plugins
```

Codex reads [`.agents/plugins/marketplace.json`](https://github.com/TerrenoLabs/terreno/blob/master/.agents/plugins/marketplace.json)
and `.codex-plugin/plugin.json` on the canonical plugin. Claude Code:

```text
/plugin marketplace add TerrenoLabs/terreno
/plugin install terreno@terreno-plugins
```

Claude Code resolves a plugin skill's command from the frontmatter `name`, so the short
names ship as a generated Claude-only copy at
[`plugins/terreno-claude/`](https://github.com/TerrenoLabs/terreno/tree/master/plugins/terreno-claude).
Stage procedure, Terreno app skills, contracts, agents, and references are generated
from the canonical `plugins/terreno-planning/` tree.

Regenerate the committed `skills/` tree and the Claude plugin with `bun run skills:sync`.
Plugin skills are authoritative when names overlap. Package skills under
`<package>/.ai/skills/` remain package/MCP inputs and do not overlay the installable
tree.

The plugin bundles reusable backend/API, UI, data-fetching, schema, SDK, admin, prompt,
docs, upgrade, deployment, and UI-verification workflows, plus `pre-commit` and
`ui-verifier` agents on Cursor and Claude Code. Codex consumes the combined skills
without plugin-defined agents. Repository-local skills supply only project-specific
roadmap, release, and maintenance conventions discovered at stage start.
