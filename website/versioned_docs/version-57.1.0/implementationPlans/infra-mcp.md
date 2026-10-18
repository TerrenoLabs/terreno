# Implementation Plan: Infrastructure MCP server (`@terreno/infra-mcp`)

**Status:** Draft — unblocked; RBAC module is Complete ([rbac-permissions.md](rbac-permissions.md))
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1090
**Branch:** TBD
**Owner:** TBD
**Created:** 2026-08-09
**Research:** [infra-mcp-research.md](infra-mcp-research.md)

## Goal

A deployable, self-contained MCP server that puts privileged infrastructure tooling — GCP, Sentry, MongoDB, and later Expo/EAS and Vercel — behind a single MCP endpoint with per-user authentication, RBAC-driven read/write permission tiers, per-call write confirmation, and a full audit trail. Packaged as a reusable `@terreno/infra-mcp` workspace package targeting one-man shops through growing startups, dogfooded by our own Cloud Run deployment. Cloud agents stop receiving raw `GCP_SA_*` service-account env vars and instead call this server with scoped service tokens.

## Non-Goals

- Per-user vendor identity (on-behalf-of OAuth to GCP/Sentry/etc.) — the credential interface accepts a user context so this can be added later, but v1 executes with server-held credentials.
- Proxying vendor MCP servers that require interactive browser OAuth (Vercel `mcp.vercel.com`, Expo `mcp.expo.dev`) — research showed these are allowlisted/interactive-only; those vendors get native tools instead.
- A bespoke permission engine — permissioning is the `@terreno/api` RBAC module (`createAccess`), not custom code.
- Rate limiting, cost tracking, tool versioning (future work).
- Changes to the existing `@terreno/mcp` docs server (stays on SDK v1, unchanged).

## Decisions

| Question | Decision |
|----------|----------|
| Approach | **Option C (hybrid):** native curated tools first; proxied vendor-MCP adapters behind an explicit per-tool allow-list with mandatory read/write annotation |
| Protocol | **MCP 2026-07-28 spec** via TS SDK v2 (`@modelcontextprotocol/server`), `createMcpHandler` with `legacy: "stateless"` so 2025-era clients keep working |
| Permissioning | **`@terreno/api` RBAC module** — this IP is blocked behind that PR. Each integration is an RBAC resource with `read`/`write` actions; meta-permissions live on an `infra` resource |
| Write safety | **Write tools require per-call confirmation (MCP elicitation).** A config option can disable confirmation per integration or globally, but it only takes effect for users holding `infra:writeUnconfirmed` — everyone else is still prompted |
| Phase 1 scope | **Read-only:** GCP observability (logs/metrics/errors), Sentry, MongoDB |
| GCP credentials | **Cloud Run default runtime service account only (ADC).** No injected SA key env vars anywhere; the `GCP_SA_*` pattern for cloud agents is retired. IAM on the runtime SA is the outer bound; the MCP's RBAC is the per-user gate |
| Other credentials | Static tokens (Sentry auth token, Mongo connection strings, later `EXPO_TOKEN`/Vercel token) from Secret Manager/env |
| User store & login | Mongo users via `@terreno/api` (`baseUserPlugin` + `rbacUserPlugin`); MCP clients authenticate via OAuth 2.1 using **`@better-auth/oauth-provider` + `@better-auth/mcp`** (already aligned with the 2026-07-28 authorization spec: CIMD, RFC 9728, `requireMcpAuth`) |
| Non-human callers | Service tokens (Better Auth `apiKey` plugin if compatible, else a `ServiceToken` model) mapped to machine users with RBAC roles — this is how cloud agents call the server |
| Packaging | New workspace package `infra-mcp/` publishing `@terreno/infra-mcp`; config-driven integration registry; deployed via a clone of the existing `mcp_service` terraform module |

## Architecture

```
MCP client (Cursor, Claude Code, cloud agent)
  | OAuth 2.1 bearer token (human) or service token (machine)
  v
POST /mcp  — SDK v2 createMcpHandler (2026-07-28 + legacy stateless)
  |
  1. Auth: Better Auth verifies token -> User (+ roles via rbacUserPlugin)
  2. Authz: access.can({[integration]: [tier]}) using Mcp-Name header ->
     integration/tool lookup; tools/list is filtered to the caller's grants
  3. Write tools: elicitation confirmation (unless override + infra:writeUnconfirmed)
  4. Dispatch: IntegrationAdapter (native handler | proxied MCP client)
  5. Audit: InfraAuditLog record for every tools/call
```

