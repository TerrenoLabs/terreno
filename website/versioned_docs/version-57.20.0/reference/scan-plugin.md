# Scan plugin reference

Plugin: `terreno-scan` (`2.11.0`). Requires the lifecycle plugin
([lifecycle plugin reference](lifecycle-plugin.md)).

A scan turns a long-term outcome — "cold builds under 30s", "no unbounded reads", "WCAG
AA on every screen" — into a measured campaign: charter the goal, map-reduce the
repository into verified findings, slice those findings into IPs and tasks, run each
slice through Grow/Pick/Roast/Brew/Taste, then re-measure and repeat.

Scan stages never edit product code. The lifecycle does.

| Skill | Preconditions | Primary output | PASS next |
| --- | --- | --- | --- |
| `terreno-scan-1-aim` | goal/outcome + repository | approved charter: metric, measured baseline, dry-run rules, exclusions, validity rule, severity rubric, slice policy, budget | Sweep |
| `terreno-scan-2-sweep` | approved charter | per-rule hits, deterministic shard manifest, schema-valid candidate findings from parallel workers | Sift |
| `terreno-scan-3-sift` | candidates for the round | deduped, adversarially verified, ranked findings report plus dropped-candidate summary | Plot, or Track when dry |
| `terreno-scan-4-plot` | findings report + slice policy | ordered PR-sized slices, one standalone Grow brief each, findings marked `planned` | Track, with `handoff: grow` |
| `terreno-scan-5-track` | landed slice or dry round | re-measured metric with command output, findings closed/reopened with evidence, round record, next move | Plot, Sweep, or `null` |

Outer loops (not stages):

| Skill | What it walks | Default |
| --- | --- | --- |
| `terreno-scan-campaign` | One goal, round after round | Aim once, then Sweep → Sift → Plot → lifecycle → Track until the metric hits target, the budget is spent, or a genuine human gate is reached. Stops at each gate. |
| `terreno-scan-loop` | The same, but resident | Keeps the campaign moving **and** heartbeats over every open campaign PR — routing it to a reviewer, answering review comments through Taste, fixing red CI, tracking merges — refilling work as PRs land. Runs until the goal is met, a stop argument fires, or a human decision is required. |

## Resident loop

`terreno-scan-loop` is the "leave it running" entry point. One session holds the goal,
the state, and the schedule; every unit of work happens in a fresh subagent.

Arguments: `goal=<slug>`, `reviewer=<handle[,handle]>`, `assignee=<handle>`, `wip=<n>`,
`rounds=<n>`, `until=<ISO timestamp>`, `tick=<seconds>`. Overrides apply to the run only
and are recorded in state as overrides — they never rewrite the charter.

Each tick snapshots the campaign's PRs and sorts each into one bucket, then acts in
priority order:

| Bucket | Action |
| --- | --- |
| `unrouted` | Apply the charter's routing, then count the slice in flight |
| `answered` | A human commented or requested changes → one `terreno-5-taste` in a fresh subagent |
| `broken` | CI failed or the PR conflicts → one `terreno-5-taste` |
| `merged` | → `terreno-scan-5-track`: re-measure, close findings with evidence |
| `closed` | Mark the slice abandoned, return its findings to `open`, free its slot |
| `bot-pending`, `waiting` | Nothing — this is why the next tick exists |

