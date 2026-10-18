# Reference

Technical reference for Terreno packages and APIs. Information-oriented, precise descriptions.

## Packages

- [@terreno/api](api.md) — modelRouter, auth, permissions, setupServer
- [@terreno/ui](ui.md) — Components, theming, layout
- [@terreno/syncdb](syncdb.md) — Local-first data layer (reads, writes, offline sync)
- [@terreno/ai](ai.md) — AI service, GPT routes, Langfuse integration
- [@terreno/admin-backend](admin-backend.md) — Auto-generated admin CRUD endpoints
- [@terreno/admin-frontend](admin-frontend.md) — Admin panel UI components
- [@terreno/admin-spa](admin-spa.md) — Standalone admin SPA + Express serve plugin
- [@terreno/api-health](api-health.md) — Health check TerrenoPlugin
- [@terreno/comms](comms.md) — Pluggable mail, SMS, push, and verification providers
- [@terreno/feature-flags](feature-flags.md) — Feature flags and A/B testing plugin
- [@terreno/mcp](mcp-server.md) — AI coding assistant integration (MCP)
- [@terreno/test](test.md) — Bun test helpers and in-memory MongoDB

## Migrating from RTK

`@terreno/rtk` is deprecated for **data synchronization**. New apps should use [`@terreno/syncdb`](syncdb.md). Existing RTK consumers: follow [Migrate from @terreno/rtk to @terreno/syncdb](../how-to/migrate-rtk-to-syncdb.md). Archived RTK reference: [legacy/rtk.md](legacy/rtk.md).

## Configuration

- [Environment Variables](environment-variables.md) — Complete environment variable reference for all packages

## Other references

- [Lifecycle plugin](lifecycle-plugin.md) — Grow/Pick/Roast/Brew/Taste contracts, results, and transitions
- [Install agent skills](../how-to/install-agent-skills.md) — Published `skills/` tree for `npx skills`
- Root [package.json](https://github.com/TerrenoLabs/terreno/blob/master/package.json) — Workspace scripts and catalog
- Per-package `package.json` in each package directory — Commands and dependencies
