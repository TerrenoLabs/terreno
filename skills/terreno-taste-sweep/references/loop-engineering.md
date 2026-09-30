# Loop engineering

This file describes orchestration for a runner, human, or automation. The lifecycle
skills do not implement Grow → Brew → Taste. Pick and Roast **do** implement the
[`pick-roast inner loop`](pick-roast-loop.md) in-process.

```text
Grow PASS → Pick/Roast inner loop → Brew PASS → Taste
              Pick one task → Roast that task
              Roast FAIL → Pick (same task, exact evidence)
              Roast PASS + remaining tasks → Pick (next frontier task)
              Roast PASS + no remaining tasks → Brew
Brew PENDING (review-bot timeout) ───→ outer loop waits → Taste
Taste PENDING (CI wait timeout / bot timeout / second push) ───→ outer loop waits → fresh Taste
Taste waits in-process for Bugbot/CodeQL and product CI (`gh` / `circleci`) ───→ same invocation reacts
Taste PASS ────────────→ merge-ready
Any BLOCKED ───────────→ human/external gate
```

The loop persists the execution state, starts a fresh agent for Grow, for the first
Pick or Roast entry, and for Brew/Taste, honors `next`, waits on `PENDING` (`wait`
seconds), and stops on `PASS` or `BLOCKED` according to policy. It must not turn a human
decision into retries. It must not reinvoke Pick or Roast between tasks while the inner
loop can continue. Stage YAML is loop/skill data; keep it collapsed for humans. Brew and
Taste themselves wait until async review bots on the current head have reported,
preferring provider CLI watch hooks or harness subscriptions. Taste then waits in a loop
for product CI using GitHub CLI or CircleCI CLI until jobs are terminal or the wait
times out. The loop does not need to reinvoke for those in-process waits.

Three invocable outer-loop skills ship beside the five stages. They are not stages:

| Skill | Loop |
| --- | --- |
| `terreno-pick-roast-loop` | Drive an approved plan through recoverable Pick/Roast failures, accumulate one run ledger, and stop only at completion or a genuine human gate. |
| `terreno-planning-loop` | Walk Grow/Pick/Brew/Taste. Default Grow once, then Pick once (Pick owns the pick-roast inner loop). Pass `phases=` (`grow`, `pick`, `roast`, `brew`, `taste`) to restrict. |
| `terreno-taste-sweep` | Find the author's open non-draft PRs that are conflicting or failing, isolate each one, and reinvoke Taste until mergeable or blocked. |

## Invocation packet

Give each fresh agent a [task-scoped briefing](subagent-briefing.md):

1. lifecycle skill path/name
2. IP and task path
3. execution-state artifact
4. branch and current PR (if any)
5. previous stage result and referenced evidence
6. pointer to repository architecture docs for the affected area
7. this slice's criteria, file list, and patch — not a request to rediscover the catalog

The stage discovers repository skills itself, matching this slice's files. The loop may
suggest known skills but must not replace stage-level discovery. Roast and its children
must not spawn two unconstrained reviewers.

Invoking Pick is enough to run the inner loop until the approved task list is done.
Invoking Roast proves the current task only and emits `next: pick` or `next: brew`.
Roast never invokes Pick. Do not start the next task until Roast PASS. Exactly one driver continues after each current-task Roast: Pick owns the inner loop.

`terreno-pick-roast-loop` adds recovery around those bounded invocations. It reinvokes
the named stage when a concrete engineering action remains, but it does not repeat a
failed approach without a new hypothesis. It keeps cycle details in execution state and
presents one complete report at the end. At a human gate, the report must explain the
overall goal/state, completed work, decisive evidence, options and impact, recommendation,
then one exact question, then PR deployment URLs when a PR has them. It never invokes Grow, Brew, Taste, or product CI.

## Feature profile (formerly Grind)

For one bounded feature, the loop may use a compact approved task file instead of a full
IP when repository policy permits:

1. Invoke Grow to research/grill and write the compact task contract.
2. Invoke Pick once. It implements one unblocked task, roasts it, then picks the next
   until the list is done. Do not dispatch parallel Picks and roast once at the end.
3. When the inner loop emits `PASS` with `next: brew`, invoke Brew, then fresh Taste
   iterations.

The inner loop, not a long-lived parent agent outside Pick/Roast, marks tasks, persists
per-task results in execution state, and continues to the next frontier task.

## Backend/API scenario

- Grow shapes the model/API contract, acceptance criteria, and discoverable supporting
  skills.
- Pick loads applicable API, schema, and test-environment skills and implements with TDD
  one task at a time.
- Roast independently exercises that task's routes, integration/database behavior, and
  regressions before the next task starts.
- Brew submits only after every in-scope task has Roast `PASS`.
- Taste reacts to the current CI/review state until the loop receives `PASS`. It waits
until Bugbot, CodeQL, and similar review bots have reported, then waits in a loop for
product CI with `gh` or `circleci`, then acts. Before any push it fetches latest
`master` (merging it only when needed), then spawns a fresh subagent with no parent conversation. When the repository
root defines a `prepush` package script, the subagent runs that authoritative local gate.
Otherwise it falls back to lint, typecheck, and locally affected tests in affected
packages. Before that gate, Taste records last-run failed tests from the CI snapshot and
re-verifies them locally. Taste then pushes and watches CI.

## UI scenario

- Grow shapes UX, API, state, and observable verification criteria.
- Pick loads applicable UI conventions and implements/tests one task's behavior.
- Roast loads the repository's UI verification capability, launches the real app,
  exercises the changed workflow, and records media evidence before the next task.
- Brew attaches evidence after the inner loop completes.
- A Taste fix that changes UI reruns the required UI verification, pushes, and returns
  `PENDING` for the new head.

## CI/review scenario

1. Brew pushes the PR, uses native watch/subscription hooks where available until
   Bugbot/CodeQL (if running) are terminal, records outcomes, and exits with
   `next: taste` without implementing fixes.
2. Taste waits if those bots are still running, then runs the product-CI wait loop
   (`gh pr checks --watch` / `gh run watch` / `circleci run watch`) until jobs on SHA A
   are terminal. It sees a branch-caused CI failure, fixes it, fetches latest
   `master` (merging it only when needed), records last-run failed tests and re-verifies them locally, then runs the
   root `prepush` script (or fallback lint, typecheck, and affected
   tests) in a fresh subagent with no parent conversation, pushes SHA B, then watches
   review bots and product CI on B, and acts once on those results. A further push emits
   `PENDING` and exits.
3. The outer loop uses the same native watch hook only when Taste timed out or pushed a
   second fix (falling back to the requested timer), then invokes fresh Taste. It sees
   green jobs plus an actionable human review comment, fixes it, waits for review bots
   and product CI on the new head, and emits `PENDING` or `PASS`.
4. When all jobs on every discovered host are terminal/pass, no conflicts, and no
   actionable comments remain, Taste emits `PASS`.