Then it refills capacity up to `wipLimit` and schedules the next tick: the provider's
watch hook while CI runs, 2–5 minutes while review bots report, 15–30 minutes while a
human holds the PR, and no wait at all while backlog work remains. Ticks that find
nothing print nothing, and every comment is answered exactly once — answered ids live in
state. See
[`heartbeat.md`](https://github.com/TerrenoLabs/terreno/blob/master/plugins/terreno-scan/references/heartbeat.md).

## PR routing

Aim settles who reviews the campaign's PRs before any PR exists, and records a `review`
block: `mode` (`fixed`, `codeowners`, `blame`, `round-robin`, `none`), reviewer and
assignee handles, teams, draft policy, labels, `wipLimit`, `mergePolicy`, and how to
notify. Handles are verified with `gh api repos/{owner}/{repo}/collaborators/<handle>`
before use; an unverifiable handle is a human gate, never a silently unassigned PR.

Routing is applied right after Brew reports the PR (`gh pr edit --add-reviewer
--add-assignee --add-label`) and re-requested once when requested changes are addressed.
The campaign never approves its own PRs, never dismisses a review, and never merges when
`mergePolicy` is `human` — the default. See
[`pr-routing.md`](https://github.com/TerrenoLabs/terreno/blob/master/plugins/terreno-scan/references/pr-routing.md).

## Stage anatomy

Every stage includes Preconditions, Inputs, Procedure, Supporting skills, Evidence
produced, Success/Failure/Blocked conditions, and a recommended next stage — the same
shape as the lifecycle stages.

Results use `PASS`, `FAIL`, `BLOCKED`, or `PENDING` and the compact `v: 2`
[`scan-result.schema.json`](https://github.com/TerrenoLabs/terreno/blob/master/plugins/terreno-scan/references/scan-result.schema.json)
(`v`, `stage`, `status`, `next`, `action`; omit empty keys). Campaign state follows
[`scan-state.schema.json`](https://github.com/TerrenoLabs/terreno/blob/master/plugins/terreno-scan/references/scan-state.schema.json)
and findings follow
[`finding.schema.json`](https://github.com/TerrenoLabs/terreno/blob/master/plugins/terreno-scan/references/finding.schema.json).
Chat shows `status` / `next` / `action` plus the current metric; the YAML lives in a
Details toggle.

## Map-reduce

Sweep shards rule hits into batches (default: at most 25 files or 80 hits per shard,
never splitting a file) and maps one fresh worker per shard. Workers get a shard
briefing — goal, rules, validity rule, severity rubric, file list, hit lines, allowed
commands, and the return schema — and nothing else. They never search the repository at
large, never spawn nested agents, and never edit files. Sift then dedupes by
`rule + path + symbol`, re-runs evidence, refutes every high-severity candidate before
keeping it, drops what does not reproduce, and ranks by impact × confidence ÷ effort.
Dropped shards and capped coverage are always reported; silent truncation is a defect.
See
[`mapreduce.md`](https://github.com/TerrenoLabs/terreno/blob/master/plugins/terreno-scan/references/mapreduce.md).

## Goal and metric

Aim is not finished until the metric has a command that prints a number and the baseline
came from running it. Track re-runs that command with the charter's protocol every round
and records the value with its output. A finding that cannot be tied to the metric is
dismissed in Sift, not deferred. Re-baselining without recording both values, the reason,
and the round is untrustworthy and Track says so. See
[`goal-tracking.md`](https://github.com/TerrenoLabs/terreno/blob/master/plugins/terreno-scan/references/goal-tracking.md).

## Artifacts

| Artifact | Default path | Committed |
| --- | --- | --- |
| Charter | `docs/scans/<goal-slug>/charter.md` | yes |
| Findings report | `docs/scans/<goal-slug>/round-<n>-findings.md` | yes |
| Shard manifest, candidates, slice briefs | round artifact directory | per repository policy |
| Campaign state | `.terreno/scan/<goal-slug>.json` | no (git-ignored) |
| Slice IP and tasks | the repository's existing IP/task convention, written by Grow | yes |

An existing repository convention always wins over these defaults.

## State machine

```text
Aim PASS → Sweep → Sift
  Sift PASS (findings)    → Plot → handoff: grow
  Sift PASS (dry round)   → Track
  Plot PASS               → Grow → Pick/Roast inner loop → Brew → Taste → Track
  Track PASS (backlog)    → Plot
  Track PASS (empty)      → Sweep
  Track PASS (target/budget/regression) → null, report and ask
  Track PENDING (slice still in flight) → campaign waits → fresh Track
  Any BLOCKED             → named human/external gate
```

The campaign loop owns persistence, retry, waiting, stop, and escalation. It never
implements a finding itself, never commits, and never opens a PR — Plot hands each slice
to Grow, and the lifecycle takes it from there.

## Hosts

| Host | Plugin | Invoke Aim | Invoke the campaign |
| --- | --- | --- | --- |
| Cursor | `terreno-scan` | `/terreno-scan-1-aim` | `/terreno-scan-campaign` |
| Codex | `terreno-scan` | `$terreno-scan-1-aim` | `$terreno-scan-campaign` |
| Claude Code | `terreno-scan` | `/terreno-scan:1-aim` | `/terreno-scan:campaign` |

The resident loop is `/terreno-scan-loop` (Cursor), `$terreno-scan-loop` (Codex), and
`/terreno-scan:loop` (Claude Code).

`plugins/terreno-scan/` is canonical. `plugins/terreno-scan-claude/` is generated with
shortened skill names; regenerate it with `bun run skills:sync` and never hand-edit it.

## Example

```text
/terreno-scan:loop reduce cold compile time reviewer=octocat wip=2
```

Aim grills the target (30s), measures the baseline with `bun run compile` on a clean
tree, approves four rules, and records `octocat` as reviewer with a two-PR limit. Sweep
shards 180 hits into nine batches and maps nine workers. Sift keeps 12 of 31 candidates,
refuting four high-severity claims that did not reproduce. Plot writes three slices; the
loop runs the first through Grow, Pick/Roast, and Brew, then routes the PR to `octocat`.
While that PR waits, the loop opens the second slice up to the limit and then goes quiet,
ticking every 20 minutes. `octocat` requests a change at 14:05; the next tick hands that
PR to Taste, which replies, fixes, runs the pre-push gate, pushes, and watches CI. When
the PR merges, Track re-measures at 48.2s (from 58.6s), marks five findings fixed, and
the loop refills capacity with the third slice.

Stop it with a plain "stop" — it leaves every PR routed, state consistent, and reports
what is in flight and who holds it.
