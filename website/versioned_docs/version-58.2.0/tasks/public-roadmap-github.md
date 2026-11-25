# Task List: Public Roadmap on GitHub

See: [`docs/implementationPlans/public-roadmap-github.md`](../implementationPlans/public-roadmap-github.md)

**RTK deprecation flag:** None. Safe to implement before PR #869. One caveat: the `area:syncdb` label and the `syncdb` Area value assume PR #869 merges — create them anyway, they cost nothing.

## Instructions for the implementing agent

- Several tasks require GitHub UI or `gh` API calls that change repository state. The `gh` CLI available to cloud agents is **read-only**. For any task that mutates GitHub state (creating Discussion categories, Projects, labels, or repo settings), write the exact commands or UI steps into `docs/explanation/roadmap-process.md` under a "Maintainer setup" heading and mark the task as requiring a human. Do not attempt to fake completion.
- Tasks that create files in the repo (`ROADMAP.md`, workflows, scripts, templates) are fully implementable — do those.
- Run `bun run lint` before each commit. Run `bun run rules:check` if you touch `.rulesync/`.
- Do not add new dependencies for YAML or GraphQL — use `fetch` and Bun's built-ins.

## Phase 1: Discussions

- [x] **Task 1.1**: Document Discussion category setup
  - Description: Create `docs/explanation/roadmap-process.md`. Start with a "Maintainer setup" section listing the seven Discussion categories from the IP with their exact names, formats (Announcement / Question-Answer / Open-ended), descriptions, and display order. For each, include the description text to paste into the GitHub UI (one to two sentences, written for outside users). Note that Discussions must first be enabled in Settings → General → Features.
  - Files: `docs/explanation/roadmap-process.md` (new)
  - Depends on: none
  - Acceptance: all seven categories are listed with name, format, description, and order; the Announcements category is marked maintainers-only.

- [x] **Task 1.2**: Write the pinned intro posts
  - Description: In `docs/explanation/roadmap-process.md`, add a "Pinned posts" section containing the full markdown body for one pinned post per category. Each should say what belongs there, what does not, and where to go instead. The Ideas post must explain that ideas are the intake funnel and that maintainers promote them to issues. The Agents & AI post must point at the MCP setup docs and the skills directory. The Q&A post must link `docs/how-to/` and note that recurring questions become how-to guides.
  - Files: `docs/explanation/roadmap-process.md`
  - Depends on: Task 1.1
  - Acceptance: seven post bodies exist, each under 200 words, each naming an alternative destination for off-topic content.

- [x] **Task 1.3**: Add Discussion templates
  - Description: Create `.github/DISCUSSION_TEMPLATE/rfc.yml` with fields: title guidance, Summary (required), Motivation (required), Detailed design (required), Alternatives considered (required), Drawbacks, Unresolved questions, and a checkbox acknowledging that accepted RFCs become IPs in `docs/implementationPlans/`. Create `.github/DISCUSSION_TEMPLATE/ideas.yml` with: Problem you are hitting (required), What you tried, Rough idea for a solution, and Would you be willing to help implement. Both must set the correct `labels:` and target the right category via the filename convention.
  - Files: `.github/DISCUSSION_TEMPLATE/rfc.yml` (new), `.github/DISCUSSION_TEMPLATE/ideas.yml` (new)
  - Depends on: Task 1.1
  - Acceptance: both files parse as valid YAML and use GitHub's discussion form schema (`body` with `type: textarea` / `type: checkboxes`); the RFC template mentions the IP graduation path.

## Phase 2: Project board

- [x] **Task 2.1**: Document Project board setup
  - Description: Add a "Project board" section to `docs/explanation/roadmap-process.md` specifying: the Project name (`Terreno Roadmap`), whether it is repo- or org-level, the six fields with their exact types and option values from the IP, and the four views with their layout, grouping, and filters. Include the `gh project` commands a maintainer can run for the parts the CLI supports, and mark the rest as UI-only.
  - Files: `docs/explanation/roadmap-process.md`
  - Depends on: Task 1.1
  - Acceptance: all six fields and four views are specified precisely enough to recreate without further decisions; option values match the IP tables exactly.

