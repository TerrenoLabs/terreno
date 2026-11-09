# Tasks: Organizations as a first-class primitive (admin UI + RBAC)

IP: [org-management-ui](../implementationPlans/org-management-ui.md)

Supporting skills (all tasks): `update-docs`. Models: `mongoose-schema-safety`. API tests: `backend-test-env`. Admin UI: `terreno-ui`, `building-terreno-apps`, `verify-ui-changes`. SDK: `generate-sdk`. Data: `terreno-data-fetching`.

## Phase 1 — Models + context

- [x] **Task 1.1**: Organization + Membership models
  - Delivers: persist orgs and per-org `roleName` (`org-admin` \| `member`)
  - Files: `api/src/orgs/organizationModel.ts`, types, `api/src/orgs/*.test.ts`
  - Blocked by: none
  - Docs: field `description`s (OpenAPI); note in `docs/reference/api.md` stub section if the page is updated later in 6.1
  - Acceptance: unit tests for compound unique index and duplicate membership rejection
- [x] **Task 1.2**: `orgScopedPlugin`
  - Delivers: required indexed `organizationId` on consumer schemas
  - Files: `api/src/orgs/orgPlugin.ts` + tests
  - Blocked by: 1.1
  - Docs: none until 6.1
  - Acceptance: save without org fails; index present
- [x] **Task 1.3**: Org context middleware + `OrgQueryFilter`
  - Delivers: Q13 header matrix; lists never cross orgs
  - Files: `api/src/orgs/orgContext.ts`, `orgPermissions.ts`, `api/src/permissions.ts` (stop using `User.organizationIds`)
  - Blocked by: 1.1, 1.2
  - Docs: none until 6.1
  - Acceptance: supertest — operator missing header on scoped list → 400; org-admin of one org omits header → scoped; org A member never reads org B including `$or` / query-param attacks; non-member header → 403

## Phase 2 — RBAC

- [x] **Task 2.1**: `organization` statements + `operator` role + membership-scoped `org-admin`
  - Delivers: platform vs org grants as in the IP tables
  - Files: `api/src/rbac/statements.ts`, `roleModel.ts`, resolve/can path for Membership `roleName`, tests
  - Blocked by: 1.3
  - Docs: `docs/reference/api.md` RBAC/org note (or 6.1)
  - Acceptance: `org-admin` on org A cannot `organization:list` all orgs; `operator` can; `user.roles` containing `org-admin` is not how grants work (test that membership wins)

## Phase 3 — OrgsApp routes

- [x] **Task 3.1**: Operator org CRUD + `/orgs/mine`
  - Delivers: create/list-all/mine/read/patch/soft-delete + `onOrgAudit`
  - Files: `api/src/orgs/orgsApp.ts`, exports, OpenAPI, supertest
  - Blocked by: 2.1
  - Docs: none until 6.1
  - Acceptance: org-admin 403 on `GET /orgs`; operator 200; create does not require membership; disable/soft-delete suspends memberships
- [x] **Task 3.2**: Members attach / patch / delete + last-admin guards
  - Delivers: existing-user attach; no email; last `org-admin` protected
  - Files: `api/src/orgs/orgsApp.ts` + tests
  - Blocked by: 3.1
  - Docs: none until 6.1
  - Acceptance: attach by email of existing user; unknown email 404; demote last org-admin 400; no comms/send invoked

## Phase 4 — Admin backend

- [x] **Task 4.1**: Admin org routes + AdminApp tenant context
  - Delivers: admin UI can call org APIs; generic admin model lists use context filter
  - Files: `admin-backend/src/*` (org registration or aliases), AdminApp queryFilter/preCreate, tests
  - Blocked by: 3.2
  - Docs: `docs/reference/admin-backend.md` org section (may land with 6.1)
  - Acceptance: operator `/admin` list of an org-scoped model without header → 400; with header → only that org; org-admin cannot hit all-orgs admin list

## Phase 5 — Admin frontend

- [x] **Task 5.1**: `OrgDirectoryScreen` (operator)
  - Delivers: all-orgs table, create, disable, enter org
  - Files: `admin-frontend/src/orgs/OrgDirectoryScreen.tsx` + tests
  - Blocked by: 4.1
  - Docs: `docs/reference/admin-frontend.md` component section
  - Acceptance: loading/error/empty; org-admin nav hidden in unit test via role prop/fixture
- [x] **Task 5.2**: `OrgSwitcher` + `useOrgContext` (header + URL)
  - Delivers: Q10/Q13 client behavior for org-admins and operators-in-org
  - Files: `admin-frontend/src/orgs/OrgSwitcher.tsx`, `useOrgContext.tsx`, `AdminShellLayout` slot
  - Blocked by: 5.1
  - Docs: admin-frontend reference
  - Acceptance: switching sets `X-Organization-Id` on subsequent admin queries (test with mocked api); single-org org-admin still renders org name
- [x] **Task 5.3**: Org settings + members table
  - Delivers: settings PATCH; members DataTable; add existing user; last-admin error; disabled Invite; billing placeholder
  - Files: `admin-frontend/src/orgs/OrgSettingsScreen.tsx`, `OrgMembersScreen.tsx` + tests
  - Blocked by: 5.2, 3.2
  - Docs: admin-frontend reference
  - Acceptance: Invite control disabled; billing placeholder visible; last-admin error shown
- [x] **Task 5.4**: Host wiring — admin-spa + example-frontend `/admin`
  - Delivers: routes on both hosts; SDK regen
  - Files: `admin-spa/app/orgs/*`, `example-frontend/app/admin/orgs/*`, `example-frontend/store/openApiSdk.ts` (generated)
  - Blocked by: 5.3
  - Docs: `docs/reference/admin-spa.md` nav entry
  - Acceptance: `cd example-frontend && bun run sdk` compiles; both apps have `/admin/orgs` routes
- [x] **Task 5.5**: Frontend verification
  - Delivers: evidence org-admin vs operator flows
  - Files: `/opt/cursor/artifacts/` (not in repo)
  - Blocked by: 5.4, 6.2
  - Docs: none
  - Acceptance: login operator → directory → create/open org → members; login org-admin → no directory → switcher → members only that org; screenshots/video on the PR (`verify-ui-changes`)

## Phase 6 — Example + docs

- [x] **Task 6.1**: Docs (same slice as behavior; can land incrementally but must be complete before Brew)
  - Delivers: stranger can operate orgs from docs
  - Files: `docs/how-to/add-organizations.md`, `docs/explanation/organizations.md`, `docs/reference/api.md`, `docs/reference/admin-backend.md`, `docs/reference/admin-frontend.md`, `docs/reference/admin-spa.md`, `.rulesync/**` if agent rules need org context
  - Blocked by: 4.1 (content must match shipped routes)
  - Docs: (this task)
  - Acceptance: `bun run website:build` (or package docs check used in CI); how-to has one minimal OrgsApp + AdminApp example
- [x] **Task 6.2**: example-backend migration + seeds
  - Delivers: Membership instead of `User.organizationIds`; operator + two org-admins
  - Files: `example-backend/src/models/user.ts`, `types/models/userTypes.ts`, `api/projects.ts`, `scripts/seed-*`, `access.ts`, `rbacRoles.ts`, tests
  - Blocked by: 3.2, 2.1
  - Docs: seed users named in `docs/how-to/add-organizations.md`
  - Acceptance: grep finds no `organizationIds` on User; isolation tests pass; seed creates operator@example.com
