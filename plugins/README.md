# Terreno plugins

## `terreno-planning` — lifecycle plus Terreno app workflows

The reusable plugin exposes exactly five bounded lifecycle transitions. Cursor and Codex
install it as `terreno-planning`; Claude Code installs the generated `terreno-claude/`
copy as `terreno` (see [Hosts](#hosts)):

| # | Stage | Contract |
| --- | --- | --- |
| 1 | **Grow** (`terreno-1-grow`) | Research, clarify, shape, and approve the IP/tasks |
| 2 | **Pick** (`terreno-2-pick`) | Build one slice, roast it, then pick the next until the list is done |
| 3 | **Roast** (`terreno-3-roast`) | Prove the current task, then continue the pick-roast inner loop |
| 4 | **Brew** (`terreno-4-brew`) | Final checks, commit/push, PR/evidence, confirm product CI on every discovered host, wait for review bots, then exit |
| 5 | **Taste** (`terreno-5-taste`) | Wait for review bots and product CI, one current-head reaction; record last-run failed tests and re-verify them locally before push; fetch latest `master` (merge only when needed), then run root `prepush` when present (otherwise affected-package checks) in a no-context subagent, then push and watch; invoked directly, repeats bounded reactions until terminal |

Stages and outer loops are model-invocable; descriptions keep Pick/Brew/Taste from firing
on casual chat. Grow, Brew, and Taste never own the full orchestration. Pick and Roast own
the inner loop that implements one task, roasts it, then picks the next until the list is
done.

Three additional skills are **outer loops**, not stages. They invoke the five transitions
and persist state:

| Skill | Loop |
| --- | --- |
| **Pick–Roast loop** (`terreno-pick-roast-loop`) | Work an approved plan through every Pick/Roast retry, resume only Pick or Roast, collect one run ledger, and stop only when complete or genuinely blocked on human input. |
| **Planning loop** (`terreno-planning-loop`) | Walk Grow/Pick/Brew/Taste. Default Grow once, then Pick once (Pick owns pick-roast). Pass `phases=` to restrict. |
| **Taste sweep** (`terreno-taste-sweep`) | Find the author's open non-draft PRs that are conflicting or failing, isolate each one, and reinvoke Taste until mergeable or blocked. |

## `terreno-scan` — goal-driven code scans

An optional second plugin that turns a long-term outcome into measured work. It depends
on `terreno-planning`: scan stages discover and shape, the lifecycle implements and ships.

| # | Stage | Contract |
| --- | --- | --- |
| 1 | **Aim** (`terreno-scan-1-aim`) | Charter the goal: metric, measured baseline, dry-run detection rules, exclusions, validity rule, severity rubric, slice policy, budget |
| 2 | **Sweep** (`terreno-scan-2-sweep`) | Run the rules, shard the hits deterministically, map fresh parallel workers into candidate findings |
| 3 | **Sift** (`terreno-scan-3-sift`) | Dedupe, adversarially verify, drop what does not reproduce, rank, write the findings report |
| 4 | **Plot** (`terreno-scan-4-plot`) | Slice findings into PR-sized units with standalone Grow briefs, then hand the top slice to the lifecycle |
| 5 | **Track** (`terreno-scan-5-track`) | Re-measure the metric, close or reopen findings with evidence, record the round, choose the next move |

Two outer loops drive them:

| Skill | Loop |
| --- | --- |
| **Scan campaign** (`terreno-scan-campaign`) | Aim once, then Sweep → Sift → Plot → lifecycle → Track, round after round, until the metric hits target, the budget is spent, or a genuine human decision is required. Stops at each gate. |
| **Scan loop** (`terreno-scan-loop`) | Resident session: keeps the campaign moving **and** heartbeats over open campaign PRs — route, answer review through Taste, fix red CI, Track merges — refilling work up to `wipLimit`. Quiet ticks print nothing; each comment is answered exactly once. |

Aim settles who reviews the PRs before any PR exists (`fixed`, `codeowners`, `blame`,
`round-robin`, or an explicit `none`), verifies the handles, and records the `review`
block. The loop applies it right after Brew and re-requests review once when requested
changes are addressed. It never approves its own PRs and never merges under the default
`mergePolicy: human`.

```text
Aim PASS → Sweep → Sift
  Sift PASS (findings) → Plot → handoff: grow → Grow → Pick/Roast → Brew → Taste → Track
  Sift PASS (dry)      → Track
  Track PASS → Plot (backlog) | Sweep (empty) | null (target, budget, or regression)
  Track PENDING (slice in flight) → campaign waits → fresh Track
  Any BLOCKED → named human/external gate
```

No scan stage edits product code, commits, or opens a PR. Contracts and schemas:

- [`references/scan-contract.md`](terreno-scan/references/scan-contract.md)
- [`references/mapreduce.md`](terreno-scan/references/mapreduce.md)
- [`references/goal-tracking.md`](terreno-scan/references/goal-tracking.md)
- [`references/heartbeat.md`](terreno-scan/references/heartbeat.md)
- [`references/pr-routing.md`](terreno-scan/references/pr-routing.md)
- [`scan-result.schema.json`](terreno-scan/references/scan-result.schema.json)
- [`scan-state.schema.json`](terreno-scan/references/scan-state.schema.json)
- [`finding.schema.json`](terreno-scan/references/finding.schema.json)

Reference docs: [`docs/reference/scan-plugin.md`](../docs/reference/scan-plugin.md).

## Composition

```text
lifecycle stage
      +
repository/domain skills
      +
IP + task + execution state
      +
current evidence
```

The plugin owns portable stage method and transition contracts plus reusable Terreno app
workflows: backend/API, UI, data fetching, schema safety, SDK generation, admin, prompt
governance, docs, upgrades, deployment, and UI verification. Repository-local skills
own this monorepo's roadmap, release, maintenance, and other project-only operations.
Every stage discovers applicable skills by description.

The shared result/state format and outer state machine live in:

- [`references/lifecycle-contract.md`](terreno-planning/references/lifecycle-contract.md)
- [`references/pick-roast-loop.md`](terreno-planning/references/pick-roast-loop.md)
- [`references/subagent-briefing.md`](terreno-planning/references/subagent-briefing.md)
- [`references/documentation-contract.md`](terreno-planning/references/documentation-contract.md)
- [`references/async-review-bots.md`](terreno-planning/references/async-review-bots.md)
- [`references/product-ci.md`](terreno-planning/references/product-ci.md)
- [`references/loop-engineering.md`](terreno-planning/references/loop-engineering.md)
- [`references/github-attention-contract.md`](terreno-planning/references/github-attention-contract.md)
- [`references/pr-deployments.md`](terreno-planning/references/pr-deployments.md)
- [`stage-result.schema.json`](terreno-planning/references/stage-result.schema.json)
- [`execution-state.schema.json`](terreno-planning/references/execution-state.schema.json)

Stage YAML is compact (`v: 2`, omit empty keys) and collapsed behind a Details toggle in
chat and on the PR. Humans read `status` / `next` / `action`. When the current PR has
GitHub Deployments, those demo URLs are the last visible section of every wait-for-human
or done chat.

The focused `terreno-pick-roast-loop` is the implementation autopilot: it keeps
recovering from objective Pick/Roast failures while an evidence-backed engineering
action remains. It reports the complete task/attempt ledger once at completion. When a
human decision is genuinely required, it first explains the plan state, work completed,
decisive evidence, options, impact, and recommendation, then asks one exact question,
then prints PR deployment URLs when a PR has them.

The optional **feature profile** in the loop document preserves the former Grind behavior:
invoke Pick once; it pick-roasts each frontier task in sequence. `terreno-planning-loop`
is the invocable outer recipe (optional phases including Grow, Brew, Taste). Neither is
a sixth lifecycle stage.

## State machine

```text
Grow PASS → Pick/Roast inner loop → Brew PASS → Taste
              Pick one task → Roast that task
              Roast FAIL → Pick (same task, exact evidence)
              Roast PASS + remaining tasks → Pick (next frontier task)
              Roast PASS + no remaining tasks → Brew
Brew PENDING (review-bot timeout) → outer loop waits → Taste
Taste PENDING (CI wait timeout / bot timeout / second push) → outer loop waits → fresh Taste
Taste PASS → merge-ready
Any BLOCKED → named human/external gate
```

Brew does not execute Taste. Pick never skips Roast. Roast never invokes Pick. Exactly
one driver continues after each current-task Roast. Brew and Taste wait until Bugbot,
CodeQL, and similar review bots on the current head have reported, preferring provider
CLI watch hooks or harness event subscriptions over sleep polling, then continue. Taste
then waits in a loop for product CI using GitHub CLI or CircleCI CLI until jobs are
terminal or the wait times out. Before any push, Taste fetches latest `master` (merging it only when needed),
then spawns a fresh subagent with no parent conversation. It records last-run failed
tests from the CI snapshot and re-verifies them locally, then runs the root `prepush`
package script when present; otherwise it falls back to lint, typecheck, and locally
affected tests in each affected package. It then pushes and watches product CI. Taste observes jobs on every discovered CI host (GitHub Actions, CircleCI,
Buildkite, and similar), not only GitHub checks. Outer loops use the same native hooks
during Taste `PENDING` waits. The loop owns persistence, retry, stop, and escalation.
It does not reinvoke Pick between roasted tasks.

## Repository integration

Reusable Terreno framework skills are canonical under
`plugins/terreno-planning/skills/` and install with the lifecycle. The plugin also ships
`pre-commit` and `ui-verifier` agents. Terreno-repository-only skills remain canonical
under `.rulesync/skills/` and are generated for supported agent ecosystems with
`bun run rules`.

Install the generated skill set directly with:

```bash
npx skills add TerrenoLabs/terreno
bun run skills:sync
```

`skills/` is generated from `.rulesync/skills/` and the combined plugin; plugin skills
are authoritative when names overlap. Package `.ai/skills/` remain available to package
and MCP tooling but do not overlay the installable tree. Stages read architecture docs
first and update them in the same slice; see
[`documentation-contract.md`](terreno-planning/references/documentation-contract.md).

Validate the plugin architecture with:

```bash
bun run check:lifecycle-skills
bun run rules:check
```

## Migration

| Retired | Canonical |
| --- | --- |
| `terreno-1-blend` | `terreno-1-grow` |
| `terreno-2-roast` (implementation) | `terreno-2-pick` |
| `terreno-3-cupping` | `terreno-3-roast` (verification) |
| `terreno-4-pour` | `terreno-4-brew` |
| `terreno-5-dialin` | `terreno-5-taste` |

No aliases are retained for the five retired plugin command names. The old
implementation-Roast name collides semantically with the new verification-Roast stage.
Deprecated repo-local routers (`/ip`, `/implement`, `/submit`, `/autobot`, `/check-watcher`)
are removed; invoke the canonical stages directly.

## Hosts

| Host | Plugin | Marketplace | Invoke Pick–Roast loop |
| --- | --- | --- | --- |
| Cursor | `terreno-planning` | [`.cursor-plugin/marketplace.json`](../.cursor-plugin/marketplace.json) | `/terreno-pick-roast-loop` |
| Codex | `terreno-planning` | [`.agents/plugins/marketplace.json`](../.agents/plugins/marketplace.json) | `$terreno-pick-roast-loop` |
| Claude Code | `terreno` | [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json) | `/terreno:pick-roast-loop` |

The scan plugin publishes from the same marketplaces as `terreno-scan` on every host.
Bounded rounds: `/terreno-scan-campaign` (Cursor), `$terreno-scan-campaign` (Codex),
`/terreno-scan:campaign` (Claude Code, from the generated `terreno-scan-claude/`).
Resident loop: `/terreno-scan-loop`, `$terreno-scan-loop`, `/terreno-scan:loop`.

All three hosts ship continuous Pick–Roast, phase-planning, and Taste-sweep outer loops.
Cursor and Claude Code also load the bundled `pre-commit` and `ui-verifier` agents;
Codex currently consumes the combined skills without plugin-defined agents.

Claude Code install:

```text
/plugin marketplace add TerrenoLabs/terreno
/plugin install terreno@terreno-plugins
```

Codex install:

```text
codex plugin marketplace add TerrenoLabs/terreno
codex plugin install terreno-planning --source terreno-plugins
```

Claude Code's installer collides when the marketplace `name` matches the plugin `name`.
The marketplace is `terreno-plugins`; the plugin stays `terreno` so Grow is `/terreno:1-grow`.

`terreno-planning/` is canonical and keeps the `terreno-<n>-<stage>` skill names used by
Cursor, Codex, and `npx skills`. Codex reads `.codex-plugin/plugin.json` in that same
directory. Claude Code resolves a plugin skill's command from the frontmatter `name`, so
its shortened names cannot live in the shared stage files. `terreno-claude/` is a
**generated** Claude-only copy: same procedure, stage names shortened to `1-grow` …
`5-taste`, outer loops shortened to `pick-roast-loop`, `planning-loop`, and
`taste-sweep`, published under the plugin name `terreno`. Regenerate it with
`bun run skills:sync`; never hand-edit it.
