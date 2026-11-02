---
name: campaign
description: Drive a long-term codebase goal to its target — charter it, sweep and sift the repository into findings, plot PR-sized slices, run each slice through the Terreno lifecycle, then re-measure and repeat until the metric hits target or a genuine human decision is required. Not a scan stage — an outer loop that invokes the scan stages and the lifecycle. Use when asked to run a scan campaign, work toward a long-term engineering goal, or keep scanning and fixing until an outcome is reached.
---

# Scan campaign (outer driver)

Not a stage. The five scan stages stay Aim, Sweep, Sift, Plot, Track. This skill walks
them round after round and hands each plotted slice to the Terreno lifecycle, until the
goal metric reaches its target or a genuine human decision is required.

For a session that stays resident — heartbeating over open PRs, answering review, and
refilling work as PRs merge — use `run` instead. This skill runs the rounds
and stops at each gate; the loop wraps it and keeps going.

Read the shared [`scan contract`](../../references/scan-contract.md),
[`agentic map-reduce`](../../references/mapreduce.md),
[`goal tracking`](../../references/goal-tracking.md), and
[`PR routing`](../../references/pr-routing.md). The campaign state must conform to
[`scan-state.schema.json`](../../references/scan-state.schema.json).

## Scope

- Included: the five scan stages, campaign-state persistence, lifecycle handoff for each
  plotted slice, bounded retries, and one accumulated report.
- Excluded: implementing findings, editing product code, committing, pushing, opening or
  merging PRs. The lifecycle owns all of that.
- Requires the Terreno lifecycle plugin (`1-grow` … `5-taste`). If it is
  not installed, stop at Plot and report the missing dependency.

## Preconditions

- A goal, outcome, or existing charter is available with a repository.
- The campaign-state location is resolvable and can be preserved between invocations.

If a charter exists but is unapproved, stop at a human gate. Do not invent a goal, a
target, or a metric.

## Round shape

```text
Aim (once per goal)
  → Sweep → Sift
      → dry round → Track
      → findings → Plot → handoff
          → 1-grow (slice brief → approved IP + tasks)
          → pick-roast-loop, or 2-pick once
          → 4-brew → 5-taste
      → Track
          → plot  (backlog remains)
          → sweep (backlog empty, rounds remain)
          → null  (target reached, budget spent, regression, or diminishing returns)
```

## Drive

1. **Reconstruct once.** Read the charter and campaign state. Verify goal, round, branch,
   findings, and slice PR status against reality. Identify the stage named by
   `next.stage`; default to Aim when no charter exists, otherwise Sweep.
2. **Invoke the named scan stage** in a fresh context with the charter, campaign state,
   the previous result, and this round's artifacts. Never ask the stage to rediscover the
   campaign from conversation.
3. **Consume the result.** Update campaign state, then classify:
   - `PASS` with `next` set → invoke that stage next.
   - `PASS` with `handoff: grow` → run the lifecycle for the top slice (below), then
     invoke Track.
   - `PASS` with `next: null` → finish and report.
   - `FAIL` with a concrete action → reinvoke the named stage with the exact evidence and
     a new hypothesis.
   - `BLOCKED` with `kind: human` or `next.human: true` → present the human gate.
   - `BLOCKED` for environment/access/external → attempt safe remediation or one bounded
     retry when a new hypothesis exists. Never relabel it `human` merely to stop.
   - `PENDING` → wait per `wait`, preferring the harness's native completion hook or the
     provider's watch hook; use a timer only when no hook applies. Then reinvoke.
4. **Run the handed-off slice.** For the slice Plot names:
   - Invoke `1-grow` with the slice brief. Grow owns the IP, the task list, and
     human approval.
   - On Grow `PASS`, invoke `pick-roast-loop` when it is installed, otherwise
     `2-pick` once — Pick owns the pick → roast → next-task inner loop.
   - On completion, invoke `4-brew`, then `5-taste`, honoring their
     `PENDING` waits exactly as the lifecycle's own loops do.
   - As soon as Brew reports the PR, apply the charter's routing per `pr-routing.md` and
     record the reviewer and assignee. An unrouted PR is not a finished handoff.
   - Record the slice's branch, PR, reviewer, and outcome in campaign state. A slice the lifecycle
     blocks is recorded and skipped; the campaign continues with the next slice rather
     than stalling the goal, unless the blocker applies to every slice.
