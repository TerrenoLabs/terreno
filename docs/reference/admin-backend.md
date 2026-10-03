# @terreno/admin-backend

Backend plugin that auto-generates admin CRUD endpoints for Mongoose models. Works with `@terreno/admin-frontend` to provide a complete admin panel solution.

Screens, sidebar, and host wiring: [How admin interfaces are shaped](../explanation/admin-interface.md)
and [Build admin screens](../how-to/build-admin-screens.md).

## Quick Start

``````typescript
import {AdminApp} from "@terreno/admin-backend";
import {User, Todo} from "./models";

const admin = new AdminApp({
  basePath: "/admin",
  models: [
    {
      model: User,
      routePath: "/users",
      displayName: "Users",
      listFields: ["email", "name", "admin"],
      defaultSort: "-created",
    },
    {
      model: Todo,
      routePath: "/todos",
      displayName: "Todos",
      listFields: ["title", "completed", "ownerId"],
    },
  ],
});

admin.register(app);
``````

This creates:
- `GET /admin/config` — Model metadata endpoint (`migrations.enabled` when `AdminApp` is given `migrations.dir`)
- `GET /admin/migrations/status` (`admin:access`) and `POST /admin/migrations/run?wetRun=` (`admin:runScripts`) as `modelRouter` collection actions when `migrations.dir` is set. CRUD on `/admin/migrations` is disabled (405), action permission denials are 405, and responses use `{data: ...}`. Both operations are documented under the `adminMigrations` OpenAPI tag.
- Poll/cancel those tasks at `GET`/`DELETE /admin/scripts/tasks/:id`
- Pass `migrations: {dir: "./migrations"}` on `AdminApp`
- Standard CRUD routes for each model at `{basePath}{routePath}`
- All routes protected with `Permissions.IsAdmin`, or fine-grained RBAC when `accessControl` is set

## AdminApp Options

``````typescript
interface AdminOptions {
  models?: AdminModelConfig[];
  basePath?: string;  // Default: "/admin"
  organizations?: boolean; // Default: false
}

interface AdminModelConfig {
  model: Model<any>;
  routePath: string;      // e.g., "/users"
  displayName: string;    // e.g., "Users"
  listFields: string[];   // Fields shown in table
  defaultSort?: string;   // Default: "-created"
}
``````

## Organization scoping

Organization-aware admin CRUD is opt-in so existing single-tenant apps remain
unchanged. Enable organizations in both access and admin wiring:

``````typescript
const access = createAccess({
  connection: mongoose.connection,
  organizations: true,
  statements,
  userModel: User,
});

new AdminApp({
  accessControl: access,
  organizations: true,
});
``````

When enabled, models whose schema contains `organizationId`:

- require organization context through `X-Organization-Id` (single-org
  `org-admin` callers may use context inference);
- AND `organizationId` into list and search queries;
- deny read, update, delete, and bulk update for records outside the current org;
- overwrite client-provided `organizationId` on create with the current org.

Models without `organizationId` and every admin app that omits `organizations`
keep their existing behavior. Organization directory, settings, and membership
requests use the shared `OrgsApp` routes mounted by
`TerrenoApp({organizations: true, accessControl: access})`.

## Generated Routes

For each model, creates standard modelRouter CRUD endpoints plus admin membership helpers:

- `GET {basePath}{routePath}` — List (paginated, sortable). Query params: `page`, `limit`, `sort`, `q` (partial search across string `searchFields`), plus `queryFields` from list/filter metadata. Envelope: `{data, limit, more, page, total}` (`page` is the raw query string when provided)
- `GET {basePath}{routePath}/search?q=` — Typeahead search. Envelope: `{data}` (limit 20; empty `q` returns `{data: []}`)
- `POST {basePath}{routePath}/bulk-patch` — Body `{ids: string[], patch: object}`. Success body `{updated}` plus `failures` when any id fails. Ids must pass `mongoose.isValidObjectId` (hex String `_id` values work; arbitrary UUID-like strings are rejected as `"Invalid id"`)
- `POST {basePath}{routePath}` — Create
- `GET {basePath}{routePath}/:id` — Read
- `PATCH {basePath}{routePath}/:id` — Update
- `DELETE {basePath}{routePath}/:id` — Delete

## Scripts

