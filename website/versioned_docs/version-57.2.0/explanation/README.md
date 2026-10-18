# Explanation

Understanding-oriented documentation: concepts, architecture, and context.

## Deployment

- [Deployment baseline](deployment-baseline.md) — seven requirements for production Terreno apps
- [GCP deployment architecture](deployment-architecture-gcp.md) — Cloud Run + GCS/CDN topology and tradeoffs
- [GCP hosting architecture](gcp-hosting-architecture.md) — static site hosting with GCS and Cloud CDN (legacy detail)

## Contents

- [Local-first data](local-first-data.md) — Why the local store is the UI source of truth
- [Loop engineering](loop-engineering.md) — Fresh-invocation lifecycle, state, evidence, and orchestration boundaries
- [Install agent skills](../how-to/install-agent-skills.md) — `npx skills add TerrenoLabs/terreno`
- [AI-powered workflows](ai-workflows.md) — Autonomous documentation, testing, and maintenance workflows
- [Authentication architecture](authentication.md) — How JWT, OAuth, and token refresh work
- [Configuration system](configuration-system.md) — Runtime configuration with database persistence
- [Dependency management](dependency-management.md) — Dependabot, auto-merge, and security practices
- [Modular API design](modular-api-design.md) — 🚧 Why TerrenoApp replaces setupServer
- [modelRouter actions](model-router-actions.md) — Named collection and instance operations on modelRouter
- [No barrel imports](no-barrel-imports.md) — Import concrete modules, not `index` re-export barrels
- [Positioning](positioning.md) — Canonical copy blocks and the honest Django/Rails comparison
