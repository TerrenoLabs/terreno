# Implementation Plan: Positioning — "Django/Rails for TypeScript, with Universal Apps"

**Status:** Draft — blocking questions open
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1008
**Priority:** High
**Effort:** Small batch
**Owner:** unassigned
**Created:** 2026-07-27
**Program:** [OSS launch](oss-launch-program.md)
**Depends on:** [`rtk-to-syncdb-migration-docs`](rtk-to-syncdb-migration-docs.md) (the architecture diagram and frontend story must be correct before it is repeated everywhere)
**RTK deprecation flag:** **Partial** — tasks that touch architecture diagrams, package lists, and the integration flow are `[RTK]` marked and must run after #869.

## Goal

Say the same thing about Terreno everywhere, and say it well. Today the README makes a strong, well-written case ("batteries-included framework… Django for Python web development") but the docs landing page says "shared packages for full-stack applications with React Native and Express/Mongoose", `AGENTS.md` says "a monorepo containing shared packages", and npm package descriptions vary. A visitor's impression depends on which door they came through.

The agreed framing, from the program doc:

> **Terreno is Django/Rails for TypeScript — with universal app support.**

Three pillars in priority order: **batteries included**, **universal by default**, **AI-native**.

## Non-Goals

- Adding governance files (that is [`oss-governance-baseline`](oss-governance-baseline.md)).
- Writing new tutorials or reference pages (those are separate IPs).
- Visual redesign of the docs site or a logo/brand refresh.
- Renaming packages or the project.

## Blocking questions

**Recorded 2026-07-29** (defaults accepted).

| # | Decision |
|---|----------|
| PO1 | Tagline **A** for README/docs H1; short variant **C** for social/repo description |
| PO2 | Lead with **Django/Rails** |
| PO3 | **Universal app** (not cross-platform) |
| PO4 | AI-native pillar **co-equal** with batteries-included |
| PO5 | README roadmap: **two-line summary + link `ROADMAP.md`** |
| PO6 | **Trim README** — move maintainer content to CONTRIBUTING/docs |
| PO7 | AI pillar names **both** MCP tools and `/terreno-*` pipeline, always paired |

## Architecture

### Canonical copy blocks

Define the wording once, in `docs/explanation/positioning.md`, and have every other surface reuse it verbatim:

| Block | Length | Used by |
|-------|--------|---------|
| `tagline` | one line | README H1 subtitle, docs site `tagline`, GitHub repo description, npm `description` prefix |
| `elevator` | 2–3 sentences | README intro, docs landing intro, package READMEs |
| `pillars` | three bullets | README, docs landing, `AGENTS.md` |
| `aiPillar` | 2–3 sentences | Expansion of the third pillar wherever it gets more than a bullet. Must name **both** layers per PO7: the MCP tool layer and the `/terreno-*` process layer |
| `pitch` | ~150 words | Blog post intro, conference abstracts, social |

### Surfaces to align

| Surface | Current | Action |
|---------|---------|--------|
| `README.md` | Strong but long and mixed-audience | Restructure: tagline → elevator → pillars → quickstart → packages → links. Move maintainer content out |
| `docs/README.md` | "shared packages… React Native and Express/Mongoose" | Replace with tagline + elevator + pillars; add the complete package table |
| `website/docusaurus.config.ts` | `tagline` field | Set to the canonical tagline; check `title` and og metadata |
| `website/src/pages/index.tsx` (if present) | unknown | Landing hero uses tagline + pillars + one code sample |
| `AGENTS.md` / `CLAUDE.md` | "monorepo containing shared packages" | Lead with the positioning so agents describe Terreno correctly to users |
| `CLAUDE-consumer.md` | consumer-facing template | Lead with the positioning |
| Every published `package.json` `description` | inconsistent | Standardize: `<what it does> — part of Terreno, the batteries-included TypeScript framework for universal apps.` |
| Package READMEs | some are stubs pointing at `.claude/` | Handled by [`docs-reference-coverage`](docs-reference-coverage.md); this IP supplies the shared intro block |
| GitHub repo description + topics | unknown | Set description to the short variant; add topics (`typescript`, `react-native`, `expo`, `express`, `mongoose`, `framework`, `mcp`, `ai`, `universal-apps`) |