`POST {basePath}/scripts/:name/run` creates a `BackgroundTask` and returns `{taskId}`. Poll
`GET {basePath}/scripts/tasks/:id`. Cancel `DELETE {basePath}/scripts/tasks/:id`.

When `JobsApp` is already registered, the run is enqueued as job `admin/script` (see
[Durable background jobs](../how-to/background-jobs.md#admin-scripts)). Call
`defineAdminScriptJob` on the worker process with the same script list. The CLI
(`runScriptCli`) does not enqueue.

## Config Endpoint

`GET {basePath}/config` returns metadata for all registered models:

``````typescript
{
  models: [
    {
      name: "User",
      routePath: "/admin/users",
      displayName: "Users",
      listFields: ["email", "name", "admin"],
      defaultSort: "-created",
      fields: {
        email: {
          type: "string",
          required: true,
          description: "User email address"
        },
        admin: {
          type: "boolean",
          required: false,
          default: false
        }
      },
      adminBroadcast: false
    }
  ]
}
``````

Field metadata includes:
- `type` — Field type (string, number, boolean, date, objectid, array, etc.)
- `required` — Whether field is required
- `description` — From schema (ensure all fields have descriptions!)
- `enum` — Enum values if applicable
- `default` — Default value
- `ref` / `itemRef` — Referenced admin config `name` for ObjectId refs. Framework
  compiled names such as `TerrenoOrganization` are returned as their stable public
  admin names (`Organization`) so frontend reference pickers resolve the matching model.
- `adminBroadcast` — Always present. `true` when the app `modelRouter` `sync` config set
  `adminBroadcast`, except organization-scoped models (forced to `false`)
- `organizationScoped` — `true` when `AdminApp({organizations: true})` manages a model with
  an `organizationId` path, except `AuditEvent` (platform log; rows may omit the field)
- `syncCollection` — Sync collection tag (app `routePath` without a leading slash, e.g. `todos`) when `adminBroadcast` is true; omitted otherwise

Field metadata is built from `describeModel()` via `modelDescriptionToAdminFields()` — not from a second OpenAPI property walk. Widget overrides (`fieldOverrides`) remain admin-backend configuration.

## Permissions

`admin:access` is the only permission that opens the admin page. `GET /admin/config` returns 403
without it. Script, configuration, RBAC, and per-model permissions never grant entry on their own.

Without `accessControl`, that same page gate uses `Permissions.IsAdmin` (`user.admin`).

`AdminApp.register` also installs each model's list/read permissions and `queryFilter` on
the sync admin window (`registerAdminBroadcastScope`). `GET /sync/entities` and
`{collection}|admin` deltas then use that contract, not product `IsOwner`. Organization-scoped
models are excluded because the current sync window protocol does not carry the selected
organization context; they stay on REST so `X-Organization-Id` and `OrgQueryFilter` cannot be
bypassed.

For writes, AdminApp registers an admin-window mutation scope (`registerAdminWindowMutationScope`).
Sync clients listed in `createSyncDb({windowCollections})` tag outbox rows with
`mutationMode: "adminWindow"`. The server does not trust the marker alone: it also requires
`adminBroadcast`, admin-window access (`admin:access` with RBAC, else `user.admin`), and the
registered scope. Successful admin-window sync mutations enforce the same create/update/delete
enabled flags, RBAC/`writeOwned` ownership, readonly/hidden stripping, User admin-flag/role gates,
and `onAdminAudit` post hooks as REST — via AdminApp executor callbacks on the shared sync write
pipeline (Mongoose validation, conflict/baseVersion checks, and ledger ordering unchanged).
Organization-scoped models do not register this scope and use REST mutations. Product clients
that omit the marker keep product sync permissions and hooks.

With `accessControl`, each model can use a standard admin resource with three actions:

| Action | Access |
| --- | --- |
| `read` | List, search, and read any record |
| `write` | Create, update, bulk-update, and delete any record |
| `writeOwned` | Create records and update/delete records accepted by the ownership helper |

Declare an `admin<ModelName>` statement and optionally customize ownership:

```typescript
import {ADMIN_MODEL_ACCESS} from "@terreno/api";
import {adminOwnedBy, AdminApp} from "@terreno/admin-backend";

const statements = {
  adminForm: ADMIN_MODEL_ACCESS,
  adminScreen: ["formReports"],
} as const;

modelRouter("/forms", Form, {
  admin: {
    adminAccess: {isOwned: adminOwnedBy("staffId")},
    displayName: "Forms",
    listFields: ["title", "staffId"],
  },
  // ...
});

new AdminApp({
  accessControl,
  customScreens: [{
    adminAccess: {resource: "adminScreen", action: "formReports"},
    displayName: "Form reports",
    name: "form-reports",
  }],
});
```

`adminAccess.resource` overrides the default `admin<ModelName>` name. Framework
models compiled as `Terreno*` still use the pre-namespace `admin<ModelName>`
resource (`adminAuditEvent`, `adminAnnouncement`, `adminMcpServiceToken`) and
the same `/admin/<PublicName>` UI key (`/admin/AuditEvent`). Use
`adminAccess.authorize({action, instance, user})` when a model or screen needs a completely
custom decision. The callback replaces the standard read/write/write-owned decision, while
`admin:access` still protects the admin shell. Every action is authorized without an instance
first (router and `/admin/config` probes). Return `true` for `read` / `update` / `delete` when
`instance` is missing if some records may be allowed; the loaded record is authorized next.
`create` is also checked again with the request body.

`writeOwned` can create any new record; `isOwned` is only applied to update and delete.

The config endpoint is caller-specific: models and custom screens without read access are omitted,
writable controls are disabled, and `platformTools` reports visibility for Scripts, Roles, Version,
and Configuration. Built-in tools use the existing editable permissions:

- Scripts: `admin:runScripts` or `admin:viewBackgroundTasks`
- Migrations apply/dry-run: `admin:runScripts` (status listing uses `admin:access`)
- Roles: `rbac:read`
- Version and Configuration: `configuration:read`
- Audit Log and Feature Flags: their model's admin `read` permission

Read and list responses include `_adminCapabilities.update` and
`_adminCapabilities.delete` for each record. This keeps `writeOwned` forms and row controls
read-only for records the current user does not own. Script metadata separately exposes run and
history permissions so a history-only role never receives an enabled Run control.

When `AuditApp` is registered, successful admin POST/PATCH/DELETE persist append-only
`AuditEvent` rows with `source: "admin"`. `onAdminAudit` is an extra best-effort sink; it is
not required for the framework log. Failures in either sink do not change the mutation HTTP
status. `AuditEvent` itself is never audited.

**Important:** Only expose models that should be editable via admin panel. Avoid sensitive internal models.

## Document storage

`DocumentStorageApp` mounts a GCS file browser at `basePath` (default `/documents`): list, upload, download, create folder, and delete.

| Option | Default | Notes |
| --- | --- | --- |
| `bucketName` | `GCS_BUCKET` | 503 `Storage not configured` when neither is set |
| `folderPrefix` | `""` | Root inside the bucket |
| `access` | `"admin"` | `"authenticated"` also admits signed-in non-admins, confined to `{folderPrefix}users/<userId>/`. Admins always see the whole `folderPrefix` |
| `uploadRateLimit` | off | `{max, windowMs, store?, keyBy?}` on `POST basePath/` only. Keys by IP by default. See [Rate limiting](../how-to/rate-limiting.md#limit-one-route) |
| `allowedMimeTypes`, `maxFileSize` | images, PDF, text, Office; 10 MB | Upload filter |

```typescript
new DocumentStorageApp({
  access: "authenticated",
  basePath: "/documents",
  bucketName: process.env.GCS_BUCKET ?? "",
  uploadRateLimit: {max: 1, store: "mongo", windowMs: 60_000},
});
```

Pair it with `DocumentStorageBrowser` from `@terreno/admin-frontend`. Pass `backButton={false}` when the browser is embedded outside admin. Upload failures (including 429) show inline.

## Best Practices

- Add `description` to all model fields — flows through to admin UI
- Use `listFields` to control which columns appear in table views
- Set `defaultSort` to control initial ordering (usually `"-created"`)
- Keep `routePath` simple and pluralized (`"/users"`, `"/todos"`)

## Integration

Works seamlessly with `@terreno/admin-frontend`. The frontend uses the `/admin/config` endpoint to:
- Discover available models
- Generate forms with proper field types
- Render references as clickable links
- Validate required fields
