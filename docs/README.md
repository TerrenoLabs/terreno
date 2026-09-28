# Terreno Documentation

**Terreno is Django/Rails for TypeScript — with universal app support.**

Terreno is Django/Rails for TypeScript — a batteries-included, full-stack
framework where the undifferentiated 80% of an app is already written. On the
backend you get Mongoose models, auto-generated REST APIs, permissions, an admin
panel, authentication, and an AI service. On the frontend you get one universal
app — a single React Native codebase that ships to iOS, Android, and web. It is
built to be driven by AI coding agents from the first prompt to a production
deploy.

- Batteries included — auth, CRUD APIs, admin, permissions, AI, realtime,
  feature flags, and consent are already built, so your code is business logic.
- Universal by default — one React Native codebase ships to iOS, Android, and
  web. Not a web framework with a mobile bolt-on.
- AI-native — agents are a first-class client of the framework, not an
  afterthought.

Canonical copy, language rules, and the Django/Rails comparison:
[Positioning](explanation/positioning.md).

## Structure

- **[Tutorials](tutorials/)** — Learning-oriented, hands-on lessons
- **[How-to guides](how-to/)** — Problem-oriented, practical steps
- **[Reference](reference/)** — Technical reference for APIs and packages
- **[Explanation](explanation/)** — Concepts and context
- **[Implementation Plans](implementationPlans/)** — Forward-looking plans for major features

## Packages

| Package | Description |
|---------|-------------|
| [@terreno/api](reference/api.md) | REST API framework for Express/Mongoose (modelRouter, auth, OpenAPI) |
| [@terreno/test](reference/test.md) | Shared Bun test helpers, MongoDB preload utilities, and HTTP fixtures |
| [@terreno/ui](reference/ui.md) | React Native UI component library for iOS, Android, and web |
| [@terreno/syncdb](reference/syncdb.md) | Local-first data layer with TinyBase, durable outbox, and delta sync |
| [@terreno/ai](reference/ai.md) | Provider-agnostic AI service with streaming chat, request logging, and admin tools |
| [@terreno/blocks](reference/agent-ui-asks.md) | Shared contracts for agent-driven UI: ask schemas, answer validation, simple cards, and JSON Schemas for native clients |
| [@terreno/admin-backend](reference/admin-backend.md) | Admin panel backend plugin for `@terreno/api` |
| [@terreno/admin-frontend](reference/admin-frontend.md) | Admin panel frontend screens for `@terreno/api` backends |
| [@terreno/admin-spa](reference/admin-spa.md) | Standalone admin SPA (Expo Router web) plus Express serve plugin |
| [@terreno/api-health](reference/api-health.md) | Health check plugin for `@terreno/api` |
| [@terreno/announcements](reference/announcements.md) | In-app product update announcements |
| [@terreno/comms](reference/comms.md) | Pluggable communications providers |
| [@terreno/feature-flags](reference/feature-flags.md) | Feature flags and A/B testing plugin for `@terreno/api` |
| [@terreno/mcp](reference/mcp-server.md) | MCP server that gives coding agents Terreno docs, codegen tools, and prompts |
| [@terreno/cli](reference/cli.md) | `terreno` CLI for docs, codegen, bootstrap, and OpenAPI REST |
| [create-terreno-app](reference/create-terreno-app.md) | CLI to scaffold a deployable full-stack Terreno app (`bunx create-terreno-app`) |

### Legacy

| Package | Description |
|---------|-------------|
| [@terreno/rtk](reference/legacy/rtk.md) (deprecated for data sync) | OpenAPI SDK, Better Auth Redux, and feature flags for Terreno frontends |

**Migrating from RTK?** See [How to migrate from @terreno/rtk to @terreno/syncdb](how-to/migrate-rtk-to-syncdb.md).

## Quick links

- [Getting started](tutorials/getting-started.md)
- [Set up Terreno MCP](how-to/set-up-terreno-mcp.md)
- [Debug with MCP](how-to/debug-with-mcp.md)
- [Create a Terreno app](how-to/create-a-terreno-app.md)
- [Positioning](explanation/positioning.md)
- [How admin interfaces are shaped](explanation/admin-interface.md)
- [Build admin screens](how-to/build-admin-screens.md)
- [Local-first data](explanation/local-first-data.md)
- [AGENTS.md](../AGENTS.md) — Onboarding context for AI assistants
- [ROADMAP.md](../ROADMAP.md) — Public roadmap
- [CONTRIBUTING.md](../CONTRIBUTING.md) — Setup, tests, and pull requests
