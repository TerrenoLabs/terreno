# Public roadmap process

Terreno runs its **public roadmap on GitHub** and keeps **sprint execution in Linear**.
Implementation plans in `docs/implementationPlans/` remain the design source of truth for
both.

- **GitHub** — discussions, triaged issues, the Terreno Roadmap project board, generated
  [`ROADMAP.md`](https://github.com/TerrenoLabs/terreno/blob/master/ROADMAP.md)
- **Linear** — estimates, assignees, sprint workflow (internal)
- **IPs** — approved design docs before substantial cross-package work

See also [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for the contributor intake flow.
Issue-sized work that is not a public roadmap item uses
[GitHub issue lifecycle](../how-to/github-issue-lifecycle.md)
(`create-github-issue` → `work-github-issues`, or `status:ready-for-dev` →
`implement-ready-for-dev`) instead of an IP.

## How work flows (IP ↔ roadmap)

One idea travels through discussion, a tracking issue, a design doc, implementation, and
release. Each artifact is authoritative for exactly one thing, so nothing is entered twice.

```
Discussion (Ideas/RFC)
    │  maintainer accepts  →  roadmap-promote
    ▼
Issue: Status = Shaping ─────────────────────────────┐
                                                      │  IP approved → roadmap-item
Grow writes IP + task list   ────────────────────────┤  (sets IP field, Shaping → Planned)
(docs/implementationPlans/ + docs/tasks/)             ▼
                                          Issue: Status = Planned
                                                      │  Pick → Roast → Brew
                                                      ▼
                                          PR: Fixes #NNN
                                                      │  merge
                                                      ▼
                                  Issue closed · board: Shipped
```

The planning pipeline (the `terreno-planning` plugin) drives the design-and-build half;
the roadmap skills drive the public-tracking half. They meet at one handoff: **Grow
writes the IP, and once it is Approved hands off to `roadmap-item`.**

| Transition | Who owns it | Authoritative artifact |
| ---------- | ----------- | ---------------------- |
| Idea debated and shaped | Community + maintainers | GitHub Discussion |
| Discussion → first tracking issue (`Shaping`) | `roadmap-promote` | GitHub Issue + Project |
| Design, scope, acceptance criteria | `terreno-1-grow` | `docs/implementationPlans/<slug>.md` |
| Task breakdown for implementation | `terreno-1-grow` | `docs/tasks/<slug>.md` |
| Approved IP → issue `Planned` + `IP` field set | `roadmap-item` | GitHub Issue + Project |
| Implement, verify, submit, review | `terreno-2-pick` … `terreno-5-taste` | the PR |
| Sprint estimates, assignees, internal-only work | Linear | Linear |
| Public rendered list | CI (`roadmap:generate`) | `ROADMAP.md` |

**promote vs item — the one ambiguity worth stating plainly:** `roadmap-promote` opens the
issue for community-originated work at `Shaping` and never sets the `IP` field or `Planned`.
`roadmap-item` is the only skill that sets the `IP` field and moves an item to `Planned`,
and it **updates the promoted issue** rather than opening a second one. Internal-origin work
with no discussion skips promote and starts at `roadmap-item`.

### Repos without a public roadmap

The `terreno-planning` plugin is meant to run in any Terreno repo, including ones with no
Discussions and no roadmap board (Flourish, most consumer apps). There, only the design-and-build
half applies:

- **Grow** still writes the IP + task list — that dual-file model is the source of truth
  everywhere. It detects the absence of `.github/roadmap-fields.yml` and the `roadmap-item`
  skill and **skips the roadmap handoff** instead of inventing issues or labels.
- Sprint execution is tracked in Linear and linked from the IP header; it is never copied
  into the plan.
- The `roadmap-*` skills and everything under [Maintainer setup](#maintainer-setup) only
  apply once a repo adopts the public roadmap.

## Maintainer setup

> **Human action required.** Cloud agents cannot mutate GitHub org/repo settings. Run these
> steps once per environment.

### Enable Discussions

1. GitHub → **Settings** → **General** → **Features** → enable **Discussions**.
2. Create the categories below in **Discussions** → **⚙️ Categories** (display order top to
   bottom).

| Order | Name | Format | Who can post | Description (paste into GitHub) |
| ----- | ---- | ------ | ------------ | --------------------------------- |
| 1 | Announcements | Announcement | Maintainers only | Official release notes, breaking changes, deprecations, and launch updates from the Terreno team. |
| 2 | Q&A | Question / Answer | Anyone | Ask how to use Terreno. Search existing threads first; accepted answers may become how-to guides in `docs/how-to/`. |
| 3 | Ideas | Open-ended | Anyone | Feature ideas and improvements before they are shaped. This is the intake funnel — do not open a tracking issue until a maintainer promotes your idea. |
| 4 | Hacktoberfest | Open-ended | Anyone | Pitch something to build during Hacktoberfest and upvote the ideas you want. Popular, well-scoped ideas become `hacktoberfest` issues anyone can pick up. |
| 5 | Agents & AI | Open-ended | Anyone | MCP setup, Cursor/Claude skills, agent workflows, and prompt patterns for building with Terreno. |
| 6 | RFCs | Open-ended | Anyone | Substantial proposals that change public API or add packages. Use the RFC discussion template; accepted RFCs become IPs. |
| 7 | Show and tell | Open-ended | Anyone | Apps and experiments built with Terreno. Share what you shipped and what friction you hit. |
| 8 | Docs feedback | Open-ended | Anyone | Report missing or confusing documentation. Link the page URL; recurring feedback becomes docs PRs. |

### Pinned posts

Pin one intro post per category after creation. Bodies below are ready to paste.

#### Announcements

```markdown
Release announcements, breaking changes, and deprecation notices land here.

- Do **not** file support bugs as announcements — use [Issues](https://github.com/TerrenoLabs/terreno/issues/new/choose) or Q&A.
- Security issues: see [SECURITY.md](https://github.com/TerrenoLabs/terreno/blob/master/SECURITY.md) (private report only).
```

#### Q&A

```markdown
Ask **how** to use Terreno — setup, APIs, deployment, agents.

1. Search [existing Q&A](https://github.com/TerrenoLabs/terreno/discussions/categories/q-a) and the [docs site](https://terreno-docs.netlify.app/).
2. For step-by-step guides, start with [`docs/how-to/`](https://github.com/TerrenoLabs/terreno/tree/master/docs/how-to).
3. Bug reports belong in [Bug report issues](https://github.com/TerrenoLabs/terreno/issues/new?template=bug_report.yml), not here.

When an answer repeats, maintainers turn it into a how-to doc via PR.
```

#### Ideas

```markdown
**Ideas are the intake funnel.** Share problems and rough solutions before they become roadmap items.

- Do **not** open a feature issue directly — maintainers promote accepted ideas to tracked issues on the [Terreno Roadmap](https://github.com/TerrenoLabs/terreno/projects) board.
- For API/package-level design, use the **RFCs** category instead.
- Bugs → [Bug report](https://github.com/TerrenoLabs/terreno/issues/new?template=bug_report.yml).
```

#### Hacktoberfest

```markdown
**Pitch Hacktoberfest ideas here, and 👍 the ones you want built.**

1. [Start a Hacktoberfest discussion](https://github.com/TerrenoLabs/terreno/discussions/new?category=hacktoberfest) — the form asks for the idea, area, rough size, and what "done" looks like.
2. Upvote and comment on other pitches. Upvotes are how maintainers rank them.
3. Maintainers turn popular, well-scoped ideas into issues labeled [`hacktoberfest`](https://github.com/TerrenoLabs/terreno/issues?q=is%3Aissue+is%3Aopen+label%3Ahacktoberfest) and link them back here. Pick one up by commenting on the issue.

Longer-term feature ideas → **Ideas**. Bugs → [Bug report](https://github.com/TerrenoLabs/terreno/issues/new?template=bug_report.yml).
```

Promotion follows the Ideas path, with one change: a Hacktoberfest idea small enough to finish
in a weekend becomes a `hacktoberfest` + `good first issue` work item directly (see
[GitHub issue lifecycle](../how-to/github-issue-lifecycle.md)) instead of a `Shaping` roadmap
item. Larger ones go through `roadmap-promote` like any other idea.

#### Agents & AI

```markdown
MCP server setup, Cursor/Claude skills, and agent-driven workflows.

- MCP package: [`mcp-server/`](https://github.com/TerrenoLabs/terreno/tree/master/mcp-server) and hosted `terreno-mcp`.
- Agent skills: [`.rulesync/skills/`](https://github.com/TerrenoLabs/terreno/tree/master/.rulesync/skills) (mirrored into editor-specific copies).
- Terreno planning plugin: [`plugins/terreno-planning/`](https://github.com/TerrenoLabs/terreno/tree/master/plugins/terreno-planning).

General feature ideas → **Ideas**. Doc typos → **Docs feedback** or a docs PR.
```

#### RFCs

```markdown
Propose changes to **public API**, **new published packages**, or **cross-package architecture**.

Use the [RFC template](https://github.com/TerrenoLabs/terreno/discussions/new?category=rfcs) (Summary, Motivation, Design, Alternatives).

Accepted RFCs become implementation plans in `docs/implementationPlans/` before large code changes. Small bugs and docs fixes do not need an RFC.
```

#### Show and tell

```markdown
Show what you built with Terreno — screenshots, repos, and lessons learned welcome.

Friction you discover may become Ideas, bugs, or docs PRs. This category is for celebration and learning, not support tickets.
```

#### Docs feedback

```markdown
Report missing, outdated, or confusing documentation.

Include the **page URL** (docs site or `docs/` path). For quick fixes, open a PR instead.

Every docs page also has a **Discuss this page** link in the footer.
```

### Project board

The board must be an **organization** project under `TerrenoLabs`. The generator queries
`organization(login:).projectV2`, so a repo-level project returns no data.

`bun run roadmap:sync` creates the project, its fields, and its items from repo data — no
hand-clicking. It needs a token with `project` scope:

```bash
gh auth refresh -s project                              # one time
GITHUB_TOKEN=$(gh auth token) bun run roadmap:sync --dry-run   # print the plan
GITHUB_TOKEN=$(gh auth token) bun run roadmap:sync             # apply
GITHUB_TOKEN=$(gh auth token) bun run roadmap:sync --check     # exit 1 on drift (CI)
```

What it reads, and therefore what you edit to change the board:

| Source | Drives |
| ------ | ------ |
| [`.github/roadmap-fields.yml`](https://github.com/TerrenoLabs/terreno/blob/master/.github/roadmap-fields.yml) | `Status`, `Target`, `Impact` options |
| `area:*` labels in [`.github/labels.yml`](https://github.com/TerrenoLabs/terreno/blob/master/.github/labels.yml) | `Area` options |
| [`roadmap-seed-issues.md`](roadmap-seed-issues.md) | one item per roadmap entry, plus its field values and issue labels |

**Fields** (single-select unless noted):

| Field | Type | Options |
| ----- | ---- | ------- |
| Status | Single select | from `roadmap-fields.yml` `status` |
| Area | Single select | from the `area:*` labels |
| Target | Single select | from `roadmap-fields.yml` `target` |
| IP | Text | Slug e.g. `web-ssr-and-admin-spa` (empty when no IP yet) |
| Impact | Single select | from `roadmap-fields.yml` `impact` |
| Community interest | Number | 👍 count — refresh manually on triage |

`Target` answers *which release*, never *what state* — `Status` carries state. Already-shipped
work uses `Target = Released` so it groups at the bottom of `ROADMAP.md` instead of inflating
an upcoming version. `TARGET_ORDER` in
[`scripts/generate-roadmap/lib.ts`](https://github.com/TerrenoLabs/terreno/blob/master/scripts/generate-roadmap/lib.ts)
must stay deep-equal to the yaml list; a test enforces it.

**Views** — still UI-only; there is no GitHub API for creating project views.

1. **Roadmap** — Board layout, group by `Status`, filter `Status != Declined` (default public view).
2. **By area** — Table, group by `Area`.
3. **Next release** — Table, filter `Target = Next` (update filter when cutting a release).
4. **Needs shaping** — Table, filter `Status = Shaping`.

**What sync will not do:** it never opens a tracking issue for an entry whose `IP` field is
empty. The repo's process opens the issue when the IP reaches **Approved**, so speculative
items stay off the public board. Pass `--create-missing-issues` once an IP lands to open the
issue and place it in one step.

Adding new options to an existing single-select field rewrites that field's whole option list
(GitHub has no add-one-option mutation). The planner always carries the existing option names
through the rewrite, so no card loses its current value — but review the `--dry-run` output
before applying a rewrite.

### Labels

[`.github/labels.yml`](https://github.com/TerrenoLabs/terreno/blob/master/.github/labels.yml) is the source of truth.

Every issue on the board carries the **`roadmap`** label. That label — not a title prefix — is
how roadmap work is filtered:

```bash
gh issue list --repo TerrenoLabs/terreno --label roadmap --state all
```

`roadmap:sync` adds it to every issue it declares, so seed entries do not repeat it on their
`**Labels:**` line. Tracking issues used to be titled `[Roadmap] <outcome>`; titles are now
just the outcome, and `displayTitle` in
[`scripts/generate-roadmap/lib.ts`](https://github.com/TerrenoLabs/terreno/blob/master/scripts/generate-roadmap/lib.ts)
strips the legacy prefix wherever it survives.

Apply or update labels with `gh` authenticated as a maintainer:

```bash
bun run labels:sync --repo TerrenoLabs/terreno --dry-run   # preview
bun run labels:sync --repo TerrenoLabs/terreno             # apply
```

[`scripts/sync-labels.ts`](https://github.com/TerrenoLabs/terreno/blob/master/scripts/sync-labels.ts)
parses the YAML and passes each description to `gh` as a single argument, so descriptions
containing commas or quotes survive intact. It refuses to run on a malformed color,
a missing description, or a duplicate name.

Delete unused GitHub defaults after the new taxonomy is applied (`gh label list`).

### Secrets for roadmap generation

| Name | Kind | Purpose |
| ---- | ---- | ------- |
| `TERRENO_PROJECT_NUMBER` | Repository variable | GitHub Project number for **Terreno Roadmap** |
| `ROADMAP_PROJECT_TOKEN` | Repository secret | Classic PAT with `read:project` (plus `repo` for private repos) |

The workflow's built-in `GITHUB_TOKEN` **cannot** be used here: it is repository-scoped and
returns no `projectV2` data for an organization project. GitHub also reserves the name
`GITHUB_TOKEN`, so a PAT cannot be supplied under that name — hence the separate
`ROADMAP_PROJECT_TOKEN` secret. The same PAT also pushes the regenerated `ROADMAP.md`: the
`master` ruleset requires a pull request and the default `GITHUB_TOKEN` is not a bypass actor
on it, so the PAT needs `repo` scope and its owner must be listed as a ruleset bypass actor.
[`.github/scripts/git-auth-roadmap-pat.sh`](https://github.com/TerrenoLabs/terreno/blob/master/.github/scripts/git-auth-roadmap-pat.sh)
applies that credential only for the fetch/push steps, so `bun install` never sees it.

Locally, export the PAT as `GITHUB_TOKEN` (for example `GITHUB_TOKEN=$(gh auth token)`), which
is the variable the generator reads.

## Maintainer skills

Five agent skills cover the recurring roadmap work. Each one researches, proposes, and then
**stops for a maintainer to approve** before touching GitHub — roadmap decisions are the most
human part of the process, so none of them mutate state on their own. All five are
`disable-model-invocation`, meaning an agent will not start them on its own initiative;
you invoke them explicitly. Unattended implementation of a roastable issue is
[`implement-ready-for-dev`](../how-to/github-issue-lifecycle.md#unattended-pickup),
not a sixth roadmap skill.

| Skill | Use it when |
| ----- | ----------- |
| `roadmap-triage` | An inbound issue or discussion needs `area:*` / `type:*` / `status:*` labels, or a call on whether it belongs on the board |
| `roadmap-promote` | Maintainers accepted an Ideas or RFC discussion and it needs a tracked issue that links back to the thread |
| `roadmap-item` | An approved IP needs its public tracking issue, or an existing entry's scope changed |
| `roadmap-review` | Recurring hygiene: status drift, stale items, untriaged backlog, promotion candidates, then regenerate `ROADMAP.md` |

`roadmap-item` and `roadmap-promote` no longer touch the board with `gh project`. They add or
edit an entry in [`roadmap-seed-issues.md`](roadmap-seed-issues.md) and run `roadmap:sync`,
which opens the issue, applies the labels, adds the item, and sets every field in one
idempotent pass. Board items added by hand show up as `--check` drift; apply does not delete
them. A dragged `Status` that is ahead of the seed is reported the same way and is not reset.

`roadmap-review` starts from `bun run roadmap:reconcile`, which mechanically answers most
hygiene questions and leaves a `Needs a human` list that is exactly the review's agenda.
| `roadmap-frontier` | A destination is too large or uncertain for one IP/context and needs a map, a small unblocked frontier, and repeated Grow → Taste delivery loops |

### Huge features: frontier maps

A frontier map is one low-resolution roadmap issue with an observable destination,
resolved-decision index, current frontier, fog, and explicit out-of-scope boundary. Child
tickets hold the detail and native blocking relationships. Work only the **frontier**:
open, unblocked, unclaimed tickets.

Decision tickets resolve one question. Delivery tickets link one approved IP/task pair and
run the complete planning pipeline. After each ticket, update the map, graduate clarified
fog into precise tickets, and return to the frontier with a fresh agent context. The map
closes only when the destination is reached and no in-scope fog or open child tickets remain.

Sources live in `.rulesync/skills/`; run `bun run rules` after editing to regenerate the
per-agent mirrors.

### Checking an item before you file it

The skills do not carry a copy of the taxonomy. They call:

```bash
bun run roadmap:check --on-board --labels "roadmap,area:api,type:feature" --status Planned --target Next --impact Feature --area api
```

Run it with no arguments to print every valid label and field option. It enforces exactly one
`area:*` and one `type:*` label, requires the `roadmap` label under `--on-board` (omit the
flag when triaging an issue that is not headed for the board), rejects labels absent from
[`.github/labels.yml`](https://github.com/TerrenoLabs/terreno/blob/master/.github/labels.yml),
rejects Project values absent from
[`.github/roadmap-fields.yml`](https://github.com/TerrenoLabs/terreno/blob/master/.github/roadmap-fields.yml),
and catches an `Area` field that disagrees with the issue's `area:` label.

Those two files are the single source for the taxonomy: labels in `labels.yml`, Status/Target/
Impact options in `roadmap-fields.yml`, and Area derived from the `area:*` labels rather than
listed a second time. The Project field options in the table above must match
`roadmap-fields.yml`; a test asserts the roadmap generator's own ordering stays in sync with
both files.

## Linear bridge

| Artifact | System of record |
| -------- | ---------------- |
| Public discussion, prioritization debate | GitHub Discussions |
| Triaged work items, roadmap columns | GitHub Issues + Project |
| Design scope, acceptance criteria | `docs/implementationPlans/*.md` |
| Sprint estimates, assignees, internal-only work | Linear |

**GitHub → Linear (one-way intake)**

1. Maintainer adds the `tracked` label to a GitHub issue.
2. Linear's GitHub integration imports the issue into the Terreno Linear team.
3. Title and description sync on creation; **status is not synced back**.

**Closing the loop:** merging PRs use `Fixes #NNN` so GitHub closes the issue and the board
item moves to `Shipped`. Closing Linear alone does **not** change GitHub state.

**Internal → public:** open a GitHub issue manually and paste the Linear URL. Internal-only
Linear work is never mirrored.

**Why not two-way status sync?** Bidirectional sync produces confusing loops between board
columns and sprint state. One-way intake plus `Fixes #NNN` keeps public state accurate.

Configure Linear: **Settings → Integrations → GitHub** → import issues with label `tracked`.

## One-time backfill

```bash
gh issue list --state open --limit 200 --json number,title,labels,updatedAt
```

For each issue: assign `area:*` + `type:*`, add to board as `Inbox` if relevant, or
`status:wontfix` / close if stale (> 6 months, no longer applies). A human must run this —
do not claim completion until done.

## Automation in this repo

| Workflow | Trigger | Purpose |
| -------- | ------- | ------- |
| [`.github/workflows/triage.yml`](https://github.com/TerrenoLabs/terreno/blob/master/.github/workflows/triage.yml) | Issue opened | `status:needs-triage` + `area:*` from package dropdown + `type:*` from Kind when present; `area:*` / `type:*` labels the issue was opened with win, so `roadmap:sync` issues are not asked for an area |
| [`.github/workflows/roadmap-generate.yml`](https://github.com/TerrenoLabs/terreno/blob/master/.github/workflows/roadmap-generate.yml) | Daily + manual | `roadmap:sync --check` for board drift, then regenerate `ROADMAP.md` from the board and open a pull request when it changes |
| [`.github/workflows/roadmap-sync.yml`](https://github.com/TerrenoLabs/terreno/blob/master/.github/workflows/roadmap-sync.yml) | Taxonomy files change on `master` + manual | Apply labels and reconcile the board's fields and items |
| [`.github/workflows/roadmap-reconcile.yml`](https://github.com/TerrenoLabs/terreno/blob/master/.github/workflows/roadmap-reconcile.yml) | IP or task files change on `master` + manual | Advance status from IP headers, add an entry for every new IP, open its tracking issue, push to the board, regenerate `ROADMAP.md` |
All three share the `roadmap` concurrency group. They write the same board, and interleaving
them produces confusing partial states. After the group lock is acquired, each job refreshes
to the latest branch HEAD so a queued `roadmap-sync` cannot overwrite statuses that
`roadmap-reconcile` already advanced. `roadmap-reconcile` also fails fast when
`TERRENO_PROJECT_NUMBER` is unset, so it never mutates the seed or board before generate
can run. `roadmap:sync` pages organization projects until it finds **Terreno Roadmap**, so
it will not create a second project if the org has more than 50 boards.

The full loop, each arrow with exactly one writer:

```
docs/implementationPlans/*.md ──roadmap:reconcile──▶ roadmap-seed-issues.md
docs/tasks/*.md              (Status + new entries)           │
                                                         roadmap:sync
                                                              ▼
                                                        Project board
                                                              │
                                                      roadmap:generate
                                                              ▼
                                                          ROADMAP.md
```

Who owns what:

| Artifact | Owns |
| -------- | ---- |
| IP header `**Status:**` | Where the work is in its lifecycle |
| `roadmap-seed-issues.md` | Which items exist, plus Area / Target / Impact / labels / summary |
| Project board | Live state a maintainer drags, and `Community interest` |
| `ROADMAP.md` | Nothing — fully generated |

`roadmap:sync` owns the board's *shape*: which fields exist, which options they allow, which
issues are on it, and Area / Target / Impact / IP. It writes `Status` only onto a new card or
when the seed is strictly ahead (or Declined). A dragged Status that is ahead of the seed is
reported by `--check` and is never overwritten. Cards that are not in
[`roadmap-seed-issues.md`](roadmap-seed-issues.md) are also `--check` failures; apply does
not delete them. Maintainers own the board's *state* and `Community interest`.

**New IPs reach the roadmap on merge.** When a merged plan has no entry,
`roadmap:reconcile --fix` scaffolds one: the title from the IP's H1, the summary from the first
paragraph of `## Goal`, and links to the IP and its task list (when `docs/tasks/<slug>.md`
exists). Area, Target, and Impact come from an optional IP header:

```markdown
**Roadmap:** Area=`api`, Target=`Next`, Impact=`Feature`
```

Without that header they are inferred: Area from the packages named in the header block
(default `dx`); Target `Released` for shipped work, `Future` for drafts, `58` when a
`**Target:**` line names 58, otherwise `Next`; Impact `Breaking` when the `**Target:**` line
says so, otherwise `Feature`. Edit the scaffolded section afterward if a guess is wrong. The
workflow then runs `roadmap:sync --create-missing-ip-issues`, which opens a tracking issue
only for entries backed by an IP. Drafts land as `Shaping`. Moving an entry to `Shipped` also
moves its Target to `Released`. `ROADMAP.md` links each entry's IP and, when one exists, its
task list.

**Status automation is monotonic.** `roadmap:reconcile --fix` advances status and applies
supersessions, but never walks a status backwards and never revives declined work. IP headers
go stale far more often than boards do — several plans still read `Draft` for work that
shipped — so a backwards move is reported as a stale header for a human to resolve.

| IP `**Status:**` | Board `Status` |
| ---------------- | -------------- |
| `Draft` (also `Shaped`) | `Shaping` |
| `Approved` | `Planned` |
| `In progress` | `In progress` |
| `Complete` (also `Implemented`) | `Shipped` |
| `Deferred`, or any `**Superseded by:**` | `Declined` |

Only the leading phrase matters, so `Approved — decisions recorded (2026-07-29)` maps cleanly.
A status the table cannot map is reported rather than guessed at.

Two headers keep a plan out of that accounting:

| Header | Effect |
| ------ | ------ |
| IP `**Parent IP:**` | The plan rides on another plan's roadmap entry, like a `-research` or `-design` sub-document, and needs no entry of its own. Empty or italic `*(optional)*` placeholders do not count — omit the header unless it names a real parent |
| Task file `**Status:** Closed` | The checklist is history — the IP finished by another route, so its unchecked boxes are not outstanding work and never contradict a `Shipped` status |

Triage resolves the `area:*` label with
[`scripts/issueAreaLabels.ts`](https://github.com/TerrenoLabs/terreno/blob/master/scripts/issueAreaLabels.ts),
which owns the package-to-area table. Add new packages there, not in the workflow.

Run the generator locally against the real board:

```bash
GITHUB_TOKEN=$(gh auth token) TERRENO_PROJECT_NUMBER=... bun run roadmap:generate
```

The generator exits non-zero when the project cannot be read, so a bad project number or a
token without `read:project` fails loudly instead of writing an empty `ROADMAP.md`.
