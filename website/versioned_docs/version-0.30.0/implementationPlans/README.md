# Implementation Plans

Forward-looking implementation plans for significant features and architectural changes to Terreno packages.

## Purpose

This directory contains detailed technical plans for major features **before implementation**. Each plan documents:

- Design goals and rationale
- Architecture and file structure
- Configuration interfaces
- Usage examples
- Breaking changes and migration paths
- Implementation tasks and phases

## Current Plans

- **[Admin UI v2 — Django-parity admin](admin-ui-v2-django-parity.md)** — Config-driven admin shell (sidebar, home widgets, changelist, forms, bulk + background actions); tasks in [`docs/tasks/admin-ui-v2-django-parity.md`](../tasks/admin-ui-v2-django-parity.md)
- **[Modular API (TerrenoApp)](ModularAPI.md)** — New fluent builder API to replace `setupServer` in `@terreno/api`
- **[Offline Mode](offline-mode.md)** — Placeholder plan for offline queueing, replay, conflict handling, and UI surfaces
- **[MCP Boost Parity](mcp-boost-parity.md)** — Docs search tools, local stdio MCP with runtime introspection, browser log capture, per-package guidelines, and upgrade prompts (inspired by laravel/boost)
- **[Docs Site & Versioning](docs-site-and-versioning.md)** — Docusaurus site, versioned docs per release, UI demo embeds, and docs-maintenance skills

## Status Tracking

| Plan | Status | Target Version | Discussion |
|------|--------|----------------|------------|
| Admin UI v2 (Django parity) | ✅ Approved | TBD | — |
| Modular API | 📝 Planning | 2.0.0 | [#149](https://github.com/TerrenoLabs/terreno/pull/149) |
| Offline Mode | Placeholder | TBD | TBD |
| MCP Boost Parity | 📝 Planning | TBD | TBD |
| Docs Site & Versioning | 📝 Planning | TBD | TBD |

## Process

1. **Planning**: Implementation plan merged to master
2. **Discussion**: Community feedback in linked PR/issue
3. **Implementation**: Feature developed in feature branch with tests
4. **Documentation**: How-to guides and migration docs updated
5. **Release**: Plan moves to `docs/explanation/` as architectural documentation

Plans that are fully implemented should be moved to `docs/explanation/` and updated to reflect the actual implementation.
