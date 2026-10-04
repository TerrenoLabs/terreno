# Loop engineering

Terreno separates engineering method from orchestration:

```text
                 LOOP
       orchestrate / persist / wait
          retry / stop / escalate
                  |
                  v
               GROW
               shape
                  |
                  v
         PICK ⇄ ROAST  (inner loop)
         one task, prove it, next task
                  |
                  v
               BREW
              submit
                  |
                  v
              TASTE
             react once
```

Repository knowledge composes underneath every invocation:

```text
lifecycle stage + project skills + IP/task/state + evidence
```

## Why fresh invocations

One enormous agent context accumulates assumptions, stale external state, and confidence
in its own implementation. The lifecycle instead makes every stage reconstructable from
durable artifacts. Pick can retry from exact Roast evidence; Roast can verify without the
implementer's assumptions; Taste can react to the current PR head rather than an old
green result.

Pick continues across tasks in one invocation. Roast proves the current task and
returns. Each Roast cycle still reconstructs from artifacts and prefers a fresh context
with a task-scoped briefing (criteria, file list, and patch). Fresh context is for
independence, not for two children to each reload the repository.

The outer loop decides **when, who, what next, when to retry Taste `PENDING`, and when
to escalate**. Stages decide how to perform one transition correctly. Pick continues
the inner loop until the approved task list is done. Roast never invokes Pick. Brew and
Taste additionally wait while async review bots are running, preferring provider CLI
watch hooks or harness event subscriptions over timer polling. Taste also waits in a
loop for product CI with `gh` or `circleci` until jobs are terminal or the wait times
out. Before any push it fetches latest `master` (merging it only when needed), then records last-run failed tests
and re-verifies them locally, then runs the repository's root
`prepush` package script in a no-context subagent when present (falling back to affected
package lint, typecheck, and tests), then pushes and watches CI.

Invocable outer loops in the plugin:

- `/terreno-pick-roast-loop` works an approved plan until every task passes Roast or a
  genuine human decision is required. It resumes only Pick or Roast. Stored `next: brew`
  completes the loop without launching Brew. It keeps one run ledger and reports all
  task, retry, evidence, and risk details at the end. A human question includes the
  overall state, options/impact, and recommendation.
- `/terreno-planning-loop` runs Grow, then Pick (Pick owns the pick-roast inner loop),
  then optional Brew/Taste; pass `phases=` to restrict.
- `/terreno-taste-sweep` drives the author's broken open PRs by reinvoking Taste.

None is a sixth stage.

## The five transitions

| Stage | Question | Primary evidence |
| --- | --- | --- |
| Grow | Is the work shaped and approved? | IP/tasks, decisions, criterion→verification map |
| Pick | Was this slice implemented carefully? | red/green tests, checks, internal reviews; then Roast |
| Roast | Does this task actually satisfy its criteria? | independent requirement→evidence verdict; emit next Pick or Brew |
| Brew | Is the verified result correctly submitted? | final checks, commit/head, PR, artifacts |
| Taste | What is actionable on the current PR head now? | CI on every discovered host, mergeability, reviews, bounded fixes |

Roast is not another implementation review. It independently proves or disproves
acceptance criteria. Taste is one reactive iteration, not an unbounded fix-until-green
daemon. It waits until async review bots (Bugbot, CodeQL, and similar) on the current
head have reported, then waits in a loop for product CI using GitHub CLI
(`gh pr checks --watch`, `gh run watch`) or CircleCI CLI (`circleci run watch`) until
jobs are terminal or the wait times out. Before any push it fetches latest
`master` (merging it only when needed), records last-run failed tests and re-verifies them locally, then runs root
`prepush` when present in a fresh subagent with no parent
conversation. If absent, it proves affected-package lint, typecheck, and tests instead.
It then pushes and watches CI, emits `PASS`, `FAIL`, `BLOCKED`, or `PENDING`, and exits.

Brew review-bot waits use only hooks targeted to the matched bot so ordinary CI cannot
extend Brew. Taste's product-CI wait uses unfiltered GitHub/CircleCI watches on purpose.
A host with a documented path/config reason not to run is terminal `skipped`; an
unexplained missing run is never green.

## Combined plugin, local knowledge

The reusable plugin defines contracts, invariants, evidence, and transitions and bundles
Terreno's reusable API/UI/data/schema/admin/docs/upgrade/deploy workflows. Repo-local
skills define only project-specific roadmap, release, and maintenance operations.

Each stage inspects available skills and loads those whose descriptions match the
affected domain. A useful skill is optional when absent; a capability required by
repository policy is a hard gate and produces `BLOCKED` if unavailable.

Stages also load architecture docs before acting. Docs are the design; code implements
them. Missing docs for a user-visible or architectural change is `FAIL`.

