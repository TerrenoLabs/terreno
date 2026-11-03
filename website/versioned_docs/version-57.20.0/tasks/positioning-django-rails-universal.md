# Task List: Positioning — "Django/Rails for TypeScript, with Universal Apps"

See: [`docs/implementationPlans/positioning-django-rails-universal.md`](../implementationPlans/positioning-django-rails-universal.md)

**RTK deprecation flag:** **Partial.** Tasks marked `[RTK]` touch the architecture diagram, package list, or integration flow and must run after PR #869 merges and after [`rtk-to-syncdb-migration-docs`](rtk-to-syncdb-migration-docs.md) Phase 6. Unmarked tasks are safe earlier.

## Instructions for the implementing agent

- Write the copy blocks **once** in `docs/explanation/positioning.md` (Task 1.1), then copy them verbatim everywhere else. Do not paraphrase per surface — drift is the problem this IP exists to fix.
- Do not claim any feature listed under "Where Terreno is headed" as shipped. If you are unsure whether something ships today, grep for it in the package source before writing about it.
- When moving content out of the README, use `git mv`-style discipline: cut from one file, paste into the other in the same commit, and grep for inbound links.
- Run `bun run website:build` and `bun run rules:check` before each commit that touches `website/` or `.rulesync/`.

## Phase 1: Canonical copy

- [x] **Task 1.1**: Write `docs/explanation/positioning.md`
  - Description: New explainer containing five clearly-labeled copy blocks in fenced code blocks (so they can be copied verbatim without markdown rendering surprises): `tagline` (one line), `elevator` (2–3 sentences), `pillars` (three bullets, in the order batteries-included / universal-by-default / AI-native), `aiPillar` (2–3 sentences naming both AI layers per IP question PO7 — the MCP tool layer and the `/terreno-*` SDLC pipeline process layer), and `pitch` (~150 words). Then a "Why the Django/Rails analogy" section, then the honest comparison table from the IP. Then a "Language rules" section restating the four rules from the program doc (lead with the analogy, say "universal app", never claim unshipped features, keep superlatives off reference pages) plus a fifth: never describe one AI layer without the other.
  - Files: `docs/explanation/positioning.md` (new)
  - Depends on: none
  - Acceptance: five fenced copy blocks present and labeled; the `aiPillar` block names both the MCP tools and the `/terreno-*` pipeline; comparison table has at least eight rows including at least three honest gaps with IP links; language rules section has all five rules.

- [x] **Task 1.2**: Verify every claim in the comparison table
  - Description: For each row of the comparison table, confirm the Terreno side exists by finding it in source: `modelRouter` in `api/src/api.ts`, admin packages, `Permissions` in `api/src/permissions.ts`, Better Auth in `api/src/betterAuth*.ts`, MCP tools in `mcp-server/src/tools.ts`, and the SDLC pipeline in `plugins/terreno-planning/skills/`. For each "not shipped" row (background jobs, SSR, RBAC), confirm it is genuinely absent and link the IP or roadmap item tracking it. Correct any row that turns out to be wrong.
  - Files: `docs/explanation/positioning.md`
  - Depends on: Task 1.1
  - Acceptance: every "shipped" row cites a source path; the generator row cites both `mcp-server/src/tools.ts` and `plugins/terreno-planning/`; every "not shipped" row links an IP file that exists in `docs/implementationPlans/`.

- [x] **Task 1.3**: Gate the pipeline claim on its portability work
  - Description: The `/terreno-*` pipeline currently only runs inside this monorepo (see [`agentic-sdlc-plugin`](../implementationPlans/agentic-sdlc-plugin.md), "It only works here"). Do not publish positioning copy that implies consumers can use it until that IP's Phase 2 is complete. Check the state of `agentic-sdlc-plugin` Task 2.5 before writing the `aiPillar` block; if portability is not done, write the block describing the tool layer only and add a `TODO` in the IP to revisit, rather than making a claim that fails on first use.
  - Files: `docs/explanation/positioning.md`
  - Depends on: Task 1.1
  - Acceptance: the `aiPillar` block claims the pipeline only if `agentic-sdlc-plugin` Task 2.5 has passed; otherwise the omission is recorded with a pointer to the blocking task.

