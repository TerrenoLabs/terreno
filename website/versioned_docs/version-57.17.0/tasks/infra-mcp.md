# Tasks: Infrastructure MCP server (`@terreno/infra-mcp`)

Plan: [docs/implementationPlans/infra-mcp.md](../implementationPlans/infra-mcp.md)
Status: Blocked — Phase 1 RBAC wiring depends on the RBAC module PR ([rbac-permissions.md](../implementationPlans/rbac-permissions.md)). Scaffold/adapter tasks marked (unblocked) can start now.

## Phase 1 — Read-only core

- [ ] (unblocked) Scaffold `infra-mcp/` workspace package: package.json (catalog deps), tsconfig, biome, bun test setup, root workspace + catalog entries (zod 4, `@modelcontextprotocol/server`, `@better-auth/oauth-provider`, `@better-auth/mcp`)
- [ ] (unblocked) `src/config.ts`: `defineInfraMcp` config schema (zod), secret resolution (env/Secret Manager), boot validation
- [ ] (unblocked) `src/server.ts`: Express/TerrenoApp server with SDK v2 `/mcp` endpoint (`createMcpHandler`, `legacy: "stateless"`, `toNodeHandler`) + `/health`
- [ ] (unblocked) `src/auth.ts`: Better Auth OAuth 2.1 setup — authorization server, RFC 9728 protected-resource metadata, bearer verification middleware; login page flow verified with Cursor and Claude Code
- [ ] `src/access.ts`: `infraStatements`, default roles (`infra-readonly`, `infra-operator`), `createAccess` wiring, `Mcp-Name`-keyed authz middleware, per-user filtered `tools/list` (**blocked on RBAC PR**)
- [ ] `src/models/infraAuditLog.ts` + audit middleware around `tools/call` (statuses: allowed/denied/confirmed/rejected/error; per-tool arg redaction)
- [ ] (unblocked) Integration adapter types + registry (`src/integrations/types.ts`, `registry.ts`)
- [ ] (unblocked) GCP native adapter (ADC): `gcp_query_logs`, `gcp_list_log_names`, `gcp_query_metrics`, `gcp_list_error_groups`, `gcp_list_cloud_run_services`, `gcp_get_cloud_run_service`
- [ ] (unblocked) Sentry native adapter (REST + static token): `sentry_search_issues`, `sentry_get_issue`, `sentry_list_issue_events`, `sentry_get_event`
- [ ] (unblocked) Mongo native adapter (read URI): `mongo_list_collections`, `mongo_collection_schema`, `mongo_find`, `mongo_aggregate` (reject `$out`/`$merge`). Extract the shared read-query/schema logic from `mcp-server/src/local/tools/databaseQuery.ts` + `databaseSchema.ts` into a reusable module both packages import — do not fork copies into infra-mcp (per architectural review)
- [ ] Admin panel registration (`@terreno/admin-backend`): Users, InfraAuditLog (read-only)
- [ ] Terraform: `infra_mcp_service` Cloud Run module instance, Artifact Registry, runtime SA with viewer/logging IAM only
- [ ] Tests: authz matrix (role × tool × tools/list filtering), adapter handlers, audit records, legacy-client fallback
- [ ] Deploy + end-to-end verification from a real MCP client; docs: `.cursor/rules/infra-mcp/00-infra-mcp.mdc`, AGENTS.md/CLAUDE.md package lists
- [ ] Roadmap: open the tracking issue from [roadmap-seed-issues.md](../explanation/roadmap-seed-issues.md#infra-mcp) once the IP is Approved, add it to the Terreno Roadmap board, and register `@terreno/infra-mcp` → `area:mcp` in `scripts/issueAreaLabels.ts` + the bug-report package dropdown when the package lands

## Phase 2 — Write tier + machine callers

- [ ] `confirmWrite` elicitation wrapper; fail-closed behavior for clients without elicitation support
- [ ] Config override (`confirmWrites: false`) gated by `infra:writeUnconfirmed`; tests for both paths
- [ ] Write tools: `sentry_resolve_issue`, `sentry_assign_issue`, `gcp_rollback_cloud_run_revision`, `gcp_update_cloud_run_traffic`, `mongo_update_one`, `mongo_delete_one`; widen runtime SA IAM minimally
- [ ] Service tokens: spike Better Auth `apiKey` plugin; fallback `ServiceToken` model; machine users (`isServiceAccount`) with role assignment; admin surface (token shown once)
- [ ] Cloud agent migration: `INFRA_MCP_URL` + service token in agent environments; verify log-digging flows; remove `GCP_SA_*` injection; update AGENTS.md Cursor Cloud instructions

## Phase 3 — Proxied adapters + remaining vendors

- [ ] `ProxiedAdapter`: `@modelcontextprotocol/client` (stdio + HTTP), deny-by-default `allowedTools` with mandatory tier annotations, tool name prefixing, upstream lifecycle management
- [ ] Reference proxied integration (`@sentry/mcp-server` stdio or `@google-cloud/observability-mcp`) with parity tests against native tools
- [ ] Expo/EAS native adapter (`EXPO_TOKEN`): build status, update status, submission status (read); trigger tools deferred to write expansion
- [ ] Vercel native adapter (API token): deployments, logs, project info (read)

## Phase 4 — OSS packaging

- [ ] `defineInfraMcp` config reference + quickstart docs (website); one-man-shop deploy path (container anywhere)
- [ ] Publish `@terreno/infra-mcp`; changelog + upgrade notes
- [ ] Dogfood writeup: our deployment as the reference architecture