### The comparison table

The Django/Rails claim invites the obvious question. `docs/explanation/positioning.md` should answer it head-on with an honest table — what maps, what does not:

| Django / Rails concept | Terreno equivalent | Honest caveat |
|------------------------|--------------------|----------------|
| Models + ORM | Mongoose schemas + `@terreno/api` plugins | Document store, not relational; no migrations framework |
| `ModelViewSet` / scaffolds | `modelRouter` | REST only; no GraphQL |
| Django admin | `@terreno/admin-backend` + `admin-frontend` / `admin-spa` | Younger; see the admin parity IP for the gap list |
| Auth + permissions | Better Auth + `Permissions` / RBAC | RBAC shipped (`rbac-permissions.md`, Complete) |
| Templates / views | `@terreno/ui` components, one codebase for iOS/Android/web | SSR is not shipped yet — see [`web-ssr-and-admin-spa`](web-ssr-and-admin-spa.md) |
| `manage.py` / generators | MCP server tools (the *tool* layer) + the `/terreno-*` SDLC pipeline (the *process* layer) | Agent-driven rather than CLI-driven. Django gives you `manage.py startapp`; Terreno gives you a reviewed path from a request to a mergeable PR |
| Celery / ActiveJob | Not shipped | On the roadmap |
| Migrations | No migrations framework | Schema evolution is convention + the `mongoose-schema-safety` skill |

Being straight about the gaps is what makes the analogy credible rather than marketing.

## Models / APIs / Notifications

None.

## UI

Docs site landing page and README only. No application UI.

## Phases

1. **Canonical copy** — write `docs/explanation/positioning.md` with the five copy blocks and the comparison table.
2. **README restructure** — apply the new structure, move maintainer content out.
3. **Docs site** — landing page, config tagline, docs index.
4. **Agent surfaces** — `AGENTS.md`, `CLAUDE.md`, `CLAUDE-consumer.md`, and the MCP overview resource.
5. **Metadata** — `package.json` descriptions, GitHub repo description and topics.

## Feature Flags & Migrations

None. Moving README sections to `CONTRIBUTING.md` and `docs/` requires checking for inbound links from the docs site and agent rules.

## Not Included / Future Work

- Logo, brand palette, or docs site visual redesign.
- Landing-page marketing site separate from the docs site.
- Case studies or testimonials.
- Renaming `@terreno/*` packages.

## Files to Create / Modify

**Create**

- `docs/explanation/positioning.md`

**Modify**

- `README.md`
- `docs/README.md`
- `website/docusaurus.config.ts`, `website/src/pages/index.tsx` (if it exists)
- `AGENTS.md`, `CLAUDE.md`, `CLAUDE-consumer.md`, `.rulesync/rules/00-root.md`
- `CONTRIBUTING.md` (receives the maintainer content moved out of the README)
- `mcp-server/src/docs/resources/overview.md`
- Every published `package.json` (`description` field)

## Task List

See [`docs/tasks/positioning-django-rails-universal.md`](../tasks/positioning-django-rails-universal.md).

## Acceptance Criteria

- [ ] `docs/explanation/positioning.md` defines the five copy blocks and the honest comparison table.
- [ ] The canonical tagline appears verbatim in `README.md`, `docs/README.md`, `website/docusaurus.config.ts`, and the GitHub repo description.
- [ ] The phrase "Django/Rails for TypeScript" appears within the first two sentences of both `README.md` and `docs/README.md`.
- [ ] "universal app" is the term used for the frontend in all five surfaces; no surface says "cross-platform".
- [ ] The three pillars appear in the same order with consistent wording in `README.md`, `docs/README.md`, and `AGENTS.md`.
- [ ] `README.md` contains no Flourish-internal instructions, GCP project names, or the feature-flag migration walkthrough; that content lives in `CONTRIBUTING.md`, `infra/flourish/`, or `docs/how-to/`.
- [ ] Every published package's `description` follows the standard pattern and mentions Terreno.
- [ ] The comparison table lists at least three honest gaps and links the IPs tracking them.
- [ ] No surface claims an unshipped feature as available.
- [ ] `bun run website:build` and `bun run rules:check` pass.
