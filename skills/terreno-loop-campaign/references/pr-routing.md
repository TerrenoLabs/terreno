# PR routing

Every slice PR reaches a named human. A campaign that opens unassigned PRs is producing
work nobody owns.

Routing is decided once in Aim, recorded in the charter's `review` block, and applied by
the campaign or the loop immediately after Brew creates the PR. It is never re-decided
per PR by guesswork.

## The review block

| Field | Meaning |
| --- | --- |
| `mode` | `fixed`, `codeowners`, `blame`, `round-robin`, or `none` |
| `reviewers` | Login handles requested for review |
| `assignees` | Login handles set as assignee (who owns landing it); defaults to `reviewers` |
| `teams` | Org team slugs requested for review, when the host supports them |
| `draft` | Open PRs as drafts and mark ready only when CI on the head is green |
| `labels` | Labels applied to every campaign PR, for example the goal slug |
| `wipLimit` | Maximum campaign PRs open at once |
| `mergePolicy` | `human` (default), or `agent-after-approval` with its exact conditions |
| `notify` | How to nudge: PR body mention, no mention, or a named external channel |

## Modes

| Mode | Resolve reviewers by |
| --- | --- |
| `fixed` | The charter's explicit handles. Simplest, and the default when one person owns the goal. |
| `codeowners` | The repository's `CODEOWNERS` entries for the slice's touched paths. Let the host apply them; do not duplicate the request. |
| `blame` | The most frequent recent authors of the slice's touched files, excluding bots and the campaign's own commits. Cap at two. |
| `round-robin` | Rotate through the charter's handle list, one per slice, recorded in state so the rotation survives a fresh invocation. |
| `none` | Open the PR unassigned because the repository routes review elsewhere. Valid only when the charter says so explicitly. |

When a mode resolves to nobody — no `CODEOWNERS` match, blame returns only bots, an empty
handle list — fall back to the charter's `reviewers`, and if that is also empty, stop and
ask. Do not invent a handle, and do not guess one from a commit email.

## Applying routing

After Brew reports the PR, and before the loop counts the slice as in flight:

```bash
gh pr edit <pr> --add-reviewer <handle> --add-assignee <handle> --add-label <label>
gh pr ready <pr>            # only when draft is true and CI on the head is green
```

Record on the slice in campaign state: `pr`, `reviewer`, `assignee`, and the routing mode
that chose them. A slice whose PR exists with no recorded reviewer is not routed yet; the
next heartbeat tick routes it before doing anything else with that PR.

When a push addresses changes that were requested, re-request review from the same
handles rather than waiting silently:

```bash
gh pr edit <pr> --add-reviewer <handle>
```

## Verifying a handle

Before using a handle the campaign has not used before, verify it can be requested:

```bash
gh api "repos/{owner}/{repo}/collaborators/<handle>" --silent
```

A handle that fails verification is `BLOCKED` with `kind: human`: name the handle, say it
could not be requested, and ask who should review instead. Never quietly open the PR
unassigned when the charter asked for a reviewer.

## What the campaign must not do

- Do not approve its own PRs, dismiss reviews, or resolve another person's review thread.
- Do not merge when `mergePolicy` is `human`, even with approval and green CI.
- Do not `@`-mention on every push. One routing action per PR, plus one re-request when
  requested changes have been addressed.
- Do not exceed `wipLimit`. Waiting on review is correct behavior, not a reason to start
  more work.
