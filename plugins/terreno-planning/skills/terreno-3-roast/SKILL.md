---
name: terreno-3-roast
description: Independently prove or disprove the current task against its IP criteria, then return. Do not pick or start the next task. Pick owns the inner loop. Use after Pick, preferably in a fresh context; not for fixing implementation code.
---

# Roast — prove

Roast is the authoritative stage-level verifier for the **current task**. It does not
continue the inner loop. Roast never invokes Pick. Pick owns the inner loop:

```text
requirement → verification method → evidence → PASS / FAIL / BLOCKED
```

Read the shared [`lifecycle contract`](../../references/lifecycle-contract.md),
[`documentation contract`](../../references/documentation-contract.md),
[`PR deployments`](../../references/pr-deployments.md),
[`pick-roast loop`](../../references/pick-roast-loop.md),
[`testing plan`](../../references/testing-plan.md), and
[`subagent briefing`](../../references/subagent-briefing.md).

## Preconditions

- An approved IP/task contract and completed Pick result exist for the current task.
- Current branch/head and diff are resolvable.
- Run in a fresh context when the harness permits, with a task-scoped briefing.

## Inputs

- IP, task file, acceptance criteria, and verification requirements for the current task
- Current branch/head, diff, and PR when present
- Pick result, execution state, prior Roast attempts, and artifacts
- Repository instructions and available project/verification skills

## Procedure

1. **Reconstruct independently.** Verify the head and this task's source artifacts from
   the task-scoped briefing (criteria, file list, patch). Do not trust Pick's completion
   claims as proof. Do not reload unnamed lifecycle references or the whole skill catalog.
2. **Discover supporting skills.** Load only skills whose descriptions match this task's
   files and criteria. Repository-mandatory capabilities are hard requirements.
3. **Build the matrix.** Map every in-scope criterion **for the current task** to one or
   more objective methods and the evidence required. Include promised regressions,
   compatibility, and non-scope that this task could break. Add every IP
   `## E2E tests` row whose `Written in` names this task, with the command that runs
   its spec at the row's path, following the e2e guide the testing plan resolves.
   A missing spec or a failing row is `FAIL` that names the row ID. A row whose layer
   this invocation cannot reach is `deferred` per the testing-plan deferral rule, unless
   repository policy makes that layer mandatory here, which is `BLOCKED`. Record a
   deferred row's exact command in the Roast result and execution state, never in the
   IP tables, and never count it as passed. Add every IP `## Regression cases` row this
   task's criteria name, or whose `Automated by` names one of this task's rows or specs;
   when no unblocked tasks remain, add every row no earlier Roast checked. Check each
   against the testing-plan regression-step bar. A row without a concrete starting
   state, a followable action, and an observable Expected is `FAIL` that names the row
   ID and the missing part; Pick fixes it by rewriting that row in the IP in place.
   A row an e2e guide layer could cover completely is also `FAIL` (testing-plan
   "Automate first"); Pick moves it to `## E2E tests`. Roast never walks a row.
   An IP that lacks either section follows the testing-plan legacy rule: warn once and
   do not fail.
4. **Inspect and execute.** Review this task's patch and run concrete checks in this
   invocation: repository-prescribed tests, integration/system behavior, lint/type/build
   checks, runtime/API/database probes, regression reproductions, or real UI interaction.
   Do not spawn two unconstrained reviewers. Prefer named commands here over a second
   general-purpose child that rediscovers the repo. Run the gate CI will run on these
   files, not only this task's test file. Use the root `prepush` package script when
   present, since it scopes itself to changed files. Otherwise run each touched
   package's lint, typecheck, and the same test command CI runs, including coverage
   thresholds. A test that passes alone but fails in the package suite is `FAIL`.
5. **Exercise changed behavior.** For UI-facing work in **this task's file list**, spawn
   at most one specialized UI/runtime verifier with the same briefing. Interact with the
   actual changed workflow and capture required screenshots/video/logs. App launch alone
   is not proof. Skip that child when this task has no UI/runtime files.
6. **Prove docs.** Confirm architecture and public docs match the shipped behavior. A
   criterion that is true in code but absent or wrong in docs is `FAIL`.
7. **Classify each criterion.** Record `PASS`, `FAIL`, or `BLOCKED` with reproducible
   evidence. Never pass a criterion because the code merely looks reasonable.
8. **Do not fix.** Report implementation defects to Pick. Only correct verifier setup
   owned by Roast; if that changes evidence materially, rerun the affected method.
9. **Record.** Update execution state for this task's Roast result.
10. **Return.** Follow the pick-roast loop. Do not start the next task until Roast PASS.
    Roast never invokes Pick. Pick owns the inner loop. Exactly one driver continues —
    that driver is always Pick. After recording this task, return the result; do not
    reconstruct Pick, do not invoke Pick, and do not start the next task. `PASS` with
    remaining unblocked tasks → emit `PASS` with `next: pick`. `PASS` with none remaining
    → emit `PASS` with `next: brew`. `FAIL` → emit `FAIL` with `next: pick`. `BLOCKED`
    → emit `BLOCKED` with `next: null`. When Pick invoked this Roast, returning to Pick
    is enough; still do not invoke Pick.

Do not treat a Roast of the last slice as proof of earlier unroasted tasks. Terminal
inner-loop `PASS` requires every in-scope task to have Roast `PASS` on the recorded head.

## Supporting skills

Follow the shared discovery procedure. Applicable skills may supply API/database test
methods, UI/runtime verification, security/safety checks, build commands, or deployment
probes. If repository policy makes one mandatory and it is unavailable, emit `BLOCKED`.

## Evidence produced

- Requirement-to-evidence matrix for the current task
- Each `## E2E tests` row this task owns, with its spec path, command, and `PASS`,
  `FAIL`, or `deferred`
- Each `## Regression cases` row checked against the regression-step bar, and its result
- Commands/probes/interactions and outcomes
- Artifact/log/API response references
- Exact expected vs actual behavior for every failure
- Environment/access details for every blocker
- Docs pages that match or fail against shipped behavior
- Per-task Roast results in execution state
- Terminal structured Roast or inner-loop result

## Success conditions

- Every in-scope acceptance criterion for the current task has objective passing
  evidence on the recorded head.
- Required regression/runtime/UI checks pass.
- Every `## E2E tests` row this task owns has a spec at its path that passed here, or
  is recorded `deferred` with its exact command.
- Every `## Regression cases` row Roast checked meets the regression-step bar.
- Architecture and public docs match the shipped behavior.
- Remaining unblocked tasks emit `next: pick`. Roast never invokes Pick.
- When none remain and every in-scope task has Roast `PASS`, emit `PASS` with
  `next: brew`.

## Failure conditions

One or more criteria disproven by evidence emits `FAIL` with severity, expected, actual,
and reproducible evidence. Set `next: pick`. A missing or failing `## E2E tests` row, or
a `## Regression cases` row that misses the regression-step bar or could be fully
automated, is `FAIL` that names the row ID.

## Blocked conditions

Unavailable required environment/capability/access, ambiguous criterion requiring a human
decision, or external service failure that prevents proof emits `BLOCKED` with exact
classification, `next: null`, and next action.

## Recommended next stage

- Inner-loop `PASS` (all in-scope tasks roasted) → `next: brew`
- `PASS` with remaining unblocked tasks → `next: pick`
- `FAIL` → `next: pick` with exact failure evidence and current head
- `BLOCKED` → outer loop classifies retryable environment/external vs human gate
