---
name: roadmap-item
description: >-
  Draft or update a Terreno roadmap tracking issue for an approved
  implementation plan — correct labels, Project fields, and house-style body,
  applied only after maintainer approval. Trigger with /roadmap-item or phrases
  like "create a roadmap item", "add this IP to the roadmap", "update the
  roadmap entry".
---
# Roadmap item

Create or update the public tracking issue for a piece of planned work, usually one approved IP in `docs/implementationPlans/`.

**What lands on the public roadmap is a human decision.** Draft it, validate it, then stop for approval.

Process background, including the full IP ↔ roadmap lifecycle and the promote-vs-item ownership table: [`docs/explanation/roadmap-process.md`](https://github.com/TerrenoLabs/terreno/blob/master/docs/explanation/roadmap-process.md).

## Where this sits in the lifecycle

`roadmap-item` is the stage that ties an **approved IP** to its public tracking issue.
It is the only skill that sets the Project `IP` field and moves an item to `Status=Planned`.

- If the work started as a community discussion, `roadmap-promote` already opened a
  `Shaping` issue. **Update that issue** — set the `IP` field and move it
  `Shaping → Planned`. That issue was created before the IP existed, so it does **not**
  contain the IP slug; Step 2 locates it via the IP header `Roadmap issue:` link, the
  `roadmap` label, or the originating discussion, not by a slug search. Never open a
  second issue for the same work.
- If the IP is internal-origin with no discussion behind it, **create** the issue here at
  `Planned`.
- The planning pipeline's **Grow** stage hands off here once an IP reaches Approved (in
  repos that run a roadmap). In a repo with no roadmap board, there is nothing to do —
  the IP and its task list are the source of truth.

## When to use