### Integration adapter interface

```typescript
// infra-mcp/src/integrations/types.ts
export interface InfraToolContext {
  user: UserDocument;            // resolved caller (human or machine)
  access: TerrenoAccess<InfraStatements>;
  confirmWrite: (summary: string) => Promise<boolean>; // elicitation wrapper
  logger: Logger;
}

export interface InfraTool {
  name: string;                  // exposed as `${integration}_${name}`
  tier: "read" | "write";       // maps to the RBAC action checked
  description: string;
  inputSchema: ZodType;          // zod 4 (SDK v2 Standard Schema requirement)
  handler: (args: unknown, ctx: InfraToolContext) => Promise<ToolResult>;
}

export type IntegrationAdapter =
  | {kind: "native"; name: string; tools: InfraTool[]}
  | {
      kind: "proxied";
      name: string;
      transport: {type: "stdio"; command: string[]} | {type: "http"; url: string; headers?: Record<string, string>};
      // Deny-by-default: only listed upstream tools are exposed, and each
      // MUST carry an explicit tier annotation.
      allowedTools: Record<string, {tier: "read" | "write"; rename?: string}>;
    };
```

Proxied adapters use `@modelcontextprotocol/client` (speaks both protocol eras; stateless — no per-upstream session). Stdio upstreams run as child processes inside the container.

### RBAC statements

```typescript
// infra-mcp/src/access.ts — merged with terrenoStatements via createAccess
export const infraStatements = {
  ...terrenoStatements,
  gcp: ["read", "write"],
  sentry: ["read", "write"],
  mongo: ["read", "write"],
  expo: ["read", "write"],      // phase 3
  vercel: ["read", "write"],    // phase 3
  infra: ["viewAudit", "manageIntegrations", "writeUnconfirmed"],
} as const;
```

- `read`/`write` are in the RBAC module's `READ_ACTIONS` semantics, so the shipped `auditor` role (read-only everywhere) works unmodified — that is the "log digging" role for free.
- Default roles seeded on top of the RBAC defaults: `infra-readonly` (every integration `read`), `infra-operator` (`read` + `write`, still confirmed per call), `superadmin` from RBAC covers everything including `infra:writeUnconfirmed`.
- Per-integration grants ("Sentry read only, no GCP") are just roles with narrower permission sets — no extra machinery.

### Write confirmation flow

1. Tool handler for a `write`-tier tool calls `ctx.confirmWrite(summary)` before mutating.
2. `confirmWrite` sends an MCP **elicitation** request to the client ("Confirm: roll back Cloud Run service X to revision Y? yes/no") and resolves with the user's answer. Decline → tool returns a cancelled result; audit records `rejected`.
3. Override: `config.integrations[name].confirmWrites: false` (or global `confirmWrites`) skips the elicitation **only when** `access.can({infra: ["writeUnconfirmed"]})` passes for the caller. Without the permission, the config flag is ignored and the prompt still fires.
4. Clients that do not support elicitation (some non-interactive agents): write tools **fail closed** with an instructive error unless the caller holds `infra:writeUnconfirmed` and the override is on.

### Configuration

Static config (code/env, validated at boot with zod):

```typescript
// consuming app / our deployment: infra.config.ts
export default defineInfraMcp({
  integrations: {
    gcp: {enabled: true, projectId: env("GCP_PROJECT")},           // ADC — no key
    sentry: {enabled: true, authToken: secret("SENTRY_MCP_TOKEN"), org: "flourish"},
    mongo: {enabled: true, readUri: secret("MONGO_READ_URI"), writeUri: secret("MONGO_WRITE_URI")},
  },
  confirmWrites: true, // global default; per-integration override allowed
});
```

## Models

All models live in `infra-mcp/src/types/models/` per convention; every field carries a `description`.

### User

`@terreno/api` user schema with `baseUserPlugin` + `rbacUserPlugin` (adds `roles: string[]`). Machine users (cloud agents) are ordinary users flagged `isServiceAccount: true`.

### InfraAuditLog

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId ref User | caller (human or machine) |
| `tool` | string | full exposed tool name |
| `integration` | string | adapter name |
| `tier` | "read" \| "write" | |
| `args` | Mixed | redacted via per-tool redaction list before persist |
| `status` | enum | `allowed`, `denied`, `confirmed`, `rejected`, `error` |
| `error` | string? | |
| `durationMs` | number | |
| `created` | Date | plugin-managed |

Indexed on `{userId, created}` and `{integration, created}`. Read surface gated by `infra:viewAudit`.

