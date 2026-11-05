# Implementation Plan: Organizations, teams, and multi-tenant scoping

**Status:** Superseded — 2026-08-24
**Superseded by:** [org-management-ui](org-management-ui.md) (backend primitive + RBAC + admin UI)
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1024
**Priority:** High
**Effort:** Big batch
**Owner:** unassigned
**Created:** 2026-08-09
**Program:** [B2B platform](b2b-platform-program.md)
**Depends on:** superseded; see [org-management-ui](org-management-ui.md)
**RTK deprecation flag:** None — backend only; frontend surfaces are `org-management-ui`

Do not implement from this file. Canonical design, tasks, and acceptance criteria live on
[org-management-ui](org-management-ui.md). Kept for decision history (native models, header
transport) absorbed into that IP.

## Goal

Terreno's entire access story is per-user: `ownerId` fields, `OwnerQueryFilter`,
`Permissions.IsOwner`. A B2B app needs data owned by an **organization** and accessed by
its **members**. This IP adds the tenant analog of the owner stack to `@terreno/api`:
Organization and Membership models, an org-context middleware, an `orgScopedPlugin` for
schemas, `OrgQueryFilter` and `Permissions.IsOrgMember`/`IsOrgAdmin` for modelRouter, and
CRUD routes for orgs and memberships — so `modelRouter(Todo, {queryFilter: OrgQueryFilter,
permissions: {...IsOrgMember}})` is all an app needs for tenant-safe endpoints.

## Non-Goals

- Invitations, seat counting (`invitations-and-seats` item).
- Fine-grained RBAC (roles beyond `member`/`admin` — [rbac-permissions](rbac-permissions.md)).
- Org switcher and management screens (`org-management-ui` item).
- Billing linkage (`billing-stripe` maps customers to orgs later).
- Cross-org data sharing, nested teams/sub-orgs (future work).

## Decisions

| Question | Decision |
|----------|----------|
| **D6 (resolved 2026-08-09):** native Mongoose models vs Better Auth `organization` plugin | **Native models.** The JWT/passport path (still supported and the example default) cannot use a Better-Auth-only construct; native models serve both auth paths, keep modelRouter/query-filter integration first-class, and can sync to Better Auth's plugin later if wanted |
| Org context transport | `X-Organization-Id` header, resolved by middleware into `req.organization` + `req.membership`; explicit query/body override rejected |
| One org or many per user? | Many (Membership join collection); apps wanting single-org enforce via option `maxOrgsPerUser: 1` |
| Coarse roles now | `Membership.role: "admin" \| "member"` — deliberately minimal; RBAC IP replaces this enum with role references, migration documented there |
| Scoping mechanism | `orgScopedPlugin` adds required indexed `organizationId`; `OrgQueryFilter` filters lists by active memberships; `preCreate` helper injects the context org |
| Personal orgs? | No auto-created personal org; apps opt in via `createDefaultOrgOnSignup` option |

## Architecture

```
api/src/orgs/
  organizationModel.ts   # Organization + Membership schemas/models
  orgContext.ts          # middleware: header → req.organization/req.membership
  orgPlugin.ts           # orgScopedPlugin(schema) — organizationId field + index
  orgPermissions.ts      # IsOrgMember, IsOrgAdmin, OrgQueryFilter
  orgsApp.ts             # OrgsApp TerrenoPlugin — routes + options
```

`OrgsApp` options:

```typescript
new OrgsApp({
  maxOrgsPerUser?: number;
  createDefaultOrgOnSignup?: boolean;
  onOrgCreated?: (org, owner) => Promise<void>;
})
```

Request flow: `authenticateMiddleware` → `orgContextMiddleware` (loads org by header,
verifies an active membership for `req.user`, 403 otherwise) → route. Routes that take
`Permissions.IsOrgMember`/`IsOrgAdmin` require the context; `OrgQueryFilter` works with or
without a context (no header → all orgs the user belongs to; header → that org only).

## Models

Both use the five-type pattern, `description` on every field, `createdUpdatedPlugin` +
`isDeletedPlugin`, `strict: "throw"`.

**Organization** — `name` (string, required), `slug` (string, unique, indexed, generated),
`ownerId` (ref User, required — the creating user; ownership transferable), `settings`
(Mixed, app-defined), `disabled` (boolean).

