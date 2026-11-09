# Implementation Plan: Loop-Engineering Lifecycle Plugin

**Status:** Complete — shipped as `plugins/terreno-planning`
**Approved:** 2026-08-22
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1006
**Priority:** High
**Owner:** agent
**Created:** 2026-07-27
**Program:** [OSS launch](oss-launch-program.md)

## Goal

Evolve Terreno's existing planning plugin into five reusable, bounded lifecycle
transitions optimized for repeated fresh agent invocations:

```text
Grow (shape) → Pick (build) → Roast (prove) → Brew (submit) → Taste (react)
```

The outer loop owns invocation, persistence, Taste `PENDING` reinvocation, retry, stop,
and escalation. Brew waits in-process for async review bots. Taste waits in-process for
review bots and for product CI (GitHub CLI or CircleCI CLI watch loop). Before any
push it pulls latest `master`, runs root `prepush` when present (otherwise affected
package lint/typecheck/tests) in a no-context subagent, then pushes and watches CI.
Lifecycle skills own how one stage is performed. Repository skills own how this codebase
works. Roast owns independent acceptance proof. State/evidence bridge fresh invocations.

This is a refactor of the existing strong workflow, not a parallel implementation.

## Scope

- Canonical five plugin skills and migration from former names
- Explicit transition contracts for every stage
- Shared machine-readable result and execution-state schemas
- Supporting-skill discovery/composition
- Repository-specific detail removed from portable stages
- Brew exits after PR setup and the review-bot wait
- Taste performs one reactive iteration after waiting for review bots and product CI, then exits
- Outer-loop reference including small-feature and CI/review scenarios
- Static validation for names, status values, transitions, portability, and loop bounds
- Documentation, metadata, and generated integrations

## Non-scope

- A daemon/hosted scheduler implementation
- Automatic merging
- Copying Terreno's repository skills into the plugin
- Persisting chain-of-thought or conversational transcripts
- Hundreds of generic micro-skills

## Decisions

| ID | Decision |
| --- | --- |
| AP1 | Public reusable plugin; repository-specific knowledge remains local |
| AP2 | Sensitive-data rules cover credentials, customer data, PII/PHI, and evidence media |
| AP3 | Canonical stages are Grow, Pick, Roast, Brew, Taste |
| AP4 | Stages discover supporting skills by description; exact skill names are never universal dependencies |
| AP5 | Taste is one observe/act/emit iteration after in-process waits for async review bots and product CI. Before any push: always pull latest `master`, record last-run failed tests and re-verify them locally, then run the repository root's `prepush` package script when present (otherwise affected-package lint, typecheck, and tests) in a fresh subagent with no parent conversation, then push and watch CI (`gh` / `circleci`). The outer loop reinvokes on Taste `PENDING` |
| AP6 | Shared results use compact `v: 2` YAML; required keys are `v`, `stage`, `status`, `next`, `action`; empty keys are omitted; YAML is collapsed for humans |
| AP7 | Existing repository state convention wins; fallback reuses loop-owned `.terreno/pipeline/<slug>.json`, not committed by default |
| AP8 | Brew emits PR/head state and exits; direct Taste invocation is standalone compatibility only |
| AP9 | No deprecated command aliases: old implementation-Roast conflicts with new verification-Roast and no maintained alias mechanism exists |
| AP10 | Plugin major version is `2.0.0` because lifecycle semantics and command names are breaking |
| AP11 | Grow ends with a standalone approval brief — orientation paragraph, optional background, idea, plan — then an unbounded Decisions table pairing every grilled decision with the question that prompted it, or omits that table when there were none; grilling stays on a question until the answer is executable |
| AP12 | Brew and Taste wait until Bugbot, CodeQL, and similar review bots on the current head have reported, preferring hooks targeted to the matched bot or harness subscriptions over timer polling; unfiltered PR-check watches are product-CI waits owned by Taste |
| AP13 | Product CI is every discovered host (GitHub Actions, CircleCI, Buildkite, GitLab CI, and similar). Taste observes native jobs when GitHub checks are incomplete; Brew confirms each host triggered or documented a not-applicable skip. An unexplained untriggered host prevents Brew `PASS`; a documented skip is terminal for Taste |
| AP14 | Taste waits in-process with the provider's bounded native watch command (`gh pr checks --watch`, `gh run watch`, `circleci run watch`, `bk build watch`) in a loop until jobs are terminal or the wait times out. Outer loops honor Taste `PENDING` with the same hooks. Watch exit codes trigger a fresh classification rather than becoming stage verdicts directly |