This lets the same plugin install provide Pick/Roast plus backend API, test-environment,
UI, and real-app verification knowledge in consumer projects.

### Terreno's bundled skill layer

Reusable framework skills are canonical inside `plugins/terreno-planning/skills/`.
Repository-only skills remain under `.rulesync/skills/`. High-value composition points
include:

| Domain | Repo-local skills stages may discover |
| --- | --- |
| Backend/API/data | `terreno-backend-api`, `mongoose-schema-safety`, `backend-test-env`, `generate-sdk`, `terreno-data-fetching` |
| UI/app | `terreno-ui`, `building-terreno-apps`, `verify-ui-changes` |
| AI/prompts | `ai-prompt-governance` — new features also follow [Develop an AI feature](../how-to/ai-feature-development.md) |
| Docs/submission | `update-docs`, Brew, `fix-conflicts` |
| GitHub issues | `create-github-issue`, `work-github-issues`, `implement-ready-for-dev` (Pick plan comment is the Roast contract; unattended Grow may also write an IP) |
| Deployment/runtime | `deploy-gcp`, Expo deployment/workflow skills |

This inventory is descriptive, not a plugin dependency list. Stages inspect the actual
catalog on every invocation.

## State and evidence

The IP remains the design/scope source of truth. The task file remains the execution
checklist. Lightweight loop-owned state stores only current stage/attempt/task,
branch/head/PR, the previous structured result, artifacts, attempted approaches, and next
transition.

The fallback state location is `.terreno/pipeline/<slug>.json`; the outer loop preserves
or transports it and Brew excludes it from commits unless repository policy says
otherwise. Stage results follow the plugin's JSON-schema-backed YAML contract and never
contain chain-of-thought or transcripts.

## Commits and pushes

Every pushed commit starts a full CI run. Harnesses such as Cursor cloud agents push
every commit automatically, so commit count turns directly into CI runs. Before these
rules, one 30-commit dashboard PR had ten "mark slice roasted" commits and ten "harden"
follow-ups, and `ui-ci` stayed red on every commit after the first.

- One behavior-scoped commit per task, after Roast `PASS`: code, tests, docs, and the
  task-file mark together. Roast-driven fixes fold into that commit.
- Progress lives in execution state, not in standalone task-file commits.
- Pick and Roast never push. Brew pushes once. Taste pushes at most once per reaction.
- Pick does not continue on a head whose product CI shows a branch-caused failure.
- Pick lists a behavior's edge cases before coding, so Roast proves them instead of
  discovering them.
- Roast runs the gate CI will run (root `prepush`, which mirrors the triggered CI jobs),
  not only the task's test file.
- Taste fetches `master` before every push but merges it only when the PR conflicts, a
  failure traces to base drift, or the branch is otherwise merge-ready.

## Direct invocation

Outer loops (`terreno-planning-loop`, `terreno-taste-sweep`) consume Taste `PENDING`
and invoke Taste again. When a human invokes Taste directly, no loop is waiting, so a
`PENDING` would only tell them to come back later. In that case Taste uses
**standalone entry**: it waits in-process with native watches and reacts again. It
stops on `PASS`, `BLOCKED`, or `FAIL`, or after 3 fix pushes or 3 hours of waiting,
which ends as `BLOCKED` with one concrete human action. A directly invoked Brew
starts Taste as its next stage instead of exiting.

## Retry and stop rules

- Pick implements one task, Roast proves it, then Pick takes the next unblocked task.
  Do not start the next task until Roast PASS. Roast never invokes Pick. Exactly one
  driver continues after each Roast. Do not pick every task and roast once.
- Roast failure returns exact expected/actual evidence to Pick for the same task.
- Engineering retries require a new hypothesis and preserve failed approaches.
- The focused Pick–Roast outer loop continues through ordinary implementation, test,
  lint, and Roast failures while a concrete safe engineering action remains. It asks
  for human input only when evidence cannot choose a product, architecture, security,
  data, destructive, compatibility, permission, or policy outcome.
- Taste `PENDING` is for review-bot timeout, product-CI wait timeout, or a second
  post-fix push. The outer loop then uses native provider watch hooks or harness
  subscriptions where available and a timer only as fallback, then invokes fresh Taste.
- Brew waits in-process while Bugbot, CodeQL, or similar review bots are running.
  Taste waits in-process for those bots and for product CI (`gh` / `circleci` watch
  loop), then continues without a loop reinvocation unless it timed out.
- Human decisions are `BLOCKED`, never arbitrary retries.
- Taste `PASS` requires all current-head jobs on every discovered CI host
  terminal/non-failing, no conflicts, and no actionable review findings.

The detailed contract, schemas, and three execution scenarios live under
[`plugins/terreno-planning/references/`](https://github.com/TerrenoLabs/terreno/tree/master/plugins/terreno-planning/references).

