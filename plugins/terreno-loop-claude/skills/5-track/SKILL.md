---
name: 5-track
description: Re-measure a scan campaign's goal metric after slices land, close or reopen findings with evidence, record the round, and choose the next move — more slices, a fresh sweep, or a report with one question. Use after a plotted slice finishes in the lifecycle or a round is dry; not for discovering findings, planning slices, or writing code.
---

# Track — measure and decide

A campaign is only working if the number moved. Track re-measures the goal metric,
reconciles the findings against reality, records the round, and names the next move.

Read the shared [`scan contract`](../../references/scan-contract.md),
[`goal tracking`](../../references/goal-tracking.md), and
[`heartbeat`](../../references/heartbeat.md) before acting.

## Preconditions

- Campaign state exists with a metric, a baseline, and at least one round in progress.
- Either a plotted slice has finished in the lifecycle, or the round was dry.
- This invocation owns measurement and routing only. It never edits product code.

## Inputs

- Campaign state: goal, metric, baseline, rounds, findings, slices
- Findings report and slice briefs for the round
- Merge state of each slice's PR and the current head

## Procedure

1. **Reconstruct.** Read campaign state. Resolve each running slice's real status — PR
   open, merged, closed, abandoned — from the repository, not from state's memory.
2. **Wait when the work is still moving.** If a slice is mid-lifecycle (open PR, CI
   running, review bots pending), emit `PENDING` with a `wait` and let the campaign loop
   return. Prefer the harness's native completion hook or the provider's watch hook; use
   a timer only when no hook applies. Do not close findings against unmerged work.
3. **Re-measure.** Run the metric command exactly as the charter's protocol specifies, on
   the branch the charter names (usually the default branch after merge). Quote the output
   as evidence and compute the delta against both the baseline and the round start.
4. **Reconcile findings.** For each finding in a landed slice, verify against the current
   code: re-run its evidence command or re-check its anchor.
   - Gone and the fix is present → `fixed`
   - Still reproducible → `reopened`, with the new evidence and a one-line reason
   - Anchor moved but the defect persists → update anchors, keep it open
   Never mark a finding `fixed` because a task was checked off; only evidence closes a
   finding.
5. **Catch regressions.** If the metric moved the wrong way, or a previously fixed finding
   is reproducible again, record it with evidence and treat it as the headline of this
   round, not a footnote.
6. **Retire closed slices.** A slice whose PR was closed without merging is `abandoned`:
   record the closing reason, return its findings to `open`, and free its slot against the
   open-PR limit.
7. **Record the round.** Append the round record per `goal-tracking.md`: metric at start
   and end with command output, found/kept/planned/fixed/dismissed/reopened counts, slices
   landed with their PRs, residual risk, and anything deliberately deferred.
8. **Choose the next move.** Apply the decision table in `goal-tracking.md`: `plot` while
   planned findings remain within budget, `sweep` when the backlog is empty and rounds
   remain, `null` when the target is reached and held, when two rounds moved less than the
   charter's minimum step, when the metric regressed, or when the budget or horizon is
   exhausted.
9. **Report and persist.** Lead with the trajectory in one line — baseline → previous →
   current against target. Update campaign state and emit the result collapsed. When a
   slice's PR has GitHub Deployments, close the message with those demo URLs as the last
   visible section.

## Constraints

- Never re-baseline to flatter the campaign; re-baseline only per the goal-tracking rules
  and record both values and the reason.
- Never report a metric value without its command output.
- Never close a round while a slice's PR is unmerged; emit `PENDING` instead.
- Diminishing returns, regressions, and exhausted budgets are reports with one question,
  not silent stops.

## Supporting skills

Follow the shared discovery procedure. Measurement may require the same build, test,
performance, or analysis skills the charter's metric command depends on.

## Evidence produced

- Metric value with quoted command output, and deltas against baseline and round start
- Per-finding closure evidence: fixed, reopened, or still open with anchors
- Round record appended to campaign state
- Regression report when the metric or a fixed finding moved the wrong way
- The chosen next move with its reason

## Success conditions

- The metric was re-measured with the charter's protocol and its output is quoted.
- Every finding in a landed slice was reconciled against current code with evidence.
- The round record makes the whole trajectory readable from state alone.
- Emit `PASS` with `next: plot`, `next: sweep`, or `next: null` per the decision table.

## Failure conditions

A metric command that cannot run, a round record that contradicts the repository's real
merge state, or findings closed without evidence emit `FAIL` with exact defects and
`next: track`.

## Blocked conditions

Missing measurement tooling or access, or a decision about whether to continue the
campaign that only a human can make, emits `BLOCKED` with the trajectory, options,
tradeoffs, and a recommended default.

## Recommended next stage

- `PASS` with planned findings remaining → Plot
- `PASS` with an empty backlog and rounds remaining → Sweep
- `PASS` with the target reached, the budget spent, or a regression → `null`, report and
  ask
- `PENDING` → campaign loop waits for the running slice and reinvokes Track
- `BLOCKED` → campaign loop routes the named human/external gate
