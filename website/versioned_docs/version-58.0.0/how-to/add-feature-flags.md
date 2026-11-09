# Add Feature Flags

Add feature flags and A/B testing to your Terreno app using `@terreno/feature-flags`.

## Prerequisites

- A working Terreno backend using `TerrenoApp`
- `@terreno/admin-backend` registered for the admin panel (optional but recommended)

## Steps

### 1. Install the package

```bash
bun add @terreno/feature-flags
```

### 2. Register the backend plugin

In your server file, register `FeatureFlagsApp` and add the admin config:

```typescript
import {TerrenoApp} from "@terreno/api";
import {AdminApp} from "@terreno/admin-backend";
import {FeatureFlagsApp, featureFlagAdminConfig} from "@terreno/feature-flags";

// Define segment functions to classify users for targeting rules
const segments = {
  "pro-users": (user) => user.plan === "pro",
  "beta-testers": (user) => user.betaTester === true,
  "internal-team": (user) => user.email?.endsWith("@mycompany.com"),
};

new TerrenoApp({userModel: User})
  .register(new FeatureFlagsApp({segments}))
  .register(
    new AdminApp({
      models: [
        featureFlagAdminConfig,  // adds Feature Flags to the admin panel
        // ...your other models
      ],
    })
  )
  .start();
```

`featureFlagAdminConfig` is a pre-configured admin model config exported by the package. It sets up the display name, list fields, route path, and model reference so you don't need to configure them manually.

### 3. Regenerate the frontend SDK

After adding the backend routes, regenerate the SDK so the frontend can call the new endpoints (with the example backend running, or set `OPENAPI_URL` to your deployed `openapi.json`):

```bash
cd your-frontend && bun run sdk
```

Regeneration may emit a hook for `/feature-flags/flagConfiguration`; prefer **`useTerrenoFeatureFlags`** / **`useFeatureFlags`** from `@terreno/syncdb/flags` so the OpenFeature domain, per-user refetch, and socket refresh stay consistent.

### 4. Use feature flags in the frontend

Add `@openfeature/web-sdk` and `@openfeature/react-sdk` to the app (`catalog:` versions). Both
hooks come from `@terreno/syncdb/flags`, fetch through the request client from
`ApiClientProvider`, and refetch when the server pushes `featureFlagsChanged` on the syncdb
socket.

**Recommended (OpenFeature):** wrap the tree that reads flags in
`<OpenFeatureProvider domain="feature-flags">` and call `useTerrenoFeatureFlags` once after
auth. Pass your `syncDb` as `socket` when this component sits above `SyncDbProvider`. Then read
values with `useBooleanFlagValue` / `useStringFlagValue` / `FeatureFlag`.

```typescript
import {OpenFeatureProvider} from "@openfeature/react-sdk";
import {useTerrenoFeatureFlags} from "@terreno/syncdb/flags";
import {syncDb} from "@/store/syncdb";

const FlagsBridge: React.FC<{children: React.ReactNode; userId?: string}> = ({
  children,
  userId,
}) => {
  useTerrenoFeatureFlags({skip: !userId, socket: syncDb, userId});
  return <OpenFeatureProvider domain="feature-flags">{children}</OpenFeatureProvider>;
};
```

```typescript
import {useBooleanFlagValue} from "@openfeature/react-sdk";

const GatedBanner: React.FC = () => {
  const showBanner = useBooleanFlagValue("new-ui", false);
  return showBanner ? <NewUI /> : null;
};
```

**Flat accessors:** `useFeatureFlags` returns `{flags, getFlag, getVariant, isLoading, error,
refetch}`. Screens below the bridge can pass `socket: null` — they share the bridge's cached
query, so its refetch updates them too.

```typescript
import {useFeatureFlags} from "@terreno/syncdb/flags";

const LegacyStyle: React.FC<{userId?: string}> = ({userId}) => {
  const {getFlag, isLoading} = useFeatureFlags({skip: !userId, socket: null, userId});

  if (isLoading) {
    return <Spinner />;
  }

  return getFlag("new-ui") ? <NewUI /> : <OldUI />;
};
```

### 4b. Live updates (optional)

