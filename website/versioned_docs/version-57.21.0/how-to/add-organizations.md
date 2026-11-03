# Add organizations to a Terreno app

Enable organizations only when the app is multi-tenant. Existing single-tenant
apps can omit every option in this guide.

## 1. Enable organization RBAC

``````typescript
import {createAccess, terrenoStatements} from "@terreno/api";

export const access = createAccess({
  connection: mongoose.connection,
  organizations: true,
  statements: terrenoStatements,
  userModel: User,
});

await access.roles.seedDefaults();
``````

This adds Membership-based `org-admin` grants and seeds the locked `operator`
role. It does not change apps that omit `organizations`.

## 2. Mount organization routes

``````typescript
const app = new TerrenoApp({
  accessControl: access,
  organizations: true,
  userModel: User,
});
``````

This mounts `OrgsApp` at `/orgs`. To configure audit handling or a different
path, pass an options object:

``````typescript
organizations: {
  basePath: "/organizations",
  onOrgAudit: recordOrganizationAudit,
  settingsSchema: organizationSettingsSchema,
}
``````

## 3. Type organization settings

Keep native `Organization` fields unchanged. Put app fields on
`Organization.settings` with a nested Mongoose schema and a TypeScript
interface.

1. Declare the settings shape (optional module augmentation):

``````typescript
// src/types/models/organizationSettingsTypes.ts
export interface ExampleOrganizationSettings {
  timezone?: string;
}

declare module "@terreno/api" {
  interface OrganizationSettings extends ExampleOrganizationSettings {}
}
``````

2. Build the nested schema. Use optional fields or defaults so existing
organizations still validate:

``````typescript
// src/models/organizationSettings.ts
import {createOrganizationSettingsSchema} from "@terreno/api";
import type {ExampleOrganizationSettings} from "../types/models/organizationSettingsTypes";

export const organizationSettingsSchema = createOrganizationSettingsSchema<ExampleOrganizationSettings>({
  timezone: {
    description: "IANA timezone used for organization-local dates",
    type: String,
  },
});
``````

3. Register before you create or patch organizations (startup and seeds):

``````typescript
import {registerOrganizationSettings} from "@terreno/api";
import {organizationSettingsSchema} from "./models/organizationSettings";

registerOrganizationSettings(organizationSettingsSchema);
``````

Or pass the same schema on `TerrenoApp` / `OrgsApp`:

``````typescript
new TerrenoApp({
  accessControl: access,
  organizations: {settingsSchema: organizationSettingsSchema},
  userModel: User,
});
``````

Read typed settings with `organizationSettingsOf(organization)` or
`organizationSettingsOf<ExampleOrganizationSettings>(organization)`.

Without a registered schema, `settings` stays Mixed and accepts any object.
Unknown keys and wrong types fail with **400** `Organization settings are invalid`
once a schema is registered.

## 4. Scope tenant models

Add `orgScopedPlugin` to models that use ObjectId organization keys. Put
`orgContextMiddleware({required: true})` before their routes, use
`OrgQueryFilter` for lists, and overwrite client organization ids during
create:

``````typescript
import {
  authenticateMiddleware,
  getOrgContext,
  modelRouter,
  OrgQueryFilter,
  orgContextMiddleware,
  orgScopedPlugin,
  Permissions,
  type TerrenoPlugin,
} from "@terreno/api";
import type express from "express";

schema.plugin(orgScopedPlugin);

const projectOrgContextPlugin: TerrenoPlugin = {
  register(expressApp: express.Application): void {
    expressApp.use(
      "/projects",
      authenticateMiddleware(),
      orgContextMiddleware({required: true})
    );
  },
};

const projectRouter = modelRouter("/projects", Project, {
  permissions: {
    create: [Permissions.IsAuthenticated, Permissions.IsOrganizationMember],
    delete: [Permissions.IsAuthenticated, Permissions.IsOrganizationMember],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated, Permissions.IsOrganizationMember],
    update: [Permissions.IsAuthenticated, Permissions.IsOrganizationMember],
  },
  preCreate: (body, _req) => ({
    ...body,
    organizationId: getOrgContext()?.organization?._id,
  }),
  queryFilter: OrgQueryFilter,
});

app.register(projectOrgContextPlugin).register(projectRouter);
``````

For admin CRUD, use `new AdminApp({accessControl: access, organizations:
true})`. Models with an `organizationId` schema path are scoped automatically,
except `AuditEvent` (the platform audit log lists without a selected org).
Admin-window `POST /sync/mutate` and socket `sync:mutate` use the same membership
check as REST for update and delete when `X-Organization-Id` (HTTP) or
`organizationId` (socket payload) is set. Admin `createSyncDb({organizationIdProvider})`
sends that id on every mutate.

`orgScopedPlugin` also makes `organizationId` immutable after the document is
created. Client PATCH bodies, admin writes, sync updates, and direct Mongoose
saves that change `organizationId` return HTTP 400 with
`organizationId cannot be changed`.

## 5. Send organization context

Send `X-Organization-Id` on tenant-scoped requests. `org-admin` callers with
exactly one administered organization may omit it; Terreno infers that org.
Operators and superadmins must select an org.

Frontend admin hosts use `OrgContextProvider` + `OrgSwitcher`.
`useAdminApi` adds the selected organization header automatically.

Disabled organizations are excluded from `/orgs/mine` and cannot be selected as
tenant context. Operators re-enable them from the organization directory UI or
with `PATCH /orgs/:id` and `disabled: false` (see
[How organization tenancy works](../explanation/organizations.md#disabled-organizations)).

Creating or renaming an organization to a name that generates an existing slug,
including a slug still held by a **soft-deleted** organization, returns **409**
`Organization name already in use`. `OrgSwitcher` hides itself
when `/orgs/mine` returns **403** for callers without org-admin memberships.

## Example app accounts

After `bun run backend:seed`, all accounts use password `testpassword123`:

| Account | Access |
| --- | --- |
| `operator@example.com` | Platform organization directory; may enter either org |
| `orgadmin-alpha@example.com` | Org admin for Alpha Workspace |
| `orgadmin-beta@example.com` | Org admin for Beta Workspace |
| `test@example.com` | Member of Alpha Workspace |
| `admin@example.com` / `superadmin@example.com` | Existing example superadmin accounts |

The seed creates Alpha Workspace and Beta Workspace plus two projects in Alpha
Workspace. Membership rows, not fields on User, are the source of tenant access.
In-process Better Auth seeding sets `disableRateLimit: true` so production
preview smoke tests can create all six accounts without hitting Better Auth's
sign-up limiter.