- [x] **Task 2.2**: Write the tracking-issue bodies for this program's IPs
  - Description: Create `docs/explanation/roadmap-seed-issues.md` containing one ready-to-paste issue body per IP listed in `docs/implementationPlans/oss-launch-program.md`. Each body must include: a one-paragraph summary written for an outside reader (not internal shorthand), a link to the IP file, a link to the task file, the RTK deprecation flag, the dependencies, and the labels and Project field values to set (`Area`, `Target`, `Impact`, `IP`). Read each IP file to write its summary — do not paraphrase from the program index alone.
  - Files: `docs/explanation/roadmap-seed-issues.md` (new)
  - Depends on: Task 2.1
  - Acceptance: one section per IP in the program index; every section names its `Area`, `Target`, `Impact`, and `IP` field values; every summary is comprehensible without reading the IP.

## Phase 3: Labels and triage

- [x] **Task 3.1**: Define the label set as data
  - Description: Create `.github/labels.yml` listing every label from the IP taxonomy with `name`, `color`, and `description`. Use a consistent color family per prefix (for example one hue for `area:`, another for `type:`, another for `status:`, and distinct colors for the bare labels). Add a "Labels" section to `docs/explanation/roadmap-process.md` explaining that `.github/labels.yml` is the source of truth and how to apply it (`gh label create` loop or a label-sync action), plus which GitHub default labels to delete.
  - Files: `.github/labels.yml` (new), `docs/explanation/roadmap-process.md`
  - Depends on: Task 1.1
  - Acceptance: `.github/labels.yml` parses as valid YAML and contains every label in the IP taxonomy table with no duplicates; colors are valid six-digit hex without `#`.

- [x] **Task 3.2**: Add the triage workflow
  - Description: Create `.github/workflows/triage.yml`. On `issues: [opened]`, add the `status:needs-triage` label. Then read the issue body for the package dropdown value rendered by the issue forms and map it to the matching `area:*` label (for example `@terreno/api` → `area:api`, `docs` → `area:docs`). Implement the mapping in an inline `actions/github-script` step with an explicit lookup object; if no match is found, add no area label and leave a comment asking the reporter to specify. Validate required inputs before use per the repo convention.
  - Files: `.github/workflows/triage.yml` (new)
  - Depends on: Task 3.1
  - Acceptance: workflow parses as valid YAML; the mapping object covers every option in `bug_report.yml`'s package dropdown; the no-match path does not throw.

- [x] **Task 3.3**: Document the backfill triage pass
  - Description: Add a "One-time backfill" section to `docs/explanation/roadmap-process.md` describing how to triage existing open issues and PRs onto the new taxonomy: run `gh issue list --state open --limit 200 --json number,title,labels`, assign one `area:` and one `type:` label each, add anything still relevant to the board with `Status = Inbox`, and close or label `status:wontfix` anything stale beyond six months. Include the read-only `gh` commands for producing the working list.
  - Files: `docs/explanation/roadmap-process.md`
  - Depends on: Task 3.1
  - Acceptance: the section gives a repeatable procedure and the exact `gh` command for listing candidates; it does not claim the backfill has been done.

## Phase 4: Roadmap generation

- [x] **Task 4.1**: Write the roadmap generator
  - Description: Create `scripts/generate-roadmap.ts` (Bun, TypeScript, `const` arrow functions with explicit return types, no new dependencies). It queries the GitHub GraphQL API for the `Terreno Roadmap` ProjectV2 items and their field values, then writes `ROADMAP.md`: a header explaining that the board is the source of truth and that no dates are promised, then sections grouped by `Target` (current release first, then `Next`, then `Future`), and within each, subsections by `Area`. Each item renders as a bullet with its title, issue link, `Impact`, and an IP link when the `IP` field is set. Exclude items with `Status` of `Declined`. Read the token from `GITHUB_TOKEN` and the project number from `TERRENO_PROJECT_NUMBER`; fail with a clear message listing missing variables when either is absent. Use Luxon for the generated-at timestamp.
  - Files: `scripts/generate-roadmap.ts` (new), `package.json` (add a `roadmap:generate` script)
  - Depends on: Task 2.1
  - Acceptance: running with both env vars unset prints an error naming both and exits non-zero; with a valid token it writes a `ROADMAP.md` matching the described structure; `bun run lint` passes.