To push flag changes to open clients without a refresh, pass **`liveUpdates`** when constructing `FeatureFlagsApp` (see `example-backend/src/server.ts`): Mongoose **`FeatureFlag.watch()`** drives a Socket.io broadcast. Point `socketIoServer` at `() => realtimeApp.getIo()` so the push goes out on the socket the syncdb client already holds. **MongoDB must run as a replica set** (a single-node replica set is enough); standalone instances cannot use change streams, and the plugin logs a warning if `watch()` fails.

On the client there is nothing extra to wire: `useTerrenoFeatureFlags` listens for `featureFlagsChanged` (or `socketEventName`) through `syncDb.onSocketEvent` and refetches `/flagConfiguration`. The app opens no second socket. The event payload is only `{ key: string }` — the same flag keys are already returned to every authenticated user in `/flagConfiguration`, so this is not considered a new exposure.

### 5. Create flags via the admin panel

Navigate to the admin panel in your app. The "Feature Flags" card appears automatically. Create a flag with:

- **Key**: unique identifier, e.g. `new-ui`
- **Name**: human-readable label
- **Type**: `boolean` for on/off toggles, `variant` for A/B tests
- **Enabled**: global kill switch
- **Rules**: optional targeting (field-based or segment-based)
- **Rollout Percentage**: gradual rollout for boolean flags (default 100%)

## Migrating from `GET …/evaluate` (OpenFeature)

Terreno's feature-flag stack uses **OpenFeature** (`@terreno/feature-flags` on the server, `@terreno/syncdb/flags` on the client). Use this checklist if you upgrade from a Terreno release that only documented `GET …/evaluate`.

### Backend (`@terreno/feature-flags`)

1. Keep **`FeatureFlagsApp`** registered as before; admin CRUD is unchanged.
2. Prefer authenticated clients calling **`GET {basePath}/flagConfiguration`** — the JSON body matches OpenFeature's static configuration shape (for `TypedInMemoryProvider` on the client).
3. **`GET {basePath}/evaluate`** still returns the legacy `Record<key, boolean | string | null>` map but is **deprecated** (`Deprecation: true`, `Sunset` header). Migrate direct HTTP or hand-written clients to `/flagConfiguration`, or rely on the `@terreno/syncdb/flags` hooks below.
4. **`FeatureFlag`** documents gain optional **`defaultVariant`** (boolean: `"on"` / `"off"`; variant: a key from `variants`). Omitted values are filled on save. For existing databases, run a one-off backfill or reuse the pattern in `example-backend/src/scripts/seed-feature-flags.ts`.
5. **Live updates (optional):** pass `liveUpdates: { socketIoServer: io | () => io }` to `FeatureFlagsApp`. MongoDB must run as a **replica set** (a single-node replica set is enough) so Mongoose change streams work.

### Frontend (`@terreno/syncdb/flags` + OpenFeature)

1. Replace the Terreno 57 `useFeatureFlags(terrenoApi, options)` with
   `useFeatureFlags(options)` from `@terreno/syncdb/flags`. The result shape is unchanged:
   `{flags, getFlag, getVariant, isLoading, error, refetch}`. The legacy string `basePath`
   argument is gone; pass `{basePath}`.
2. Replace `useTerrenoFeatureFlags(terrenoApi, {socket, ...})` with
   `useTerrenoFeatureFlags({socket: syncDb, ...})`. `socket` is now your `SyncDb` client, not a
   Socket.io client, and defaults to the `SyncDbProvider` client.
3. Drop `useSocketConnection` and `useRealtimeDebug`. Listen for other server events with
   `useSocketEvent` from `@terreno/syncdb/react` (see
   [WebSocket integration](./websocket-integration.md)).
4. Keep `@openfeature/web-sdk` and `@openfeature/react-sdk` in the app (`catalog:` versions) and
   wrap the UI that reads flags in `<OpenFeatureProvider domain="feature-flags">`.
5. Mount the hooks under `ApiClientProvider`, or pass `client`.

### Further reading

- [Feature flags reference](../reference/feature-flags.md)
- [OpenFeature implementation plan](../implementationPlans/feature-flags-openfeature.md)

## Next steps

- See the [reference docs](../reference/feature-flags.md) for the full API, targeting rules, and variant flags
- See `example-backend/src/server.ts` for a complete working example