**Membership** — `organizationId` (ref Organization, required, indexed), `userId` (ref
User, required, indexed), `role` ("admin" | "member", default "member"), `status`
("active" | "suspended", default "active"), compound unique index on
`(organizationId, userId)`. Statics: `findActiveForUser`, `isMember`, `isOrgAdmin`.

## APIs

| Method | Path | Permissions | Notes |
|---|---|---|---|
| POST | `/orgs` | IsAuthenticated | Creates org + admin membership for creator; respects `maxOrgsPerUser` |
| GET | `/orgs` | IsAuthenticated | Lists orgs the user belongs to (membership join) |
| GET | `/orgs/:id` | IsOrgMember | |
| PATCH | `/orgs/:id` | IsOrgAdmin | name/settings; ownership transfer admin-only |
| DELETE | `/orgs/:id` | IsOrgAdmin | Soft delete; memberships cascade to suspended |
| GET | `/orgs/:id/members` | IsOrgMember | Paginated membership list (populated user name/email) |
| PATCH | `/orgs/:id/members/:memberId` | IsOrgAdmin | Role/status change; cannot demote last admin |
| DELETE | `/orgs/:id/members/:memberId` | IsOrgAdmin | Remove member; cannot remove last admin |

Member creation is **not** exposed here — members arrive via `invitations-and-seats`
(or `createDefaultOrgOnSignup`). All routes via modelRouter where shapes fit, custom
`createOpenApiBuilder` routes for member management.

## Notifications

None in this IP (invitation emails belong to `invitations-and-seats`).

## UI

None in this IP (`org-management-ui`). example-backend gains an org-scoped demo model
(`Project`) exercising `orgScopedPlugin` + `OrgQueryFilter` end to end.

## Phases

1. **Models + plugin:** Organization, Membership, `orgScopedPlugin`, statics, unit tests.
2. **Context + permissions:** middleware, `IsOrgMember`/`IsOrgAdmin`, `OrgQueryFilter`,
   modelRouter integration tests (member of A cannot read B's rows — the critical suite).
3. **Routes + app:** `OrgsApp`, org/member routes, last-admin guards, OpenAPI, supertest.
4. **Example + docs:** example-backend `Project` model + routes, seeds, admin panel model
   registration, `docs/how-to/add-organizations.md`, reference docs, SDK regen.

## Feature Flags & Migrations

No migration for existing apps (new collections; opt-in plugin). Adopting apps that
backfill `organizationId` onto existing collections get a documented backfill recipe —
formal tooling arrives with `mongo-migrations`.

## Activity Log & User Updates

Org create/delete and membership role changes fire an `onOrgAudit` hook (mirroring
`onAdminAudit`) so apps can log them; framework-wide audit persistence is the
`framework-audit-log` item.

## Not Included / Future Work

- Teams within orgs (the Membership schema reserves a `teamIds` extension point but ships
  without it — YAGNI until a consumer needs it).
- Org-level settings UI, domain capture/auto-join (SSO IP touches this).
- Per-org rate limits, quotas.

## Files to Create / Modify

- `api/src/orgs/*` (new), `api/src/index.ts` exports
- `api/src/permissions.ts` — export org permissions alongside existing ones
- `example-backend/src/models/project.ts`, `api/projects.ts`, seeds, `server.ts`
- `docs/how-to/add-organizations.md`, `docs/reference/api.md`
- `example-frontend` SDK regen (`bun run sdk`) after backend routes land

## Task List

See [docs/tasks/orgs-and-teams.md](../tasks/orgs-and-teams.md).

## Acceptance Criteria

- [ ] A user can create an org, becoming its admin member; `maxOrgsPerUser` is enforced.
- [ ] With two orgs seeded, a member of org A listing an org-scoped model with
      `OrgQueryFilter` never receives org B documents — including via crafted `$or` /
      query-param attempts.
- [ ] Requests with an `X-Organization-Id` the user is not an active member of get 403.
- [ ] The last admin of an org cannot be demoted or removed.
- [ ] Org routes appear in `/openapi.json`; regenerated SDK compiles; admin panel can
      browse Organizations and Memberships.
- [ ] Soft-deleting an org suspends its memberships and hides its scoped data from lists.
