# RBAC Permissions for Terreno — API Design

**Status:** Complete — phases 1–6 shipped in PR #932 (2026-08-22)
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1089
**Target package:** `@terreno/api` (new `src/rbac/` module), with surfaces in `admin-backend`, `admin-frontend`, `admin-spa`, `rtk`, and the modelRouter MCP work
**Depends on:** `better-auth/plugins/access` (already a dependency via the Better Auth provider)

## Shipped (PR #932)

Phases 1–6 in section 8 are implemented. `RoleManager` emits `RbacAudit` (including
`permissionDelta`) on create/update/remove/assign/unassign; denied escalation attempts are
written with `denied: true`. `rbacRouter` is a thin HTTP adapter and does not write a second
audit row. Apps can attach `createAccess({auditSink})` (one sink or an array) to fan the same
record into a consuming-app audit log. `persistAudit: false` skips the built-in collection
and requires at least one sink. Seed upsert lives in `upsertSeededRole`; `RbacRole.seedDefaults({statements,
extraRoles})` is the single seed entry. `previewRoleChange.affectedUserCount` is the number of
users currently holding that role.

### Compatibility: no default-connection models

Importing `@terreno/api` does **not** register `RbacRole` or `RbacAudit` on
`mongoose.connection`. Apps must:

1. Call `createAccess({connection, ...})` (registers both models on that connection), or
2. Call `createRbacRoleModel(connection)` / `createRbacAuditModel(connection)` in scripts/tests.

The previous `RbacRoleModel` / `RbacAuditModel` value singletons are removed. The TypeScript
type `RbacRoleModel` remains exported. Migrate `import {RbacRoleModel} from "@terreno/api"` to
`createRbacRoleModel(connection)`.

Left out of this close: Redis/pubsub cross-instance cache invalidation beyond in-process
`invalidateCache`.

---

## 1. Summary

Terreno currently has a binary privilege model: `User.admin: boolean`, plus per-route
`PermissionMethod<T>[]` arrays (`Permissions.IsAdmin`, `IsOwner`, …) with AND semantics. This
plan replaces that with a first-class RBAC module in `@terreno/api`:

- **Permission vocabulary** (resources → actions) is statically defined by the consuming app,
  merged with Terreno defaults, using Better Auth's `createAccessControl` as the engine.
- **Roles** are DB-backed Mongoose documents editable at runtime through the Terreno admin,
  hydrated into Better Auth `Role` objects (`ac.newRole(permissionsFromDb)`) at check time.
  Terreno ships standard roles; consuming apps add their own (SuperUser, PatientGuide, …).
- **Users hold many roles**; effective permissions are the union of all their roles plus any
  grants from **external permission sources** (e.g. a Healthie adapter).