5. **Bound retries by evidence.** A retry must add a new hypothesis, changed setup, or
   new evidence. Never repeat a failed approach. After two focused failures of the same
   stage with no new hypothesis, classify the underlying decision honestly instead of
   looping.
6. **Continue quietly.** Repeat steps 2–5 without narrating each cycle. Keep details in
   campaign state and report once at completion or at a human gate.

## Budget and safety

- Honor the charter's budget: rounds, slices per round, and open PRs at once (`wipLimit`).
- Never exceed the open-PR limit; wait on Track instead of stacking review load.
- Stop and report when the horizon passes, even mid-backlog.
- Never run a campaign that edits code the charter marked out of scope.

## Recurring campaigns

A campaign is resumable by design: every invocation reconstructs from the charter and
campaign state. To run it on a cadence, schedule this skill with the goal slug and let it
pick up the next move — a fresh sweep, the next slice, or a report. Repeated invocations
must not restart Aim or re-baseline a goal that already has one.

## Genuine human gate

Ask for input only for:

- the goal statement, metric, or target itself
- destructive or irreversible remediation
- public API, data-format, or compatibility changes a finding requires
- scope growth beyond the approved charter
- a metric regression or two rounds below the charter's minimum step
- credentials or permissions no authorized alternative can supply
- a reviewer handle that cannot be verified or requested

Before the question, give this overview in plain language:

1. **Goal and trajectory:** statement, metric, baseline → previous → current vs target.
2. **What happened:** rounds run, findings found/fixed/reopened, slices merged, decisive
   evidence.
3. **Why input is needed:** the exact decision and why evidence cannot choose it.
4. **Options:** two to four concrete choices with impact and risk.
5. **Recommendation:** one default and its rationale.

End with **one exact question** the human can answer in one message. Then close with PR
deployment URLs when a slice's PR has them. Do not expose chain-of-thought, worker
transcripts, or unexplained stage YAML.

## Completion report

When the target is reached, lead with:

`PASS — <metric> <baseline> → <current> <unit> (target <target>) across <n> rounds.`

Then report:

- `Trajectory`: metric per round with the command output for the final measurement
- `Fixed`: findings closed with evidence, grouped by slice and PR
- `Open`: findings still open or deferred, with the reason
- `Dismissed`: dropped findings and why
- `Regressions`: anything that moved the wrong way, or `None identified`
- `Residual risk`: explicit remaining risk, or `None identified`
- `Next`: the recommended follow-up, such as a cadence for re-sweeping

When stopped early, use the same report plus `Blocker`. Include everything from the round
records once; do not duplicate per-round narration.

## Stop conditions

- `PASS`: the metric reached target and held after the last slice landed.
- `PASS` with a question: budget or horizon exhausted, or diminishing returns.
- `BLOCKED` (human): a genuine human gate above.
- `BLOCKED` (non-human): retries exhausted and no safe autonomous action exists.
- `FAIL`: campaign state is inconsistent or corrupt, or the named stage cannot be invoked.

Ordinary rule failures, empty shards, dry rounds, and lifecycle test failures are not
terminal while a concrete action remains.

## Emit

After the human-facing report, include one collapsed scan-result payload. Since outer
loops are not stages, set `stage` to the last scan stage invoked.

```yaml
v: 2
stage: track
status: PASS
goal: reduce-cold-build-time
round: 3
metric:
  value: 28.4
  unit: s
  delta: -30.2
  ev: "bun run compile (cold, best of 3): 28.4s"
next: null
action: Target reached; re-sweep quarterly to hold the gain
```

For a human gate, use `status: BLOCKED`, `next: null`, and an `ask` entry with the exact
question, recommendation, and options. For a non-human terminal blocker, use a `block`
entry with `kind: environment`, `access`, or `external`, and omit `ask`.
