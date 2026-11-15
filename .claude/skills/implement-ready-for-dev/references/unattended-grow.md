# Unattended Grow (ready-for-dev)

Grow's grilling skill waits for a human. This skill is the operator. Do not send a
chat round. Do not treat Grow `BLOCKED` as a chat pause.

Read [`terreno-1-grow`](https://github.com/TerrenoLabs/terreno-skills/blob/master/plugins/terreno-planning/skills/terreno-1-grow/SKILL.md)
and its [`grilling`](https://github.com/TerrenoLabs/terreno-skills/blob/master/plugins/terreno-planning/skills/terreno-1-grow/references/grilling.md)
procedure, then apply the overrides below.

## Classify every unknown

| Kind | Action |
| --- | --- |
| Discoverable fact | Look it up in the repo, docs, tests, and git history. Never ask. |
| Low-risk implementation detail | Choose the convention-implied default. Record the assumption. |
| Implied by `$TRUSTED_BODY` | Use Outcome, Non-scope, Acceptance, and Current behavior. Record the assumption. |
| Genuine human gate | Post on the GitHub issue and stop. Do not invent. |

A **genuine human gate** is a decision that changes product intent, security/authz,
data ownership, public API compatibility, destructive migration, production rollout,
or scope **and** cannot be read from `$TRUSTED_BODY` plus architecture docs.

Not a genuine human gate:

- Which file, test command, or existing pattern to use
- Missing roastable wording when Outcome + Current behavior already imply the destination
- Docs page to update (`update-docs` in the same slice)
- Task split, tracer-bullet seam, or naming that follows repo convention
- Grow's "confirm shared understanding" pause — you confirm it

If Acceptance is missing, derive observable criteria from Outcome and Current behavior
when those sections exist. If both Outcome and Acceptance are empty or contradict
Non-scope, that is a genuine human gate.

## Frontier loop (no chat)

1. Research in parallel. Fill facts.
2. Compute the frontier.
3. For each frontier item that is not a genuine human gate: take Grow's recommended
   default (or the docs/convention default), write it as an assumption, unlock children.
4. Repeat until the frontier is only genuine human gates or empty.
5. If any genuine human gate remains, post and stop. Do not write IP/tasks as approved.
6. If the frontier is empty, skip Grow's confirm-and-write wait. Write the IP and task
   list. Put Grow's standalone approval brief in the run report, not as a chat blocker.
   Assumptions you took in place of grilled answers belong in its Decisions table, with
   the question each one answers and `assumed` as the source.

Cap recorded assumptions at the decisions that affect Pick. Do not log lookup facts
as assumptions.

## GitHub human-gate comment

First line must be exactly `<!-- terreno-ready-for-dev-human-gate -->`.

```markdown
<!-- terreno-ready-for-dev-human-gate -->
## Human gate — implement-ready-for-dev stopped

Grow cannot assume the next decision. Reply on this issue, then re-apply
`status:ready-for-dev` (unassigned) when it is roastable.

❓ **Q1** — **<short title>**: <context>
Options: A / B / C
➡️ Recommend: <answer, one-line why>

Shared understanding so far:
- Destination: <one sentence>
- In: <comma-separated>
- Out: <comma-separated>
```

Apply `status:needs-info`, remove `status:in-progress`, unassign yourself. Do not
start Pick.
