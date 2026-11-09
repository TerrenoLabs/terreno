# Research: Infrastructure MCP server (privileged tools gateway)

**Status:** Complete — decisions made, IP written: [infra-mcp.md](infra-mcp.md)
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1090
**Created:** 2026-08-09

## Scope statement

Evaluate approaches for a new deployable, self-contained MCP server ("infra MCP") that puts privileged infrastructure tooling — GCP, Expo/EAS, Vercel, MongoDB, Sentry, and similar — behind a single MCP endpoint that:

- Authenticates each user individually.
- Enforces per-user permissions (at minimum: read-only vs. write tiers; e.g. "log digging" vs. "change infra").
- Is deployable as its own service (Cloud Run, following the existing `terreno-mcp` deployment pattern).

Also: confirm whether targeting the new MCP spec revision ("MCP 2.0") is the right call.

## PRD summary

From the request:

- **Problem:** Privileged infra tools are currently accessed with broadly-scoped credentials (e.g. env-injected service accounts, personal API keys). There is no per-user gate, no read-only tier, and no central audit point for agent-driven infra access.
- **Goal:** One MCP server controlling authentication and authorization per user, supporting a read-only mode (log digging, metrics, build status) and a write mode (actual infra changes).
- **Integrations named:** GCP, Expo/EAS, Vercel, MongoDB, Sentry, "etc." (extensible).
- **Constraint:** Deployable and self-contained.

## Codebase findings

### Existing MCP package (`mcp-server/`)

- `@terreno/mcp` is a docs/codegen MCP server on `@modelcontextprotocol/sdk` **v1.27** (2025-era spec), served over Streamable HTTP via `createMcpExpressApp` + `StreamableHTTPServerTransport`, wrapped with Sentry (`Sentry.wrapMcpServerWithSentry`).
- It has **no authentication** — it serves public docs/tooling. It is not a suitable base for privileged tools but proves out the HTTP-MCP + Sentry + Cloud Run shape.
- A second bin (`terreno-mcp-local`) runs stdio-side local tools (logs, db query/schema, runtime) — relevant prior art for "log digging" tool design.

### Deployment prior art (`terraform/`)

- `module "mcp_service"` deploys `terreno-mcp` to **Cloud Run** with its own Artifact Registry repo, min/max instances, and a scoped deploy service account. A new infra MCP service can clone this module usage nearly verbatim.

### Auth/permissions prior art (`api/`)

- `@terreno/api` ships JWT/Passport auth, Better Auth (OAuth 2.x social login), a permission system (`IsAdmin`, `IsAuthenticated`, per-route permission arrays), and the `TerrenoPlugin` pattern.
- The [RBAC Permissions IP](rbac-permissions.md) (Draft) is designing richer role-based permissions for `@terreno/api` — potential overlap if the infra MCP models roles in Mongo.

### Related IPs

