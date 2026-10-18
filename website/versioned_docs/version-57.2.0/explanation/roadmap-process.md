# Public roadmap process

Terreno runs its **public roadmap on GitHub** and keeps **sprint execution in Linear**.
Implementation plans in `docs/implementationPlans/` remain the design source of truth for
both.

- **GitHub** — discussions, triaged issues, the Terreno Roadmap project board, generated
  [`ROADMAP.md`](https://github.com/TerrenoLabs/terreno/blob/master/ROADMAP.md)
- **Linear** — estimates, assignees, sprint workflow (internal)
- **IPs** — approved design docs before substantial cross-package work

See also [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for the contributor intake flow.

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
| 4 | Agents & AI | Open-ended | Anyone | MCP setup, Cursor/Claude skills, agent workflows, and prompt patterns for building with Terreno. |
| 5 | RFCs | Open-ended | Anyone | Substantial proposals that change public API or add packages. Use the RFC discussion template; accepted RFCs become IPs. |
| 6 | Show and tell | Open-ended | Anyone | Apps and experiments built with Terreno. Share what you shipped and what friction you hit. |
| 7 | Docs feedback | Open-ended | Anyone | Report missing or confusing documentation. Link the page URL; recurring feedback becomes docs PRs. |

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

#### Agents & AI

```markdown
MCP server setup, Cursor/Claude skills, and agent-driven workflows.

- MCP package: [`mcp-server/`](https://github.com/TerrenoLabs/terreno/tree/master/mcp-server) and hosted `terreno-mcp`.
- Agent skills: [`.rulesync/skills/`](https://github.com/TerrenoLabs/terreno/tree/master/.rulesync/skills) (mirrored to `.cursor/`, `.claude/`, etc.).
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

Create one GitHub Project named **Terreno Roadmap** (repo-level is fine; org-level also
works). Link it to `TerrenoLabs/terreno`.

**Fields** (single-select unless noted):

| Field | Type | Options |
| ----- | ---- | ------- |
| Status | Single select | `Inbox`, `Shaping`, `Planned`, `In progress`, `In review`, `Shipped`, `Declined` |
| Area | Single select | `api`, `ui`, `syncdb`, `auth`, `admin`, `ai`, `mcp`, `docs`, `deploy`, `examples`, `dx` |
| Target | Single select | `0.28`, `0.29`, `Next`, `Future` (add version labels as releases approach) |
| IP | Text | Slug e.g. `web-ssr-and-admin-spa` (empty when no IP yet) |
| Impact | Single select | `Breaking`, `Feature`, `Improvement`, `Fix` |
| Community interest | Number | 👍 count — refresh manually on triage |

**Views**

1. **Roadmap** — Board layout, group by `Status`, filter `Status != Declined` (default public view).
2. **By area** — Table, group by `Area`.
3. **Next release** — Table, filter `Target = Next` (update filter when cutting a release).
4. **Needs shaping** — Table, filter `Status = Shaping`.

**CLI (partial support)**

```bash
gh project list --owner TerrenoLabs --limit 20
gh project link <project-number> --owner TerrenoLabs --repo TerrenoLabs/terreno
```

Field and view creation is **UI-only** today — recreate the tables above in the Project
settings.

**Backfill:** paste tracking issues from [`roadmap-seed-issues.md`](roadmap-seed-issues.md)
when each IP reaches **Approved**.

### Labels

[`.github/labels.yml`](https://github.com/TerrenoLabs/terreno/blob/master/.github/labels.yml) is the source of truth.

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
`ROADMAP_PROJECT_TOKEN` secret. Pushing the regenerated `ROADMAP.md` still uses the default
token via `permissions: contents: write`.

Locally, export the PAT as `GITHUB_TOKEN` (for example `GITHUB_TOKEN=$(gh auth token)`), which
is the variable the generator reads.

## Maintainer skills

Five agent skills cover the recurring roadmap work. Each one researches, proposes, and then
**stops for a maintainer to approve** before touching GitHub — roadmap decisions are the most
human part of the process, so none of them mutate state on their own. All five are
`disable-model-invocation`, meaning an agent will not start them on its own initiative;
you invoke them explicitly.

| Skill | Use it when |
| ----- | ----------- |
| `roadmap-triage` | An inbound issue or discussion needs `area:*` / `type:*` / `status:*` labels, or a call on whether it belongs on the board |
| `roadmap-promote` | Maintainers accepted an Ideas or RFC discussion and it needs a tracked issue that links back to the thread |
| `roadmap-item` | An approved IP needs its public tracking issue, or an existing entry's scope changed |
| `roadmap-review` | Recurring hygiene: status drift, stale items, untriaged backlog, promotion candidates, then regenerate `ROADMAP.md` |
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
bun run roadmap:check --labels "area:api,type:feature" --status Planned --target Next --impact Feature --area api
```

Run it with no arguments to print every valid label and field option. It enforces exactly one
`area:*` and one `type:*` label, rejects labels absent from
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
| [`.github/workflows/triage.yml`](https://github.com/TerrenoLabs/terreno/blob/master/.github/workflows/triage.yml) | Issue opened | `status:needs-triage` + `area:*` from package dropdown |
| [`.github/workflows/roadmap-generate.yml`](https://github.com/TerrenoLabs/terreno/blob/master/.github/workflows/roadmap-generate.yml) | Daily + manual | Regenerate `ROADMAP.md` from the Project board |

Triage resolves the `area:*` label with
[`scripts/issueAreaLabels.ts`](https://github.com/TerrenoLabs/terreno/blob/master/scripts/issueAreaLabels.ts),
which owns the package-to-area table. Add new packages there, not in the workflow.

Run the generator locally against the real board:

```bash
GITHUB_TOKEN=$(gh auth token) TERRENO_PROJECT_NUMBER=... bun run roadmap:generate
```

The generator exits non-zero when the project cannot be read, so a bad project number or a
token without `read:project` fails loudly instead of writing an empty `ROADMAP.md`.