## Phase 2: README restructure

- [x] **Task 2.1**: Restructure the README's opening
  - Description: Rewrite `README.md` above the packages list to this order: title with badges (preserve existing npm badges and the license badge from the governance IP), the `tagline` block as the subtitle, the `elevator` block, the three `pillars`, then a "Quickstart" section, then "Packages". Preserve the existing Vision and Philosophy content but fold it into the pillars rather than repeating it. Per IP question PO5, replace the "Where Terreno is headed" list with a two-line summary linking `ROADMAP.md`.
  - Files: `README.md`
  - Depends on: Task 1.1
  - Acceptance: "Django/Rails for TypeScript" appears within the first two sentences; the pillars appear in the IP's order; the roadmap section is two lines plus a link; no feature claimed that is not shipped.

- [x] **Task 2.2**: Move maintainer content out of the README
  - Description: Move these README sections to their correct homes: local development / bootstrap / linking instructions → `CONTRIBUTING.md`; the "Feature flags: OpenFeature migration" walkthrough → a new or existing page under `docs/how-to/` (check `docs/how-to/add-feature-flags.md` first — it may already cover this, in which case delete the README copy and link it); GCP project names, Cloud Run URLs, and Netlify hosts → `infra/flourish/README.md` (created by [`deploy-to-gcp`](../implementationPlans/deploy-to-gcp.md)) or a short "Live examples" list with URLs only and no infra detail; release instructions → `CONTRIBUTING.md`. After moving, grep the repo and `website/` for links to the removed anchors and fix them.
  - Files: `README.md`, `CONTRIBUTING.md`, `docs/how-to/add-feature-flags.md`, `infra/flourish/README.md`
  - Depends on: Task 2.1
  - Acceptance: `rg -i "flourish-terreno|a\.run\.app|Slack" README.md` returns nothing; no content was deleted without a new home; `bun run website:build` reports no new broken links.

- [x] **Task 2.3**: `[RTK]` Update the README architecture and package list
  - Description: Confirm the architecture diagram and published-package list reflect syncdb (this may already be done by `rtk-to-syncdb-migration-docs` Task 6.5 — check first and skip if so). Ensure every package in `publish-on-tag.yml` appears in the list exactly once with a one-line description matching its `package.json` description.
  - Files: `README.md`
  - Depends on: Task 2.2, `rtk-to-syncdb-migration-docs` Task 6.5
  - Acceptance: package list matches `publish-on-tag.yml` one-to-one; each description matches the package's `package.json`; diagram names syncdb not rtk.

## Phase 3: Docs site

- [x] **Task 3.1**: `[RTK]` Rewrite `docs/README.md`
  - Description: Replace the opening line ("shared packages for full-stack applications with React Native and Express/Mongoose") with the `tagline` + `elevator` + `pillars` blocks. Keep the Diátaxis structure section. Rebuild the package table so it contains every published package including `@terreno/ai`, `@terreno/syncdb`, `@terreno/admin-spa`, and `@terreno/feature-flags`, with `rtk` under a Legacy heading. Update the Quick links section: remove the `.cursorrules` link if that file no longer exists, add `positioning.md`, `ROADMAP.md`, and `CONTRIBUTING.md`.
  - Files: `docs/README.md`
  - Depends on: Task 1.1, `rtk-to-syncdb-migration-docs` Task 2.3
  - Acceptance: tagline appears in the first two sentences; package table complete and matching `publish-on-tag.yml`; every Quick link resolves to an existing file.

