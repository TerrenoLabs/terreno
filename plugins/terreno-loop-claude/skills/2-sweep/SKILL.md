---
name: 2-sweep
description: Run an approved scan charter across the repository — execute detection rules, shard the hits deterministically, and map fresh parallel workers over the shards into schema-valid candidate findings. Use after a scan charter is approved, or to re-sweep a later campaign round; not for shaping goals, ranking findings, or writing code.
---

# Sweep — shard and map

Execute the approved charter across the repository and return raw candidate findings with
reproducible evidence. Sweep discovers; it does not judge, rank, or fix.

Read the shared [`scan contract`](../../references/scan-contract.md) and
[`agentic map-reduce`](../../references/mapreduce.md), plus the
[`worker briefing`](references/worker-briefing.md), before acting.

## Preconditions

- An approved charter and campaign state exist for this goal.
- The working tree is clean enough that `path:line` anchors are stable; record the head
  SHA the sweep ran against.
- This invocation owns discovery only. It never edits files.

## Inputs

- Charter: rules, exclusions, validity rule, severity rubric, effort scale
- Campaign state: goal, round, prior findings and their status
- Repository code, tests, build output, and available skills

## Procedure

1. **Reconstruct.** Read the charter and campaign state. Verify the branch and head, and
   increment the round when the previous round is closed.
2. **Discover supporting skills.** Load repository skills matching the rules in play.
3. **Run the rules.** Execute each rule's query with its exclusions. Record hit counts per
   rule and compare them to the charter's dry-run counts. A rule that now returns zero or
   an order of magnitude more hits is reported in the result — the repository moved, and
   Sift must know.
4. **Shard.** Group and pack the hits into deterministic shards per the map-reduce
   reference. Write the shard manifest to the round's artifact directory. When the shard
   cap truncates coverage, name exactly what was dropped.
5. **Map.** Spawn one fresh worker per shard with no parent conversation, using the
   worker briefing. Run them concurrently up to the harness's practical limit. Each worker
   returns candidates conforming to
   [`finding.schema.json`](../../references/finding.schema.json) and nothing else.
6. **Collect.** Validate every returned candidate against the schema. Drop malformed
   entries and record how many and from which shard. Retry a failed worker once with the
   same briefing; record a second failure as a failed shard without failing the sweep.
7. **Persist.** Write the candidate set to the round's artifact directory, update campaign
   state with the round, rules, shard count, and candidate count, and emit the result.

## Constraints

- Never edit, stage, or commit files. Never run destructive commands.
- Never let a worker roam outside its shard beyond following a hit's definition or caller.
- Never fabricate a candidate to make a shard look productive; empty shards are normal.
- Never silently truncate. Dropped shards, capped groups, and malformed returns all appear
  in the result.

## Supporting skills

Follow the shared discovery procedure. Typical matches are static-analysis, build,
performance-measurement, or domain skills named by the charter's rules.

## Evidence produced

- Head SHA, round number, and per-rule hit counts with drift against the charter
- Shard manifest path and shard count
- Candidate findings artifact path and candidate count
- Failed shards, malformed candidates, and any coverage the caps dropped

## Success conditions

- Every approved rule ran, or a `FAIL` names the rule that could not.
- Every shard was mapped or explicitly recorded as failed.
- Every candidate validates against the finding schema and carries a `path:line` anchor.
- Emit `PASS` with `next: sift`.

## Failure conditions

A rule that cannot execute, a shard manifest that does not cover the hits, or a candidate
set that fails schema validation emits `FAIL` with exact evidence, `next: sweep`, and the
smallest retry — usually re-running the named rule or re-mapping the named shards.

## Blocked conditions

Missing tooling, unreadable paths, or a harness that cannot spawn workers emits `BLOCKED`
with the exact capability required.

## Recommended next stage

- `PASS` → Sift
- `FAIL` → Sweep with the named rule or shard
- `BLOCKED` → campaign loop routes the named environment/access gate