### ServiceToken (only if Better Auth `apiKey` plugin is unsuitable)

`name`, `hashedToken`, `userId`, `expiresAt?`, `lastUsedAt`, `created`. Verified in the same auth middleware path as bearer tokens.

## APIs

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/mcp` | OAuth bearer / service token | MCP endpoint (2026-07-28 + legacy stateless) |
| GET | `/.well-known/oauth-protected-resource` | — | RFC 9728 metadata (via `@better-auth/mcp`) |
| * | `/oauth2/*`, `/api/auth/*` | — | Better Auth authorization server + login pages |
| GET | `/health` | — | health check |
| * | `/rbac/*` | RBAC perms | role CRUD/assignment (RBAC module's `rbacRouter`) |
| * | `/admin/*` | `admin:access` | admin panel (`@terreno/admin-backend`): Users, InfraAuditLog (read-only), ServiceTokens |

### Phase 1 tools (read tier)

| Integration | Tools |
|---|---|
| gcp | `gcp_query_logs`, `gcp_list_log_names`, `gcp_query_metrics`, `gcp_list_error_groups`, `gcp_list_cloud_run_services`, `gcp_get_cloud_run_service` |
| sentry | `sentry_search_issues`, `sentry_get_issue`, `sentry_list_issue_events`, `sentry_get_event` |
| mongo | `mongo_list_collections`, `mongo_collection_schema`, `mongo_find`, `mongo_aggregate` (read-only stages; `$out`/`$merge` rejected; executed on the read-only connection) |

GCP tools call the Cloud Logging/Monitoring/Error Reporting/Cloud Run Admin APIs via ADC. Sentry tools call the Sentry REST API. Mongo tools reuse the read-query/schema logic behind `mcp-server/src/local/tools/databaseQuery.ts`/`databaseSchema.ts` — extracted into a shared module both packages import rather than forked into infra-mcp — run against the configured read URI.

### Phase 2 tools (write tier, all elicitation-confirmed)

Initial minimal set: `sentry_resolve_issue`, `sentry_assign_issue`, `gcp_rollback_cloud_run_revision`, `gcp_update_cloud_run_traffic`, `mongo_update_one`, `mongo_delete_one` (write URI). Expansion is deliberate and per-PR.

## Notifications

None in v1. Future: optional Slack notifier (via `@terreno/api` notifiers) on write-tier tool execution.

## UI

No new frontend package. Admin surfaces reuse `@terreno/admin-backend` + `@terreno/admin-frontend`/`admin-spa`:

- Users + role assignment (RBAC module's admin screens per its IP).
- InfraAuditLog read-only table (`listFields`: created, user, tool, tier, status).
- ServiceToken management (create shows the token once).

## Phases

### Phase 1 — Read-only core (the "log digging" MVP)

- Package scaffold `infra-mcp/` (workspace, biome, tsconfig, bun test, catalog deps; zod 4 catalog entry).
- SDK v2 `/mcp` endpoint (`createMcpHandler`, `legacy: "stateless"`, `toNodeHandler`) mounted on a TerrenoApp/Express server.
- Better Auth OAuth 2.1 (`@better-auth/oauth-provider` + `@better-auth/mcp`): discovery, login, token verify middleware.
- RBAC wiring: `infraStatements`, default roles, `access.can()` authz middleware keyed on `Mcp-Name`, filtered `tools/list`. **Gated on the RBAC PR.**
- Native adapters: gcp (ADC), sentry, mongo — read tools above.
- `InfraAuditLog` + audit middleware.
- Terraform: clone `mcp_service` module (new service name, Artifact Registry, runtime SA with viewer/log IAM roles only for now).
- Tests: authz matrix (role × tool), tool handlers against mocks/emulators, audit records.
- **Deliverable:** a teammate signs in from Cursor/Claude Code, gets exactly the tools their role allows, digs logs across GCP/Sentry/Mongo.

### Phase 2 — Write tier + machine callers

- Elicitation `confirmWrite` wrapper; config override gated by `infra:writeUnconfirmed`; fail-closed for non-elicitation clients.
- Initial write tools (list above); runtime SA IAM widened only for the specific write APIs.
- Service tokens (Better Auth `apiKey` spike → fallback `ServiceToken` model); machine users with `infra-readonly` role.
- Cloud agent migration: agents get `INFRA_MCP_URL` + service token instead of `GCP_SA_*`; update AGENTS.md/environment docs; retire the env-injected SA keys.
- **Deliverable:** write actions work with per-call confirmation; cloud agents dig logs through the MCP with no raw GCP credentials.

### Phase 3 — Proxied adapters + remaining vendors

- `ProxiedAdapter` (MCP client, stdio + HTTP transports, allow-list with mandatory tier annotations, name prefixing).
- First proxied integration: `@sentry/mcp-server` (stdio, static token) or `observability-mcp` — pick one as the reference implementation and keep the native tools as fallback.
- Native Expo/EAS tools (`EXPO_TOKEN`: builds, updates, submissions status) and Vercel tools (API token: deployments, logs).
- **Deliverable:** adding a vendor MCP is config + annotations, not code.

### Phase 4 — OSS packaging

- `defineInfraMcp` config reference docs, quickstart (one-man-shop path: tokens + deploy anywhere a container runs), website docs page.
- Publish `@terreno/infra-mcp`; bootstrap/MCP-server docs updates; changelog + upgrade notes.
- **Deliverable:** an external startup can deploy their own instance from docs alone.

## Feature Flags & Migrations

- **No data migrations** — all collections are new.
- Rollout is additive: new package, new Cloud Run service. Nothing existing changes until Phase 2's cloud-agent credential switch, which is coordinated: keep `GCP_SA_*` injection until the MCP path is verified, then remove.
- RBAC dependency: the RBAC module is Complete ([rbac-permissions.md](rbac-permissions.md)). Phase 1 wiring consumes `createAccess`, `rbacUserPlugin`, `rbacRouter`, default-role seeding.

## Activity Log & User Updates

`InfraAuditLog` records every `tools/call` (allowed, denied, confirmed, rejected, error) with user attribution — this is the compliance answer for server-held credentials, since vendor-side logs only show the service identity. RBAC role changes are covered by the RBAC module's `RbacAudit`.

## Not Included / Future Work

- Per-user vendor identity for the write tier (credential interface takes user context; add later).
- Rate limiting / quotas per user or tier.
- Slack notifications on write actions.
- Proxying interactive-OAuth-only vendor MCPs (Vercel/Expo hosted) — revisit if they ship headless credentials.
- Terraform-apply / IaC tools (high blast radius; needs its own design).
- MCP Tasks extension for long-running operations (EAS builds) — Phase 3+ candidate.

## Files to Create / Modify

- `infra-mcp/` — new package: `src/index.ts` (server entry), `src/server.ts`, `src/access.ts`, `src/config.ts`, `src/auth.ts`, `src/audit.ts` + `src/models/infraAuditLog.ts`, `src/integrations/{types,registry,gcp/*,sentry/*,mongo/*,proxied}.ts`, `src/types/models/*`, tests.
- `package.json` (root) — workspace entry, catalog: zod 4, `@modelcontextprotocol/server`, `@better-auth/oauth-provider`, `@better-auth/mcp`, Google API clients.
- `terraform/main.tf`, `variables.tf`, `outputs.tf` — `infra_mcp_service` module instance + runtime SA IAM.
- `.cursor/rules/infra-mcp/00-infra-mcp.mdc`, `AGENTS.md`/`CLAUDE.md` package lists, docs site page.
- `ROADMAP.md` + `docs/explanation/roadmap-seed-issues.md` — roadmap entry and ready-to-paste tracking issue (done); `scripts/issueAreaLabels.ts` + bug-report package dropdown when the package lands.

## Task List

See [docs/tasks/infra-mcp.md](../tasks/infra-mcp.md).

## Acceptance Criteria

- [ ] An MCP client completes OAuth against the deployed server and lists only the tools the signed-in user's roles allow.
- [ ] A user with only `auditor`/`infra-readonly` can query GCP logs, Sentry issues, and Mongo collections, and cannot see or call any write tool.
- [ ] A write-tier tool call triggers an elicitation prompt; declining aborts with an audited `rejected` status.
- [ ] With `confirmWrites: false` configured, confirmation is skipped **only** for callers holding `infra:writeUnconfirmed`; all others are still prompted.
- [ ] Every tool call (including denials) produces an `InfraAuditLog` record with user attribution and redacted args.
- [ ] The deployed service runs with only the Cloud Run default runtime SA — no SA key files or `GCP_SA_*` env vars anywhere in the stack.
- [ ] A cloud agent authenticates with a service token and reads logs; the `GCP_SA_*` env vars are removed from agent environments.
- [ ] A 2025-era MCP client (pre-2026 spec) connects successfully via the legacy stateless fallback.
- [ ] `bun run lint`, package tests, and CI pass.
