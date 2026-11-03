---
name: 3-sift
description: Reduce raw scan candidates into a trustworthy findings report — dedupe, adversarially verify, drop what does not reproduce or does not move the goal metric, rank by impact over effort, and write the round's findings report. Use after a sweep returns candidates; not for running detection rules, shaping goals, or writing code.
---

# Sift — reduce

Turn a pile of worker candidates into a short, ranked, defensible findings list. A
finding that survives Sift is one an engineer can act on without re-investigating.

Read the shared [`scan contract`](../../references/scan-contract.md),
[`agentic map-reduce`](../../references/mapreduce.md), and
[`goal tracking`](../../references/goal-tracking.md) before acting.

## Preconditions

- A sweep for the current round produced a candidate artifact.
- The charter's validity rule, severity rubric, and effort scale are available.
- This invocation owns reduction only. It never edits product code.

## Inputs

- Candidate findings artifact and shard manifest for this round
- Charter: validity rule, severity rubric, effort scale, exclusions, metric
- Campaign state: prior findings and their status, including previously dismissed ones

## Procedure

1. **Reconstruct.** Read campaign state, the charter, and the round's candidates. Verify
   the recorded head still matches the working tree; re-anchor or re-sweep if it moved.
2. **Normalize and dedupe.** Give each candidate the dedupe key `rule + path + symbol`.
   Merge candidates describing one defect at several anchors into one finding carrying all
   anchors. Fold candidates matching a previously dismissed finding into that dismissal
   instead of resurrecting them, unless new evidence contradicts the dismissal.
3. **Verify.** Re-check each surviving candidate against the validity rule. Re-run the
   candidate's evidence command when it has one. For every `high` severity candidate,
   verify adversarially: state the strongest case that the finding is wrong, and keep it
   only when that refutation fails. Downgrade confidence rather than deleting evidence.
4. **Drop.** Remove candidates whose evidence does not reproduce, whose anchor no longer
   exists, that an exclusion covers, or whose link to the metric cannot be stated in one
   sentence. Count the drops and the top drop reasons.
5. **Rank.** Score by goal impact × confidence ÷ effort. Apply the charter's severity
   rubric yourself; a worker's severity is an input, not the verdict.
6. **Report.** Write the round's findings report to the repository's scan convention
   (default `docs/scans/<goal-slug>/round-<n>-findings.md`): goal and metric header, the
   ranked findings table with severity, effort, anchors, and evidence, one short paragraph
   per high-severity finding, and the dropped-candidate summary with counts and reasons.
7. **Persist.** Merge surviving findings into campaign state with status `open`, keep the
   dismissal record for dropped ones, update state, and emit the result.

## Constraints

- No finding ships without reproducible evidence and a stated metric link.
- No silent deletion: every dropped candidate is counted and its reason categorized.
- Severity comes from the charter's thresholds, never from adjectives.
- A round that keeps zero findings is a valid dry round, not a failure.

## Supporting skills

Follow the shared discovery procedure. Verification of a candidate may require the same
build, test, performance, or domain skills the rules named.

## Evidence produced

- Findings report path, kept count, and dropped count with reasons
- Per-finding severity, confidence, effort, anchors, and evidence
- Adversarial verification outcome for every high-severity finding
- Updated campaign state and structured Sift result

## Success conditions

- Every kept finding is deduped, verified, evidenced, ranked, and tied to the metric.
- Every high-severity finding survived an explicit refutation attempt.
- A fresh Plot invocation can slice the work from the report alone.
- Emit `PASS` with `next: plot`, or `PASS` with `next: track` when the round is dry.

## Failure conditions

Candidates that cannot be read or validated, a report that contradicts its own evidence,
or unverifiable high-severity claims emit `FAIL` with exact defects and `next: sift`, or
`next: sweep` when the candidate set itself is unusable.

## Blocked conditions

Missing tooling needed to reproduce evidence, or a metric link that requires a product
decision, emits `BLOCKED` with the exact decision or capability required.

## Recommended next stage

- `PASS` with findings → Plot
- `PASS` with no findings → Track (dry round)
- `FAIL` → Sift, or Sweep when candidates are unusable
- `BLOCKED` → campaign loop routes the named gate
