# Implementation plan index

Tracks active and completed implementation plans (IP) for Terreno. File paths are relative to `docs/implementationPlans/`.

## Programs

Umbrella plans that coordinate several IPs.

| Program | Status | Created | IPs |
|---------|--------|---------|-----|
| [Open source launch](oss-launch-program.md) | Draft — decisions recorded; Vercel spike open | 2026-07-27 | 15 |

## Active

| Plan | Status | Created | Tasks |
|------|--------|---------|-------|
| [Admin UI v2 — Django-parity admin](admin-ui-v2-django-parity.md) | Approved | 2026-06-15 | [tasks](../tasks/admin-ui-v2-django-parity.md) |
| [RBAC Permissions](rbac-permissions.md) | Draft (API design) | 2026-07-08 | TBD |
| [SyncDB Local-First Data Layer](syncdb-local-first.md) | In progress ([PR #869](https://github.com/TerrenoLabs/terreno/pull/869)) | 2026-07-13 | [tasks](../tasks/syncdb-local-first.md) |
| [MCP Boost parity](mcp-boost-parity.md) | In progress ([PR #802](https://github.com/TerrenoLabs/terreno/pull/802)) | 2026-06-21 | TBD |

## Open source launch IPs

All part of the [launch program](oss-launch-program.md). The **RTK flag** column marks dependence on the `@terreno/rtk` → `@terreno/syncdb` migration in PR #869: `None` is safe to implement now, `Partial` has some blocked tasks, `Blocked` cannot start until #869 merges.

### Wave 0 — unblocked

| Plan | Status | RTK flag | Tasks |
|------|--------|----------|-------|
| [OSS governance baseline](oss-governance-baseline.md) | Draft | None | [tasks](../tasks/oss-governance-baseline.md) |
| [Public roadmap on GitHub](public-roadmap-github.md) | Draft | None | [tasks](../tasks/public-roadmap-github.md) |
| [Deploy to GCP (generalized)](deploy-to-gcp.md) | Draft | None | [tasks](../tasks/deploy-to-gcp.md) |
| [Agentic SDLC plugin (`/terreno-*`)](agentic-sdlc-plugin.md) | Draft | Partial | [tasks](../tasks/agentic-sdlc-plugin.md) |

### Wave 1 — gated on PR #869

| Plan | Status | RTK flag | Tasks |
|------|--------|----------|-------|
| [RTK deprecation and syncdb migration docs](rtk-to-syncdb-migration-docs.md) | Draft | **Blocked** (gating IP) | [tasks](../tasks/rtk-to-syncdb-migration-docs.md) |
| [Positioning — Django/Rails for TypeScript](positioning-django-rails-universal.md) | Draft | Partial | [tasks](../tasks/positioning-django-rails-universal.md) |
| [Reference documentation coverage](docs-reference-coverage.md) | Draft | Blocked | [tasks](../tasks/docs-reference-coverage.md) |
| [AI-first tutorials](docs-tutorials-ai-first.md) | Draft | Blocked | [tasks](../tasks/docs-tutorials-ai-first.md) |
| [Deployment foundation](deployment-foundation.md) | Draft | Partial | [tasks](../tasks/deployment-foundation.md) |
| [Deploy to Vercel](deploy-to-vercel.md) | Draft | Partial | [tasks](../tasks/deploy-to-vercel.md) |
| [Upgrade guides and skill](upgrade-guides-and-skill.md) | Draft | Blocked | [tasks](../tasks/upgrade-guides-and-skill.md) |
| [The AI development loop (Boost)](ai-dev-loop-boost.md) | Draft | Partial | [tasks](../tasks/ai-dev-loop-boost.md) |
| [Dogfooding run and launch blog post](build-terreno-app-validation.md) | Draft | Blocked | [tasks](../tasks/build-terreno-app-validation.md) |
| [Examples, demo, and test coverage](examples-demo-coverage.md) | Draft | Partial | [tasks](../tasks/examples-demo-coverage.md) |

### Wave 2 — independent

| Plan | Status | RTK flag | Tasks |
|------|--------|----------|-------|
| [Web SSR and admin SPA](web-ssr-and-admin-spa.md) | Draft | Partial | [tasks](../tasks/web-ssr-and-admin-spa.md) |

## Completed

| Plan | Status | Created | Tasks |
|------|--------|---------|-------|
| [APIError redesign — standards-first extension of Error](apierror-standard-error-redesign.md) | Complete | 2026-07-28 | n/a |

## Deferred / Closed

*(Plans parked or superseded.)*

## Backlog

*(Links to ideas not yet promoted to a full IP.)*

| Idea | Notes |
|------|-------|
| [Langfuse integration](terreno-langfuse-integration.md) | AI observability plugin |
| [modelRouter MCP tools](model-router-mcp.md) | MCP surface for consumer app APIs |
| [Offline mode](offline-mode.md) | Superseded in large part by [syncdb](syncdb-local-first.md) — confirm and close |
| [modelRouter actions](model-router-actions.md) | — |
