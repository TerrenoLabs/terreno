# Implementation Plan: Organizations as a first-class primitive (admin UI + RBAC)

**Status:** Draft — awaiting approval
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1024 (absorbs `orgs-and-teams`; retitle on approve)
**Priority:** High
**Effort:** Big batch
**Owner:** unassigned
**Created:** 2026-08-24
**Program:** [B2B platform](b2b-platform-program.md)
**Depends on:** [rbac-permissions](rbac-permissions.md) (Complete — PR #932)
**Supersedes:** [orgs-and-teams](orgs-and-teams.md)
**RTK deprecation flag:** Partial — admin screens use generated OpenAPI SDK / `useAdminApi`, not syncdb

## Goal

Organizations are a first-class Terreno primitive: native Organization and Membership
models, request org context, tenant-safe `modelRouter` filters, and RBAC so **org-admins**
run one org, **operators** run every org, and **superadmin** remains `*`.

The product surface is the **admin panel** (`@terreno/admin-backend` +
`@terreno/admin-frontend`, hosted by admin-spa and example-frontend `/admin`). Operators
get a platform org directory. Org-admins get a switcher and only see the current org.
No admin screen lists users, todos, or other tenant objects across orgs.

## Non-Goals

- Nested teams / sub-orgs.
- Self-serve `POST /orgs` or create-org UI in the product (non-admin) app.
- Invite-by-email tokens, accept/decline, seat counts (`invitations-and-seats`).
- Billing checkout, plans, or Stripe (`billing-stripe`).
- In-app org switcher outside admin.
- Cross-org object lists (users, todos, projects, …).
- Personal auto-created orgs (`createDefaultOrgOnSignup`).
- Better Auth `organization` plugin as the source of truth (B2B D6: native models).

Claude Design still specifies invite and billing frames so UI can be designed once; those
frames are **not** acceptance criteria for this IP (see [Claude Design brief](#claude-design-brief)).

## Decisions

| ID | Question | Choice |
| --- | --- | --- |
| Q1 | IP vs `orgs-and-teams` | This IP owns backend **and** admin UI; `orgs-and-teams` is superseded |
| Q2 | Roles | Three layers: `org-admin` (one org), `operator` (all orgs), `superadmin` (`*`) |
| Q3/Q7 | UI home | `@terreno/admin-frontend` + `@terreno/admin-backend`; both admin-spa and example `/admin` |
| Q4/Q6 | Invites + billing code | Out. Design brief includes those frames marked later |
| Q5 | Design coverage | Switcher, settings, members, operator directory, **plus** invite wizard and billing settings as later frames |
| Q8/Q11 | Surfaces | Operator-only `/admin/orgs` directory. Org-admins never see all orgs; switcher of orgs they admin only |
| Q9 | Old IP | Supersede `orgs-and-teams`; B2B program points here |
| Q10/Q13 | Org selection | Org entity routes: `/admin/orgs/:orgId`. Other admin screens: `X-Organization-Id`. Header optional if the caller admins exactly one org; **required** for `operator`/`superadmin` on tenant-scoped screens (400 if missing). Never unscoped lists |
| Q12 | Who creates orgs | `operator` and `superadmin` only (API + `/admin/orgs`) |

**Recorded assumptions (not grilled):** `org-admin` / `member` live on Membership (per org).
`operator` / `superadmin` live on `user.roles`. Inherit native models, slugs, soft-delete,
last-admin guards, and `X-Organization-Id` from the superseded IP. Admin data layer stays
RTK/OpenAPI.

## Architecture

```
@terreno/api
  src/orgs/
    organizationModel.ts   # Organization + Membership
    orgPlugin.ts           # orgScopedPlugin → required indexed organizationId
    orgContext.ts          # header / single-org inference → req.organization, req.membership
    orgPermissions.ts      # OrgQueryFilter, IsOrgMember, requireOrgContext
    orgsApp.ts             # OrgsApp TerrenoPlugin — public org/member routes
  src/rbac/statements.ts   # + organization actions
  src/rbac/roleModel.ts    # + operator, org-admin (locked); member stays empty globally

@terreno/admin-backend
  org admin routes under /admin/orgs
  AdminApp list/create filters: OrgQueryFilter + requireOrgContext for org-scoped models

@terreno/admin-frontend
  orgs/OrgDirectoryScreen.tsx      # operator: all orgs
  orgs/OrgSwitcher.tsx             # org-admin (and operator-in-org): current org
  orgs/OrgSettingsScreen.tsx
  orgs/OrgMembersScreen.tsx
  orgs/useOrgContext.tsx           # URL + header for generated SDK
```

### Role storage

| Role | Stored on | Scope |
| --- | --- | --- |
| `superadmin` | `user.roles` | Platform. `*` including operator powers |
| `operator` | `user.roles` | Platform. Create/list/disable any org; enter any org context; assign org-admins |
| `org-admin` | `Membership.roleName` | That organization only |
| `member` | `Membership.roleName` | That organization only. No admin shell |

Do not put `org-admin` on `user.roles`. A user may be `org-admin` of A and `member` of B.

`can()` for `organization:*` on a specific org uses Membership in `req.organization`.
`operator` / `superadmin` skip membership and still **must** send `X-Organization-Id` for
tenant-scoped model lists (Q13). Platform `GET /admin/orgs` does not use the header.

### Header resolution (`orgContextMiddleware`)

Order:

1. `X-Organization-Id` present → load org; allow if `operator`/`superadmin` **or** active membership; else 403.
2. Tenant-scoped route and caller is `operator`/`superadmin` → **400** missing org context.
3. Caller is `org-admin` of exactly one org → use that org.
4. Caller is `org-admin` of many orgs → **400** must select (switcher).
5. Else 403 for admin tenant routes. Plain members do not get the admin shell.

`Permissions.IsOrganizationMember` / `OrgQueryFilter` read **memberships + context**, not
`User.organizationIds`. Example-backend’s `organizationIds` array is removed in this IP.

### Admin surfaces

| Who | Sees | Never sees |
| --- | --- | --- |
| `operator`, `superadmin` | `/admin/orgs` (all orgs, create, disable, open). After picking an org: same org-scoped screens as org-admin | Unscoped Users/Todos/… tables |
| `org-admin` | Switcher of orgs they admin; `/admin/orgs/:orgId` settings + members; other admin models with header | `/admin/orgs` directory of **all** orgs; any cross-org list |
| `member` | Not this admin | — |

Org entity URLs: `/admin/orgs`, `/admin/orgs/:orgId`, `/admin/orgs/:orgId/members`.
Client sends `X-Organization-Id` from the switcher (or the path id) on every other admin
request.

### Request flow

```
authenticateMiddleware
  → orgContextMiddleware (rules above)
  → requireAccess / IsPermitted
  → OrgQueryFilter (always {organizationId: context.id} when context exists)
  → route
```

## Models

Five-type pattern, `description` on every field, `createdUpdatedPlugin` + `isDeletedPlugin`,
`strict: "throw"`. Skill: `mongoose-schema-safety`.

**Organization** — `name` (required), `slug` (unique, indexed, generated), `ownerId` (creating
operator/user; transferable), `settings` (Mixed, app-defined), `disabled` (boolean).

**Membership** — `organizationId`, `userId`, `roleName` (`org-admin` \| `member`, default
`member`), `status` (`active` \| `suspended`), compound unique `(organizationId, userId)`.
Statics: `findActiveForUser`, `isOrgAdmin`, `isMember`.

No `Membership.role: admin|member` enum from the old IP — RBAC names only.

## RBAC vocabulary

Add to `terrenoStatements`:

```typescript
organization: [
  "create",
  "list",
  "read",
  "update",
  "delete",
  "manageMembers",
  "disable",
]
```

Seeded locked roles (in addition to existing `superadmin`, `admin`, `auditor`, `member`):

| name | permissions (sketch) |
| --- | --- |
| `operator` | `organization: *`, `admin: ["access"]`, `user: ["list","read","update"]` (always org-scoped by context) |
| `org-admin` | Not a global `user.roles` seed used for grants. Statement bundle used when resolving Membership `roleName === "org-admin"`: `organization: ["read","update","manageMembers"]`, `admin: ["access"]` |

Existing global `admin` role does **not** imply operator. Platform org directory is
`organization:list` + `organization:create` (`operator` / `superadmin` only).

## APIs

### OrgsApp (framework)

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| POST | `/orgs` | operator, superadmin | Create org; no membership required |
| GET | `/orgs` | operator, superadmin | **All** orgs. Org-admins do not use this list |
| GET | `/orgs/mine` | org-admin (and operator) | Orgs the caller may switch into (memberships they admin; operators: all) |
| GET | `/orgs/:id` | org-admin of id, operator, superadmin | |
| PATCH | `/orgs/:id` | org-admin of id, operator, superadmin | name/settings; disable is `organization:disable` (operator/superadmin) |
| DELETE | `/orgs/:id` | operator, superadmin | Soft delete; memberships → suspended |
| GET | `/orgs/:id/members` | org-admin of id, operator, superadmin | Paginated; populated user name/email |
| POST | `/orgs/:id/members` | org-admin of id, operator, superadmin | Attach **existing** user by id/email; set `roleName`. No invite email |
| PATCH | `/orgs/:id/members/:memberId` | org-admin of id, operator, superadmin | role/status; cannot demote last `org-admin` |
| DELETE | `/orgs/:id/members/:memberId` | org-admin of id, operator, superadmin | Cannot remove last `org-admin` |

Admin-backend may mount the same handlers at `/admin/orgs` with admin OpenAPI tags, or
proxy OrgsApp. Prefer **one implementation** in `OrgsApp`, registered once; admin UI calls
those paths (or `/admin/orgs` aliases). Pick chooses aliases vs shared router without
changing permissions.

Member **invite** is not exposed. UI shows a disabled Invite control (later IP).

### Tenant-scoped modelRouter (example `Project`, admin Users if org-scoped)

`queryFilter: OrgQueryFilter` (context org only). `preCreate` injects `organizationId`
from context; client-supplied org id cannot win. Missing context for operators → 400.

## Notifications

None. Invitation email is `invitations-and-seats`.

## UI

Admin v2: org directory and switcher live in `navGlobal` (switcher) and `main` (directory,
settings, members). Do not add a `home.slots` cross-org user table.

Components use `@terreno/ui` (`Page`, `Box`, `DataTable`, `SelectField`, `Modal`, `Button`,
`Badge`). New primitives only if composition fails (skill: `terreno-ui`).

Wire screens in `admin-frontend`, then expo-router in `admin-spa` and
`example-frontend/app/admin/orgs/`. Skill: `building-terreno-apps`, `verify-ui-changes`.

**Invite** button: visible, disabled, helper “Invites ship in invitations-and-seats.”
**Billing** tab/card: visible placeholder, “Billing ships in billing-stripe.”

## Claude Design brief

Copy everything in this section into Claude Design. Do not implement invite or billing in
this IP; those frames are visual only.

```text
Product: Terreno admin panel (React Native Web + native via @terreno/ui).
Theme: TerrenoProvider, Nunito body / Titillium headings, existing admin-spa shell
(sidebar + top bar + page canvas). Do not invent a new design system.

Users:
1) superadmin — platform * (includes operator).
2) operator — manages every organization; never sees unscoped object lists.
3) org-admin — manages only organizations they admin; switcher required when they
   admin more than one.
4) member — not in this admin.

Hard rule: no screen lists users, members, or any tenant object across organizations.
The only all-orgs view is the operator Organization directory (org records only).

Screens to design (this slice — implement):

A) Operator — Organization directory (/admin/orgs)
   - Table: name, slug, disabled, created, member count.
   - Primary: Create organization (name → generates slug).
   - Row click: enter that org (sets current org, navigates to org home/settings).
   - Row action: Disable / Enable.
   - Empty, loading, error states.
   - Org-admins must not see this information architecture at all.

B) Org switcher (admin chrome, navGlobal)
   - Current org name + slug.
   - Dropdown/list of orgs the viewer may enter (org-admin: memberships they admin;
     operator: all orgs, or “Switch org” after entering from the directory).
   - If exactly one org for an org-admin, still show the name; selecting is optional.
   - Switching updates URL for org entity pages and X-Organization-Id for other pages.

C) Organization settings (/admin/orgs/:orgId)
   - Name, slug (read-only or constrained), disabled badge, owner.
   - Save. Operator-only disable control.

D) Members (/admin/orgs/:orgId/members)
   - DataTable: name, email, roleName (org-admin | member), status, joined.
   - Add member: pick existing user (email/id), assign role. No email invite send.
   - Change role / suspend / remove. Block demoting or removing the last org-admin
     with an inline error.
   - Invite button present but disabled; caption that invites are a later feature.

E) Other admin model tables (Users, Projects, …) while an org is selected
   - Same existing AdminModelTable chrome.
   - Banner or chip: “Viewing {org name}”.
   - If operator has no org selected: blocking empty state “Select an organization”
     (no table data), not an all-orgs dump.

Screens to design (later — do not build in this IP):

F) Invite wizard
   - Invite by email, role on accept, expiry, pending/accepted/expired list,
     resend/revoke. Connects to invitations-and-seats.

G) Billing settings (org-scoped)
   - Current plan, seats, Stripe checkout/portal CTAs, invoices list.
   - Connects to billing-stripe. Web-first.

Platforms: web (admin-spa) first; layouts must also work on native widths (same
components). Desktop ~1280px content column and a ~390px mobile width.

Deliver: one file per screen (A–G), sidebar with switcher, and a flow:
operator creates org → opens it → adds existing user as org-admin → that user
logs in, sees switcher, members table for that org only.
```

## Phases

1. **Models + context** — Organization, Membership, `orgScopedPlugin`, header inference, isolation tests.
2. **RBAC** — `organization` statements, `operator` role, membership-scoped `org-admin` resolution, admin shell access without `User.admin`.
3. **Routes** — `OrgsApp` create/list/mine/members/last-admin; OpenAPI.
4. **Admin backend** — `/admin/orgs` (or aliases), AdminApp `OrgQueryFilter` + 400 without context for operators.
5. **Admin frontend** — directory, switcher, settings, members; spa + example routes; SDK.
6. **Example + docs** — drop `User.organizationIds`; seeds (operator, two orgs, two org-admins); how-to/reference/explanation.

## Feature Flags & Migrations

New collections; `OrgsApp` opt-in. Adopting apps backfill `organizationId` with a documented
recipe (formal migrator is `mongo-migrations`).

Example-backend **breaking for the example app only:** remove `User.organizationIds`;
resolve tenants via Membership. Seed users: `operator@example.com` (`operator`), two
org-admins in distinct orgs, `admin@example.com` remains `superadmin`.

## Activity Log & User Updates

`onOrgAudit` hook (mirrors `onAdminAudit`) on org create/disable/delete and membership
role/status changes. Framework-wide audit log stays `framework-audit-log`.

## Not Included / Future Work

- `invitations-and-seats`, `billing-stripe`, SSO domain capture, per-org rate limits.
- Teams (`teamIds` reserved, not shipped).
- Product-app signup → create org (B2B path after a tenant UI exists).

## Files to Create / Modify

- `api/src/orgs/*` (new), `api/src/rbac/statements.ts`, `api/src/rbac/roleModel.ts`, `api/src/permissions.ts`, exports
- `admin-backend` org routes + AdminApp queryFilter/context
- `admin-frontend/src/orgs/*`
- `admin-spa/app/orgs/*`, nav
- `example-backend` seeds, User model, Project routes, `access.ts` / `rbacRoles.ts`
- `example-frontend/app/admin/orgs/*`, SDK regen
- `docs/how-to/add-organizations.md`, `docs/explanation/organizations.md`, `docs/reference/api.md`, `docs/reference/admin-frontend.md`, `docs/reference/admin-backend.md`
- This IP + `docs/tasks/org-management-ui.md`; superseded `orgs-and-teams`; B2B program; roadmap seed

## Task List

See [docs/tasks/org-management-ui.md](../tasks/org-management-ui.md).

## Acceptance Criteria

| Criterion | Verification |
| --- | --- |
| Operator creates an org via API and `/admin/orgs`; creator is not required to be a member | bun test / supertest; UI exercise |
| Org-admin cannot `GET` the all-orgs directory (403) | supertest + UI (org-admin session has no directory nav) |
| Org-admin switcher lists only orgs they admin; members table is that org only | supertest isolation + UI |
| Two orgs seeded: listing an org-scoped model with context A never returns B, including crafted `$or` / query params | tenant isolation suite |
| Operator omitting `X-Organization-Id` on Users/Projects admin list gets 400, not a cross-org list | supertest |
| Org-admin of exactly one org can omit the header and still scoped correctly | supertest |
| Last `org-admin` cannot be demoted or removed | supertest |
| Attach existing user as member; no invite email sent | supertest; no comms call |
| Invite and billing controls are visible and disabled / placeholder | UI tests + verify-ui screenshots |
| Soft-delete org suspends memberships and hides scoped rows | bun test |
| OpenAPI includes org routes; `bun run sdk` compiles | compile + sdk |
| Docs: how-to + explanation + admin/api reference match shipped behavior | pages exist; Roast reads them |
| `User.organizationIds` gone from example-backend | grep + tests |

## Human gates

Approve this Draft before Pick. Roadmap issue #1024 retitle/body on **Approved**
(`roadmap-item` handoff). No production data migration in the example app beyond seeds.
