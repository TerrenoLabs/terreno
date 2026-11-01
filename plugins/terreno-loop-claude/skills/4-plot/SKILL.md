---
name: 4-plot
description: Turn ranked scan findings into PR-sized slices and hand the top slice to the Terreno IP and task system, writing a Grow-ready brief with metric-linked acceptance criteria and verification methods for each slice. Use after a sift produces a findings report; not for discovering findings, implementing them, or PR operations.
---

# Plot — findings to IPs and tasks

A findings report is not work. Plot converts ranked findings into ordered, PR-sized
slices and hands the top one to the lifecycle, which owns the IP, the task list, and the
implementation.

Read the shared [`scan contract`](../../references/scan-contract.md),
[`goal tracking`](../../references/goal-tracking.md), and
[`PR routing`](../../references/pr-routing.md) before acting.

## Preconditions

- A findings report exists for the current round with at least one kept finding.
- The charter's slice policy and budget are available.
- The lifecycle skills (`1-grow`, `2-pick`, `3-roast`,
  `4-brew`, `5-taste`) are installed. If they are not, emit `BLOCKED`
  naming the missing plugin — Plot must not implement findings itself.

## Inputs

- Findings report and campaign state for this round
- Charter: slice policy, budget, unacceptable trade-offs, metric
- Repository IP/task conventions and available skills

## Procedure

1. **Reconstruct.** Read campaign state and the findings report. Resolve the repository's
   IP and task conventions the same way Grow does; do not invent a second convention.
   Skip findings already `planned`, `fixed`, or `dismissed`.
2. **Slice.** Group open findings into units that fit the charter's slice policy: one
   theme per slice, within the file and finding caps, never mixing combinations the
   charter forbids, and giving risky or reviewer-heavy findings their own slice. Order
   slices by rank, then by dependency — a slice that unblocks others goes first.
3. **Respect the budget.** Plan at most the charter's slices per round and never exceed
   its open-PR limit (`wipLimit`) counting PRs already open. Findings beyond the budget stay `open` for the next round; say so
   explicitly rather than quietly dropping them.
4. **Write a Grow brief per slice.** Each brief is standalone and contains:
   - the goal statement, the metric, and the current value
   - the findings in this slice with their anchors, evidence, and proposed fixes
   - the acceptance criteria, each observable and each paired with a verification method
     (test, build probe, runtime/API/database check, artifact, regression case)
   - at least one criterion that ties back to the metric or names why this slice cannot
     move it alone
   - the unacceptable trade-offs from the charter, quoted
   - the docs the slice must create or update
   - known blockers, dependencies on other slices, and residual risk
   - the reviewer and assignee this slice routes to, resolved from the charter's `review`
     block; a slice whose routing cannot be resolved is `BLOCKED`, not opened unassigned
5. **Persist the plan.** Write briefs to the round's artifact directory, record every
   slice in campaign state with status `planned` and its finding ids, and mark those
   findings `planned` with their slice slug.
6. **Hand off.** Emit `PASS` with `next: track` and `handoff: grow`, naming the top
   slice's brief path. The campaign loop invokes `1-grow` with that brief, then
   the Pick/Roast inner loop, then Brew and Taste. Plot itself never invokes them, never
   edits product code, and never opens a PR.

## Constraints

- Plot writes briefs, not IPs. Grow owns the IP, the task list, and human approval.
- A slice with no metric-linked criterion needs an explicit sentence saying why.
- Never merge findings from different rules into one slice purely to hit the budget.
- Never mark a finding `fixed`; only Track does that, and only with evidence.

## Supporting skills

Follow the shared discovery procedure. Slice briefs may name domain skills for the
lifecycle to load, but Grow and Pick still perform their own discovery.

## Evidence produced

- Slice plan with order, rationale, and the findings in each slice
- Brief path per slice, its resolved reviewer/assignee, and the acceptance-criterion →
  verification mapping
- Findings deferred to a later round, with the budget reason
- Updated campaign state and structured Plot result

## Success conditions

- Every planned slice fits the slice policy and has a standalone, criterion-complete
  brief.
- Every open finding is either planned into a slice or explicitly deferred with a reason.
- A fresh Grow invocation can produce an approved IP and task list from one brief alone.
- Emit `PASS` with `next: track` and `handoff: grow`.

## Failure conditions

Slices that violate the policy, briefs missing verification methods, or findings silently
lost between the report and the plan emit `FAIL` with exact defects and `next: plot`.

## Blocked conditions

A missing lifecycle plugin, an IP convention that cannot be resolved, or a finding whose
fix requires a product, security, or compatibility decision emits `BLOCKED` with options,
tradeoffs, and a recommended default.

## Recommended next stage

- `PASS` → Track, after the campaign loop runs the handed-off slice through Grow, the
  Pick/Roast inner loop, Brew, and Taste
- `FAIL` → Plot with defect evidence
- `BLOCKED` → campaign loop routes the named human/external gate
