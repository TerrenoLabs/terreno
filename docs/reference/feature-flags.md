# @terreno/feature-flags

Feature flags and A/B testing plugin for `@terreno/api`. Provides a Mongoose model, admin CRUD endpoints, user-facing evaluation, and deterministic hashing for gradual rollouts and variant assignment.

## Install

```bash
bun add @terreno/feature-flags
```

Peer dependency: `mongoose >= 8.0.0`.

## Quick Start

### Backend

Register `FeatureFlagsApp` as a `TerrenoPlugin` and add the pre-configured admin model config to your `AdminApp`:

```typescript
import {TerrenoApp} from "@terreno/api";
import {AdminApp} from "@terreno/admin-backend";
import {FeatureFlagsApp, featureFlagAdminConfig} from "@terreno/feature-flags";
import {User} from "./models/user";

const segments = {
  "pro-users": (user) => user.plan === "pro",
  "beta-testers": (user) => user.betaTester === true,
};

new TerrenoApp({userModel: User})
  .register(new FeatureFlagsApp({segments}))
  .register(
    new AdminApp({
      models: [featureFlagAdminConfig],
    })
  )
  .start();
```

`featureFlagAdminConfig` is a ready-to-use admin model config that sets up the display name, list fields, route path, and model reference — no manual configuration needed. Downstream consumers can import it directly and pass it to `AdminApp`.

### Frontend

Use `useFeatureFlags` from `@terreno/syncdb/flags` to read flags for the current user. It
loads `GET {basePath}/flagConfiguration` with the syncdb request client (the one from
`ApiClientProvider`) and refetches when the server pushes `featureFlagsChanged` on the
syncdb socket:

```typescript
import {useFeatureFlags} from "@terreno/syncdb/flags";

const MyComponent: React.FC<{userId?: string}> = ({userId}) => {
  const {getFlag, getVariant, isLoading} = useFeatureFlags({skip: !userId, userId});

  if (isLoading) return <Spinner />;

  const showNewFeature = getFlag("new-feature"); // boolean
  const variant = getVariant("checkout-experiment"); // string | null

  return showNewFeature ? <NewFeature /> : <OldFeature />;
};
```

New code can also use OpenFeature React hooks (`useBooleanFlagValue`, `useStringFlagValue`, `FeatureFlag`, …) after wiring `useTerrenoFeatureFlags` and `<OpenFeatureProvider domain="feature-flags">` — see [how-to: add feature flags](../how-to/add-feature-flags.md).

#### `@terreno/syncdb/flags`

| Export | Description |
|--------|-------------|
| `useTerrenoFeatureFlags(options?)` | Loads `/flagConfiguration` into OpenFeature's `TypedInMemoryProvider` for `domain`; returns `{client, flags, isLoading, error, refetch}` |
| `useFeatureFlags(options?)` | Flat accessors over `useTerrenoFeatureFlags`: `{flags, getFlag, getVariant, isLoading, error, refetch}` |
| `TerrenoFlagConfiguration`, `TerrenoFlagDefinition` | Wire shape of `/flagConfiguration` |
| `DEFAULT_FEATURE_FLAGS_BASE_PATH`, `DEFAULT_FEATURE_FLAGS_DOMAIN`, `DEFAULT_FEATURE_FLAGS_EVENT` | `"/feature-flags"`, `"feature-flags"`, `"featureFlagsChanged"` |

Options (both hooks):

| Option | Default | Description |
|--------|---------|-------------|
| `userId` | `null` | Current user. A change refetches and sets the OpenFeature `targetingKey` |
| `skip` | `false` | Do not fetch or listen (for example while signed out) |
| `client` | `ApiClientProvider` client | Request client from `@terreno/syncdb/api` |
| `socket` | `SyncDbProvider` client | Anything with `onSocketEvent` (a `SyncDb`). Pass your `syncDb` when the hook sits above `SyncDbProvider`; `null` turns live refresh off |
| `socketEventName` | `"featureFlagsChanged"` | Push event that triggers a refetch |
| `basePath` | `"/feature-flags"` | `FeatureFlagsApp` `basePath` |
| `domain` | `"feature-flags"` | OpenFeature domain; must match `<OpenFeatureProvider domain>` |

`isLoading` is `true` until the first response is installed in OpenFeature and again while a
refetch is in flight; it is `false` when skipped or after an error. Every hook reading the same
`basePath` shares one cache entry, so a single instance that listens to the socket (usually the
root `OpenFeatureProvider` bridge) is enough; other screens can pass `socket: null`. The last
unmounted `useTerrenoFeatureFlags` for a domain restores OpenFeature's NOOP provider.

`@openfeature/web-sdk` (and `@openfeature/react-sdk` for the React hooks) are optional peer
dependencies of `@terreno/syncdb`; add them to apps that import `@terreno/syncdb/flags`.