- **Document-level scopes** and **field-level views** cover the dynamic cases RBAC alone can't
  ("any PG can view any patient, but only edit patients on their panel"; "patients see fewer
  fields than staff").
- **One `can()` check** is enforced across REST (modelRouter + custom routes), websockets
  (subscribe + emit), MCP tools, and the admin panel.
- **Everything has a function escape hatch** so consuming apps (Flourish) can migrate
  incrementally without a big-bang rewrite.

Nothing in this design is Flourish-specific; PatientGuide/Healthie examples below are
illustrations of consuming-app usage.

## 2. Concepts

| Concept | What it is | Where it lives |
|---|---|---|
| **Statement** | Map of resource → allowed actions (`{patient: ["read", "update"]}`) | Static, in code, per app (merged with Terreno defaults) |
| **Permission** | One resource:action pair (`patient:update`) | Derived from statements |
| **Role** | Named bundle of permissions (`PatientGuide`) | DB (`RbacRole` collection), editable in admin; Terreno ships defaults |
| **Grant** | Roles/permissions attached to a user | `user.roles: string[]` (+ external sources) |
| **Scope** | Per-document predicate/query narrowing an action (`patient:update` only on panel) | Code, registered by app as functions |
| **Field view** | Per-permission read/write field mask (Patient vs Staff vs SuperUser view) | Code, registered by app |
| **Permission source** | External system contributing grants (Healthie) | Code, adapter interface |

The split is deliberate: **what can be granted** (statements, scopes, views) is code — typed,
reviewed, versioned. **Who has what** (roles, assignments) is data — editable at runtime in the
admin UI. This mirrors Better Auth's own design, where dynamic roles can only recombine a
statically defined vocabulary, and it is what makes "permissions can be dynamically added by the
consuming app but not limited by Terreno" work.

## 3. Module layout

```
api/src/rbac/
  index.ts            # Public exports
  statements.ts       # terrenoStatements, mergeStatements
  access.ts           # createAccess, TerrenoAccess class (wraps better-auth ac)
  roleModel.ts        # RbacRole Mongoose model + terrenoDefaultRoles seed
  userPlugin.ts       # rbacUserPlugin (adds roles: string[] to user schema)
  scopes.ts           # ResourceScope types + evaluation
  fieldViews.ts       # Field view types + apply/pick logic
  middleware.ts       # requireAccess() express middleware, IsPermitted() adapter
  resolve.ts          # Role resolution + caching + PermissionSource merging
  routes.ts           # rbacRouter (roles CRUD, catalog, previews)
  betterAuthBridge.ts # Mirror ac/roles into better-auth admin plugin when enabled
```

Exports land in `@terreno/api` root: `createAccess`, `terrenoStatements`, `terrenoDefaultRoles`,
`rbacUserPlugin`, `rbacRouter`, `IsPermitted`, `requireAccess`, plus all types.

---

## 4. API designs

### 4.1 Permission vocabulary (statements)

Terreno re-exports Better Auth's engine and ships default statements for everything the
framework itself gates today:

```typescript
// api/src/rbac/statements.ts
export const terrenoStatements = {
  // Admin panel access + admin-only surfaces
  admin: ["access", "runScripts", "viewBackgroundTasks"],
  // Managing the RBAC system itself
  rbac: ["read", "manageRoles", "assignRoles"],
  // The framework user model (auth surfaces, admin user CRUD)
  user: ["create", "list", "read", "update", "delete", "impersonate", "setPassword"],
  // Feature flag / configuration app
  configuration: ["read", "update"],
} as const;

export type Statements = Record<string, readonly string[]>;

// Same {resource: [actions]} shape better-auth uses everywhere
export type PermissionSet = {[resource: string]: readonly string[]};
```

The consuming app defines its own vocabulary and merges:

```typescript
// consuming app: src/access.ts
import {createAccess, terrenoStatements} from "@terreno/api";

export const statements = {
  ...terrenoStatements,
  patient: ["create", "read", "update", "delete", "readClinical", "updateClinical"],
  careplan: ["create", "read", "update", "approve"],
  staff: ["create", "read", "update"],
} as const;
```

Notes:

- `as const` is required (Better Auth's literal-type inference).
- Actions are arbitrary strings — apps can model verbs beyond CRUD (`approve`,
  `readClinical`), which is how "abilities" attach to roles.
- Adding a resource/action is a code change + deploy. That is a feature: the vocabulary is the
  contract that scopes, field views, routes, and the admin UI compile against.

### 4.2 `createAccess` — the central object

```typescript
// api/src/rbac/access.ts
import {createAccessControl} from "better-auth/plugins/access";

export interface AccessOptions<S extends Statements> {
  statements: S;
  // Code-defined roles seeded into the DB on boot (upsert; admin can then edit non-locked ones)
  defaultRoles?: RoleDefinition[];
  // Document-level scopes per resource (see 4.5)
  scopes?: ResourceScopes<S>;
  // Field-level views per resource (see 4.6)
  fieldViews?: ResourceFieldViews<S>;
  // External grant providers, e.g. Healthie (see 4.10)
  sources?: PermissionSource[];
  // Actions treated as "read-ish" when expanding the auditor read-only sentinel
  // (READ_ONLY_ROLE_PERMISSIONS — see 4.3). Defaults to READ_ACTIONS; apps add
  // verbs like "readClinical".
  readActions?: readonly string[];
  // Role resolution cache TTL in ms (default 30_000). Roles are DB-backed;
  // checks must not hit Mongo on every request. Keep this short for compliance:
  // revoking a role or assignment must not linger on other replicas until TTL
  // expiry (see cross-instance invalidation on `invalidateCache` in 4.2).
  cacheTtlMs?: number;
  // Escape hatch: full custom resolution of a user's permission set
  resolvePermissions?: (args: {user: User}) => Promise<PermissionSet | null>;
  // Optional human-readable labels for the admin permission matrix
  // (resource → action → description). Returned by GET /rbac/statements.
  statementDescriptions?: Record<string, Record<string, string>>;
}

export const createAccess = <S extends Statements>(options: AccessOptions<S>): TerrenoAccess<S>;
```

`TerrenoAccess` is the one object apps pass around (to `TerrenoApp`, modelRouter options,
realtime, MCP):

```typescript
export interface AccessCheckArgs<S extends Statements> {
  user?: User;
  // Same shape as better-auth: {resource: [actions]}, ANDed across entries
  permissions: PermissionRequest<S>;
  // When present, document scopes for the resource are also evaluated
  doc?: unknown;
  // Extra context threaded into scope functions (req, socket, etc.)
  context?: Record<string, unknown>;
}

export interface AccessResult {
  allowed: boolean;
  // Which layer denied — drives 403 vs 405 and admin debugging UI
  deniedBy?: "role" | "scope" | "source";
  reason?: string;
}

export interface TerrenoAccess<S extends Statements> {
  readonly statements: S;
  // better-auth access controller, exposed for direct use / bridging
  readonly ac: ReturnType<typeof createAccessControl>;

  // The single authorization entry point (role check + optional doc scope check)
  can(args: AccessCheckArgs<S>): Promise<AccessResult>;

  // Union of a user's effective permissions (roles + sources) — powers /auth/me,
  // client gating, and the admin "what does this user have" view. Cached.
  getPermissions(args: {user: User}): Promise<PermissionSet>;

  // Query fragment for list endpoints/subscriptions from the resource's scopes.
  // null means "no access" (empty list), {} means unrestricted.
  queryFilter(args: {
    user?: User;
    resource: keyof S & string;
    action: string;
    context?: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null>;

  // Field mask for a doc + user (see 4.6). Used by responseHandler, realtime, MCP.
  // Mirrors fieldViews.select: `doc` is optional and `undefined` during create
  // (no document exists yet), and `phase` tells the resolver which enforcement
  // point is calling so the same selector yields read/write/create masks. Create
  // resolves the mask from user + permissions alone (see 4.6 "Create-time view
  // resolution"). modelRouter/realtime/MCP call sites pass `phase` explicitly.
  fieldMask(args: {
    user?: User;
    resource: keyof S & string;
    doc?: unknown; // undefined during create
    phase?: "read" | "write" | "create"; // default "read"
  }): Promise<FieldMask>;

  // Express middleware for custom routes (see 4.8)
  middleware(permissions: PermissionRequest<S>, options?: {getDoc?: DocLoader}): RequestHandler;

  // Adapter producing a legacy PermissionMethod so existing modelRouter
  // permission arrays keep working during migration (see 4.7)
  permission(permissions: PermissionRequest<S>): PermissionMethod<unknown>;

  // Role management used by rbacRouter + admin (see 4.9)
  roles: RoleManager;

  // Drop cached role/source hydrations for one user or all users on this process.
  // Production multi-replica deployments (e.g. Cloud Run) also need a shared
  // invalidation channel (Redis pub/sub, version stamp on `RbacRole.updated`, …)
  // so every instance drops stale hydrations when roles are edited — otherwise
  // `/auth/me`, websocket permission resolution, and `getPermissions()` on
  // other replicas serve the old set until `cacheTtlMs` expires. The IP will
  // specify the default transport; apps can plug a custom broadcaster.
  invalidateCache(args?: {userId?: string}): void;
}
```

Check semantics (matches Better Auth): within one resource entry, all listed actions must be
allowed; across resources, entries are ANDed. A user passes a role check if **any** of their
roles authorizes the request (union across roles) — then scopes, which are restrictions, are
ANDed on top.

### 4.3 Roles: DB-backed, hydrated through Better Auth

Why not use Better Auth's role objects directly? Released Better Auth only supports **static**
global roles (dynamic access control exists for the org plugin; the admin-plugin port is an
unmerged PR). The supported escape hatch is to store role → permission JSON ourselves and build
role objects at check time with `ac.newRole()` — that's exactly what we do, and it works
identically whether the app's auth provider is JWT/Passport or Better Auth.

```typescript
// api/src/rbac/roleModel.ts
export interface RbacRoleDocument {
  _id: ObjectId;
  // Stable machine name stored on users ("superadmin", "patientGuide")
  name: string;
  displayName: string;
  description?: string;
  // The better-auth permission JSON: {resource: [actions]}, validated
  // against access.statements on write
  permissions: PermissionSet;
  // Role exclusion rules: users cannot hold this role together with any of
  // these (e.g. patientGuide excludes familyGuide). Enforced symmetrically
  // on assignment.
  excludesRoles: string[];
  // Shipped by Terreno or the app via defaultRoles; locked roles cannot be
  // deleted or have their name changed (permissions remain editable unless
  // sealed — see isSealed).
  isLocked: boolean;
  // When true, the role is immutable through the admin API: name, description,
  // permissions, and excludesRoles cannot be changed or deleted. Only Terreno
  // seeds ship sealed (today: `superadmin`). Locked-but-not-sealed roles (e.g.
  // `admin`, `auditor`) keep a stable name while their permission matrix remains
  // editable in the admin UI.
  isSealed: boolean;
  created: Date;
  updated: Date;
}
```

Default-role `permissions` accept a `RolePermissionSpec`: either a concrete `PermissionSet`, or
one of two **seed-time expansion sentinels** resolved against the *merged* statements when the
role is upserted, so app-defined resources are covered without the app editing Terreno's roles:

```typescript
// api/src/rbac/roleModel.ts
export type RolePermissionSpec =
  | PermissionSet
  | "*" // every action of every resource (superadmin)
  | typeof READ_ONLY_ROLE_PERMISSIONS; // auditor: every read-ish action

// "read-ish" = the intersection of each resource's actions with READ_ACTIONS.
// Terreno's default list; apps can extend via createAccess({readActions}).
export const READ_ACTIONS = ["read", "list", "access", "view"] as const;

// Seed-time sentinel for auditor-style read-only expansion. Reference this
// constant in defaultRoles (`permissions: READ_ONLY_ROLE_PERMISSIONS`).
export const READ_ONLY_ROLE_PERMISSIONS = {readOnly: true} as const;

// Structural check — accepts both the exported constant and any hand-rolled
// `{readOnly: true}` object (TypeScript's structural typing allows the latter).
const isReadOnlySentinel = (
  spec: RolePermissionSpec,
): spec is typeof READ_ONLY_ROLE_PERMISSIONS =>
  typeof spec === "object" &&
  spec !== null &&
  !Array.isArray(spec) &&
  Object.keys(spec).length === 1 &&
  (spec as {readOnly?: unknown}).readOnly === true;

// Applied at seed time inside createAccess, using the merged statements as the source.
export const expandRolePermissions = (
  spec: RolePermissionSpec,
  statements: Statements,
  readActions: readonly string[],
): PermissionSet => {
  if (spec === "*") {
    return mapValues(statements, (actions) => [...actions]);
  }
  if (isReadOnlySentinel(spec)) {
    return filterMapValues(statements, (actions) =>
      actions.filter((a) => readActions.includes(a)),
    );
  }
  return spec;
};
```

Terreno ships default roles (generic names — app-agnostic):

```typescript
// api/src/rbac/roleModel.ts
export const terrenoDefaultRoles: RoleDefinition[] = [
  {
    name: "superadmin", // the "SoftwareEngineer" role, generically named
    displayName: "Super Admin",
    permissions: "*", // expands to every statement action at seed time
    isLocked: true,
    isSealed: true,
  },
  {
    name: "admin",
    displayName: "Admin",
    permissions: {
      admin: ["access"],
      user: ["create", "list", "read", "update"],
      configuration: ["read", "update"],
    },
    isLocked: true,
  },
  {
    name: "auditor",
    displayName: "Auditor",
    // Read-only *everywhere*, including app resources: expands at seed time to
    // every resource's read-ish actions from the merged statements (parallel to
    // superadmin's "*"). Not a hand-listed subset — see expandRolePermissions.
    permissions: READ_ONLY_ROLE_PERMISSIONS,
    isLocked: true,
  },
  {name: "member", displayName: "Member", permissions: {}, isLocked: true},
];
```

Because expansion runs against the merged statements at seed/upsert time, the stored
`RbacRoleDocument.permissions` is always a concrete `PermissionSet` (the sentinel is never
persisted), so runtime checks, the admin matrix, and diffs all see the fully expanded set.

At check time, roles resolve through Better Auth:

```typescript
// api/src/rbac/resolve.ts (internal)
const hydrateRole = (roleDoc: RbacRoleDocument) => ac.newRole(roleDoc.permissions);
// role.authorize({patient: ["update"]}) -> {success: boolean; error?: string}
```

When the app uses the Better Auth provider, `betterAuthBridge.ts` also passes `ac` and the
seeded roles into the better-auth `admin` plugin config so `authClient.admin.checkRolePermission`
(sync, client-side, static roles) and `auth.api.userHasPermission` work natively; DB-edited
roles remain authoritative server-side via `access.can()`.

### 4.4 Assigning roles to users

```typescript
// api/src/rbac/userPlugin.ts
export interface RbacUser {
  // Role names; effective permissions are the union
  roles: string[];
}

export const rbacUserPlugin = (schema: Schema<any, any, any, any>): void => {
  schema.add({
    roles: {
      type: [String],
      default: [],
      index: true,
      description: "RBAC role names assigned to this user",
    },
  });
};
```

Assignment goes through `RoleManager` (never raw writes) so exclusion rules and audit hooks run:

```typescript
export interface RoleManager {
  list(): Promise<RbacRoleDocument[]>;
  create(args: {actor: User; role: RoleInput}): Promise<RbacRoleDocument>;
  update(args: {actor: User; roleName: string; changes: Partial<RoleInput>}): Promise<RbacRoleDocument>;
  remove(args: {actor: User; roleName: string}): Promise<void>;

  // Throws APIError 409 with the conflicting rule if excludesRoles is violated
  assign(args: {actor: User; userId: string; roleNames: string[]}): Promise<void>;
  unassign(args: {actor: User; userId: string; roleNames: string[]}): Promise<void>;

  // Diff previews for the admin UI (see 4.11)
  previewRoleChange(args: {roleName: string; permissions: PermissionSet}): Promise<RoleDiff>;
  previewAssignment(args: {
    actor: User;
    userId: string;
    roleNames: string[];
  }): Promise<UserPermissionDiff>;
}

export interface RoleDiff {
  gained: PermissionSet;
  lost: PermissionSet;
  affectedUserCount: number;
}

export interface UserPermissionDiff {
  gained: PermissionSet; // net-new after union with their other roles
  lost: PermissionSet;
  resulting: PermissionSet;
}
```

Guardrails baked into `RoleManager` (borrowed from Better Auth's dynamic access control):

- **No escalation**: an actor can only grant (or edit a role to include, or assign) permissions
  the actor **themselves currently holds**. Holding `rbac:manageRoles` lets an actor *manage*
  roles but never lets them hand out actions they lack — a role editor cannot bootstrap
  privileges they do not have. Role **update** checks `actorPermissions ⊇ (existing ∪ incoming)`
  so emptying a role still requires holding its current grants. Role **remove** checks
  `actorPermissions ⊇ existing`. The **only** exception is `superadmin`, which (via its `"*"`
  expansion) holds every permission and so can grant anything; this is a property of *what
  superadmin holds*, not a special "manageRoles can escalate" rule. Concretely: the check is
  `actorPermissions ⊇ permissionsBeingGranted`, evaluated against the actor's effective set.
- **Vocabulary validation**: every `resource:action` in `permissions` must exist in
  `access.statements` — writes with unknown pairs are 400s.
- **Preview assignment** takes the same `actor` as assign: it requires `rbac:assignRoles`,
  the target-user privilege-subset check, and `assertNoEscalation` for every previewed role.
  The before/after diff uses uncached permission resolution on both sides so a warm cache
  cannot invent gained/lost grants, and the preview cannot write live permission caches.
- **Managing roles requires** `rbac:manageRoles`; assigning requires `rbac:assignRoles`. These
  gate *access* to the operation and are additive to (not a substitute for) the no-escalation
  subset check above.
- **`excludesRoles` remediation**: assignment-time 409s are not enough when an admin later
  *adds* an exclusion to a role that conflicts with roles users already hold. `RoleManager.update`
  rejects the role change (400) until every affected user is remediated — the error payload lists
  conflicting `(userId, roleA, roleB)` tuples. Admins resolve via `previewRoleChange` (shows
  affected users) and explicit `unassign` calls; Terreno never silently leaves a violated
  invariant in place.
- **Audit (required)**: every successful `RoleManager` create/update/remove/assign/unassign
  **must** emit an `RbacAudit` record (built-in collection and/or pluggable sink — see 7.4).
  Denied escalation attempts (actor tried to grant permissions they lack) are also logged at
  `warn` with actor, target, and the rejected permission delta for abuse detection.

### 4.5 Document-level scopes (the dynamic layer)

RBAC answers "can PatientGuides update patients?" Scopes answer "**this** patient?" They are
functions in code (typed against the app's models), keyed by resource and action:

```typescript
// api/src/rbac/scopes.ts
export interface ScopeArgs<TDoc> {
  user: User;
  action: string;
  doc?: TDoc; // absent during pre-flight (create/list) checks
  context?: Record<string, unknown>; // req, socket, mcp session...
}

export interface ResourceScope<TDoc = unknown> {
  // Object-level predicate; runs after the role check passes.
  // Return true/false, or a PermissionSet to demand extra permissions
  // (e.g. editing a doc in "final" status requires careplan:approve).
  check?: (args: ScopeArgs<TDoc>) => boolean | PermissionSet | Promise<boolean | PermissionSet>;
  // Mongo query fragment for list/subscription filtering — the same
  // constraint as `check`, expressed as a query. null = no access.
  filter?: (args: ScopeArgs<TDoc>) => Promise<Record<string, unknown> | null>;
}

// Keyed "resource.action"; "resource.*" applies to all actions of the resource
export type ResourceScopes<S extends Statements> = {
  [key: string]: ResourceScope;
};
```

**Coupling `check` and `filter` (no drift).** A per-document `check` and a list/subscription
`filter` that express *different* constraints silently corrupt authorization: a list could
return rows a per-doc read would reject, or vice versa. The design forbids that two ways:

1. **`defineScope` factory (preferred).** A scope is derived from a single predicate expressed
   once as a Mongo query fragment. The factory produces the `filter` (the fragment) and the
   `check` (the same fragment evaluated against the in-memory doc via a lightweight matcher),
   so the two can never disagree:

   ```typescript
   export interface ScopeDefinition<TDoc> {
     // The one source of truth: the constraint as a query fragment (null = no access).
     matches: (args: ScopeArgs<TDoc>) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
     // Optional elevation that skips the constraint for both check and filter.
     adminBypass?: (args: ScopeArgs<TDoc>) => boolean | Promise<boolean>;
     // How to read a field path off a loaded doc before comparison (defaults to
     // dot-path lookup). Used when a fragment references populated refs — unwrap
     // and normalize (e.g. string-coerce ObjectIds) here. The generated `check`
     // evaluates the full `matches` fragment against the in-memory doc using the
     // same semantics as Mongo (equality, `$in`, `$eq`, …) via a lightweight
     // matcher — not only flat String equality on a single leaf.
     fieldOf?: (doc: TDoc, path: string) => unknown;
   }

   // Returns {check, filter} whose logic is guaranteed identical.
   export const defineScope = <TDoc>(def: ScopeDefinition<TDoc>): ResourceScope<TDoc>;
   ```

2. **Parity tests for hand-written scopes.** When an app supplies a raw `{check, filter}` pair
   (needed for constraints not expressible as a static fragment), Terreno ships a
   `assertScopeParity(scope, {samples})` test helper and requires each such scope key to have a
   conformance test that feeds sample docs/users through both `check` and the `filter`-derived
   query and asserts they agree. `createAccess` warns (dev) when a scope defines both `check`
   and `filter` by hand without a registered parity test.

Consuming-app example (the PatientGuide panel case) — **`defineScope` so check and filter
cannot drift**:

```typescript
// One helper encodes the constraint once; both list/subscription filter and per-doc
// check evaluate the same predicate (supervisor-of-pod, on-panel, or active PTO coverage).
const patientUpdateScope = defineScope<PatientDocument>({
  matches: async ({user, doc}) => {
    const staff = user as unknown as StaffDocument;
    const editableIds = await editablePatientIds(staff); // shared: panel + PTO + supervised pods
    if (!editableIds.length) {
      return null;
    }
    // List/subscription: constrain to the same id set the per-doc check uses.
    return {_id: {$in: editableIds}};
  },
  // Per-doc check: fragment value vs doc._id (String equality, ObjectId-safe).
  fieldOf: (doc, path) => (path === "_id" ? String(doc._id) : undefined),
});

const access = createAccess({
  statements,
  scopes: {
    // Any role with patient:read can read any patient — no read scope.
    "patient.update": patientUpdateScope,
    "careplan.approve": defineScope<CareplanDocument>({
      matches: ({user}) => (user ? {assignedPsychiatristId: user.id} : null),
      fieldOf: (doc, path) =>
        path === "assignedPsychiatristId" ? String(doc.assignedPsychiatristId) : undefined,
    }),
  },
});
```

When a scope truly cannot be expressed as one Mongo fragment (rare), supply a hand-written
`{check, filter}` pair **and** register `assertScopeParity(scope, {samples})` covering every
branch (panel vs PTO vs cross-pod supervisor, etc.). `createAccess` warns in dev if both are
hand-written without a parity test — the anti-pattern is divergent predicates, not hand-writing
per se.

Semantics:

- Scopes are **restrictions only** — they can never grant an action the user's roles don't
  include. Role check first, scope second. (`superadmin` does not bypass scopes by default;
  a scope can opt in by checking permissions itself.)
- `check` without a `doc` (create pre-flight) is only called if defined for the action; scopes
  that need a doc are skipped pre-flight and enforced post-load — same two-phase flow the
  current `permissionMiddleware` already implements (405 pre-object, 403 post-object).
- `filter` is merged (`$and`) with `queryFields`/`defaultQueryParams` in list handlers and
  websocket query subscriptions — replacing today's ad-hoc `queryFilter`/`OwnerQueryFilter`.

Terreno ships the common scope as a helper, replacing `Permissions.IsOwner` + `OwnerQueryFilter`.
Its per-document behavior must preserve today's `IsOwner` semantics exactly: **admins bypass
ownership** — `IsOwner` returns `true` for `user.admin === true` on any document. Note the current
`OwnerQueryFilter` does *not* share that bypass: it always narrows list queries to
`{ownerId: user.id}` and never checks `user.admin`, so today an admin's per-document access and
their list access disagree (admins can read/update any single owned-model doc but list endpoints
still scope them to their own rows). `OwnerScope` deliberately unifies the two behind one
`adminBypass` predicate (default: the legacy `user.admin` flag) applied to **both** the per-doc
`check` and the list/subscription `filter` (where the bypass yields `{}` — no narrowing), so
admins get consistent unrestricted read/update/delete/list access and migrated flows lose no
privilege:

```typescript
export interface OwnerScopeOptions {
  field?: string; // owner id path, default "ownerId"
  // Elevated actors that skip the ownership constraint entirely.
  // Default preserves legacy IsOwner behavior (user.admin === true) and also
  // treats holders of the superadmin role as unrestricted.
  adminBypass?: (args: {user?: User}) => boolean | Promise<boolean>;
}

export const OwnerScope = (options: string | OwnerScopeOptions = {}): ResourceScope => {
  const {field = "ownerId", adminBypass = defaultAdminBypass} =
    typeof options === "string" ? {field: options} : options;
  return defineScope<unknown>({
    // One predicate drives both check and filter (see below); adminBypass short-circuits both.
    adminBypass,
    // Mongo filter matches the raw stored ownerId (an ObjectId) against the user id.
    matches: ({user}) => (user ? {[field]: user.id} : null),
    // The in-memory check must mirror IsOwner exactly: unwrap a *populated*
    // ownerId (`{_id}`) and normalize to a string so ObjectId, string, and
    // populated-document shapes all compare equal. defineScope's generated
    // `check` applies String(...) equality between the fragment value and this
    // return (see fieldOf note in 4.5), matching Mongo's ObjectId coercion — so
    // a populated `ownerId` is never falsely denied.
    fieldOf: (doc) => {
      const owner = (doc as Record<string, unknown> | undefined)?.[field];
      const ownerId = (owner as {_id?: unknown} | null | undefined)?._id ?? owner;
      return ownerId == null ? undefined : String(ownerId);
    },
  });
};

// defaultAdminBypass = ({user}) => Boolean((user as any)?.admin) || hasRole(user, "superadmin")
```

Because `OwnerScope` bypasses for admins, the "superadmin does not bypass scopes by default"
rule in 4.5 is a rule about *generic* scopes; ownership-style scopes opt into elevation
explicitly through `adminBypass` so no privilege is silently lost during migration.

### 4.6 Field-level views (attribute permissions)

Named projections per resource, chosen by a function of user + doc, applied everywhere a
document is serialized (REST responses, realtime emits, MCP tool output) and validated on write:

```typescript
// api/src/rbac/fieldViews.ts
export interface FieldMask {
  read: string[] | "*"; // dot paths; "*" = all
  write: string[] | "*";
  omit?: string[]; // always stripped even from "*" (hash, salt, ...)
}

export interface ResourceFieldViews<S extends Statements> {
  [resource: string]: {
    views: Record<string, FieldMask>;
    // Pick a view for this user + (maybe) doc. Function escape hatch: return a
    // FieldMask directly for fully dynamic cases.
    //
    // `doc` is OPTIONAL because it is absent at create time (no document exists
    // yet). `phase` tells the selector which enforcement point is calling:
    //   - "read"  : serializing a loaded doc (doc always present)
    //   - "write" : validating an update body against an existing doc (doc present)
    //   - "create": validating a create body — doc is undefined; the selector
    //               must decide from user + permissions alone.
    // Selectors that branch on `doc` fields must handle `doc === undefined` for
    // the create phase (see create-time resolution below).
    select: (args: {
      user?: User;
      doc?: unknown; // undefined during create
      permissions: PermissionSet; // the user's effective set, pre-resolved
      phase: "read" | "write" | "create";
    }) => string | FieldMask | Promise<string | FieldMask>;
  };
}
```

**Create-time view resolution.** Because no document exists yet, create validation resolves the
write mask from the user's permissions only:

- The selector is called with `phase: "create"` and `doc: undefined`. It should return a view
  keyed off `user`/`permissions` (the common case — the `patient` example below already does
  this, since its branches read only `permissions`).
- If a selector *needs* a doc and returns nothing usable when `doc` is undefined, `createAccess`
  requires an explicit `createView?: string | FieldMask` (or `createView: "deny"`) per resource
  as the fallback; omitting it while a selector dereferences `doc` is a boot-time config error,
  not a silent full-access default.
- The chosen mask's `write` paths are the create allow-list; body keys outside it are rejected
  exactly as in update. `read`/`omit` from the same mask then shape the create response.

Consuming-app example (Patient vs Staff vs SuperUser views):

```typescript
fieldViews: {
  patient: {
    views: {
      self: {read: ["name", "email", "appointments", "careTeam"], write: ["name", "email"]},
      staff: {read: "*", write: ["name", "email", "podId", "notes"], omit: ["ssn"]},
      full: {read: "*", write: "*", omit: []},
    },
    select: ({user, doc, permissions}) => {
      if (permissions.patient?.includes("updateClinical")) {
        return "full";
      }
      if (permissions.staff?.includes("read")) {
        return "staff";
      }
      return "self";
    },
  },
},
```

Enforcement points:

- **Read**: `defaultResponseHandler` and `realtimeResponseHandler` call
  `access.fieldMask()` and strip; MCP handlers do the same.
- **Write**: create/update handlers reject (400 with field-level errors) any body key outside
  the mask's `write` — replacing the deprecated `TerrenoTransformer.transform`. Update resolves
  the mask with the loaded doc (`phase: "write"`); create resolves it without a doc
  (`phase: "create"`) per the create-time rule above.
- The OpenAPI spec documents the superset; masks are runtime behavior (same as today's
  responseHandler stripping).

### 4.7 modelRouter integration

New `access` option; `permissions` arrays stay supported (deprecated) for migration:

```typescript
export interface ModelRouterAccessOptions {
  // Must be a key of access.statements
  resource: string;
  // Optional REST-method → action override. Defaults:
  // list → "list" if the resource declares it, else "read"; read → "read";
  // create → "create"; update → "update"; delete → "delete".
  actions?: Partial<Record<RESTMethod, string | null>>; // null disables the method
  // Per-route additions layered on the registry-level config
  scope?: ResourceScope;
  // Per-method function escape hatch, same signature as today's
  // PermissionMethod — ANDed after the RBAC check
  also?: Partial<Record<RESTMethod, PermissionMethod<unknown>[]>>;
  allowAnonymous?: boolean;
}

export interface ModelRouterOptions<T> {
  /** @deprecated use `access` */
  permissions?: RESTPermissions<T>;
  access?: ModelRouterAccessOptions;
  // queryFilter still works and is $and-merged with scope filters
  // ...
}
```

Usage:

```typescript
export const patientRouter = modelRouter("/patients", Patient, {
  access: {
    resource: "patient",
    actions: {delete: null}, // disabled, like today's []
  },
  queryFields: ["_id", "podId", "status"],
  sort: "-created",
});
```

Route behavior (unchanged status semantics): missing role permission pre-object → 405 with the
verb omitted from OpenAPI only when statically disabled (`actions.delete = null`); scope denial
post-object → 403. `instanceActions`/`collectionActions` gain the same
`access?: {resource, action}` option alongside their `permissions` arrays.

For apps not ready to restructure a router, the adapter keeps the old shape working:

```typescript
permissions: {
  create: [IsPermitted(access, {patient: ["create"]})],
  list: [IsPermitted(access, {patient: ["read"]})],
  read: [IsPermitted(access, {patient: ["read"]})],
  update: [IsPermitted(access, {patient: ["update"]}), SomeLegacyCheck],
  delete: [],
},
```

`IsPermitted` returns a standard `PermissionMethod` — it calls `access.can()` with the doc when
present, so it slots into existing arrays and AND-composes with legacy checks.

### 4.8 Custom routes, websockets, MCP

**Custom routes** — one middleware replaces the ad-hoc `adminGuard`s:

```typescript
router.post("/patients/:id/discharge", [
  authenticateMiddleware(),
  access.middleware({patient: ["update"], careplan: ["approve"]}, {
    getDoc: (req) => Patient.findOneOrThrow({_id: req.params.id}), // enables scope checks
  }),
  createOpenApiBuilder(options)./* ... */.build(),
], asyncHandler(async (req, res) => { /* ... */ }));
```

**Websockets** — `RealtimeApp` swaps its internals to the same object:

- `subscribe:model` / `subscribe:query` → `access.can({permissions: {[resource]: [listAction]}})`
  plus `access.queryFilter()` merged into the subscription query.
- Per-event emission (`canReadDocument`) → `access.can({..., doc})`, then
  `access.fieldMask()` before serializing — so a patient and a staff member in the same room
  receive different payloads.
- **Identity**: socket users are currently rebuilt from JWT claims only. Because roles are
  DB-editable, the socket path resolves roles through `access.getPermissions()` (cached,
  invalidated on role edit) rather than trusting `decodedToken.admin`. `generateJWTPayload`
  may still embed `roles` as a hint, but the DB is authoritative.

**MCP** — the planned modelRouter MCP handlers (docs/tasks/model-router-mcp.md) already route
through `checkPermissions()`; they call `access.can()`/`fieldMask()` instead, with
`context: {transport: "mcp"}` so scopes can distinguish transports if needed.

### 4.9 RBAC HTTP surface

Mounted by registering the router (a `TerrenoPlugin`), colocated with the admin basePath:

```typescript
new TerrenoApp({userModel: User, accessControl: access})
  .register(rbacRouter({access, userModel: User}))
  .register(patientRouter)
  .start();
```

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/rbac/statements` | `rbac:read` | Full vocabulary (+ optional `statementDescriptions`) for the admin UI |
| GET | `/rbac/roles` | `rbac:read` | List roles with permissions + user counts |
| POST | `/rbac/roles` | `rbac:manageRoles` | Create role |
| PATCH | `/rbac/roles/:name` | `rbac:manageRoles` | Edit role (validates vocabulary, escalation, locks) |
| DELETE | `/rbac/roles/:name` | `rbac:manageRoles` | Delete (blocked for locked roles / roles in use) |
| POST | `/rbac/roles/:name/preview` | `rbac:manageRoles` | `RoleDiff`: permissions gained/lost + affected user count |
| GET | `/rbac/users/:id/permissions` | `rbac:read` | Effective `PermissionSet` + which role/source grants each |
| PUT | `/rbac/users/:id/roles` | `rbac:assignRoles` | Replace assignments (409 on exclusion conflicts) |
| POST | `/rbac/users/:id/roles/preview` | `rbac:assignRoles` | `UserPermissionDiff` for the confirmation modal |

`GET /auth/me` additionally returns `roles: string[]` and `permissions: PermissionSet` so
clients can gate UI without extra round-trips (server remains authoritative).

### 4.10 External permission sources (Healthie)

Healthie (and future integrations) contribute grants without owning the model:

```typescript
// api/src/rbac/resolve.ts
export interface PermissionSourceGrants {
  roles?: string[]; // must exist in RbacRole
  permissions?: PermissionSet; // direct grants, validated against statements
  deny?: PermissionSet; // hard denials — win over every grant
}

export type StaleOnFailurePolicy =
  | "deny" // default — drop this source's grants on refresh failure (fail closed)
  | "use-stale" // reuse last successful grants (never for elevation-only sources)
  | "use-stale-bounded"; // reuse stale grants only if younger than staleMaxAgeMs

export interface PermissionSource {
  name: string;
  ttlMs?: number; // per-source cache (default: access cacheTtlMs)
  // What to do when getGrants() fails after a prior successful fetch.
  // Default "deny": external grants are omitted; local DB roles still apply.
  // Sources that can elevate beyond local roles must use "deny" or
  // "use-stale-bounded" with a short staleMaxAgeMs — never unbounded stale reuse.
  staleOnFailure?: StaleOnFailurePolicy;
  staleMaxAgeMs?: number; // required when staleOnFailure === "use-stale-bounded"
  getGrants(args: {user: User}): Promise<PermissionSourceGrants | null>;
}
```

Consuming-app sketch:

```typescript
const healthieSource: PermissionSource = {
  name: "healthie",
  ttlMs: 5 * 60_000,
  getGrants: async ({user}) => {
    const staff = await Staff.findOneOrNone({userId: user.id});
    if (!staff?.healthieId) {
      return null;
    }
    const healthieRole = await healthieClient.getProviderRole(staff.healthieId);
    return {roles: [healthieRoleMap[healthieRole] ?? "member"]};
  },
};
```

Resolution order inside `getPermissions()` / `can()`:
`union(user.roles, source roles, source permissions)` minus `source denies`.

**Source refresh failures (fail closed by default).** When `getGrants()` throws or times out,
behavior is per-source `staleOnFailure` (default `"deny"`):

| Policy | Behavior |
|---|---|
| `"deny"` (default) | Omit this source's additive grants (`roles`, `permissions`) for the request. Local `user.roles` and other sources still apply. If a prior fetch cached a `deny` set, keep applying that last-known deny so IdP/ABAC restrictions do not lift while the source is down. Revoked upstream *elevations* cannot linger because a dependency is down. |
| `"use-stale-bounded"` | Reuse the last successful grants only if younger than `staleMaxAgeMs` (hard cap). Suitable for read-only hints, not elevation. |
| `"use-stale"` | Reuse last successful grants until TTL expiry. **Not permitted** for sources that can grant roles/permissions beyond what local roles already provide — elevation paths must fail closed. |

`PermissionSource.deny` fails closed on refresh failure by keeping the last cached deny set (additive grants from that source are still omitted). Grant caching matches that posture for elevation.
Logged at `warn` with source name and policy applied.

### 4.11 Admin UI (first-class)

New screens in `admin-frontend` / `admin-spa`, driven entirely by the 4.9 endpoints:

- **Roles list** (`/admin/roles`): every role, its permission matrix (resources × actions
  grid from `/rbac/statements`), user count, locked/sealed badges.
- **Role editor**: checkbox matrix; on save, shows the `/preview` `RoleDiff` in a confirmation
  modal — "PatientGuide will **gain** `careplan:approve` and **lose** `user:create`; affects
  212 users."
- **User role assignment** (embedded in the admin user detail): multi-select of roles with
  exclusion conflicts surfaced inline; confirmation modal shows `UserPermissionDiff` (total
  permissions gained/lost after union with their remaining roles). The preview endpoint
  requires an actor with `rbac:assignRoles` and rejects roles the actor cannot grant.
- **Effective permissions inspector**: per user, each permission annotated with its source
  ("via PatientGuide", "via healthie").

The admin panel itself migrates from `IsAdmin` to `admin:access` (+ per-model resources), which
finally makes graded admin access possible (the `auditor` role gets `admin:access` + read-only
model permissions).

### 4.12 Client-side helpers

- `@terreno/rtk`: `useSelectPermissions()` / `useCan({patient: ["update"]})` selectors reading
  the `permissions` from `/auth/me`. When the Better Auth provider is active, static roles also
  work with `authClient.admin.checkRolePermission` via the bridge.
- `@terreno/ui`: nothing required; apps gate with `useCan` + existing components.

---

## 5. Migration path

1. **Ship the module inert.** `createAccess` etc. exist; nothing changes unless an app passes
   `access` options. Legacy `Permissions.*` remain exported.
2. **Legacy shims.** `Permissions.IsAdmin` becomes `IsPermitted(access, {admin: ["access"]})`
   semantics when an access registry is configured: seed maps `user.admin === true` →
   `superadmin` role (a one-time backfill script Terreno provides:
   `bunx terreno rbac:backfill-admins --role-map ./rbac-role-map.json`). The map file is
   required when legacy role names do not match Terreno defaults (e.g. Flourish StaffRole →
   RBAC role name); the script dry-runs by default and supports per-tenant overrides.
   `IsOwner`/`OwnerQueryFilter` → `OwnerScope`.
3. **Router-by-router adoption** in consuming apps via `IsPermitted` in existing arrays, then
   the full `access:` option. The `also:` escape hatch and function-based scopes mean any
   existing bespoke check can be ported verbatim as a function first, refined later.
4. **Flip the admin packages** to `admin:access`, ship the roles UI.
5. **Realtime + MCP** switch internally to `access.can()` (no consumer API change).
6. Deprecate `RESTPermissions` arrays in a future major.

## 6. Staff roles — recommendation (open for discussion)

The question posed: single staff role (PG/FG/Therapist/Psychiatrist) vs. rules that disallow
combinations.

**Recommendation: keep StaffRole as consuming-app domain data, and use `excludesRoles` for the
constraint** rather than forcing single-role:

- `excludesRoles` (4.3) gives "cannot be both PG and FG" declaratively, enforced at assignment
  time with a clear 409, and is visible in the admin UI. It generalizes (Supervisor+Auditor
  could also be excluded) without a schema change.
- A hard single-role rule couples Terreno to one org design and dies the first time someone is
  legitimately dual-hatted (Therapist who supervises). Exclusion rules express the actual
  invariant ("these two conflict") instead of a blanket cardinality.
- StaffRole-as-domain-concept (what appears on schedules, care team displays, Healthie sync)
  should *reference* an RBAC role for its permissions but remain a separate model in the
  consuming app — permissions are what the RBAC system owns; job titles are not. The Healthie
  source (4.10) maps Healthie provider types onto RBAC roles the same way.
- The pod-scoped supervisor problem ("Onyx PG Supervisor shouldn't touch Lilac PGs") is
  deliberately **not** a role: it's a scope (4.5) keyed on the supervision relationship, so one
  `supervisor` role works across pods without a role-per-pod explosion.

New scoped roles like "Human Resources" (`staff:create`, `user:create`, no `patient:*`) then
fall out of the admin UI with zero code — the exact win the RBAC move is for.

## 7. Resolved decisions (formerly open questions)

1. **Top role name**: **`superadmin`** (generic machine name; apps customize `displayName`).
2. **Should scopes ever grant?** **No — restrictions only.** Grant cases use extra actions
   (`readClinical`) instead.
3. **Per-permission scope bypass for superadmin**: **Default off**; opt in per scope via
   `adminBypass` (as `OwnerScope` does).
4. **Role assignment audit trail**: **Separate `RbacAudit` collection** from consuming-app
   audit logs (e.g. Flourish `AuditLogEvent`), but **every** successful role/assignment write
   must emit an audit record — built-in and/or pluggable sink; optional/minimal logging is not
   sufficient for HIPAA consumers. Fields: actor, action, target role/user, permission delta,
   timestamp. Denied escalation attempts are logged too (see 4.4).
5. **JWT `roles` claim**: **Hint only** (DB authoritative, cached). Multi-replica cache
   invalidation is part of the IP so `/auth/me` and websockets do not lag role edits across
   Cloud Run instances (see `invalidateCache` in 4.2).
6. **Deny semantics**: **Only `PermissionSource.deny`** — roles do not carry negative
   permissions (union semantics stay simple; matches Better Auth).

## 8. Phasing sketch — shipped

1. **Core** — shipped: statements/merge, `createAccess`, resolve+cache, `RbacRole` model + seeds,
   `rbacUserPlugin`, `IsPermitted`, `requireAccess` middleware. Tests.
2. **modelRouter** — shipped: `access` option, scope-aware permission middleware, filter merging,
   field-mask response handling, actions support.
3. **HTTP surface** — shipped: `rbacRouter`, previews, `/auth/me` extension, backfill script.
4. **Admin** — shipped: roles screens, diffs, user assignment, `admin:access` migration.
5. **Realtime + MCP** — shipped: internals use `access.can()`/`fieldMask()`.
6. **Sources + client** — shipped: `PermissionSource`, rtk selectors, Better Auth bridge,
   example-backend/-frontend `manager` role and scoped todo example.