## Architecture

```text
                 OUTER LOOP
       invoke / persist / wait / retry
           stop / route / escalate
                     |
                     v
 GROW → PICK → ROAST → BREW → TASTE
 shape  build   prove   submit  react once
                     |
     repository skills + IP/task/state + evidence
```

### Ownership

| Layer | Owns |
| --- | --- |
| Outer loop | when, who, next stage, persistence, Taste `PENDING` reinvocation, retry, stop, escalation |
| Lifecycle plugin | portable stage procedure, invariants, evidence, transitions |
| Repository skills | commands, frameworks, package conventions, safety rules, gotchas |
| Roast | requirement → method → evidence → verdict |
| State/evidence | durable facts required by a fresh invocation |

### State transition table

| Stage | PASS | FAIL | BLOCKED/PENDING |
| --- | --- | --- | --- |
| Grow | Pick | Grow with artifact defects | Human/external gate |
| Pick | Roast | Pick with new evidence-based hypothesis | Human/external gate |
| Roast | Brew | Pick with exact failed criteria | Classify environment/external/human |
| Brew | Taste | Pick/Roast/Brew according to evidence | Human/access gate |
| Taste | Merge-ready | Focused Taste retry only with new evidence | `PENDING`: loop waits then Taste; `BLOCKED`: named gate |

## Shared result contract

Every stage emits compact `v: 2` YAML: required `v`, `stage`, `status`, `next`, `action`;
optional `ip`, `task`, `attempt`, `branch`, `sha`, `pr`, `skills`, `done`, `checks`,
`artifacts`, `fail`, `block`, `ask`, `wait`. Omit nulls and empty arrays. Humans see
`status` / `next` / `action`; the YAML is collapsed in chat and in the PR Details toggle.

Schemas:

- `plugins/terreno-planning/references/stage-result.schema.json`
- `plugins/terreno-planning/references/execution-state.schema.json`

No reasoning transcript is persisted.

## Execution state

The IP owns design/scope; tasks own executable slices. State stores only current
stage/attempt/head/PR, prior structured result (`last`), artifacts, attempted approaches
(`tried`), and next transition. The outer loop preserves/transports it between fresh
invocations.

State files are excluded from Brew commits unless a repository explicitly tracks them.
After a PR exists, each Taste invocation also reconstructs current truth from the PR and
current head rather than trusting stale state.

## Stage contracts

### Grow

Researches repository facts, distinguishes human decisions from discoverable facts and
low-risk conventional details, grills until each answer is executable, then writes
approved, implementation-ready IP/tasks. Every acceptance criterion maps to verification.
Approval shows a standalone brief — orientation paragraph, optional background, idea,
plan — plus a full Decisions table with prompting questions when any grilled decisions
exist.

### Pick

Implements one slice with Specify → Encode failing test → Fulfill → Clean the Kitchen.
It consumes prior Roast/Taste evidence, preserves verified behavior, records failed
approaches, runs independent implementation and test-quality reviews, and emits evidence
for Roast.

### Roast

Runs independently, preferably in fresh context. It builds a requirement/evidence matrix
and executes objective checks. It does not normally fix implementation code. `FAIL`
returns exact expected/actual evidence to Pick.

### Brew