## OpenFeature integration

`FeatureFlagsApp` registers an OpenFeature **server** provider (`MongoFeatureFlagProvider`) on a dedicated domain (default `"feature-flags"`) so the global default provider is unchanged. The authenticated bulk endpoint **`GET {basePath}/flagConfiguration`** returns a `FlagConfiguration`-compatible map (suitable for `TypedInMemoryProvider` on the client). Disabled **boolean** flags are included and resolve to `off`, so a client can tell a turned-off flag from one that was never created. Disabled variant flags and archived flags are omitted. The legacy **`GET {basePath}/evaluate`** response shape is unchanged but is **deprecated**: responses include `Deprecation: true` and a `Sunset` HTTP-date header (~90 days). Prefer `useTerrenoFeatureFlags` / `useFeatureFlags` from `@terreno/syncdb/flags`, or migrate direct HTTP callers to `/flagConfiguration`. The server logs this advice once per process on the first `/evaluate` call.

### `defaultVariant` on `FeatureFlag`

Stored OpenFeature default variant key: for boolean flags `"on"` or `"off"`; for variant flags one of `variants[].key`. On save, if omitted, the schema sets boolean → `"off"` and variant → first variant key. `/flagConfiguration` builds each entry’s `defaultVariant` and `variants` from the **resolved** value for the current user (so client-side OpenFeature reads the correct branch without re-running targeting).

### `MongoFeatureFlagProvider`

Server-side OpenFeature `Provider` that resolves flags via `findOneOrNone` and existing `evaluateFlag()` logic. Unsupported evaluation types: **`resolveNumberEvaluation` / `resolveObjectEvaluation` always return `FLAG_NOT_FOUND`** with the caller’s default.

### Type-safe flag keys (optional)

Consumers may augment `@openfeature/core` with `BooleanFlagKey` / `StringFlagKey` unions. Those types are **compile-time hints only**; keys created in the admin UI can drift until types are updated.

### Live updates (optional)

Pass `liveUpdates: { socketIoServer: io | () => io }` to broadcast on Mongoose change streams. **Requires MongoDB as a replica set** (single-node replset is fine). Emits a socket event (default `featureFlagsChanged`, payload `{ key }`) and `PROVIDER_CONFIGURATION_CHANGED` on the server provider. All authenticated subscribers receive the same event name; payload is only the flag key (same keys are already exposed per user via `/flagConfiguration`).

Emit on the Socket.io server that hosts the syncdb socket — `RealtimeApp.getIo()` — so clients
receive the push on the one socket they already hold:

```typescript
const realtimeApp = new RealtimeApp({/* ... */});
app.register(realtimeApp);
app.register(new FeatureFlagsApp({liveUpdates: {socketIoServer: () => realtimeApp.getIo()}}));
```

## Exports

### Classes

| Export | Description |
|--------|-------------|
| `FeatureFlagsApp` | `TerrenoPlugin` that registers admin CRUD, `/flagConfiguration`, and `/evaluate` |
| `MongoFeatureFlagProvider` | OpenFeature server `Provider` backed by Mongo evaluation |

### Models

| Export | Description |
|--------|-------------|
| `FeatureFlag` | Mongoose model for feature flag documents |

### Constants

| Export | Description |
|--------|-------------|
| `featureFlagAdminConfig` | Pre-configured `AdminModelConfig` for use with `AdminApp` |

### Functions

| Export | Description |
|--------|-------------|
| `buildFlagDefinition` | Build one `FlagDefinition` for `/flagConfiguration` |
| `effectiveDefaultVariantForFlag` | Resolve `defaultVariant` including legacy docs |
| `evaluateFlag` | Evaluate a single flag for a user |
| `evaluateAllFlags` | Evaluate all enabled, non-archived flags for a user |
| `deterministicHash` | Hash a string to 0–99 for consistent assignment |

### Types

| Export | Description |
|--------|-------------|
| `FeatureFlagDocument` | Mongoose document type for a feature flag |
| `FeatureFlagModel` | Mongoose model type with custom statics |
| `FeatureFlagRule` | Targeting rule shape (field-based or segment-based) |
| `FeatureFlagVariant` | Variant key + weight for A/B tests |
| `FeatureFlagType` | `"boolean" \| "variant"` |
| `FeatureFlagsOptions` | Constructor options for `FeatureFlagsApp` |
| `SegmentFunction` | `(user: unknown) => boolean` |
| `EvaluationResult` | `Record<string, boolean \| string \| null>` |
| `FlagDefinition` | One flag entry for `/flagConfiguration` |
| `FlagConfigurationResponse` | `{ data: Record<string, FlagDefinition> }` |
| `FeatureFlagsLiveUpdatesOptions` | Socket.io + optional custom event name |
| `FeatureFlagsSocketEmitter` | Minimal `emit` shape for live updates |

