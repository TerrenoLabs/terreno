# Terreno audit: enhancements + AI optimization

Scope: read-only inspection of `/workspace` at `6cf1f06c` (58.0.4). Status was verified by searching source, not docs. Anything not confirmed in code is marked SUSPECTED. Severity S0-S3 and effort E0-E3 follow the audit skills' scales.

## 1. Capability matrix

| Feature | Status | Evidence |
| --- | --- | --- |
| App scaffold | present | `create-terreno-app/src/generate.ts` (2,695 lines, one fixed shape); `terreno bootstrap app` wraps it (`cli/src/commands/bootstrap.ts`) |
| Starter templates (variants) | absent | `create-terreno-app/src/cli.ts` has no `--template`; one output shape |
| Model / route / screen / form generators | partial | `cli/src/commands/generate.ts`, `mcp-server/src/tools.ts` (`terreno_generate_*`). Each emits one file or stdout; nothing registers the route, regenerates the SDK, adds admin, or writes a test |
| One-shot resource scaffold (model to CRUD screens) | absent | No `generate resource`/`scaffold` command in `cli/src/help.ts` |
| Local dev orchestration (`dev` command, DB bootstrap) | absent | No `dev` in `cli/src/help.ts`; `docs/how-to/create-a-terreno-app.md` step 3 has the user hand-start `mongod --replSet` and run a `node -e` replSetInitiate one-liner |
| Migrations / backfills | present | `api/src/migrations/{runner,generate,lock,cli}.ts`; admin UI `admin-frontend/src/AdminMigrations.tsx` |
| Seeding | partial | `api/src/seedRunner.ts`, `docs/how-to/seed-a-database.md`; no factories or faker anywhere in `test/src`, `api/src` |
| File uploads / storage | partial | GCS only, in two unrelated places: `ai/src/service/fileStorage.ts`, `admin-backend/src/documentStorageApp.ts`. No storage adapter interface, no S3/R2/local disk, no upload field on models |
| Email | partial | SendGrid only (`comms/src/adapters/sendgrid.ts`); no Resend/SES/SMTP/Postmark. Templates in `comms/src/templates.ts` |
| SMS / OTP / push | present | `comms/src/adapters/{twilioSms,twilioVerify,expoPush}.ts`, delivery webhooks in `comms/src/webhooks/` |
| Background jobs / cron | present | `jobs/src/{scheduler,scheduleCron}.ts`, runners `mongoRunner`, `gcpCloudTasks`, `vercelQueues` |
| Search | absent | `api/src/api.ts:921-927`: `$search` and `$autocomplete` branches are no-ops. Admin-only text search in `admin-backend/src/adminTextSearch.ts`. Global search is roadmap "Future" (#1183) |
| Orgs / RBAC | present | `api/src/orgs/`, `api/src/rbac/`, `admin-frontend/src/orgs/` |
| Invitations / seats | absent | No invite code in `api/src` or `admin-backend/src`; roadmap #1173 |
| Billing / subscriptions | absent | Only a Stripe webhook verifier (`api/src/webhooks/verifiers/stripe.ts`); IP `docs/implementationPlans/billing-stripe.md` |
| Audit log | present | `api/src/audit/` |
| i18n | absent | No i18n library in `ui/src` or `syncdb/src`; only per-locale consent content (`ui/src/useConsentForms.ts`) |
| Rate limiting | present | `api/src/rateLimit/` (memory, Mongo, Redis stores) |
| Caching | absent | No cache layer in `api/src` (Redis is used only for rate limit and realtime) |
| Inbound webhooks | present | `api/src/webhooks/` (verifiers, idempotency) |
| Outbound webhooks | absent | No subscription/delivery code found |
| Observability / tracing | partial | Sentry + request context (`api/src/requestContext.ts`, `logger.ts`); no OpenTelemetry anywhere |
| Product analytics | absent | No PostHog/Segment/Amplitude hook in `api/src`, `ui/src`, `syncdb/src` |
| Auth (password, social, 2FA, passkeys) | present | `api/src/betterAuthFeatures.ts`, `api/src/accountSecurity/` |
| Enterprise SSO | absent | Roadmap "Future" #1184 |
| Schema-driven forms | partial | Admin only (`admin-frontend/src/AdminModelForm.tsx`, `api/src/schemaMetadata.ts`). No app-facing `SchemaForm` in `ui/src` |
| Admin customization | present | `docs/how-to/admin-custom-{home,widget}.md`, `admin-backend/src/adminUiV2.ts`, scripts runner |
| Testing utilities | present | `test/src/` (in-memory Mongo, `authAsUser`, provider mocks, `renderWithTerreno`, `freezeTime`); `syncdb/src/testing/fakeTransport.ts` |
| Deploy targets | partial | GCP (`terraform/modules/`, `deploy-gcp` skill), Vercel (`deploy-vercel` skill), Netlify. No Fly/Render/Railway/Docker Compose; scaffold emits CI workflows but no Dockerfile (SUSPECTED: grep of `generate.ts` found none) |
| Plugin / extension system | present-but-undiscoverable | `api/src/terrenoPlugin.ts`, `terrenoApp.ts` are used by every first-party package, but `docs/how-to/` has no "write a plugin" page and there is no plugin index |
| Offline / sync UX primitives | present | `ui/src/{OfflineBanner,SyncStatusBanner}.tsx`, `admin-frontend/src/AdminConflictSheet.tsx`, `useSyncStatus`, `useConflicts` |
| Onboarding flows | absent | No onboarding/wizard/tour component in `ui/src`; wizard is roadmap "Future" (#1181) |
| Notification center | present | `api/src/notifications/`, `ui/src/Notification{Bell,Inbox,Preferences}.tsx` |
| Feature flags | present | `feature-flags/src/` (OpenFeature provider) |
| AI chat UI + tool calling | present | `ui/src/GPTChat.tsx`, `ai/src/routes/gpt*.ts`, `ai/src/harness/` (agents, approvals, subagents) |
| AI evals / observability | present | `ai/src/observability/` (datasets, evaluators, judge agreement) |
| RAG / embeddings / vector search | absent | No embedding or `$vectorSearch` code in `ai/src` or `api/src` |
| App as MCP server | present | `api/src/mcp/` (tools generated from modelRouter + actions, OAuth, service tokens) |
| Tutorials | partial | `docs/tutorials/` holds one file (`getting-started.md`, 84 lines) against 70 how-tos |
| llms.txt | absent | No `llms*.txt` in repo or `website/` |

## 2. Top opportunities, ranked by adoption impact / effort

1. **Zero-setup local dev: `terreno dev`** (S0, E1, 3-5 days, table stakes). Build one command that starts a single-node replica set, initiates it, seeds users, and runs backend + web. Today the first run needs a hand-installed `mongod`, a `node -e` replSetInitiate one-liner, and four secrets; this is the largest drop-off point before first render, and Supabase/Convex/Rails all start with one command. Build on `test/src/mongo/mongoServer.ts` and `ensureMongoBinary.ts` (already download and run mongod), `test/src/smoke/spawnExampleBackend.ts`, `api/src/seedRunner.ts`, `cli/src/commands/project.ts`.

2. **`terreno generate resource`: model to working CRUD in one command** (S0, E1-E2, 1-2 weeks, table stakes that becomes a differentiator on universal + local-first). Compose the existing generators, then do the wiring they skip: register the router in `server.ts`, add `sync` config, add the admin entry, run `sdk` + `sync-sdk`, emit list/detail/form screens and a backend test. Rails `scaffold`, Redwood `generate scaffold` and Payload collections set this expectation. Build on `cli/src/commands/generate.ts`, `mcp-server/src/tools.ts:210-404`, `syncdb/src/codegen/`, `api/src/schemaMetadata.ts`.

3. **Expose the same scaffold through MCP as a typed tool** (S1, E1, 2-3 days after #2, differentiator). `terreno_scaffold_resource` returning a file plan plus diffs, with a dry-run mode. Today MCP generators return text the agent must place and wire by hand, which is where agents drift. Build on `mcp-server/src/tools.ts`, `cli/src/writeFiles.ts`.

4. **Pluggable storage + upload primitive** (S1, E2, 2 weeks, table stakes). One `StorageAdapter` (GCS, S3/R2, local disk for dev), a `fileField` model helper with signed upload/download actions, and a `ui` upload field. Nearly every app needs avatars or attachments; GCS-only blocks non-GCP adopters, and the two existing implementations do not share code. Build on `ai/src/service/fileStorage.ts`, `admin-backend/src/documentStorageApp.ts`, `ui/src/FilePickerButton.tsx`, `test/src/mocks/gcs.ts`.

5. **More comms adapters: Resend, SES, SMTP** (S1, E1, 2-3 days each, table stakes). The adapter seam already exists; SendGrid-only email is a blocker for hobby and EU adopters, and SMTP unlocks local dev with Mailpit. Build on `comms/src/adapters/sendgrid.ts`, `comms/src/types.ts`, `comms/src/adapters/console.ts`.

6. **Invitations and seat management** (S1, E2, 1-2 weeks, table stakes for B2B). Orgs and RBAC ship without a way to add a teammate. Build on `api/src/orgs/`, `api/src/accountSecurity/membershipActions.ts`, `admin-frontend/src/orgs/OrgMembersScreen.tsx`, `comms/src/templates.ts`. Already roadmap #1173; raise its priority above billing.

7. **App-facing schema forms and list screens** (S1, E2, 2 weeks, differentiator). Lift the admin's metadata-driven renderers into `@terreno/ui` as `SchemaForm` / `ResourceList` so app screens are generated from `describeModel()` rather than hand-written. Build on `admin-frontend/src/{AdminModelForm,AdminFieldRenderer,AdminModelTable}.tsx`, `api/src/schemaMetadata.ts`, `blocks/src/asks/`.

8. **Starter templates** (S1, E1-E2, 1 week for 3 templates, table stakes). `--template minimal|saas|ai-chat`: SaaS adds orgs + notifications + jobs; AI chat adds `GPTChat` + harness. Shows the batteries wired together, which the single todo scaffold does not. Build on `create-terreno-app/src/generate.ts`, `example-backend/src/`, `example-frontend/app/`.

9. **Plugin authoring guide + plugin index** (S1, E0-E1, 2-3 days, differentiator for an OSS ecosystem). `TerrenoPlugin` is the mechanism behind every first-party package but is undocumented for outsiders. Add a how-to, a `generate plugin` template, and a docs page listing plugins. Build on `api/src/terrenoPlugin.ts`, `api-health/src/healthApp.ts` (smallest worked example).

10. **Search** (S2, E2, 1-2 weeks, table stakes). Implement the dead `$search` path with a Mongo text-index default and an Atlas Search option, plus a `ui` search field bound to it. Build on `api/src/api.ts:921`, `admin-backend/src/adminTextSearch.ts`, `syncdb/src/query/where.ts`.

11. **Stripe billing plugin** (S1, E2-E3, 3-4 weeks, table stakes for SaaS). Plans, checkout, portal, webhook sync, entitlement checks via `can()`. Build on `api/src/webhooks/verifiers/stripe.ts`, `docs/implementationPlans/billing-stripe.md`, `api/src/rbac/`.

12. **i18n baseline** (S2, E2, 2 weeks, table stakes outside the US). Translation provider + extraction for `@terreno/ui` built-in strings and app strings. Build on the locale resolution in `ui/src/useConsentForms.ts`; `expo-localization` is already mocked in `test/src/expo/expoModuleMocks.ts`.

13. **Test factories** (S2, E1, 3-4 days, table stakes). `defineFactory(Model, ...)` in `@terreno/test`, reused by `seedRunner`. Build on `test/src/http/authAsUser.ts`, `api/src/seedRunner.ts`.

14. **RAG primitive for `@terreno/ai`** (S2, E2, 2 weeks, differentiator when paired with the admin). An `embeddingsPlugin` for models, Atlas `$vectorSearch` retrieval, and a retrieval tool for the harness. Build on `ai/src/harness/defineTool.ts`, `ai/src/models/fileAttachment.ts`, `jobs/` for indexing.

15. **OpenTelemetry + one more deploy target** (S2, E1-E2, 1 week each, table stakes). OTel spans around modelRouter, jobs and AI calls; a Dockerfile + Compose file in the scaffold so Fly/Render/Railway work. Build on `api/src/requestContext.ts`, `example-backend/Dockerfile`.

Later, lower ratio: outbound webhooks, product analytics hook, onboarding/wizard component (#1181), response caching, enterprise SSO (#1184).

## 3. Top 5 AI-tooling findings

1. **About 148 KB (roughly 37K tokens) of instructions are effectively always loaded in Claude Code** (S1, E0, half a day). `CLAUDE.md` is 28.9 KB, `CLAUDE.local.md` 12.2 KB, and 11 package rules under `.claude/rules/` carry `paths: '**/*'` (107 KB total; `api/00-api.md` alone is 27.9 KB). The cause is `globs: ["**/*"]` in `.rulesync/rules/<pkg>/00-*.md`; `comms`, `jobs` and `blocks` are already scoped correctly. Fix: scope each to `<pkg>/**`. Exact load timing of `**/*` path rules is SUSPECTED (they match on the first file touched).

2. **`CLAUDE.local.md` is a tracked, stale near-duplicate of `CLAUDE.md`** (S2, E0, 1 hour). It is generated from `.rulesync/rules/01-claudecode-root.md` (`localRoot: true`), is committed to git, repeats the pitch, architecture diagram, code style and attention-span section, and has drifted: it lists 9 packages and says `bun run test` covers "api and ui". Delete the source rule, or reduce it to Claude-only deltas.

3. **Skill copies: 374 `SKILL.md` files, 213 distinct by hash** (S2, E1, 2-3 days). The same skill lives in `plugins/terreno-planning/skills/`, generated `plugins/terreno-claude/`, generated `skills/`, and rulesync outputs in `.claude/`, `.cursor/`, `.devin/`, `.agents/` (about 4 MB tracked). Two generators (`rulesync` and `bun run skills:sync`) must both run, guarded by `rulesync-check.yml`. Options: stop committing host outputs and generate at install, or publish only `skills/` + plugin manifests. 26 skills appear under 3+ roots.

4. **Stop hook runs the full repo gate on every agent stop** (S2, E1, 1 day). `.rulesync/hooks/quality-check.sh` runs `bun run lint` (which already ends with `typecheck`), then `bun run compile`, then `analyze:full` (knip + dependency-cruiser), with a 300 s timeout, regardless of what changed, including read-only sessions. Fix: exit early on a clean tree, scope to affected packages, drop the duplicate compile. The per-edit hook (`analyze:fast`, changed-file Biome) is fine.

5. **MCP codegen surface is text-only and has dead weight** (S2, E1). The hosted server has 4 generators and 7 prompts but no tool that writes or wires files, and no llms.txt on the docs site. `mcp-server/src/docs/templates/` (31 tracked files, including a `bootstrap/` tree superseded by `create-terreno-app`) is not referenced from `mcp-server/src/*.ts` (SUSPECTED dead; I did not trace the build script). Differentiators to add: `terreno_scaffold_resource` (opportunity 3), `llms.txt` + `llms-full.txt` generated by the Docusaurus build, typed JSON output schemas on generator tools, and a golden-path prompt per starter template.

Strengths worth stating: the local MCP server (`mcp-server/src/local/`: logs, DB reads, SyncDB state, browser drive) and the app-side MCP generated from modelRouter (`api/src/mcp/toolGenerator.ts`) are ahead of Rails/Laravel Boost equivalents.

## 4. Not covered

- Nothing was run: no builds, tests, scaffold execution, or hook timing. Hook latency and token figures are from file sizes and script contents.
- Quality and completeness of present features (orgs, jobs, harness, migrations) was not assessed, only presence.
- `website/` content, `demo/`, `admin-spa/`, `infra/`, native build flows, and the Cursor/Codex/Devin rule loading behavior were not inspected.
- Content of individual skills (overlap in instructions, trigger quality) was compared by name and hash only.
- No web research; competitor comparisons are from memory.
- Architecture, security/performance, docs/process and UI component UX are owned by the other auditors.
