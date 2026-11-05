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

Regeneration may emit a hook for `/feature-flags/flagConfiguration`; prefer **`useTerrenoFeatureFlags`** / **`useFeatureFlags`** from `@terreno/rtk` so OpenFeature domain, cache keying, and optional socket refetch stay consistent.

### 4. Use feature flags in the frontend

**Recommended (OpenFeature):** add `@openfeature/react-sdk` to the app, wrap the tree (or the subtree that reads flags) in `<OpenFeatureProvider domain="feature-flags">`, and call `useTerrenoFeatureFlags(terrenoApi, {userId, socket})` once after auth so the OpenFeature client receives `GET /feature-flags/flagConfiguration`. Then use standard hooks such as `useBooleanFlagValue` / `useStringFlagValue` / `FeatureFlag`.

**Back-compat:** `useFeatureFlags(terrenoApi)` from `@terreno/rtk` still returns `{flags, getFlag, getVariant, isLoading, …}` with the same semantics as before; it uses `/flagConfiguration` under the hood. You do not need to call a generated RTK hook for `/flagConfiguration` directly.

```typescript
import {useBooleanFlagValue} from "@openfeature/react-sdk";
import {useTerrenoFeatureFlags, useSelectCurrentUserId} from "@terreno/rtk";
import {terrenoApi} from "@/store/sdk";

const GatedBanner: React.FC = () => {
  const userId = useSelectCurrentUserId();
  useTerrenoFeatureFlags(terrenoApi, {userId, skip: !userId});
  const showBanner = useBooleanFlagValue("new-ui", false);
  return showBanner ? <NewUI /> : null;
};
```

```typescript
import {useFeatureFlags} from "@terreno/rtk";
import {terrenoApi} from "@/store/sdk";

const LegacyStyle: React.FC = () => {
  const {getFlag, isLoading} = useFeatureFlags(terrenoApi);

  if (isLoading) {
    return <Spinner />;
  }

  const showNewUI = getFlag("new-ui");

  return showNewUI ? <NewUI /> : <OldUI />;
};
```

### 4b. Live updates (optional)

To push flag changes to open clients without a refresh, pass **`liveUpdates`** when constructing `FeatureFlagsApp` (see `example-backend/src/server.ts`): Mongoose **`FeatureFlag.watch()`** drives a Socket.io broadcast. **MongoDB must run as a replica set** (a single-node replica set is enough); standalone instances cannot use change streams, and the plugin logs a warning if `watch()` fails.

On the client, pass the same Socket.io **client** into `useTerrenoFeatureFlags` / `useFeatureFlags` as `socket`; the hook listens for `featureFlagsChanged` (or `socketEventName`) and refetches `/flagConfiguration`. The event payload is only `{ key: string }` — the same flag keys are already returned to every authenticated user in `/flagConfiguration`, so this is not considered a new exposure.

### 5. Create flags via the admin panel

Navigate to the admin panel in your app. The "Feature Flags" card appears automatically. Create a flag with:

- **Key**: unique identifier, e.g. `new-ui`
- **Name**: human-readable label
- **Type**: `boolean` for on/off toggles, `variant` for A/B tests
- **Enabled**: global kill switch
- **Rules**: optional targeting (field-based or segment-based)
- **Rollout Percentage**: gradual rollout for boolean flags (default 100%)

## Migrating from `GET …/evaluate` (OpenFeature)

Terreno's feature-flag stack uses **OpenFeature** (`@terreno/feature-flags` on the server, `@terreno/rtk` on the client). Use this checklist if you upgrade from a Terreno release that only documented `GET …/evaluate`.

### Backend (`@terreno/feature-flags`)

1. Keep **`FeatureFlagsApp`** registered as before; admin CRUD is unchanged.
2. Prefer authenticated clients calling **`GET {basePath}/flagConfiguration`** — the JSON body matches OpenFeature's static configuration shape (for `TypedInMemoryProvider` on the client).
3. **`GET {basePath}/evaluate`** still returns the legacy `Record<key, boolean | string | null>` map but is **deprecated** (`Deprecation: true`, `Sunset` header). Migrate direct HTTP or hand-written clients to `/flagConfiguration`, or rely on `@terreno/rtk` hooks below.
4. **`FeatureFlag`** documents gain optional **`defaultVariant`** (boolean: `"on"` / `"off"`; variant: a key from `variants`). Omitted values are filled on save. For existing databases, run a one-off backfill or reuse the pattern in `example-backend/src/scripts/seed-feature-flags.ts`.
5. **Live updates (optional):** pass `liveUpdates: { socketIoServer: io | () => io }` to `FeatureFlagsApp`. MongoDB must run as a **replica set** (a single-node replica set is enough) so Mongoose change streams work.

### Frontend (`@terreno/rtk` + OpenFeature)

1. **`useFeatureFlags(terrenoApi, …)`** — no code changes required for the common case; it already uses `/flagConfiguration` and keeps `{ flags, getFlag, getVariant, isLoading, refetch }`.
2. **OpenFeature React hooks** (`useBooleanFlagValue`, `useStringFlagValue`, `<FeatureFlag>`, …): add **`@openfeature/react-sdk`** and **`@openfeature/web-sdk`** to your app (align versions with `@terreno/rtk` **peerDependencies** and the root **`catalog`**).
3. Wrap the UI that reads flags in **`<OpenFeatureProvider domain="feature-flags">`** (or the same `domain` you pass into the hook).
4. After auth, call **`useTerrenoFeatureFlags(terrenoApi, { userId, skip, socket, … })`** once under your Redux `Provider` so OpenFeature is populated before hooks read flag values.
5. **Regenerate the OpenAPI SDK** after the backend exposes the new route: `cd your-frontend && bun run sdk`. Prefer **`useTerrenoFeatureFlags` / `useFeatureFlags`** over calling a generated `flagConfiguration` hook directly, so domain, cache keys, and optional socket refetch stay consistent.

### Further reading

- [Feature flags reference](../reference/feature-flags.md)
- [OpenFeature implementation plan](../implementationPlans/feature-flags-openfeature.md)

## Next steps

- See the [reference docs](../reference/feature-flags.md) for the full API, targeting rules, and variant flags
- See `example-backend/src/server.ts` for a complete working example
