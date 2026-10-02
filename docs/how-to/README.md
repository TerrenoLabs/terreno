# How-to Guides

Problem-oriented, practical steps. Use these when you know what you want to do.

## Deployment

- [Deployment baseline](../explanation/deployment-baseline.md) — seven requirements every host must satisfy
- [Build for web](build-for-web.md) — export static web bundle with correct API URL
- [Deploy to Google Cloud Platform](deploy-to-gcp.md) — index for GCP guides
- [Deploy backend to Cloud Run](deploy-backend-to-cloud-run.md) — container + Secret Manager + Cloud Run
- [Deploy web to GCS + CDN](deploy-web-to-gcs-cdn.md) — static hosting with SPA routing

## Contents

- [Create a Terreno app](create-a-terreno-app.md) — Scaffold a full-stack app with `create-terreno-app` (Bun or npm)
- [Update dependencies](update-dependencies.md) — Daily rolling PR, exercise test, Expo fingerprint freeze
- [CircleCI](circleci.md) — Dual-run CI on CircleCI (package CI / policy / e2e; deploys later)
- [Run tests locally](run-tests-locally.md) — Map every CircleCI test job to a Cursor Cloud / laptop command
- [GitHub Actions CI](github-actions-ci.md) — Cut PR runtime: docs previews, compile-once e2e, pinned Bun
- [Add feature flags](add-feature-flags.md) — Add feature flags, A/B testing, and OpenFeature migration
- [Rate limiting](rate-limiting.md) — Opt-in HTTP limiter on `TerrenoApp` (memory or Redis)
- [Receive inbound webhooks](inbound-webhooks.md) — HMAC, Stripe, Twilio, and SendGrid signatures on `WebhooksApp`
- [Durable background jobs](background-jobs.md) — `@terreno/jobs`: enqueue, workers, schedules, Cloud Tasks / Vercel Queues
- [Create a Mongoose model](create-a-model.md) — Define models with proper conventions
- [Enable the framework audit log](audit-log.md) — `AuditApp`, per-router `audit`, append-only events
- [Seed a database](seed-a-database.md) — Idempotent sync, dry runs, and guarded reset-and-reseed
- [Run MongoDB migrations](run-mongodb-migrations.md) — Versioned `up`/`down` files, `terreno-migrate`, production gate
- [Add GitHub OAuth authentication](add-github-oauth.md) — Enable GitHub login for your API
- [Configure Better Auth](configure-better-auth.md) — Set up Better Auth with social OAuth (Google, GitHub, Apple)
- [Password reset and email verification](password-reset.md) — JWT routes, comms templates, Better Auth hooks
- [Add WebSocket integration](websocket-integration.md) — Set up real-time Socket.io connections
- [Expose Model Context Protocol tools](expose-mcp-tools.md) — Turn `modelRouter` models into MCP tools an LLM can call
- [Set up Terreno MCP](set-up-terreno-mcp.md) — Configure hosted docs/codegen and local runtime tools
- [Debug with MCP](debug-with-mcp.md) — Diagnose backend, browser, Metro, app, and client-state failures
- [Connect an MCP client with a service token](connect-mcp-service-token.md) — Mint a personal `mcp_` key for Perplexity and other remote clients
- [Install agent skills](install-agent-skills.md) — `npx skills`, the Cursor plugin, the Codex plugin, or the Claude Code plugin
- [GitHub issue lifecycle](github-issue-lifecycle.md) — Create pick-ready issues, Pick ⇄ Roast, or unattended `status:ready-for-dev` pickup
- [Call external APIs](call-external-apis.md) — Authenticated HTTP client, retries, and error normalization for third-party integrations
- [Upgrade banner](upgrade-banner.md) — Soft warning and hard-block app update UX
- [Upgrade Terreno](upgrade-terreno.md) — Lockstep `@terreno/*` bumps, note range, order, rollback
- [Track upstream Expo](track-upstream-expo.md) — Morning probe for SDK betas; `release-X.Y.Z` loop log + native fingerprint deps
- [Compose charts in a dashboard grid](charts-and-dashboards.md) — `LineChart` / `BarChart` / `AreaChart` / `DonutChart` inside `Card`s in `DashboardGrid` (ops-dashboard scorecards and spans: [dashboard-chart-parity](../implementationPlans/dashboard-chart-parity.md))
- [Compare rendered chart snapshots](compare-chart-rendered-snapshots.md) — PNG goldens for the chart visual gallery, not JSON snapshots
- [Migrate from @terreno/rtk to @terreno/syncdb](migrate-rtk-to-syncdb.md) — Move data sync to the local-first layer
- [Generate a REST CLI from OpenAPI](generate-a-rest-cli.md) — Scaffold `terreno generate rest-cli` for an app API
- [In-app notifications](in-app-notifications.md) — Register `NotificationsApp`, syncdb inbox, and UI bell
- [Add organizations](add-organizations.md) — Opt into Membership-backed tenancy, RBAC, admin, and seeded examples
- [Add a GPT chat mascot](add-gpt-chat-mascot.md) — Optional consumer-owned character on empty `GPTChat`

## Admin

- [Build admin screens](build-admin-screens.md) — Screens, sidebar nav, `routeBase`, custom screens
- [Add a model to the admin](admin-add-model.md) — `modelRouter({admin: ...})` setup
- [Import pre-built admins](admin-import-prebuilt.md) — Plugin `adminContribution()` wiring
- [Add a custom admin field widget](admin-custom-widget.md) — Custom field widgets
- [Customize the admin home](admin-custom-home.md) — Home slots and built-in widgets

## Coming Soon

- Add custom permissions
- Implement file uploads
- Configure email notifications
- Customize AI workflows
