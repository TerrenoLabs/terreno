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
               PICK
               build
                  |
                  v
              ROAST
               prove
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

The outer loop decides **when, who, what next, when to retry, when to wait, and when to
escalate**. Stages decide how to perform one transition correctly.

## The five transitions

| Stage | Question | Primary evidence |
| --- | --- | --- |
| Grow | Is the work shaped and approved? | IP/tasks, decisions, criterion→verification map |
| Pick | Was this slice implemented carefully? | red/green tests, checks, internal reviews |
| Roast | Does the result actually satisfy the IP? | independent requirement→evidence verdict |
| Brew | Is the verified result correctly submitted? | final checks, commit/head, PR, artifacts |
| Taste | What is actionable on the current PR head now? | CI, mergeability, reviews, bounded fixes |

Roast is not another implementation review. It independently proves or disproves
acceptance criteria. Taste is not a resident watcher. It observes once, acts once, emits
`PASS`, `FAIL`, `BLOCKED`, or `PENDING`, then exits.

## Portable plugin, local knowledge

The reusable plugin defines contracts, invariants, evidence, and transitions. Repo-local
skills define exact API/UI/database patterns, commands, test environments, generated
code, deployment, and safety rules.

Each stage inspects available skills and loads those whose descriptions match the
affected domain. A useful skill is optional when absent; a capability required by
repository policy is a hard gate and produces `BLOCKED` if unavailable.

Stages also load architecture docs before acting. Docs are the design; code implements
them. Missing docs for a user-visible or architectural change is `FAIL`.

This lets the same Pick method compose with backend API and test-environment knowledge,
while Roast composes with UI conventions and real-app verification.

### Terreno's current project-skill layer

The canonical sources remain under `.rulesync/skills/` and are generated for supported
agents. The current high-value composition points include:

| Domain | Repo-local skills stages may discover |
| --- | --- |
| Backend/API/data | `terreno-backend-api`, `mongoose-schema-safety`, `backend-test-env`, `generate-sdk`, `terreno-data-fetching` |
| UI/app | `terreno-ui`, `building-terreno-apps`, `building-native-ui`, `verify-ui-changes` |
| AI/prompts | `ai-prompt-governance` |
| Docs/submission | `update-docs`, `commit`, `create-pr`, `fix-conflicts` |
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

## Retry and stop rules

- Roast failure returns exact expected/actual evidence to a fresh Pick.
- Engineering retries require a new hypothesis and preserve failed approaches.
- Taste `PENDING` lets the outer loop wait and invoke fresh Taste against current state.
- Human decisions are `BLOCKED`, never arbitrary retries.
- Taste `PASS` requires all current-head checks terminal/non-failing, no conflicts, and
  no actionable review findings.

The detailed contract, schemas, and three execution scenarios live under
[`plugins/terreno-planning/references/`](https://github.com/TerrenoLabs/terreno/tree/master/plugins/terreno-planning/references).