Requires Roast proof, runs repository-defined final checks/review, commits/pushes, applies
the PR template, attaches evidence, confirms product CI triggered on every discovered
host, and waits for async review bots (Bugbot, CodeQL, and similar) on the current head.
Waits prefer provider CLI watch hooks or harness subscriptions and use bounded polling
only as fallback. Brew records PR/current head and exits; it does not wait for ordinary
product CI or execute Taste.

### Taste

Waits in-process if Bugbot, CodeQL, or similar review bots are still running, preferring
provider CLI watch hooks or harness subscriptions, then waits in a loop for product CI
using GitHub CLI (`gh pr checks --watch`, `gh run watch`) or CircleCI CLI
(`circleci run watch`) until jobs on every discovered host are terminal or the wait
times out. It then classifies mergeability and reviews, performs one bounded set of
actionable fixes. Before any push it always pulls latest `master`, records last-run
failed tests and re-verifies them locally, then spawns a fresh
subagent with no parent conversation to run root `prepush` when present, falling back to
lint, typecheck, and locally affected tests in each affected package. It then pushes and
watches review bots and product CI. It may act
once more after that watch. It emits
`PASS`/`PENDING`/`BLOCKED`/`FAIL` and exits. The outer loop reinvokes after timeout or a
second post-fix push.

## Supporting skills

Every stage inventories skills exposed by the harness/repository and loads those whose
descriptions match the affected domains. Useful project skills may describe APIs, UI,
data, schemas, prompts, test environments, deployment, documentation, or verification.
No exact name is hard-required globally.

If repository policy requires a capability and it is missing, the stage returns
`BLOCKED`. If no skill applies, the stage infers conventions from repository instructions,
code, tests, scripts, and analogous changes.

## Retry semantics and human gates

Engineering retries are bounded and hypothesis-driven. Each attempt retains exact failure
evidence and attempted approaches. Product CI may be observed indefinitely by repeated
fresh Taste invocations. Outer loops use provider-native watch hooks or harness
subscriptions during each bounded wait and timers only as fallback. Brew and Taste wait
internally only for async review bots.

Human gates include product semantics, architecture/security/data ownership, destructive
or irreversible operations, permissions, public compatibility, major scope expansion,
and policy-required approval. `BLOCKED` names the decision, evidence, options/tradeoffs,
and recommended default.

## Compatibility migration

| Retired | Canonical |
| --- | --- |
| `terreno-1-blend` | `terreno-1-grow` |
| `terreno-2-roast` (implementation) | `terreno-2-pick` |
| `terreno-3-cupping` | `terreno-3-roast` (verification) |
| `terreno-4-pour` | `terreno-4-brew` |
| `terreno-5-dialin` | `terreno-5-taste` |

Former Grind orchestration becomes an outer-loop feature profile. Former plugin code
review becomes a shared reference. Neither remains a sixth plugin skill.

## Acceptance criteria

- Exactly five canonical lifecycle skill directories exist.
- Every stage has explicit preconditions, inputs, procedure, supporting skills, evidence,
  success/failure/blocked conditions, and next transition.
- A fresh Pick/Roast/Taste invocation can reconstruct its work from durable artifacts.
- Result/status/transition values validate against the common schema.
- Taste has no internal indefinite wait/observation loop.
- Brew does not require same-context Taste execution.
- Lifecycle skills contain no Terreno package names/commands that belong to project skills.
- Repository skills remain local and discoverable/composable.
- Backend/API, UI, and multi-invocation CI/review scenarios are documented.
- Canonical sources and rulesync-generated copies validate cleanly.

## Remaining assumptions / weaknesses

- The plugin defines state/results but does not ship a scheduler or durable remote state
  service; the outer loop must preserve the fallback artifact between machines.
- Some generated skill formats do not encode Cursor's `disable-model-invocation`
  frontmatter. Enforcement of explicit invocation depends on that agent runtime.
- Repository skill quality controls how much exact domain knowledge a stage can compose.
  When no skill exists, agents still infer from instructions/code/tests.
