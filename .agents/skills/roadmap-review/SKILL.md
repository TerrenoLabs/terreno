---
name: roadmap-review
description: >-
  Run a Terreno roadmap board hygiene pass — find status drift, stale items,
  missing labels, and untriaged inbox entries, then report a prioritized set of
  proposed changes for a maintainer to approve. Trigger with /roadmap-review or
  phrases like "review the roadmap", "is the board accurate", "roadmap hygiene".
---
# Roadmap review

Audit the **Terreno Roadmap** board against reality and propose corrections. Read-only until a maintainer approves a batch.

A public roadmap loses its value the moment it stops being true, and the usual failure is drift: work ships but the card never moves. This skill finds that drift; **a human decides what the board should say.**

Process background: [`docs/explanation/roadmap-process.md`](https://github.com/TerrenoLabs/terreno/blob/master/docs/explanation/roadmap-process.md).

## When to use

- Recurring board hygiene, typically before a release or planning session
- `ROADMAP.md` looks wrong or stale
- Before publishing the roadmap somewhere new, to avoid shipping inaccuracies

## When not to use

- A single inbound item — use `roadmap-triage`
- One discussion to promote — use `roadmap-promote`
- One IP to add — use `roadmap-item`

## Hard rules

1. **Read-only by default.** Gather everything, report, and stop. Apply changes only for items the maintainer names.
2. **Never close an issue or set an item to `Declined` on your own.** Both are public statements about what Terreno will not do.
3. Every claim needs evidence — a merged PR, a commit, an issue state, a date. Do not assert something shipped because it looks finished.
4. Report uncertainty as uncertainty. "No activity since March, cannot tell if abandoned" is more useful than a confident wrong call.

## Procedure

### 1. Gather

Start with the reconciler — it answers most of the hygiene questions mechanically, so the
review only has to reason about what it could not decide:

```bash
bun run roadmap:reconcile
```

It reports status drift between IP headers and the roadmap, plans that shipped without their
entry moving, entries whose IP file was deleted, task lists that disagree with the declared
status, and plans with no roadmap entry at all. Treat its `Needs a human` section as the
review's agenda; it deliberately refuses to guess on exactly the calls this skill exists to
make. `--fix` applies forward status moves and supersessions, and scaffolds an entry for each
plan that has none (fields from the IP's `**Roadmap:**` header, else inferred, so check the
scaffolded Area / Target / Impact). It never applies a revival or a backwards move.

```bash
# Board contents
gh project item-list "$PROJECT_NUMBER" --owner TerrenoLabs --format json --limit 200

# Untriaged and stale issues
gh issue list --label status:needs-triage --state open --json number,title,createdAt,labels
gh issue list --state open --json number,title,updatedAt,labels,url --limit 200

# Discussions that may deserve promotion
gh api graphql -f query='
  query($owner:String!,$repo:String!){
    repository(owner:$owner,name:$repo){
      discussions(first:50, orderBy:{field:UPDATED_AT, direction:DESC}){
        nodes{number title url upvoteCount category{name} updatedAt}
      }
    }
  }' -F owner=TerrenoLabs -F repo=terreno
```

### 2. Check each dimension

| Check | What to look for |
|---|---|
| Status drift | `In progress` with a merged PR, or `Planned` with an open PR already up |
| Shipped but open | `Shipped` on the board while the issue is still open, or the reverse |
| Stale | No activity in 6+ months; propose `status:wontfix` and closure, or a target change |
| Missing labels | Board items without exactly one `area:*` and one `type:*` |
| Target realism | Everything piled into one release is a planning smell, not a plan |
| Inbox backlog | `status:needs-triage` older than a week |
| Promotion candidates | High-upvote Ideas with no tracking issue |
| Blocked items | `status:blocked` whose blocker has since merged |
| Wayfinder maps | Frontier contains blocked/closed/claimed work, resolved decisions are not indexed, or fog has become precise enough to ticket |

Validate any label or field change you intend to propose:

```bash
bun run roadmap:check --on-board --labels "roadmap,area:api,type:feature" --status "In progress"
```

### 3. Report

Group findings by **what the maintainer must decide**, not by issue number:

1. **Shipped, needs closing** — evidence per item (merged PR link)
2. **Status corrections** — current versus proposed, with evidence
3. **Needs a human call** — stale items, retargeting, anything to decline
4. **Mechanical fixes** — missing labels, area/label mismatches
5. **Promotion candidates** — discussions worth tracking, with upvote counts

For each active wayfinder map, report the destination, current unblocked frontier, stale claims, and whether the map can close. Refer to child tickets by linked title rather than bare issue number.

Cap each group at the items that matter. A 60-line audit nobody reads is worse than 10 items that get fixed.

### 4. Confirm before applying

**Stop and wait.** Then apply only the items the maintainer names, in the order they gave.

Anything in group 3 stays with the human — do not batch-apply declines or closures even if approval for other groups was given.

### 5. Refresh the generated roadmap

Once the board is correct:

```bash
GITHUB_TOKEN=$(gh auth token) TERRENO_PROJECT_NUMBER="$PROJECT_NUMBER" bun run roadmap:generate
```

The generator refuses to run when the project cannot be read, so an empty result means a real problem rather than an empty board. The daily workflow does this too — a manual run is only for seeing the change immediately.

### 6. Label taxonomy drift

If the review surfaced labels that exist on issues but not in [`.github/labels.yml`](https://github.com/TerrenoLabs/terreno/blob/master/.github/labels.yml), fix the file and sync it rather than hand-creating labels:

```bash
bun run labels:sync --repo TerrenoLabs/terreno --dry-run
```

## Notes

- Community interest is a manual field. Refresh it during review from current upvote counts.
- If the same drift recurs every review, the process is wrong, not the people. Say so and propose a process change in `docs/explanation/roadmap-process.md`.
