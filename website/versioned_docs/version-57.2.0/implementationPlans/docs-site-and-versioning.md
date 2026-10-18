# Implementation Plan: Documentation Site, Versioned Docs, and Docs-Maintenance Skills

**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1086
*When an engineer is assigned to a project but before you begin coding, you should fill in the implementation plan and get feedback from the engineering team. Once you have finished or you make any changes, tag Josh with the @ symbol so he can review. Also tag anyone else that needs to be notified, has conflicting work, etc.*

## Overview

Terreno's docs today are a Diátaxis-organized markdown tree in `docs/` plus five curated bundles inside `mcp-server/src/docs/resources/`. There is no rendered site, no versioning, and no automation keeping docs in sync with code. The UI demo (an Expo web export of `demo/`, deployed to Netlify, with per-component deep links at `/demo/[component]` and `/dev/[component]`) is the closest thing to component documentation, but it isn't connected to any written docs.

This plan delivers:

1. A **Docusaurus site** (`website/`) rendering the existing `docs/` tree, with generated reference pages per package and per UI component.
2. **Versioned docs** cut on every release, matching Terreno's lockstep package versioning — this is what unblocks version-aware MCP doc search (recommendation 4 from the Boost comparison).
3. **Demo integration**: every component doc page embeds the live demo via iframe deep link, with an "open in playground" escape hatch.
4. **Skills that keep docs current**: an `update-docs` skill wired into the PR workflow, a `docs-audit` drift detector, and release-skill extensions.

**Key design decisions:**

- **Docusaurus** over Starlight/Fumadocs/VitePress because versioned docs are first-class (`docusaurus docs:version X.Y.Z`), it's React (same mental model as the rest of the repo, and iframe/MDX component embeds are trivial), and local search (`docusaurus-search-local`) works without a SaaS dependency. Algolia DocSearch can replace local search later if wanted.
- **Docs version = release version.** All nine packages publish in lockstep from one tag (see `.rulesync/skills/release/SKILL.md`), so a single docs version per release is unambiguous. Cut a docs version only for minor/major releases; patches update the existing version in place. Retain the last ~4 versions plus `next` to keep build times sane.
- **Generated, not hand-written, reference pages.** Component pages are generated from `ui-types-documentation.json` (the TypeDoc output the demo already produces via `generate-types`); package API references come from `typedoc-plugin-markdown`. Hand-written content stays in tutorials/how-to/explanation.
- **`docs/` stays the source of truth** in its current location; the site consumes it via Docusaurus's path config rather than moving files, so existing relative links, the MCP sync script, and in-repo readers keep working.
- **The MCP server consumes the same artifacts.** `terreno_search_docs` (from the `mcp-boost-parity.md` plan) gains a `version` parameter; the MCP build syncs `website/versioned_docs/` so the hosted server can answer for any retained version.
- **Netlify hosting** for the site, like the demo — PR deploy previews are the main reason (reviewers and the `verify-ui-changes` skill can check rendered docs per PR).

## Architecture

```
website/
├── docusaurus.config.ts        # docs path → ../docs, versions config, search plugin
├── sidebars.ts                 # generated + manual sidebar (Diátaxis top-level)
├── src/
│   ├── components/
│   │   └── ComponentDemo.tsx   # iframe embed of demo /demo/[component]?embed=1
│   └── css/custom.css          # Terreno branding
├── scripts/
│   ├── generate-component-docs.ts  # ui-types-documentation.json → docs/reference/components/*.mdx
│   └── generate-api-reference.ts   # typedoc-plugin-markdown per package
├── versioned_docs/             # created by `docs:version` at release time
├── versioned_sidebars/
└── versions.json
```

### Content mapping

| Site section | Source |
|---|---|
| Tutorials, How-to, Explanation | existing `docs/tutorials`, `docs/how-to`, `docs/explanation` (hand-written) |
| Reference: packages | `typedoc-plugin-markdown` over `api`, `rtk`, `feature-flags`, `ai`, `admin-backend` + existing `docs/reference/*.md` overviews |
| Reference: UI components | generated `.mdx` per component: description, props table from `ui-types-documentation.json`, `<ComponentDemo />` embed, link to story source in `demo/stories/` |
| Upgrade guides | `mcp-server/src/docs/upgrades/<version>.md` (from the Boost-parity plan), rendered as a "Upgrading" section |
| `docs/implementationPlans`, `docs/tasks` | excluded from the site (internal) |

## Demo Integration

The demo already routes per component (`demo/app/demo/[component].tsx`), so embedding needs only:

1. **Embed mode in the demo**: support `?embed=1` in `demo/app/demo/_layout.tsx` — hide the sidebar/navigation chrome and render just the component playground. Persist via context so internal navigation keeps the flag.
2. **`ComponentDemo` MDX component** in the site: responsive iframe pointing at `https://<demo-host>/demo/<Component>?embed=1`, with a fallback link "Open in playground" and lazy loading.
3. **Environment wiring**: demo base URL set per environment (`DEMO_URL` build arg) so docs previews can point at the production demo.
4. Optional later: reverse links — the demo's component page links to its doc page.