- [modelRouter MCP tools](model-router-mcp.md) (backlog): generates MCP tools from modelRouter with per-tool auth — same "authenticated MCP tools" problem, app-data-facing rather than infra-facing.
- [MCP Boost parity](mcp-boost-parity.md) (in progress, PR #802): expands `@terreno/mcp`.
- [Deploy to GCP](deploy-to-gcp.md), [Deployment foundation](deployment-foundation.md): deployment story this service should align with.

### Current credential handling (the problem being solved)

- Cloud agent VMs receive raw env-injected service accounts (`GCP_SA_TERRENO`, `GCP_SA_PRD`, `GCP_SA_STG`, `GCP_SA_ZAPLING`) and `SENTRY_CLIENT_SECRET`. Every agent gets the full power of each credential; scoping is done only at the GCP IAM level per SA, with no read-only/write split per user and no central audit trail.

## External findings

### "MCP 2.0" — the 2026-07-28 spec revision

There is no product officially named "MCP 2.0", but the **2026-07-28 MCP specification** is the largest revision since launch and is what the TypeScript **SDK v2** implements. Its changes are unusually well-suited to this project:

- **Stateless core** — the `initialize` handshake and `Mcp-Session-Id` are gone; every request is self-contained. Scales on plain HTTP load-balanced infra (ideal for Cloud Run).
- **Header-based routing** — `Mcp-Method` and `Mcp-Name` HTTP headers are mandatory and mirrored to the body (mismatch → `-32020`). A gateway or middleware can authorize per-tool **from headers alone**, without parsing JSON-RPC bodies. This is effectively purpose-built for the per-user, per-tool permission layer this project needs.
- **Authorization hardening** — OAuth 2.1 + PKCE, RFC 9728 Protected Resource Metadata (401 + `WWW-Authenticate` discovery), RFC 8707 resource indicators (anti-confused-deputy), RFC 9207 issuer validation, and Client ID Metadata Documents (CIMD) replacing Dynamic Client Registration.
- **Tasks extension** — long-running work (e.g. an EAS build or terraform apply) has a first-class pattern.

SDK situation:

- TS SDK v2 = new packages `@modelcontextprotocol/server` (+ `@modelcontextprotocol/client`, `@modelcontextprotocol/node`), released stable 2026-07-28. The v1 `@modelcontextprotocol/sdk` line (which `@terreno/mcp` uses) remains maintained; both can coexist in one repo.
- `createMcpHandler(factory, {legacy: "stateless"})` serves **both** 2026-era and 2025-era clients from one endpoint, so older MCP clients (Claude Code/Cursor versions that predate the spec) still work.
- Gotcha: SDK v2 requires a Standard Schema validator with a `jsonSchema` property — **zod 4** (repo catalog currently needs checking; may need `zod@^4` under an alias if anything pins zod 3).

**Conclusion: yes — build new on the 2026-07-28 spec via SDK v2 with the legacy stateless fallback.** Starting a new privileged server on the 2025-era SDK would mean migrating within months and would forfeit the header-based authz and stateless scaling that this project specifically benefits from.

### Vendor MCP server landscape (all targets have official servers)

| Vendor | Official MCP server | Auth model | Notes |
|---|---|---|---|
| GCP | Managed remote endpoints (e.g. `https://cloudcli.googleapis.com/mcp` for gcloud, plus BigQuery/Storage/etc.); open-source `gcloud-mcp`, `observability-mcp`, `storage-mcp` (npm, runnable self-hosted) | OAuth 2.0 + IAM | Remote server blocks `gcloud auth`, `gcloud iam service-accounts`, etc. Observability MCP covers logs/metrics/traces/errors — the "log digging" use case |
| Sentry | Hosted `https://mcp.sentry.dev/mcp` and self-hostable | OAuth | Issues, events, traces, Seer |
| MongoDB | `mongodb-mcp-server` (official, npm) | Connection string / Atlas API creds | Has a `--readOnly` flag — native read-only mode |
| Vercel | Hosted `https://mcp.vercel.com` | OAuth | Deployments, logs, projects |
| Expo/EAS | Hosted `https://mcp.expo.dev/mcp` (Streamable HTTP) | OAuth (Expo account); paid EAS plan | Docs + project tools; EAS build/update tools evolving |

### Proxying feasibility per vendor (follow-up research)

Mechanics of chaining our MCP to upstream MCP servers are simple with SDK v2 (`@modelcontextprotocol/client` speaks both protocol eras; stateless spec = no per-upstream session to maintain; stdio servers run as child processes). Long-term authentication is the real differentiator:

| Vendor | Headless credential for MCP? | Long-term auth | Verdict for proxying |
|---|---|---|---|
| Sentry | Yes — hosted `mcp.sentry.dev` accepts `Authorization: Sentry-Bearer <token>` header; stdio `@sentry/mcp-server` takes `SENTRY_ACCESS_TOKEN` (non-expiring user auth token / internal integration token) | Static token, rotate manually | **Green** |
| MongoDB | Yes — `mongodb-mcp-server` takes a connection string; native `--readOnly` flag | Static | **Green** |
| GCP | Yes — remote endpoints and self-hosted `gcloud-mcp`/`observability-mcp` accept ADC/service-account identity; on Cloud Run the *service's own SA* is the credential, google-auth auto-refreshes | Automatic (workload identity) | **Green** |
| Vercel | **No** — `mcp.vercel.com` is OAuth-only **with a client allowlist** (Claude, Cursor, Codex, etc.); our server would not be an approved client, and there is no API-token fallback | n/a | **Red** — go native (Vercel REST API + static token) |
| Expo/EAS | Hosted `mcp.expo.dev` is browser OAuth (user-scoped, paid plan); robot tokens (`EXPO_TOKEN`) are for CI/CLI, MCP acceptance unconfirmed | Uncertain | **Amber/Red** — go native (`EXPO_TOKEN` + EAS CLI/GraphQL) |

Implication: a **pure** gateway (Option A) is not achievable for Vercel and likely not Expo — their hosted MCPs are designed for interactive human OAuth from allowlisted AI clients, not server-to-server delegation. The proxied path works cleanly exactly where static/service credentials exist, which is the same place the native path is also easy. This strengthens Option C (hybrid) and weakens A.

If we ever must proxy an interactive-OAuth-only upstream: one-time browser consent by an admin, persist the refresh token in an encrypted vault (Mongo + KMS or Secret Manager), background refresh, and an admin "re-link integration" flow for `invalid_grant`/revocation. Real ops burden — avoid unless the vendor MCP offers something the REST API doesn't.

### Gateway prior art

Multiple open-source projects already implement "aggregate MCP backends + per-user tool RBAC":

- `mcp-zero-trust-proxy` — OAuth 2.1 front door (any OIDC provider), roles with `allowed_tools`/`deny_tools`, claim-based role mapping, audit logging, rate limiting. Config-file driven.
- `joshrotenberg/mcp-proxy` (Rust) — multi-backend aggregation, capability filtering per backend, JWT/JWKS RBAC, token passthrough, OTel.
- Microsoft `mcp-gateway` — Kubernetes-native, session-aware routing, Entra ID.
- Common pattern: filter `tools/list` by role, deny `tools/call` for unauthorized tools, route by prefix to upstream servers.

These validate the architecture but none is a drop-in: they are config-file-driven (not Mongo-backed per-user), most predate the 2026-07-28 stateless spec, and none handles the "server holds privileged vendor credentials per role tier" model out of the box.

## Candidate options

Two orthogonal decisions: **(1) where tools come from** and **(2) whose credentials execute them**. Options A–C cover decision 1; the credential question is listed separately because it applies to all three.

### Option A: Pure gateway/aggregator over vendor MCP servers

New service speaks MCP to clients, authenticates users itself (OAuth 2.1 per the new spec), and proxies tool calls to upstream vendor MCP servers (GCP remote MCP, Sentry, Vercel, Expo hosted; MongoDB MCP as an in-process/sidecar child). Per-user roles filter which upstream tools appear in `tools/list` and which pass `tools/call`.

- **Pros:** Least tool-maintenance — vendors maintain their own tools; broad coverage immediately; new-spec `Mcp-Name` headers make the filter layer thin; read-only tiers are mostly "allow-list of known-read tools" plus MongoDB's native `--readOnly`.
- **Cons:** Upstream hosted servers (Expo, Vercel, Sentry, GCP remote) authenticate via *their own* OAuth — the gateway must hold/refresh upstream tokens (per user, or one service identity), which is real complexity (token vault); read/write classification of third-party tools is inference, not contract — a mislabeled vendor tool could let a "read-only" user mutate infra; tool churn upstream can silently change the permission surface; latency of double-hop.

### Option B: Self-contained curated tool server (no upstreams)

Hand-write a curated set of tools that call vendor APIs/SDKs directly (Cloud Logging API, Sentry REST API, Vercel API, EAS GraphQL/CLI, MongoDB driver). The server holds vendor credentials (e.g. two GCP SAs: viewer + editor; a read-only Mongo user + a write user). Every tool is explicitly classified read or write at authorship time.

- **Pros:** Read-only is a *hard guarantee* — enforced twice (tool tier + underlying credential scope, e.g. viewer-only SA for the read tier); smallest attack surface; no upstream token management; full control over tool descriptions/outputs (can redact); simplest to audit.
- **Cons:** Highest build-and-maintain cost — every vendor surface is our code; coverage starts narrow (whatever tools we write); vendors ship new capabilities that we lag behind.

### Option C: Hybrid — curated core + optional proxied upstreams (adapter model)

Same authenticated core as B, with an integration-adapter interface. Each integration is either **native** (hand-written tools calling vendor APIs, like B) or **proxied** (an MCP client to an upstream server with an explicit per-tool allow-list and read/write annotation required in config, like A). Start native for the high-risk/high-value surfaces (GCP logs + deploys, Mongo, Sentry), add proxied adapters where a vendor MCP is high-quality and low-risk.

- **Pros:** Ships useful read-only value fast on the native path; keeps the hard read-only guarantee where it matters; leaves a sanctioned escape hatch to vendor servers without weakening the permission model (proxied tools are deny-by-default until annotated); the 2026-07-28 header routing makes both paths share one authz middleware.
- **Cons:** Two code paths to test; the proxied path inherits A's token-management complexity *when used*; discipline required so the allow-list doesn't rot into "allow everything".

### Cross-cutting: credential model (applies to A/B/C)

1. **Server-held, role-tiered service credentials** — users authenticate to the infra MCP; tool calls execute with shared per-tier credentials (e.g. `infra-mcp-readonly@` SA vs `infra-mcp-editor@` SA). Simple, strong read-only floor, but vendor-side audit logs show the service identity, not the human (the MCP server's own audit log must carry user attribution).
2. **Per-user upstream identity (on-behalf-of)** — each user links their own GCP/Sentry/Vercel/Expo account via OAuth; the server stores/refreshes their tokens and acts as them. Vendor audit logs show the real human; but requires a token vault, per-vendor OAuth apps, and users must all have vendor accounts with correct IAM — significantly more work.
3. **Hybrid** — server-held credentials for read tier (low risk, frictionless), per-user identity required for write tier.

### Cross-cutting: where the code lives

- **New workspace package in terreno** (e.g. `infra-mcp/`), reusing `@terreno/api` (Mongo user model, logger, Sentry patterns) and cloning the `mcp_service` terraform module — fits monorepo conventions, and `@terreno/api`'s auth/permission machinery is available.
- **Standalone generic product package** (e.g. `@terreno/infra-mcp` designed for any org to deploy, config-driven integrations) — bigger ambition, aligns with the OSS launch program, more design constraints up front.

## Audience fit (one-man shop → startup → growing startup)

The target audience for the packaged product is solo founders through growing startups (not identity-team enterprises). That constraint selects the architecture:

- **Credential model 1 (server-held, role-tiered)** is the only model that works at the low end: paste tokens once, nothing expires (static tokens + workload identity), no per-vendor OAuth app registration. Vendor-side audit logs show the service identity, so the product's own Mongo audit log (with user attribution) is the compliance answer at this scale.
- **Better Auth logins (GitHub/Google/email)** instead of requiring an external IdP — the audience has GitHub accounts, not Okta. Domain-restricted Google login covers the "growing startup" tier.
- **CTO security story is structural, not procedural:** read tier executes with physically read-only credentials (viewer SA, read-only Mongo user) so misclassified tools cannot mutate; proxied tools deny-by-default until annotated; per-integration grants; full audit log. `admin-backend`/`admin-frontend` provide the user/role admin UI.
- **Enterprise upgrade path preserved:** credential resolution takes a user context, so a future "write tier requires linking your own vendor identity" mode (model 3) can be added without rearchitecting.
- **Packaging:** reusable `@terreno/infra-mcp` package with config-driven integration registry, dogfooded via our own Cloud Run deployment — aligns with the OSS launch program.

This resolves blocking questions 1 (Option C), 2 (model 1 with model-3 upgrade path), 3 (Mongo users via Better Auth), 4 (readonly/write tiers + per-integration grants), and 8 (reusable package).

## Recommendation (pending answers)

Option **C** (hybrid, starting native-first per B) with credential model **1** (server-held role-tiered credentials) as the initial phase, built as a new terreno workspace package on the 2026-07-28 spec via TS SDK v2, deployed to Cloud Run alongside `terreno-mcp`. But this is presented as a recommendation, not a decision — see blocking questions.

## Blocking questions

1. **Tool sourcing:** Option A (proxy vendor MCPs), B (all curated/native), or C (hybrid, native-first)?
2. **Credential model:** server-held tiered credentials, per-user vendor identity, or hybrid (read=shared, write=per-user)?
3. **User store & login:** Mongo-backed users in this service (reusing `@terreno/api` auth / Better Auth as the OAuth 2.1 authorization server), or an external IdP (Google Workspace / GitHub org) with the MCP server as a pure resource server? Who administers users/roles, and via what surface (admin UI? config? CLI)?
4. **Permission granularity for v1:** just two tiers (readonly/write) per user, or per-integration grants (e.g. "Sentry read + Mongo read, no GCP")?
5. **Write-action safety:** should write tools require an extra confirmation step (MCP elicitation), a second approval, or is role membership sufficient?
6. **Integration priority for phase 1:** which 2–3 integrations first? (Research suggests GCP logs/observability + Sentry + Mongo read-only covers the "log digging" case.)
7. **Audit requirements:** is an in-Mongo audit log of every tool call (user, tool, args, result status) a v1 requirement?
8. **Packaging ambition:** terreno-internal service first, or design from day one as a reusable OSS-able `@terreno/*` package (affects config surface and scope)?
9. **Consumers:** which MCP clients must work day one (Cursor cloud agents, Claude Code, humans' IDEs)? Cloud agents matter because they currently get raw SA env vars — is replacing those env-injected SAs an explicit goal?

## Non-blocking questions

- Rate limiting per user/tier in v1 or deferred?
- Should the existing `@terreno/mcp` docs server eventually merge into or share infra with this service, or stay separate? (Default: separate.)
- Naming: `infra-mcp`, `@terreno/infra-mcp`, `terreno-ops-mcp`?

## References

- MCP 2026-07-28 spec: https://modelcontextprotocol.io/specification/2026-07-28
- Spec release notes: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- TS SDK v2 (`@modelcontextprotocol/server`): https://ts.sdk.modelcontextprotocol.io/v2/
- SDK v2 legacy support guide: https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28
- MCP authorization tutorial (OAuth 2.1): https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/authorization
- GCP MCP servers: https://github.com/googleapis/gcloud-mcp, https://docs.cloud.google.com/sdk/use-gcloud-mcp, https://github.com/Google/mcp
- Expo MCP: https://docs.expo.dev/eas/ai/mcp/
- Gateway prior art: https://github.com/keith-aykira/mcp-zero-trust-proxy, https://github.com/joshrotenberg/mcp-proxy, https://microsoft.github.io/mcp-gateway/
- In-repo: `mcp-server/src/index.ts`, `terraform/main.tf` (`mcp_service`), `docs/implementationPlans/model-router-mcp.md`, `docs/implementationPlans/rbac-permissions.md`