- [x] **Task 3.2**: Update the docs site configuration
  - Description: In `website/docusaurus.config.ts`, set `tagline` to the canonical tagline and confirm `title`, `themeConfig.metadata` (og description), and navbar title read consistently. Check whether `website/src/pages/index.tsx` exists; if it does, update the hero to use the tagline, the three pillars, and one short code sample (a `modelRouter` registration plus the matching generated hook usage). If there is no custom landing page, note that in the PR body and skip the hero work.
  - Files: `website/docusaurus.config.ts`, `website/src/pages/index.tsx` (if present)
  - Depends on: Task 1.1
  - Acceptance: `bun run website:build` succeeds; the built HTML contains the canonical tagline in the meta description; the hero (if present) shows the three pillars.

## Phase 4: Agent surfaces

- [x] **Task 4.1**: `[RTK]` Update root agent context files
  - Description: In `.rulesync/rules/00-root.md` (the source for `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/00-root.mdc`, and the copilot instructions), replace the opening "A monorepo containing shared packages…" with the `tagline` + `elevator` + `pillars`. Keep all existing conventions content unchanged. Apply the same opening to `CLAUDE-consumer.md`. Then run `bun run rules` and commit every generated mirror. Note: `CLAUDE.local.md` appears to be a stale duplicate of `CLAUDE.md` — verify and either update or delete it, reporting which you chose and why.
  - Files: `.rulesync/rules/00-root.md`, `CLAUDE-consumer.md`, possibly `CLAUDE.local.md`, generated mirrors
  - Depends on: Task 1.1
  - Acceptance: `bun run rules:check` exits 0; `AGENTS.md` and `CLAUDE.md` both open with the positioning; no conventions content was lost (diff review); the `CLAUDE.local.md` decision is explained in the PR body.

- [x] **Task 4.2**: Update the MCP overview resource
  - Description: Update `mcp-server/src/docs/resources/overview.md` to open with the positioning blocks so agents reading `terreno://docs/overview` describe Terreno consistently. Check the other resource bundles (`api`, `ui`, `rtk`/`syncdb`, `patterns`) for stale positioning language in their intros and fix those too.
  - Files: `mcp-server/src/docs/resources/*.md`
  - Depends on: Task 4.1
  - Acceptance: `bun run mcp:build` succeeds; the overview resource opens with the tagline; no resource intro describes Terreno as "a monorepo of shared packages".

## Phase 5: Metadata

- [x] **Task 5.1**: Standardize `package.json` descriptions
  - Description: For every package published by `publish-on-tag.yml`, set `description` to the pattern `<what it does> — part of Terreno, the batteries-included TypeScript framework for universal apps.` Keep the first clause specific and accurate per package (do not make them all identical). Also confirm `keywords`, `repository`, `homepage`, and `bugs` fields are present and correct on every published package — missing `repository` fields hurt npm discoverability.
  - Files: every published `package.json`
  - Depends on: Task 1.1
  - Acceptance: every published package has a `description` matching the pattern, plus `repository`, `homepage`, and `bugs` fields; `bun install` still resolves cleanly.

- [x] **Task 5.2**: Document the GitHub repository metadata
  - Description: The repo description and topics cannot be set from a commit. Add a "Repository metadata" subsection to `docs/explanation/positioning.md` giving the exact description string (the short tagline variant from PO1 option C) and the exact topic list to set: `typescript`, `react-native`, `expo`, `express`, `mongoose`, `framework`, `mcp`, `ai`, `universal-apps`, `full-stack`. Mark it as a maintainer action.
  - Files: `docs/explanation/positioning.md`
  - Depends on: Task 1.1
  - Acceptance: the exact description string and full topic list are present and marked as a manual maintainer step.

- [x] **Task 5.3**: Consistency sweep
  - Description: Grep the repo for stale positioning language and fix every hit: `rg -n "monorepo containing shared packages"`, `rg -ni "cross-platform"` (should be "universal app" in prose; library-internal technical uses are fine — judge case by case), and `rg -n "88\+ components|90\+ components"` (component counts drift; either verify the number against `ui/src/index.tsx` exports or replace with "a large component library"). Report the count of fixes in the PR body.
  - Files: various
  - Depends on: Task 4.1, Task 3.1
  - Acceptance: no prose surface says "monorepo containing shared packages"; component counts are either verified against the export list or removed; `bun run rules:check` exits 0.
