# Implementation Plan: Reference Documentation Coverage

**Status:** Draft — blocked on PR #869
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1009
**Priority:** High
**Effort:** Big batch
**Owner:** unassigned
**Created:** 2026-07-27
**Program:** [OSS launch](oss-launch-program.md)
**Depends on:** [`rtk-to-syncdb-migration-docs`](rtk-to-syncdb-migration-docs.md), [`positioning-django-rails-universal`](positioning-django-rails-universal.md) (supplies the shared package-README intro block)
**RTK deprecation flag:** **Blocked** — `syncdb.md` cannot be written before #869, and the package README rewrites reference the frontend data layer.

## Goal

Give every published package a public reference page and a real README. Today four package READMEs are one-line stubs pointing at `.claude/rules/...` — paths that do not exist in a published npm tarball and that leak an internal agent-tooling layout to consumers. Meanwhile the substantive documentation for those packages *does* exist, in `.cursor/rules/*/00-*.mdc` files, and is genuinely good; it is just published to the wrong audience.

| Package | README | `docs/reference/` page |
|---------|--------|------------------------|
| `api` | good (~290 lines) | `api.md` |
| `ui` | good (~187 lines) | `ui.md` |
| `rtk` | good (~103 lines) | `rtk.md` → legacy |
| `mcp-server` | good (~267 lines) | `mcp-server.md` |
| `admin-spa` | good (~126 lines) | **missing** |
| `ai` | **stub → `.claude/`** | **missing** |
| `admin-backend` | **stub → `.claude/`** | `admin-backend.md` |
| `admin-frontend` | **stub → `.claude/`** | `admin-frontend.md` |
| `api-health` | **stub ("see source")** | `api-health.md` |
| `feature-flags` | **missing** | `feature-flags.md` |
| `test` | **missing** | **missing** |
| `syncdb` | (from #869) | **missing** |

## Non-Goals

- Writing tutorials or how-to guides (that is [`docs-tutorials-ai-first`](docs-tutorials-ai-first.md)).
- Auto-generating API reference from TypeScript types — the existing `docs-audit` skill and TypeDoc-driven component pages already partially cover `@terreno/ui`; expanding that is future work.
- Changing any package's public API.

## Blocking questions

**Recorded 2026-07-29** (defaults accepted).

| # | Decision |
|---|----------|
| RF1 | **`docs/reference/<pkg>.md` canonical**; README is short intro + link |
| RF2 | Keep **`.cursor/rules/*/00-*.mdc`** agent-optimized; add drift check |
| RF3 | **`@terreno/test` gets public docs** |
| RF4 | README links **`.ai/guidelines/core.md`** when Boost Phase 2 ships |
| RF5 | Keep `docs/implementationPlans/` + `docs/tasks/` in repo; **README on `docs/tasks/`** explaining planning artifacts |

## Architecture

### Standard package README template

Every published package's README follows the same six-section shape:

1. Title + one-line description (from the positioning IP's standard pattern)
2. `Install` — the exact install command including peer dependencies
3. `Quick start` — the shortest complete working example, runnable
4. `What's included` — bullets, 5–8 items
5. `Documentation` — link to `docs/reference/<pkg>.md` on the docs site (absolute URL, since npm renders it outside the repo)
6. `License` + `Contributing` links (absolute URLs)

Rule: **no relative links to repository-internal paths.** A README rendered on npmjs.com must not link `../.claude/rules/...` or `../docs/`.

### Standard reference page shape

Follow the existing `docs/reference/api.md` and `docs/reference/rtk.md` structure, which is already good: Commands → Architecture/file structure → Key exports → Usage per feature area → Options tables → Conventions → Testing. New pages must match it so the reference tree reads as one document.

### Content sources

Do not write from scratch. The content exists:

| Target | Source |
|--------|--------|
| `docs/reference/ai.md` | `.cursor/rules/ai/00-ai.mdc` (comprehensive: AIService, methods table, temperature presets, models, routes, integration, testing) |
| `docs/reference/admin-spa.md` | `admin-spa/README.md` + `admin-spa/src/` |
| `docs/reference/syncdb.md` | written by [`rtk-to-syncdb-migration-docs`](rtk-to-syncdb-migration-docs.md) — do not duplicate |
| `docs/reference/test.md` | `test/src/` + the preload/bunfig patterns in `admin-backend/AGENTS.md` |
| `ai/README.md` | new, from `docs/reference/ai.md` |
| `admin-backend/README.md` | `.cursor/rules/admin-backend/00-admin-backend.mdc` + existing `docs/reference/admin-backend.md` |
| `admin-frontend/README.md` | `.cursor/rules/admin-frontend/00-admin-frontend.mdc` + existing `docs/reference/admin-frontend.md` |
| `feature-flags/README.md` | `docs/reference/feature-flags.md` |
| `api-health/README.md` | `api-health/src/` |

### Sanitization pass

Every public page must be checked for internal leakage: `flourish` strings, GCP project IDs, Cloud Run URLs, Slack references, `.claude/` or `.cursor/` paths, and internal Linear ticket IDs (`PRO-`, `FH-`).

## Models / APIs / Notifications / UI

None.

## Phases

1. **Missing reference pages** — `ai.md`, `admin-spa.md`, `test.md`; fix the reference index.
2. **De-stub package READMEs** — `ai`, `admin-backend`, `admin-frontend`, `api-health`, plus new READMEs for `feature-flags`, `test`, `demo`, `website`.
3. **Sanitization** — sweep every public doc for internal leakage.
4. **Drift protection** — extend the `docs-audit` skill and workflow to catch a published package without a README or reference page, and to flag reference/rule divergence.

## Feature Flags & Migrations

None.

## Not Included / Future Work

- TypeDoc-generated API reference for `api`, `rtk`/`syncdb`, and `ai`.
- Translating docs.
- A searchable reference index beyond what Docusaurus provides.
- Consolidating agent rules and reference docs into one generated source (see RF2).

## Files to Create / Modify

**Create**

- `docs/reference/ai.md`, `docs/reference/admin-spa.md`, `docs/reference/test.md`
- `feature-flags/README.md`, `test/README.md`, `demo/README.md`, `website/README.md`
- `docs/tasks/README.md`

**Modify**

- `ai/README.md`, `admin-backend/README.md`, `admin-frontend/README.md`, `api-health/README.md`
- `api/README.md`, `ui/README.md`, `mcp-server/README.md`, `admin-spa/README.md` (apply the standard template; convert relative links to absolute)
- `docs/reference/README.md`, `docs/README.md`
- `docs/reference/mcp-server.md` (tool list is behind the live server — reconcile)
- `.rulesync/skills/docs-audit/SKILL.md`, `.github/workflows/docs-audit.yml`

## Task List

See [`docs/tasks/docs-reference-coverage.md`](../tasks/docs-reference-coverage.md).

## Acceptance Criteria

- [ ] Every package published by `publish-on-tag.yml` has both a README following the standard template and a `docs/reference/<pkg>.md` page.
- [ ] No published package README links to a path outside its own package directory using a relative link.
- [ ] `rg -n "\.claude/|\.cursor/" -- */README.md` returns nothing.
- [ ] `rg -ni "flourish|a\.run\.app|PRO-[0-9]|FH-[0-9]" docs/reference/ docs/how-to/ docs/tutorials/ docs/explanation/ */README.md` returns nothing (excluding `infra/flourish/`).
- [ ] `docs/reference/ai.md` documents every public export of `@terreno/ai`, including all `AIService` methods, temperature presets, both models, and all three route registrars.
- [ ] `docs/reference/mcp-server.md` and `mcp-server/README.md` list the same tools as the live hosted server.
- [ ] `docs/reference/README.md` lists every reference page, and every listed page exists.
- [ ] `docs/tasks/README.md` states that the directory holds agent task lists, not user documentation.
- [ ] The `docs-audit` workflow fails when a published package is missing a README or reference page.
- [ ] `bun run website:build` produces no new broken-link warnings.
