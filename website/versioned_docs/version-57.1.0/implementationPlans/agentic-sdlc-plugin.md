# Implementation Plan: Loop-Engineering Lifecycle Plugin

**Status:** In Progress
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

The outer loop owns invocation, persistence, waiting, retry, stop, and escalation.
Lifecycle skills own how one stage is performed. Repository skills own how this codebase
works. Roast owns independent acceptance proof. State/evidence bridge fresh invocations.

This is a refactor of the existing strong workflow, not a parallel implementation.

## Scope

- Canonical five plugin skills and migration from former names
- Explicit transition contracts for every stage
- Shared machine-readable result and execution-state schemas
- Supporting-skill discovery/composition
- Repository-specific detail removed from portable stages
- Brew exits after PR setup
- Taste performs one reactive iteration and exits
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
| AP5 | Taste is one observe/act/emit iteration; the outer loop owns waiting and reinvocation |
| AP6 | Shared results use stable YAML shaped by JSON Schema; statuses are `PASS`, `FAIL`, `BLOCKED`, `PENDING` |
| AP7 | Existing repository state convention wins; fallback reuses loop-owned `.terreno/pipeline/<slug>.json`, not committed by default |
| AP8 | Brew emits PR/head state and exits; direct Taste invocation is standalone compatibility only |
| AP9 | No deprecated command aliases: old implementation-Roast conflicts with new verification-Roast and no maintained alias mechanism exists |
| AP10 | Plugin major version is `2.0.0` because lifecycle semantics and command names are breaking |

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
| Outer loop | when, who, next stage, persistence, waiting, retry, stop, escalation |
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

Every stage emits the same concise YAML keys: schema version, stage/status, IP/task,
attempt, branch/head/PR, supporting skills, completed work, checks, artifacts, failures,
blockers, decisions required, next stage/action, and optional next-check interval.

Schemas:

- `plugins/terreno-planning/references/stage-result.schema.json`
- `plugins/terreno-planning/references/execution-state.schema.json`

No reasoning transcript is persisted.

## Execution state

The IP owns design/scope; tasks own executable slices. State stores only current
stage/attempt/head/PR, prior structured result, artifacts, attempted approaches, and next
transition. The outer loop preserves/transports it between fresh invocations.

State files are excluded from Brew commits unless a repository explicitly tracks them.
After a PR exists, each Taste invocation also reconstructs current truth from the PR and
current head rather than trusting stale state.

## Stage contracts

### Grow

Researches repository facts, distinguishes human decisions from discoverable facts and
low-risk conventional details, grills only genuine decisions, then writes approved,
implementation-ready IP/tasks. Every acceptance criterion maps to verification.

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
the PR template, attaches evidence, records PR/current head, and exits. It does not wait
for CI or execute Taste.

### Taste

Reads current-head CI, mergeability, and unresolved review signals once. It classifies,
performs one bounded set of actionable fixes, verifies/pushes if changed, emits
`PASS`/`PENDING`/`BLOCKED`/`FAIL`, and exits. The outer loop schedules another invocation.

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
evidence and attempted approaches. Changing external state may be observed indefinitely
by repeated fresh Taste invocations, but no lifecycle skill waits internally.

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
