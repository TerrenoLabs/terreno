# Tasks: Organizations, teams, and multi-tenant scoping

**Superseded.** Do not execute. Canonical tasks: [org-management-ui](org-management-ui.md).

IP: [orgs-and-teams](../implementationPlans/orgs-and-teams.md) (superseded by [org-management-ui](../implementationPlans/org-management-ui.md))

## Phase 1 — Models + plugin

- [ ] **Task 1.1**: Organization + Membership models
  - Description: schemas per IP (five-type pattern, descriptions, plugins, compound unique index), statics `findActiveForUser`/`isMember`/`isOrgAdmin`
  - Files: `api/src/orgs/organizationModel.ts`, type files
  - Depends on: none
  - Acceptance: unit tests incl. duplicate-membership rejection
- [ ] **Task 1.2**: `orgScopedPlugin`
  - Description: adds required indexed `organizationId` to a schema
  - Files: `api/src/orgs/orgPlugin.ts`
  - Depends on: 1.1
  - Acceptance: plugin test on a sample schema; save without org fails

## Phase 2 — Context + permissions

- [ ] **Task 2.1**: Org context middleware
  - Description: `X-Organization-Id` → `req.organization`/`req.membership`; 403 on non-membership; no header → no context
  - Files: `api/src/orgs/orgContext.ts`
  - Depends on: 1.1
  - Acceptance: supertest for member/non-member/missing header
- [ ] **Task 2.2**: `IsOrgMember`, `IsOrgAdmin`, `OrgQueryFilter`
  - Description: permission methods + query filter (header-scoped or all-memberships)
  - Files: `api/src/orgs/orgPermissions.ts`
  - Depends on: 2.1
  - Acceptance: **tenant isolation suite** — org A member never reads org B rows, incl. crafted `$or`/query-param attempts
- [ ] **Task 2.3**: modelRouter integration + `preCreate` org injection helper
  - Description: end-to-end org-scoped CRUD on a test model
  - Files: `api/src/orgs/*`, `api/src/tests.ts`
  - Depends on: 2.2
  - Acceptance: create injects context org; list/read/update/delete respect scope

## Phase 3 — Routes + app

- [ ] **Task 3.1**: `OrgsApp` plugin + org CRUD routes
  - Description: create (with `maxOrgsPerUser`), list-my-orgs, read, patch, soft delete with membership cascade
  - Files: `api/src/orgs/orgsApp.ts`
  - Depends on: Phase 2
  - Acceptance: supertest per route; OpenAPI entries present
- [ ] **Task 3.2**: Member management routes + last-admin guards
  - Description: list/patch/delete members; cannot demote/remove last admin
  - Files: `api/src/orgs/orgsApp.ts`
  - Depends on: 3.1
  - Acceptance: guard tests pass
- [ ] **Task 3.3**: `onOrgAudit` hook + exports
  - Description: audit hook mirroring `onAdminAudit`; public exports from `@terreno/api`
  - Files: `api/src/orgs/orgsApp.ts`, `api/src/index.ts`
  - Depends on: 3.1
  - Acceptance: hook fires for create/role-change/delete in tests

## Phase 4 — Example + docs

- [ ] **Task 4.1**: example-backend org-scoped `Project` model + routes + seeds
  - Description: demo model with `orgScopedPlugin` + `OrgQueryFilter`; seed two orgs with distinct data
  - Files: `example-backend/src/models/project.ts`, `src/api/projects.ts`, `scripts/seed*`
  - Depends on: Phase 3
  - Acceptance: seeded backend proves isolation via curl/supertest
- [ ] **Task 4.2**: Admin registration + SDK regen
  - Description: register Organization/Membership in AdminApp; `cd example-frontend && bun run sdk`
  - Files: `example-backend/src/server.ts`, `example-frontend/store/openApiSdk.ts`
  - Depends on: 4.1
  - Acceptance: admin panel lists orgs; SDK compiles
- [ ] **Task 4.3**: Docs
  - Description: `docs/how-to/add-organizations.md`, reference updates, rulesync
  - Files: `docs/how-to/add-organizations.md`, `docs/reference/api.md`, `.rulesync/**`
  - Depends on: Phase 3
  - Acceptance: `bun run rules:check` passes
