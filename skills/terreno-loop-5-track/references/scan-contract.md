# Scan contract

Aim, Sweep, Sift, Plot, and Track are **transitions**, not the orchestration loop.
`terreno-loop-campaign` is the invocable outer loop; it must never be recorded as a
`stage` value.

A scan is not a code change. Scan stages discover, prioritize, and shape work; the
Terreno lifecycle (`terreno-1-grow`, `terreno-2-pick`, `terreno-3-roast`,
`terreno-4-brew`, `terreno-5-taste`) implements and ships it. No scan stage edits
product code, commits, pushes, or opens a PR.

Two outer loops drive the stages. `terreno-loop-campaign` runs bounded rounds and stops
at each gate. `terreno-loop-run` stays resident: it keeps the campaign moving, routes
every PR to a named human per [`pr-routing.md`](pr-routing.md), and heartbeats over open
PRs per [`heartbeat.md`](heartbeat.md) so review comments, red CI, and merges are handled
without a person restarting anything.

| Owner | Responsibility |
| --- | --- |
| Campaign loop | when to invoke, which agent, persistence, retry, stop, escalation, lifecycle handoff |
| Resident loop | the same, plus PR routing, the heartbeat over open PRs, and scheduling |
| Scan stage | one bounded transition plus its evidence |
| Lifecycle stages | implementing, proving, submitting, and landing one plotted slice |
| Repository skills | repository commands, architecture, safety rules, and domain conventions |
| Campaign state | what a fresh invocation needs from previous rounds |

Every stage reads durable inputs, performs one bounded transition, writes campaign
state, emits one result document, and exits. Never rely on conversational memory.

## Stages

| Stage | Transition | PASS next |
| --- | --- | --- |
| `aim` | Goal, metric, baseline, detection rules, exclusions, validity rule, severity rubric, slice policy; human approval | `sweep` |
| `sweep` | Shard the rule hits and map parallel workers over the shards into candidate findings | `sift` |
| `sift` | Reduce: dedupe, verify, drop unfounded, rank, write the findings report | `plot`, or `track` when the round is dry |
| `plot` | Turn ranked findings into PR-sized slices and hand the top slice to the lifecycle | `track` with `handoff: grow` |
| `track` | Re-measure the goal metric, close or reopen findings, record the round, choose the next move | `plot`, `sweep`, or `null` |

## Goal before findings

A campaign exists to move one measurable goal, not to collect observations. Aim must
produce a metric with a command that prints it, a baseline captured by running that
command, and a target. Every later stage justifies its output by that metric:

- A detection rule that cannot plausibly move the metric does not belong in the charter.
- A finding that cannot be tied to the metric is dismissed in Sift, not deferred.
- A slice that lands without a metric re-measurement in Track is unproven work.

See [`goal-tracking.md`](goal-tracking.md).

## Evidence

Every candidate and every finding carries reproducible evidence: a `path:line`
anchor plus the command, query, probe output, or artifact that produced it. Findings
without evidence are dropped in Sift, never carried forward with a caveat. Never persist
chain-of-thought, worker transcripts, or speculative narration.

## Discover supporting skills

At the start of every stage:

1. Inspect skills exposed by the harness and repository.
2. Match their descriptions to **this round's rules, files, and findings**, not the
   whole catalog.
3. Load applicable `SKILL.md` files before acting and record their names in `skills`.
4. If repository instructions require a capability and it is unavailable, return
   `BLOCKED`; never silently skip it.
5. If no skill applies, infer conventions from repository instructions, existing code,
   tests, package scripts, and recent analogous changes.

The lifecycle plugin's stages perform their own discovery once a slice is handed off.
Scan stages do not pre-resolve implementation skills for them.

## Map workers

Sweep spawns fresh workers with no parent memory. Each worker receives a
**shard briefing** and returns schema-valid findings only. Workers never reconstruct the
repository, never run a full-branch diff, never spawn nested workers, and never edit
files. See [`mapreduce.md`](mapreduce.md).

## Documentation

Scan stages write scan artifacts (charter, findings report, round records). They do not
write product architecture docs. The plotted slices carry documentation work: every task
Plot writes names the docs to create or update, and the lifecycle's documentation
contract applies when that slice runs.