- [x] **Task 4.2**: Add the roadmap workflow
  - Description: Create `.github/workflows/roadmap-generate.yml` running on `schedule` (daily) and `workflow_dispatch`. Validate `GITHUB_TOKEN`/PAT and `TERRENO_PROJECT_NUMBER` at job start with the repo's fail-fast pattern. Run `bun run roadmap:generate`, then commit and push `ROADMAP.md` only if `git diff --quiet` reports changes. Use a bot identity for the commit.
  - Files: `.github/workflows/roadmap-generate.yml` (new)
  - Depends on: Task 4.1
  - Acceptance: workflow parses as valid YAML; the secret-validation step lists every required variable; the commit step is conditional on a real diff.

- [x] **Task 4.3**: Seed `ROADMAP.md` and link it
  - Description: Commit an initial hand-written `ROADMAP.md` (the generator will overwrite it later) built from the IPs in `docs/implementationPlans/oss-launch-program.md` plus active IPs (those whose `**Status:**` header is not Complete/Deferred/Closed). Add a note at the top that it is generated from the Project board. Link it from `README.md` and add it to the docs site sidebar in `website/docusaurus.config.ts` (or the sidebars file if navigation is defined there — check both).
  - Files: `ROADMAP.md` (new), `README.md`, `website/docusaurus.config.ts` or `website/sidebars.ts`
  - Depends on: Task 4.1
  - Acceptance: `ROADMAP.md` lists every IP in the program with a `Target`; the docs site builds (`bun run website:build`) with the new nav entry; the README links it.

- [x] **Task 4.4**: Add the docs feedback footer link
  - Description: In `website/docusaurus.config.ts`, add a footer link (or theme config item) pointing at the Docs feedback Discussions category. If Docusaurus's `editUrl` mechanism is the better fit for per-page feedback, add the discussion link alongside the existing `editUrl` rather than replacing it.
  - Files: `website/docusaurus.config.ts`
  - Depends on: Task 1.1
  - Acceptance: `bun run website:build` succeeds and the built output contains the discussions URL; the existing `editUrl` still works.

## Phase 5: Linear bridge

- [x] **Task 5.1**: Document the Linear bridge rules
  - Description: Add a "Linear bridge" section to `docs/explanation/roadmap-process.md` covering: which artifacts live where (GitHub = public discussion, issues, roadmap state; Linear = sprint execution; `docs/implementationPlans/` = design), the one-way GitHub → Linear intake triggered by the `tracked` label, the rule that Linear status is not synced back and that GitHub state changes via `Fixes #NNN` on merge, how internally-originated public work gets a manual GitHub issue, and an explicit statement that internal-only Linear work is never mirrored. Explain *why* status is not two-way synced.
  - Files: `docs/explanation/roadmap-process.md`
  - Depends on: Task 3.1
  - Acceptance: the section states the direction of every sync, names the trigger label, and gives the reason two-way status sync was rejected.

- [x] **Task 5.2**: Document the intake flow in `CONTRIBUTING.md`
  - Description: Add a "How work gets planned" section to `CONTRIBUTING.md`, under 30 lines: file an Ideas discussion → maintainer promotes to an issue → issue is triaged onto the roadmap board → substantial work gets an IP → implementation. Add the RFC path for public API changes and new packages. Link `ROADMAP.md`, the Discussions categories, and `docs/implementationPlans/README.md`.
  - Files: `CONTRIBUTING.md`
  - Depends on: Task 5.1
  - Acceptance: the section is under 30 lines, links all three destinations, and matches the flow diagram in the IP.

- [x] **Task 5.3**: Add the release announcement step
  - Description: Edit `.rulesync/skills/release/SKILL.md` to add a step: after publishing a release that includes breaking changes or deprecations, post a discussion in the Announcements category summarizing the change, linking the changelog section and the relevant upgrade note in `mcp-server/src/docs/upgrades/`. Regenerate mirrors with `bun run rules`.
  - Files: `.rulesync/skills/release/SKILL.md` plus generated mirrors
  - Depends on: Task 1.1
  - Acceptance: `bun run rules:check` exits 0; the release skill names the Announcements category and the upgrade-note path.
