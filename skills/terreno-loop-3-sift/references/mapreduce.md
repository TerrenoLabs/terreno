# Agentic map-reduce

One agent reading a whole repository finds shallow problems and forgets the first file by
the last. A scan instead **plans** detection rules, **shards** their hits into small
batches, **maps** a fresh worker over each batch, and **reduces** the returned candidates
into one ranked findings list.

```text
Aim   → rules, exclusions, validity rule, severity rubric   (plan)
Sweep → rule hits → deterministic shards → parallel workers (shard + map)
Sift  → dedupe → verify → drop → rank → report              (reduce)
```

## Plan (Aim)

Each detection rule records:

| Field | Meaning |
| --- | --- |
| `name` | stable slug used by every later stage |
| `query` | the exact command: `rg` pattern, AST query, dependency query, build probe |
| `matches` | what a hit means in one sentence |
| `why` | how a fix moves the goal metric |
| `exclude` | globs this rule must not report on |

A rule is not approved until it has been **dry-run** and its hit count recorded. A rule
with zero hits is removed or rewritten in Aim, never carried into Sweep as an empty
promise. A rule with hits in the tens of thousands is narrowed before it ships.

Default exclusions unless the charter says otherwise: dependency directories, build
output, generated trees, lockfiles, snapshots, vendored code, and fixtures.

## Shard (Sweep)

Sharding is deterministic so a re-run of the same round produces the same shards:

1. Run every approved rule and collect hits as `path:line:rule`.
2. Group hits by their nearest meaningful unit — package, then directory, then file.
3. Pack groups into shards up to the charter's shard budget (default: at most 25 files
   or 80 hits per shard, whichever is reached first). Never split one file across shards.
4. Sort shards by path so the manifest is stable, and write the manifest to the round's
   artifact directory.
5. Cap the number of shards at the charter's limit. When the cap truncates coverage,
   record exactly which groups were dropped and why in the result — silent truncation
   reads as "we looked everywhere" when the scan did not.

## Map (Sweep)

Each shard gets one fresh worker with no parent conversation. The briefing contains only:

- the goal statement and metric, in one sentence each
- the rules in play for this shard, with their `matches` and `why`
- the shard's file list and the hit lines
- the validity rule and severity rubric, quoted
- the named commands the worker may run
- the findings schema and the instruction to return that JSON and nothing else

Worker rules:

1. Treat the briefing as the working set. Do not scan outside the shard's files except
   to read a definition or caller the shard's hits point at.
2. Do not run a full-repository search, a full-branch diff, or the skill catalog.
3. Do not spawn nested workers.
4. Do not edit files, stage changes, or run anything destructive.
5. Every candidate carries a `path:line` anchor plus the evidence that proves it.
6. Report "no valid candidates" plainly; an empty shard is a normal outcome, and
   inventing a marginal finding to look productive is a defect.

Run workers concurrently up to the harness's practical limit. A worker that fails is
retried once with the same briefing; a second failure records the shard as failed in the
result and does not fail the whole sweep.

## Reduce (Sift)

1. **Normalize.** Give every candidate a dedupe key of `rule + path + symbol`. Merge
   candidates that describe the same defect at different anchors into one finding with
   all anchors listed.
2. **Verify.** Re-check each surviving candidate against the charter's validity rule.
   For `high` severity, verify adversarially: try to refute the finding, and keep it only
   when refutation fails. Re-run the candidate's evidence command where one exists.
3. **Drop.** Remove candidates whose evidence does not reproduce, whose anchor no longer
   exists, that the validity rule excludes, or that cannot be tied to the goal metric.
   Record the drop count and the top drop reasons.
4. **Rank.** Order by goal impact × confidence ÷ effort. Severity is the charter's
   rubric, not the worker's opinion.
5. **Report.** Write the findings report: goal and metric header, one row per finding
   with severity, effort, anchors, and evidence, then the dropped-candidate summary.

A round that keeps zero findings is a valid result. Report it as a dry round and let
Track decide whether to re-aim, widen the rules, or declare the goal met.
