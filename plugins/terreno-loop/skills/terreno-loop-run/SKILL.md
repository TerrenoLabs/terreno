---
name: terreno-loop-run
description: Run a scan campaign as a resident session — keep working toward the goal, open PR-sized slices routed to named reviewers, and heartbeat over every open PR to answer review comments, fix failing CI, and land merges, until the metric hits target or a human decision is required. Use when asked to keep a goal running continuously, leave a scan going in the background, watch and respond to campaign PRs, or run the scan loop; not for a single bounded round.
---

# Scan loop (resident driver)

One session, running until the goal is met. It alternates between **making progress** —
sweep, sift, plot, hand a slice to the lifecycle, open a routed PR — and **servicing what
is already open** — answering human review, fixing red CI, tracking merges. Work happens
in fresh subagents; this session holds only the goal, the state, and the schedule.

Read [`scan contract`](../../references/scan-contract.md),
[`heartbeat`](../../references/heartbeat.md),
[`PR routing`](../../references/pr-routing.md),
[`goal tracking`](../../references/goal-tracking.md), and
[`agentic map-reduce`](../../references/mapreduce.md). Campaign state conforms to
[`scan-state.schema.json`](../../references/scan-state.schema.json).

## Scope

- Included: the five scan stages, PR routing, the heartbeat over open campaign PRs,
  lifecycle invocation per slice, state persistence, scheduling, and one report per
  human gate or completion.
- Excluded: writing product code, committing, pushing, approving, and merging. Every one
  of those belongs to a lifecycle stage invoked in a fresh subagent — Pick implements,
  Brew submits, Taste reacts.
- Requires the lifecycle plugin (`terreno-1-grow` … `terreno-5-taste`) and a host CLI
  with PR access (`gh`). Missing either is `BLOCKED`, not a workaround.

## Arguments

Parse from the invocation, in this order: an explicit `goal=<slug>`, a quoted goal
statement, or the remaining text. Also accept:

| Argument | Meaning |
| --- | --- |
| `reviewer=<handle[,handle]>` | Override the charter's reviewers for this run |
| `assignee=<handle>` | Override the charter's assignee |
| `wip=<n>` | Override the charter's open-PR limit for this run |
| `rounds=<n>` | Stop after this many sweep rounds |
| `until=<ISO timestamp>` | Stop at this time regardless of progress |
| `tick=<seconds>` | Fixed heartbeat interval instead of the adaptive one |

An override applies to this run only and is recorded in state as an override, never
written back into the charter.

If no campaign exists for the goal, run Aim first and block for approval — a resident
loop does not invent a metric, a target, or a reviewer.

## Start

1. **Resolve the campaign.** Read the charter and campaign state for the goal. Verify the
   branch, round, findings, and every recorded PR against the host. If nothing exists,
   invoke `terreno-loop-1-aim` and stop at its approval gate.
2. **Resolve routing.** Confirm the charter's `review` block names a reachable reviewer or
   an explicit `mode: none`. Verify unfamiliar handles per `pr-routing.md`. An unroutable
   campaign stops here with one question, before any PR exists.
3. **Announce once.** One short line: goal, metric baseline → current vs target, open PRs
   and who has them, what this run will do first, and the heartbeat interval. This is the
   only unprompted status message until something needs a human.

## Run

Repeat until a stop condition:

1. **Heartbeat tick.** Follow `heartbeat.md`: snapshot the campaign's PRs, classify each,
   and act in priority order — route unrouted PRs, hand answered and broken PRs to Taste
   in fresh subagents, Track merged ones, retire closed ones. Answer any given comment
   exactly once.
2. **Refill capacity.** When open campaign PRs are below the effective `wipLimit` and the
   backlog has planned findings, advance the campaign one step:
   - planned findings remain → `terreno-loop-4-plot` for the next slice
   - backlog empty, rounds remain → `terreno-loop-2-sweep`, then `terreno-loop-3-sift`
   - a slice is ready to build → `terreno-1-grow` with its brief, then
     `terreno-pick-roast-loop` (or `terreno-2-pick` once), then `terreno-4-brew`
   - Brew reported a PR → apply routing immediately, then count the slice in flight
3. **Persist.** Update campaign state after every stage and every tick: stage, round,
   slices with PR/reviewer/assignee/bucket, answered comment ids, `lastTick`, and the
   chosen next interval.
4. **Schedule.** Pick the next interval from the heartbeat table — provider watch hook
   while CI runs, minutes while bots report, tens of minutes while a human holds the PR,
   no wait at all while backlog work remains. Prefer the harness's native scheduling or
   completion hooks; use a timer only when no hook applies.
5. **Stay quiet.** A tick with nothing to report prints nothing. Do not narrate ticks, do
   not repeat the plan, and do not post PR comments to show activity.

## Concurrency

- Never exceed the effective `wipLimit` of open campaign PRs.
- Never run two lifecycle stages against the same slice at once.
- Never start a new slice while a slice for the same files is open — the second PR will
  conflict and waste the reviewer's time.
- One branch per slice, named from the slice slug. Never reuse a branch a human is
  reviewing.

## Speak only when it matters

Interrupt the human for:

- a genuine gate from `scan-contract.md`: goal or target changes, destructive remediation,
  public API or data-format changes, scope growth, metric regression, exhausted budget
- an unroutable or unverifiable reviewer handle
- a PR a human has held with requested changes the campaign cannot satisfy without a
  decision
- three consecutive host failures, lost credentials, or a lifecycle stage blocked on
  something only a person can supply

Every interruption carries goal and trajectory, what happened, why input is needed,
two to four options with impact, a recommendation, then **one exact question**, then PR
deployment URLs when a campaign PR has them.

## Stop conditions

- Metric reached target and held after the last slice merged → complete.
- `rounds=` or `until=` reached, or the charter's horizon passed → report and ask.
- Two rounds below the charter's minimum step, or a regression → report and ask.
- A genuine human gate → `BLOCKED`, with the question above.
- Three consecutive host failures → `BLOCKED` with `kind: access`.
- The human says stop → stop immediately, leave every PR routed and state consistent, and
  report what is in flight and who holds it.

A resident loop never stops quietly. Every stop names what is open, who has it, and what
the next action would be.

## Report

On completion or at a gate, lead with the trajectory:

`<metric> <baseline> → <current> <unit> (target <target>), <merged> slices merged, <open> open.`

Then: `In flight` (PR, reviewer, bucket, age), `Merged this run`, `Fixed` findings with
evidence, `Open` and `Dismissed` findings, `Regressions` or `None identified`,
`Residual risk`, and `Next`.

## Emit

After the human-facing report, one collapsed scan-result payload. The loop is not a
stage, so set `stage` to the last scan stage invoked.

```yaml
v: 2
stage: track
status: PENDING
goal: reduce-cold-build-time
round: 2
metric:
  value: 41.7
  unit: s
  delta: -16.9
  ev: "bun run compile (cold, best of 3): 41.7s"
prs:
  - pr: "1421"
    bucket: waiting
    who: octocat
  - pr: "1424"
    bucket: answered
    who: octocat
wait: 900
next: track
action: Taste is addressing review on #1424; recheck both PRs in 15 minutes
```

Use `status: PENDING` with a `wait` while PRs are open and progress continues,
`status: PASS` when the goal is met, and `status: BLOCKED` with one `ask` at a human gate.
