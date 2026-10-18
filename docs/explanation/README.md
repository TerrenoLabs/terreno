# Explanation

Understanding-oriented documentation: concepts, architecture, and context.

## Deployment

- [Deployment baseline](deployment-baseline.md) — seven requirements for production Terreno apps
- [GCP deployment architecture](deployment-architecture-gcp.md) — Cloud Run + GCS/CDN topology and tradeoffs
- [GCP hosting architecture](gcp-hosting-architecture.md) — static site hosting with GCS and Cloud CDN (legacy detail)

## Contents

- [Local-first data](local-first-data.md) — Why the local store is the UI source of truth
- [Planning plugins](planning-plugins.md) — How the lifecycle and scan plugins divide discovery from delivery
- [Loop engineering](loop-engineering.md) — Fresh-invocation lifecycle, state, evidence, and orchestration boundaries
- [GitHub issue lifecycle](../how-to/github-issue-lifecycle.md) — Pick-ready issues and plan comments for Pick/Roast
- [Install agent skills](../how-to/install-agent-skills.md) — `npx skills add TerrenoLabs/terreno`
- [AI observability](ai-observability.md) — Two planes (telemetry vs control), plugins vs LangfuseApp, SOP loop
- [Durable agent harness](durable-agent-harness.md) — Phases, checkpoints, and why the audit span shares the checkpoint transaction
- [AI-powered workflows](ai-workflows.md) — Autonomous documentation, testing, and maintenance workflows
- [Agent UI Asks](agent-ui-asks.md) — Why agent questions are client-side tool calls, the pause and resume round trip, why cards carry exact answers, the watch paths, asks vs blocks
- [Agent UI blocks](agent-ui-blocks.md) — Why chat replies use a closed YAML catalog instead of free-form UI, why steppers and checklists call the server, and the rich-blocks rollout
- [Authentication architecture](authentication.md) — Better Auth, JWT, and optional MCP service tokens
- [Organization tenancy](organizations.md) — Optional Membership-backed tenancy, context, and isolation boundaries
- [Configuration system](configuration-system.md) — Runtime configuration with database persistence
- [Dependency management](dependency-management.md) — Catalog pins, exercise tests, fingerprint freeze
- [Modular API design](modular-api-design.md) — 🚧 Why TerrenoApp replaces setupServer
- [modelRouter actions](model-router-actions.md) — Named collection and instance operations on modelRouter
- [Explicit `any` policy](explicit-any-policy.md) — Require rationale markers and ratchet usage per file
- [No barrel imports](no-barrel-imports.md) — Import concrete modules, not `index` re-export barrels
- [TypeScript configuration](typescript-configuration.md) — tsconfig profiles for Node, frontend, Expo, and Bun workspaces on TypeScript 6
- [Production source rules](source-rules.md) — Arrow functions, Luxon, APIError, logging, findOne, `as any`
- [Positioning](positioning.md) — Canonical copy blocks and the honest Django/Rails comparison
- [Versioning policy](versioning-policy.md) — Lockstep `@terreno/*` versions, pre-1.0 breaks, deprecation window
- [How admin interfaces are shaped](admin-interface.md) — Screens, sidebar, `apiBase` vs `routeBase`
- [Admin plugin frontend widgets](admin-plugin-frontend.md) — Widget IDs from backend plugins
- [Consent admin migration](admin-consent-migration.md) — Which consent screens stay hand-written
- [Public roadmap process](roadmap-process.md) — GitHub roadmap vs Linear execution
- [Example app coverage](example-coverage.md) — Which framework capabilities the example apps exercise
- [Repository settings](repository-settings.md) — Maintainer GitHub settings that cannot be committed
- [Why Terreno owns chart SVG](charts.md) — Owned `react-native-svg` vs victory-native
