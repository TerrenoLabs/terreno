# Goal tracking

A campaign is a long-term goal plus the evidence that the repository is moving toward
it. Without a measured metric a scan degrades into an opinion backlog.

## Goal shape

| Field | Rule |
| --- | --- |
| `statement` | One outcome sentence in the repository's language: "cold `bun run compile` finishes in under 30s". |
| `metric.name` | What is counted or timed. |
| `metric.command` | The exact command that prints the value. It must run in this repository, unattended, and print a number. |
| `metric.unit` | `s`, `ms`, `count`, `percent`, `bytes`. |
| `metric.direction` | `down` or `up` — which way is better. |
| `baseline` | The value captured by running the command during Aim, with its output quoted. |
| `target` | The value that ends the campaign. |
| `horizon` | Rounds or calendar bound after which the campaign reports instead of continuing. |
| `budget` | Maximum rounds, maximum slices per round, and maximum open PRs at once (`wipLimit`). |
| `review` | Who reviews campaign PRs and how they are routed; see [`pr-routing.md`](pr-routing.md). |

If no command can produce the metric, the goal is not yet measurable. Either pick a
proxy that is measurable and say so in the charter, or return `BLOCKED` with the exact
instrumentation the repository is missing. Do not proceed with a metric that is scored by
judgment alone.

Sanity rules for a metric command:

- It must be reproducible on a clean checkout of the current branch.
- It must not depend on the campaign's own artifacts.
- Time-based metrics are measured the same way every round (same warm/cold state, same
  machine class); record which in the charter.
- If a metric is noisy, record the measurement protocol (for example, best of three) in
  the charter and use it every round.

## Round record

Track appends one record per round:

- round number and the shard/rule set used
- metric at round start and round end, each with the command output
- findings found, kept, planned, fixed, dismissed, and reopened
- slices landed, with their IP slug, PR, reviewer, and merge state
- time each PR spent waiting on review, when the host reports it
- residual risk and anything deliberately deferred

The round record is the campaign's memory. A fresh Track invocation must be able to state
the whole trajectory from state alone.

## Deciding the next move

After re-measuring, Track picks exactly one:

| Condition | Next |
| --- | --- |
| Backlog still has planned findings within budget | `plot` |
| Backlog empty, rounds remaining, metric short of target | `sweep` |
| Metric reached target and held after the last slice landed | `null` — campaign complete |
| Two consecutive rounds moved the metric less than the charter's minimum step | `null` — report diminishing returns and ask |
| Metric moved the wrong way after a landed slice | `null` — report the regression with evidence and ask |
| Budget or horizon exhausted | `null` — report progress and ask |

Diminishing returns, regressions, and exhausted budgets are **reports with a question**,
not silent stops. Each includes the trajectory, what was fixed, what remains, options,
and a recommended default.

## Re-baselining

Do not move the baseline to make progress look better. Re-baseline only when the metric
command or measurement protocol changes, and then record both the old and new values, the
reason, and the round it changed in. A campaign whose baseline was rewritten without that
record is not trustworthy and Track must say so.
