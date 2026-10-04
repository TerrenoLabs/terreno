# Reference

Technical reference for Terreno packages and APIs. Information-oriented, precise descriptions.

## Packages

- [@terreno/api](api.md) — modelRouter, auth, permissions, setupServer
- [@terreno/ui](ui.md) — Components, theming, layout
- [@terreno/syncdb](syncdb.md) — Local-first data layer (reads, writes, offline sync)
- [@terreno/ai](ai.md) — AI service, GPT routes, Langfuse integration
- [@terreno/ai/harness](ai-harness.md) — Durable multi-phase tasks with transactional checkpoints and audit spans
- [Agent UI Asks](agent-ui-asks.md) — `@terreno/blocks` ask schemas, simple cards, the compact surface, limits, error codes, SSE events, the headless `pendingAsks` and `turn` endpoints, and JSON Schemas for native clients
- [UI blocks](blocks.md) — whole-reply YAML for leaf and layout blocks: grammar, limits, and error codes
- [@terreno/admin-backend](admin-backend.md) — Auto-generated admin CRUD endpoints
- [@terreno/admin-frontend](admin-frontend.md) — Admin panel UI components
- [@terreno/admin-spa](admin-spa.md) — Standalone admin SPA + Express serve plugin
- [@terreno/api-health](api-health.md) — Health check TerrenoPlugin
- [@terreno/announcements](announcements.md) — In-app product update announcements
- [@terreno/comms](comms.md) — Pluggable mail, SMS, push, and verification providers
- [@terreno/jobs](jobs.md) — Durable background jobs, schedules, and queue runners
- [@terreno/feature-flags](feature-flags.md) — Feature flags and A/B testing plugin
- [@terreno/mcp](mcp-server.md) — AI coding assistant integration (MCP)
- [@terreno/cli](cli.md) — `terreno` CLI for docs, codegen, bootstrap, and OpenAPI REST
- [create-terreno-app](create-terreno-app.md) — Scaffold CLI (`bunx create-terreno-app`)
- [@terreno/test](test.md) — Bun test helpers and in-memory MongoDB

## Legacy

`@terreno/rtk` is deprecated for **data synchronization**. New apps should use [`@terreno/syncdb`](syncdb.md). Existing RTK consumers: follow [Migrate from @terreno/rtk to @terreno/syncdb](../how-to/migrate-rtk-to-syncdb.md). Archived RTK reference: [legacy/rtk.md](legacy/rtk.md). `modelRouter` `realtime` and the RTK cache-patching helpers are removed in Terreno 58.

## Configuration

- [Environment Variables](environment-variables.md) — Complete environment variable reference for all packages
- [Admin configuration](admin-config.md) — `modelRouter` `admin` object fields

## Other references

- [UI performance](ui-performance.md) — Component render benchmarks
- [Lifecycle plugin](lifecycle-plugin.md) — Grow/Pick/Roast/Brew/Taste contracts, results, and transitions
- [Scan plugin](scan-plugin.md) — Aim/Sweep/Sift/Plot/Track goal campaigns that feed the lifecycle
- [Install agent skills](../how-to/install-agent-skills.md) — Published `skills/` tree for `npx skills`
- [GitHub issue lifecycle](../how-to/github-issue-lifecycle.md) — Pick-ready issues and Pick plan comments
- Root [package.json](https://github.com/TerrenoLabs/terreno/blob/master/package.json) — Workspace scripts and catalog
- Per-package `package.json` in each package directory — Commands and dependencies