- An IP has reached **Approved** and needs its public tracking issue
- An existing roadmap item's status, target, or scope has changed
- Backfilling tracking issues from [`docs/explanation/roadmap-seed-issues.md`](https://github.com/TerrenoLabs/terreno/blob/master/docs/explanation/roadmap-seed-issues.md)
- Adding one approved delivery slice to an existing `roadmap-wayfinder` map

## When not to use

- The work came from a community discussion — use `roadmap-promote`, which credits and links the thread
- The item just needs labels — use `roadmap-triage`
- Auditing the whole board — use `roadmap-review`
- Writing the IP itself — use `ip`
- A destination is too large or uncertain for one IP — use `roadmap-wayfinder` to chart the map first

## Hard rules

1. **Never create or edit an issue, or change a Project field, without explicit approval of the drafted text in this conversation.**
2. **Never promote an IP that is not Approved.** Read its status header; if it says Draft or Proposed, stop and say so.
3. **Never invent labels or field values.** Validate with `bun run roadmap:check` first.
4. Write for an outside reader. A roadmap entry that only makes sense to the team defeats the point of a public roadmap.

## Procedure

### 1. Read the plan

Read the IP and its task list. Extract:

| Field | Where it comes from |
|---|---|
| Outcome | The IP's Goal section, restated for a reader who has not seen it |
| Area | The packages it touches |
| Impact | `Breaking` / `Feature` / `Improvement` / `Fix` |
| Target | The release it is aimed at, or `Next` / `Future` |
| Status | `Planned` until work starts |
| Dependencies | The IP's "Depends on" line |

If the IP declares an RTK deprecation flag of **Blocked**, the item still gets `Status=Planned` — the Project Status field has no `Blocked` option. Carry the gating with the `status:blocked` label and say what it is waiting on.

For a wayfinder slice, also extract the map URL and blocking slice titles. Keep the full design and task graph in the linked IP/task files; the roadmap item states only the delivered outcome and native blocking edges.

### 2. Find any existing item — do not open a duplicate

A promoted issue is created **before** the IP exists, so it will not contain the IP slug.
A slug search alone will miss it and you will file a duplicate. Look in this order and
stop at the first real hit:

1. **The IP header `Roadmap issue:` line**, if set — the deterministic pointer written when
   the work was promoted or first tracked.
2. **The slug in an issue body** — matches items a previous `roadmap-item` run already linked:
   ```bash
   gh issue list --search "\"$IP_SLUG\" in:body" --state all --json number,title,url,state
   ```
3. **The `roadmap` label or the originating discussion link** — then match by outcome:
   ```bash
   gh issue list --label roadmap --state all --limit 200 --json number,title,url
   ```

If a maintainer promoted this work, ask them for the issue number rather than guessing.

When you update an existing issue, **write the IP slug and a link to the IP into its body**
so future slug searches (step 2) find it, and record the issue URL on the IP header
`Roadmap issue:` line. This closes the loop that promote could not — it ran before the IP
had a slug.

### 3. Draft

House style, matching the seed issues:

- **Title:** the outcome in plain language. **No `[Roadmap]` prefix** — the `roadmap` label marks it
- **Body:** two or three paragraphs of plain language — what is broken or missing today, what changes when it ships, and what is explicitly out of scope. No task breakdown; that is the task list's job
- **Links:** the IP and the task list, as full GitHub URLs (the docs site excludes `implementationPlans/` and `tasks/`, so relative links break there)
- **Dependencies:** name them and link their issues

### 4. Validate

```bash
bun run roadmap:check --on-board --labels "roadmap,area:deploy,type:feature" --status Planned --target Next --impact Improvement --area deploy
```

Run it with no arguments to list every valid option. `--on-board` adds the board-item rules,
including the required `roadmap` label.

### 5. Plan and confirm (required)

Print, then **stop and wait**:

- IP slug and its recorded status, quoted from the IP header
- Whether this creates a new issue or updates an existing one, with the URL if it exists
- The complete title and body, verbatim
- Labels and field values, with the `roadmap:check` result
- Every command you would run
- Anything you inferred rather than read from the IP

### 6. Apply, after approval

**Do not touch the board directly.** Write the entry into
[`docs/explanation/roadmap-seed-issues.md`](https://github.com/TerrenoLabs/terreno/blob/master/docs/explanation/roadmap-seed-issues.md)
and let the sync tool do the rest — that document is the repo's declaration of what belongs
on the board, and hand-added items fail `roadmap:sync --check`. Apply does not delete those
cards; add a seed entry or remove the card by hand.

Add a `##` section in the house style above:

```markdown
## <ip-slug>

**Title:** `<outcome>`

**Labels:** `area:deploy`, `type:feature`
**Project fields:** Area=`deploy`, Target=`Next`, Impact=`Improvement`, IP=`<ip-slug>`, Status=`Planned`

<body paragraphs>
```

Then, with a token carrying `project` scope:

```bash
GITHUB_TOKEN=$(gh auth token) bun run roadmap:sync --dry-run   # review the plan
GITHUB_TOKEN=$(gh auth token) bun run roadmap:sync --create-missing-issues
```

The `roadmap` label is added by `roadmap:sync` itself, so leave it off the `**Labels:**` line.

`roadmap:sync` opens the tracking issue, applies the labels, adds the board item, and sets
every field value. It is idempotent — updating an existing entry means editing the section and
re-running, never opening a second issue. Omit `--create-missing-issues` when the issue
already exists.

Add the new issue URL to the IP's `**Roadmap issue:**` header in the same change. That pointer
is what keeps `roadmap:reconcile` from reporting the entry as orphaned.

### 7. Report

Give the issue URL, the labels and fields actually applied, and anything the maintainer still
needs to set by hand (`Community interest` is always manual).

`ROADMAP.md` is generated from the board — do not hand-edit it to match. It refreshes daily,
on merges that touch IPs or task files, and on demand with `bun run roadmap:generate` (needs
`GITHUB_TOKEN` with `read:project` and `TERRENO_PROJECT_NUMBER`; read the number with
`gh variable get TERRENO_PROJECT_NUMBER`).
