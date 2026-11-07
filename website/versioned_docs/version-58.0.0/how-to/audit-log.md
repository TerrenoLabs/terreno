# Enable the framework audit log

Register `AuditApp` and set `audit: true` on routers you want logged. Successful HTTP mutations write append-only `AuditEvent` rows. Default retention is forever.

## Steps

### 1. Register the plugin

```typescript
import {AuditApp, TerrenoApp} from "@terreno/api";

new TerrenoApp({userModel: User}).register(new AuditApp()).start();
```

Importing `@terreno/api` does not register `AuditEvent`. HTTP list/read is admin-only at `GET /audit-events` and `GET /admin/audit-events`. Create/update/delete over HTTP are disabled (405), including the admin remount.

### 2. Opt in per router

```typescript
modelRouter("/todos", Todo, {
  audit: true, // or {redact: ["ssn"]}
  permissions: {
    /* ... */
  },
});
```

`audit: true` without `AuditApp` still returns 2xx and logs an error once per process.

## Operations

| HTTP | `verb` | `operation` | Diff |
| --- | --- | --- | --- |
| POST `/` | `created` | `create` | `after` only |
| PATCH `/:id` | `updated` | `update` | Changed fields in `before` / `after` |
| DELETE `/:id` | `deleted` | `delete` | `before` only |
| POST `/:id/:field` | `updated` | `arrayPush` | Changed fields; `recordId` set |
| PATCH `/:id/:field/:itemId` | `updated` | `arrayUpdate` | Changed fields; `recordId` set |
| DELETE `/:id/:field/:itemId` | `updated` | `arrayRemove` | Changed fields; `recordId` set |

`source` is `modelRouter` for these writes. `ConsentApp` also writes `modelRouter` events for
provisional consent actions: `created`/`create` for a provisional signature, `updated`/`update` for a void, and
`viewed`/`read` when staff read another user's consent statuses. `read` and `viewed` mark
audited reads; no other surface writes them. Secrets (`password`, `hash`, `salt`, `token`,
`secret`, `refreshToken`) are omitted at every object and array depth, including compound
keys such as `tokenHash`. Extra `redact` names merge with that list as exact field names.

### 3. Admin mutations

When `AuditApp` is registered, AdminApp writes the same `AuditEvent` collection with
`source: "admin"` after successful admin POST/PATCH/DELETE. You do not need `onAdminAudit` for
that. `onAdminAudit` remains an extra sink if the app still wants a second destination.
Admin diffs also omit each model's `hiddenFields` and `excludeFields`.

RBAC mutations fan into the same collection when `createAccess({auditSink: persistRbacAuditToAuditEvent})` is set. `source` is `rbac`.

### 4. Account security actions

`AccountSecurityApp` writes the same collection for account recovery. It refuses to start
unless `AuditApp` is registered (or you pass `audit: false`).

| `source` | Written by | `modelName` / `recordId` | `after` |
| --- | --- | --- | --- |
| `admin` | AdminApp POST/PATCH/DELETE | Model / document id | Changed fields |
| `modelRouter` | `modelRouter` with `audit` | Model / document id | Changed fields |
| `rbac` | `createAccess({auditSink: persistRbacAuditToAuditEvent})` | RBAC target | Role change |
| `security` | `AccountSecurityApp` recovery actions (2FA reset and later actions) | `User` / target user id | `{securityAction, organizationId?}` |

A recovery call that changes nothing (resetting 2FA that is already off) writes no row. List
one user's security history with `GET /audit-events?source=security&recordId=<userId>`. Routes
and action names: [Account security reference](../reference/account-security.md).

`organizationId` is copied onto the event when `req.organization` is set (`id` or `_id`), otherwise from the request org AsyncLocalStorage, then `X-Organization-Id`, then the mutated document's `organizationId` string. Socket admin-window mutates attach `organizationId` on the payload so non-tenant models still land in the selected organization's audit log. The field is omitted when none of those exist. Admin list/read for `AuditEvent` is not organization-scoped, so unscoped rows stay visible when no organization is selected.

`actorId` comes from `req.user.id` (or `_id`). Only a 24-hex Mongo ObjectId is stored;
mongoose's looser `isValidObjectId` (12-character strings) is not used. Any other id
shape still writes the event with `actorId` omitted and a warning logged.

Update and delete snapshot `before` only when `audit` is on. If that `toJSON` throws, the
mutation still completes and the event is recorded without a `before` snapshot.

### 5. Fire-and-forget persist

HTTP handlers do not await Mongo. Diffs still run before the response so `before` / `after` are captured. Failures log; the mutation stays 2xx.

To persist completely off the API process, set Cloud Tasks env (`GCP_PROJECT`, `GCP_LOCATION`, `GCP_TASKS_AUDIT_QUEUE`, `AUDIT_TASKS_URL`, `AUDIT_TASKS_SECRET`) and `bun add @google-cloud/tasks`. `AuditApp` then enqueues the write and handles `POST /internal/audit-events` with header `X-Terreno-Audit-Secret`. Or pass `enqueue` yourself:

```typescript
new AuditApp({
  enqueue: async (write) => {
    await myQueue.push(write);
  },
  processQueuePath: "/internal/audit-events",
  processQueueSecret: process.env.AUDIT_TASKS_SECRET,
});
```

Authenticated malformed queue payloads are acknowledged without persistence. They cannot
become valid on retry, and returning a non-2xx response would make Cloud Tasks retry the
same poison task indefinitely.

### 6. Retention

Omit `retentionDays` or set `0` to keep events forever (no TTL index). `new AuditApp({retentionDays: 90})` creates a Mongo TTL index on `created` with `expireAfterSeconds = 90 * 86400`, replacing the default `{created: 1}` field index so Mongo does not reject a duplicate key pattern. Mongo expires documents in the background; lowering or removing TTL later requires dropping that index yourself (`db.auditevents.dropIndex(...)`) — Mongoose will not remove it.