Versioning caveat: the embedded demo always shows the *latest* deployed demo, even on older docs versions. Acceptable for v1; if it becomes a problem, deploy the demo export per release alongside versioned docs (`/demo/0.18/...`).

## Versioning & CI

### Release-time flow (extends `publish-on-tag.yml` and the `release` skill)

1. Tag `X.Y.0` pushed → packages publish as today.
2. New `docs-version` job (after publishes succeed): `cd website && bun docusaurus docs:version X.Y.0`, commit alongside the existing `chore: bump package versions` commit, trigger site deploy.
3. Patch tags skip `docs:version`; the deploy rebuilds the current version with any docs fixes merged since.
4. Prune: keep `next` + last 4 versions; the job deletes older `versioned_docs/` entries.

### Continuous flow

- Every PR: Netlify deploy preview of the site; `generate-component-docs` runs in CI so a new `@terreno/ui` component without TypeDoc-extractable props fails visibly.
- Master: deploy `next` docs.

### MCP integration (unblocks recommendation 4)

- `mcp-server`'s `sync-docs` build step copies `website/versioned_docs/` (and `next` from `docs/`) into the image, namespaced by version.
- `terreno_search_docs` accepts `version?: string`; the agent passes the consumer's `@terreno/*` version (from `application_info` in the local MCP, or `package.json`). Unmatched versions fall back to nearest retained version, with a note in the response.
- `terreno_get_component_docs` gets the same parameter.

## Skills to Keep Docs Current

All live in `.rulesync/skills/` and sync via rulesync like existing skills.

### `update-docs` (new)

Triggered when a PR changes public API surface. Instructs the agent to:

- Map changed exports to affected pages (component → its generated page source + story; `modelRouter`/`TerrenoApp` options → `docs/reference/api.md` + relevant how-tos).
- Regenerate `ui-types-documentation.json` (`generate-types`) and component pages when `@terreno/ui` props change.
- Update or add how-to entries for new user-facing capabilities.
- Wire into the existing `implement` and `create-pr` skills: both gain a step — "if public APIs changed, run the `update-docs` skill before opening the PR."

### `docs-audit` (new)

Drift detector, runnable on demand or on a weekly scheduled CI job that opens an issue/agent task:

- Diff TypeDoc-exported symbols vs. documented pages; list undocumented components, props, and exported functions.
- Find docs referencing removed/renamed exports (broken symbol references, dead `docs/` links — Docusaurus's broken-link checker covers internal links at build time).
- Flag stale code samples by compiling fenced `ts` blocks marked `check` against current packages.
- Output a prioritized fix list the agent (or a human) works through.

### Extensions to existing skills

- **`release`**: add "cut docs version + verify site deploy" and "write `upgrades/<version>.md` if breaking changes were flagged" steps.
- **`verify-ui-changes`**: when a new component or prop ships, require the story *and* the generated doc page to render in the deploy preview.
- **`improve-rulesync`**: note that user-facing guidance belongs in `docs/` (site) while agent-facing guidance belongs in `.ai/`/rules — with cross-links rather than duplication.

## Notifications

Weekly `docs-audit` CI posts its report as a GitHub issue (reusing the Zoom notification pattern from `publish-on-tag.yml` is optional).

## Phases

### Phase 1: Site skeleton
- Scaffold `website/` (Docusaurus, TS preset), point docs path at `../docs`, exclude `implementationPlans`/`tasks`, Terreno branding, local search plugin, Netlify deploy + PR previews.

### Phase 2: Generated reference
- `generate-component-docs.ts` from `ui-types-documentation.json`; `?embed=1` mode in the demo; `ComponentDemo` embeds; `typedoc-plugin-markdown` API reference for `api` and `rtk` (others follow).

### Phase 3: Versioning
- `docs:version` release job, retention pruning, version dropdown; MCP `sync-docs` + `version` parameter on search tools (coordinates with `mcp-boost-parity.md` Phase 1).

### Phase 4: Skills
- `update-docs`, `docs-audit`, release/verify-ui-changes/implement skill extensions, weekly audit CI job.

## Feature Flags & Migrations

None. The site is additive; `docs/` files are not moved. The only behavioral change to existing workflows is the new steps in `release` and `create-pr` skills.

## Risks

- **Generated-page churn**: regenerating component pages on every `ui` change creates diff noise; mitigate by generating at build time (not committed) except for the versioned snapshots.
- **Expo web export quirks in iframes**: the demo uses `NODE_OPTIONS=--openssl-legacy-provider` and a Netlify asset fix-up script; embed mode needs testing across the docs site's origin (CSP/frame-ancestors on Netlify must allow the docs host).
- **Version sprawl**: each retained version is a full docs copy in git and in the MCP image; the retention policy (4 versions) and excluding generated API reference from versioning (regenerate from tagged source instead) are the levers if size becomes a problem.
