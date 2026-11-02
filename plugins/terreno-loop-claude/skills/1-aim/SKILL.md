---
name: 1-aim
description: Turn a long-term codebase goal into an approved scan charter — measurable metric, captured baseline, dry-run detection rules, exclusions, validity rule, severity rubric, and slice policy. Use when asked to scan a codebase for an outcome ("improve build time", "find N+1 queries", "reduce maintenance overhead", "make us WCAG-compliant"), to set a long-term engineering goal, or to start or reshape a scan campaign; not for implementation, PR operations, or one-off searches.
---

# Aim — charter the goal

Turn "make the codebase better at X" into a charter a fresh Sweep agent can execute
without conversation history, and a metric that proves whether the campaign worked.

Read the shared [`scan contract`](../../references/scan-contract.md),
[`agentic map-reduce`](../../references/mapreduce.md),
[`goal tracking`](../../references/goal-tracking.md),
[`PR routing`](../../references/pr-routing.md), and the
[`charter template`](references/charter.md) before acting.

## Preconditions

- A goal, outcome, or complaint plus a repository are available.
- This invocation owns charter shaping only. It never edits product code. After
  `PASS`, Sweep runs the scan.

## Inputs

- The requested outcome and any linked context
- Existing charter, campaign state, and prior findings when the goal already exists
- Repository instructions, code, tests, build scripts, CI config, and available skills

## Procedure

1. **Reconstruct.** Resolve the repository's scan conventions from its instructions and
   nearby artifacts. If none exists, use `docs/scans/<goal-slug>/charter.md` for the
   charter and `.terreno/scan/<goal-slug>.json` for campaign state, and record the new
   convention. Read prior state and verify it against repository reality.
2. **Read architecture docs.** Load the architecture, domain, and operator docs for the
   areas the goal touches. They define what "correct" means before any rule is written.
3. **Discover supporting skills.** Load repository/project skills matching the goal's
   domains. Record them for downstream stages.
4. **Make the goal measurable.** Derive the metric, its command, unit, direction,
   target, horizon, and budget per `goal-tracking.md`. Run the metric command now and
   quote its output as the baseline. If nothing measurable exists, grill for a proxy or
   return `BLOCKED` naming the missing instrumentation — never a judgment-only metric.
5. **Grill the human frontier.** Work one decision frontier at a time using selectable
   options with a recommended default and the harness's structured question tool when it
   has one. Settle: the outcome statement, the target and horizon, what is explicitly out
   of scope, which trade-offs are unacceptable (for example "no public API breaks"), and
   the budget. Vague or conflicting answers stay on the frontier.
6. **Settle review routing.** Ask who reviews the campaign's PRs and record the `review`
   block from `pr-routing.md`: mode, reviewer and assignee handles, teams, draft policy,
   labels, the open-PR limit, the merge policy, and how to notify. Verify every handle is
   requestable before writing it. "Whoever is free" is not an answer — resolve it to a
   mode and a list, or to an explicit `mode: none`. This is the decision that makes an
   unattended run safe to leave running.
7. **Write detection rules.** For each rule record `name`, `query`, `matches`, `why`
   (its link to the metric), and `exclude`. Dry-run every rule, record its hit count, and
   remove or narrow rules that return nothing or flood. A rule that cannot plausibly move
   the metric does not ship.
8. **Define validity and severity.** State in one sentence what makes a finding valid,
   and give the severity rubric concrete thresholds (`high` / `medium` / `low`) plus the
   effort scale (`S` / `M` / `L`). Workers and Sift use these words verbatim.
9. **Set the slice policy.** How findings become PR-sized units: maximum files and
   findings per slice, what must never be mixed in one slice, and which findings require
   their own slice because they are risky or reviewer-heavy.
10. **Write and approve.** Produce the charter from the template, capture the baseline in
   campaign state, and post the standalone approval brief: where the repository is today,
   the goal and metric, the rules with their hit counts, the exclusions, the severity
   rubric, the slice policy, and the decisions table pairing each settled decision with
   the question that prompted it. Mark the charter approved only after human
   confirmation. Update campaign state and emit the result collapsed per the scan
   contract.

## Supporting skills

Follow the shared discovery procedure. Useful skills typically cover build/test tooling,
static analysis, performance measurement, accessibility, data access, or security,
depending on the goal. Names are repository-defined; none is universally required.

## Evidence produced

- Charter path and campaign-state path
- Metric definition plus the baseline command output, quoted
- Detection rules with dry-run hit counts
- Exclusions, validity rule, severity rubric, effort scale, slice policy
- Review block: mode, verified reviewer/assignee handles, draft and label policy,
  open-PR limit, merge policy
- Decisions table with the question that prompted each decision
- Selected supporting skills and the approved `PASS` result

## Success conditions

- The metric has a command that prints a number, and the baseline was measured here.
- Every rule is dry-run-proven with a recorded hit count and a stated link to the metric.
- A fresh Sweep invocation can shard and brief workers from the charter alone.
- Every campaign PR has a named, verified destination, or the charter states `mode: none`.
- A reviewer with no prior context can approve or push back from the brief alone.
- Emit `PASS` with `next: sweep`.

## Failure conditions

An unmeasured baseline, an unproven rule, a missing validity rule, or a charter that
contradicts itself emits `FAIL` with exact defects, `next: aim`, and a focused retry.
Do not pass an unproven charter to Sweep.

## Blocked conditions

Unresolved goal or target decisions, a metric the repository cannot produce, a reviewer
handle that cannot be verified, or missing access to build/measurement tooling emit
`BLOCKED` with `next: null`, options, tradeoffs, and a recommended default.

## Recommended next stage

- `PASS` → Sweep
- `FAIL` → Aim with defect evidence
- `BLOCKED` → campaign loop routes the named human/external gate
