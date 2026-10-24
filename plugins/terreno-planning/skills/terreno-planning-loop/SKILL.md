---
name: terreno-planning-loop
description: Drive the planning plugin from the current task list, optionally restricting which stages run (Grow, Pick, Roast, Brew, Taste). Not a sixth stage — an outer loop that invokes existing stage skills. Use when asked to run the planning loop, walk the task list, or restrict work to selected phases.
---

# Planning loop (outer driver)

Not a stage. The five stages stay Grow, Pick, Roast, Brew, Taste. This skill
walks the **current** task list and invokes those stage skills in order.

Pick owns the inner **pick → roast → next-task → brew** loop (see
`plugins/terreno-planning/references/pick-roast-loop.md`). This outer loop
must **not** Pick then Roast per task as a second driver. If `pick` is in
the requested phases, invoke Pick **once**; Pick roasts each task and
continues. If `roast` is requested **with** `pick`, do not start a second
Roast driver.

## When to use

- The user asks to run the planning loop, walk the task list, or keep going
  until the list is empty.
- The user names phases (`grow`, `pick`, `roast`, `brew`, `taste`) and wants
  only those stages.
- Default when the user says "planning loop" with no phases:
  **Grow, then Pick** (Pick includes Roast for each task, then Brew).

## Parse phases

Read the user message for a phase list, in this order:

1. `phases=` (comma-separated, case-insensitive)
2. A bare comma-separated list of allowed tokens (`grow,roast` or
   `grow, pick, brew`)
3. Tokens after `/terreno-planning-loop` or the skill name

Allowed tokens: `grow`, `pick`, `roast`, `brew`, `taste`.

Ignore unknown tokens. Deduplicate while preserving order.

If nothing remains after filtering, use `grow,pick,roast`.
That default still means Grow then Pick — Roast is owned by Pick, not a
second outer-loop pass.

## Read first

Read the shared [`lifecycle contract`](../../references/lifecycle-contract.md),
[`loop engineering`](../../references/loop-engineering.md),
[`pick-roast inner loop`](../../references/pick-roast-loop.md), and
[`PR deployments`](../../references/pr-deployments.md). When Brew or Taste is
selected, also read [`product CI`](../../references/product-ci.md). Then:

1. `plugins/README.md` — Hosts and stage skills
2. Each selected stage skill under `plugins/terreno-planning/skills/`

## Drive the selected phases

Stay on the current branch. Do not start a nested PR. One logical commit
per completed unit of work.

### Grow (`grow`)

If `grow` is selected and the task list is empty or missing, invoke
`terreno-1-grow` once (shape / confirm the list). Skip Grow when a current
list already exists unless the user asked to reshape.

If Grow emits `FAIL`, stop. Do not invent tasks.

### Pick (`pick`) — includes Roast

If `pick` is selected, invoke `terreno-2-pick` **once**. Pick:

1. Takes the next unchecked task
2. Implements it
3. Invokes Roast for that task
4. On Roast `PASS`, continues to the next unchecked task
5. After the last task, emits `next: brew` (unless `brew` was excluded — then
   stop after the last Roast `PASS` and tell the user Brew is the next
   human/agent step)

Do not wrap Pick in an outer per-task loop. Do not invoke Roast yourself
when Pick is in the phase list.

If Pick emits `FAIL`, stop.

Honor Pick's `next` / `wait` when it yields.

### Roast (`roast`) without Pick

If `roast` is selected and `pick` is **not**, invoke `terreno-3-roast`
once for the current in-progress task (prove / tests). Do not start Pick's
inner loop.

If Roast emits `FAIL`, stop.

### Skip Roast when Pick is selected

If both `pick` and `roast` appear in `phases=`, treat Roast as already
owned by Pick. Do not invoke `terreno-3-roast` as a second driver.

### Brew (`brew`)

If `brew` is selected, invoke `terreno-4-brew` after the selected pre-submit stages.
Pick emits `next: brew` at the end of its inner loop; it does not invoke Brew itself.

If Brew emits `FAIL`, **do not stop the outer loop**. Read Brew's `next`
field and continue with that stage in the same invocation:

- `next: pick` — invoke `terreno-2-pick` (which will Roast again as part of
  its inner loop)
- `next: roast` — invoke `terreno-3-roast` (only when Pick is not driving)
- `next: brew` — invoke `terreno-4-brew` again for a submission-only retry; honor
  `wait` when provided

Keep following Brew `FAIL` → `next` until Brew emits `PASS` or `FAIL` with
no recoverable `next`, or a non-Brew stage emits `FAIL`. Then stop.

If Brew emits `PASS`, continue to Taste only when `taste` is selected.

### Taste (`taste`)

If `taste` is selected, invoke `terreno-5-taste` after Brew `PASS` (or
after the last selected earlier stage if Brew was omitted). Taste reacts
to review on the current PR; it does not walk the task list.

If Taste emits `PASS`, stop. If Taste emits `FAIL` with a new evidence-based
hypothesis, invoke fresh Taste; a `FAIL` without one is `BLOCKED`. On `BLOCKED`, stop
and escalate per [`push ownership`](../../references/push-ownership.md#escalation).
Never stop on a red PR without that escalation. If Taste emits `PENDING`, honor
`wait` / `next`. During that bound, prefer the product-CI provider's native watch hook
or a harness event subscription; use a timer only when no hook applies. Invoke fresh
Taste as soon as the hook returns. Taste already waited in-process for CI on the
previous invocation; `PENDING` means that wait timed out or a second push landed.

## Isolation and hosts

Same rules as the stage skills: one git checkout, no nested worktrees for
the loop itself, no extra `gh` auth, no `git config`. Cursor, Claude,
Codex, and Gemini all invoke this the same way — only the skill path
differs (see Hosts in `plugins/README.md`).

## Emit (required)

After the last stage you ran, emit **only** a YAML object in a collapsed
Markdown `<details>` block. Use `status: PASS` when every selected stage
that ran emitted `PASS` (or Brew `FAIL` that you recovered by following
`next` through to a later `PASS`). Use `FAIL` if any stage stopped the
loop. Use `PENDING` if a stage asked you to wait.

```yaml
v: 2
stage: pick
status: PASS
next: brew
action: Planning loop finished selected phases.
```

Set `stage` to the last stage skill you invoked (`grow` | `pick` |
`roast` | `brew` | `taste`). Required keys are `v`, `stage`, `status`,
`next`, and `action`. Omit `wait` unless the last stage asked you to
wait (`wait` is a positive integer). After that YAML, close with PR
deployment URLs when the current PR has them.