## Stage result

The machine-readable result is for the next skill and the campaign loop. It is **not**
the human-facing answer.

Lead the chat with `status`, `next`, and `action` in one or two lines, plus the current
metric when the stage measured one. Put the YAML only in a collapsed details block.

The schema is [`scan-result.schema.json`](scan-result.schema.json) (`v: 2`). Required
keys are `v`, `stage`, `status`, `next`, and `action`. Omit nulls and empty arrays.
Status values are exactly `PASS`, `FAIL`, `BLOCKED`, or `PENDING`.

Wrap the YAML:

```html
<details>
<summary>Scan result</summary>
</details>
```

Example payload:

```yaml
v: 2
stage: sift
status: PASS
goal: reduce-cold-build-time
round: 2
found: 31
kept: 12
metric:
  value: 48.2
  unit: s
  ev: "bun run compile (cold): 48.2s"
artifacts:
  - docs/scans/reduce-cold-build-time/round-2-findings.md
next: plot
action: Slice the four high-severity findings into the first PR-sized unit of work
```

| Key | Meaning |
| --- | --- |
| `goal` | campaign goal slug |
| `round` | current sweep round |
| `metric` | measured metric value, unit, delta, and the command that produced it |
| `found` / `kept` / `closed` | candidate, surviving, and resolved finding counts |
| `skills` | supporting skills loaded |
| `artifacts` | charter, candidate file, findings report, slice briefs |
| `handoff` | lifecycle stage the campaign must invoke next (`grow` or `pick`) |
| `fail` | `need` / `want` / `got` / `ev` |
| `block` | `kind` / `why` / optional `ev` |
| `ask` | human questions: `q` / `rec` / optional `opts` |
| `next` | recommended next scan stage or `null` |
| `action` | concrete next action |
| `wait` | seconds until the campaign should check a handed-off slice again |

## Campaign state

The charter and the findings report remain authoritative for scope and evidence.
Campaign state is a small loop-owned handoff, not a third plan.

Use an existing repository convention when present. Otherwise use
`.terreno/scan/<goal-slug>.json`, conforming to
[`scan-state.schema.json`](scan-state.schema.json). The campaign loop must preserve or
transport this file between fresh invocations. Do not commit it unless the repository
explicitly tracks scan state; lifecycle Brew must exclude loop-owned state from PR
commits.

Each invocation:

1. Read state and verify its goal, round, branch, and findings against reality.
2. Increment `attempt` for the invoked stage.
3. Consume `last` and prior `tried` approaches; do not repeat a failed approach without
   new evidence.
4. Perform the stage.
5. Replace `last`, merge artifact references, and set `next`.
6. Emit the same result to the caller so the loop can persist it elsewhere.

These six operations are mandatory whenever a stage says "update campaign state." Every
result also includes a concrete `action`, even when `next` is `null`.

If no writable artifact exists, still emit the result. If the campaign loop cannot
preserve that result for the next fresh invocation, return `BLOCKED` and name the
missing state transport.

## Failures, blockers, and pending

- `FAIL`: objective failure of this stage — an unproven detection rule, a malformed
  candidate set, a findings report that contradicts its evidence. Preserve exact
  evidence and recommend the smallest retry.
- `BLOCKED`: no safe action exists now. Classify `human`, `environment`, `access`, or
  `external`; include the exact action or decision required.
- `PENDING`: a handed-off slice is still moving through the lifecycle, a PR is waiting on
  review or CI, or a long measurement has not finished. Include `wait`; the **campaign or
  resident loop** waits and invokes again. Prefer the harness's native completion hook or the provider's watch hook over
  sleep polling; use a timer only when no hook applies.
- `PASS`: this stage's success conditions are proven for the recorded round.

Human gates include the goal statement and target, destructive or irreversible
remediation, public API or data-format changes surfaced by findings, scope growth beyond
the approved charter, and policy-required approval. Include options, tradeoffs,
evidence, and a recommended default.

A campaign requesting human input must first summarize goal state, metric movement,
completed rounds, decisive evidence, options and impact, and a recommended default. It
ends with one exact question, then the Demo section when a handed-off PR has deployment
URLs. Objective failures are not human gates while a concrete safe action remains.