## FeatureFlagsApp Options

```typescript
interface FeatureFlagsOptions {
  basePath?: string;                                // Default: "/feature-flags"
  segments?: Record<string, SegmentFunction>;       // Named segment functions
  permissions?: ModelRouterOptions["permissions"];   // Override default IsAdmin on CRUD
  segmentsPermission?: (user: unknown) => boolean;  // Override admin check on /segments
  liveUpdates?: FeatureFlagsLiveUpdatesOptions;     // Optional: change stream → socket.io
  openFeatureDomain?: string;                       // Default: "feature-flags"
}
```

## Generated Routes

All routes are mounted under the configured `basePath` (default: `/feature-flags`).

### Admin Routes (default: `IsAdmin`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `{basePath}/flags/` | Create a feature flag |
| `GET` | `{basePath}/flags/` | List flags (paginated, sortable) |
| `GET` | `{basePath}/flags/:id` | Get a single flag |
| `PATCH` | `{basePath}/flags/:id` | Update a flag |
| `DELETE` | `{basePath}/flags/:id` | Soft-delete a flag |
| `GET` | `{basePath}/segments` | List registered segment names |

### User Routes (`IsAuthenticated`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `{basePath}/flagConfiguration` | OpenFeature static configuration for enabled, non-archived flags (authenticated) |
| `GET` | `{basePath}/evaluate` | **Deprecated** — legacy `Record<key, boolean \| string \| null>` for the current user |

### Response Shapes

**`GET /feature-flags/flagConfiguration`** (enabled flags only; disabled/archived keys are omitted):

```json
{
  "data": {
    "todo-summary-card": {
      "variants": {"off": false, "on": true},
      "defaultVariant": "on",
      "disabled": false
    },
    "profile-layout": {
      "variants": {"compact": "compact", "detailed": "detailed"},
      "defaultVariant": "compact",
      "disabled": false
    }
  }
}
```

**`GET /feature-flags/evaluate`** (deprecated headers on response):

```json
{
  "data": {
    "new-checkout-flow": true,
    "checkout-experiment": "variant-a",
    "dark-mode": false
  }
}
```

**`GET /feature-flags/segments`**:
```json
{
  "data": ["pro-users", "beta-testers"]
}
```

## Flag Types

### Boolean Flags (`type: "boolean"`)

Return `true` or `false`. Use `rolloutPercentage` for gradual rollouts.

- `enabled: false` → always `false`
- `enabled: true`, no matching rules → deterministic hash compared against `rolloutPercentage`
- Matching rule → returns the rule's `enabled` value

### Variant Flags (`type: "variant"`)

Return a string variant key. Use the `variants` array with weighted distribution.

- `enabled: false` → returns `null`
- `enabled: true`, no matching rules → deterministic hash mapped to variant by cumulative weights
- Matching rule → returns the rule's `variant` value

## Targeting Rules

Rules are evaluated in order — first match wins. Each rule is either field-based or segment-based.

### Field Rules

Match against a user field with an operator:

```json
{
  "field": "email",
  "operator": "contains",
  "value": "@mycompany.com",
  "enabled": true
}
```

Supported operators: `eq`, `neq`, `in`, `nin`, `gt`, `lt`, `contains`. Dot notation is supported for nested fields (e.g. `address.zip`).

### Segment Rules

Match against a named segment function registered at startup:

```json
{
  "segment": "pro-users",
  "enabled": true
}
```

## Admin Integration

The `featureFlagAdminConfig` export provides everything `AdminApp` needs:

```typescript
import {featureFlagAdminConfig} from "@terreno/feature-flags";

// Use directly in AdminApp
new AdminApp({
  models: [featureFlagAdminConfig, ...otherModels],
});
```

This is equivalent to manually configuring:

```typescript
import {FeatureFlag} from "@terreno/feature-flags";

{
  displayName: "Feature Flags",
  listFields: ["key", "name", "type", "enabled", "archived", "defaultVariant", "created"],
  model: FeatureFlag,
  routePath: "/feature-flags",
}
```

The admin panel auto-generates forms from the FeatureFlag model schema, including fields for rules, variants, rollout percentage, and archiving.

## Segments

Segments are named functions that classify users. Register them when constructing `FeatureFlagsApp`:

```typescript
const segments = {
  "admin-users": (user) => user.admin === true,
  "oauth-users": (user) => Boolean(user.oauthProvider),
  "high-usage": (user) => user.totalActions > 1000,
  "internal-team": (user) => user.email?.endsWith("@mycompany.com"),
};

new FeatureFlagsApp({segments});
```

Segment names can be referenced in flag rules via the admin UI.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `FEATURE_FLAGS_DEBUG` | Set to `"false"` to disable evaluation debug logs | Enabled |
