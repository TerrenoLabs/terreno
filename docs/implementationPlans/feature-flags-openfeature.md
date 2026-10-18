# Implementation Plan: OpenFeature Adoption for `@terreno/feature-flags`

**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1082  
**Status:** Complete

## Goal

Migrate `@terreno/feature-flags` (backend) and `@terreno/rtk`'s `useFeatureFlags` (frontend) to be built on top of the OpenFeature SDKs (`@openfeature/server-sdk`, `@openfeature/react-sdk`) while preserving:
- The Mongoose-backed `FeatureFlag` model as source of truth (no data migration)
- The current admin UI via `@terreno/admin-backend`
- Backwards-compatible `useFeatureFlags()` API for downstream consumers
- The single-bulk-fetch network shape (no per-flag round trips)

And add:
- A swappable, OpenFeature-standard provider abstraction on the backend (`MongoFeatureFlagProvider`)
- Standard OpenFeature React hooks (`useBooleanFlagValue`, `useStringFlagValue`, `<FeatureFlag>`, etc.) available to consumers
- Live updates via Mongoose change streams + Socket.io + OpenFeature `PROVIDER_CONFIGURATION_CHANGED` events
- Type-safe flag keys via OpenFeature's module augmentation pattern

## Non-goals

- Replacing Mongo storage with flagd or a third-party flag service
- Dropping the existing admin panel UX
- Adding analytics or experiment-results tracking (out of scope; the OF tracking hook is available to consumers but not wired up here)
- Allowing anonymous evaluation (stays `IsAuthenticated`)

---

## Models

### `FeatureFlag` (extended, no migration)

**File**: `feature-flags/src/featureFlagModel.ts`

One new field on the existing schema:

```typescript
defaultVariant: {
  type: String,
  description:
    "OpenFeature defaultVariant key. Returned when the flag is disabled or " +
    "errors during evaluation. For boolean flags, must be 'on' or 'off'. " +
    "For variant flags, must be one of the keys in `variants`. " +
    "Auto-populated by pre-save hook for legacy docs (boolean → 'off', variant → first variant key).",
},
```

**No Mongoose getter** — we use a `pre("save")` hook that sets `defaultVariant` when it is `undefined`, plus a normalization step in the `/flagConfiguration` build path that supplies the default at read time without mutating the doc. This avoids getter re-entrancy on `this.type` / `this.variants`.

Validation (in the existing `pre("save")` hook):
- If `defaultVariant` is set: for boolean flags it must be `"on"` or `"off"`; for variant flags it must be one of `variants[].key`. Validation is **only enforced when the field is set** — legacy docs without `defaultVariant` are not rejected; the hook populates the default before the validate step.
- Tested explicitly in `featureFlagModel.test.ts` with both legacy-doc-update and new-doc-create paths.

Also update `featureFlagAdminConfig.listFields` to include `"defaultVariant"` so admins see and can edit it.

### `FlagConfiguration` (wire shape, not a Mongoose model)

The response shape returned by the new `/feature-flags/flagConfiguration` endpoint. One entry per evaluated flag:

```typescript
interface FlagDefinition {
  variants: Record<string, boolean | string>;  // {on: true, off: false} or {compact: "compact", detailed: "detailed"}
  disabled: boolean;                            // per-user resolved disabled state
  defaultVariant: string;
}

interface FlagConfigurationResponse {
  data: Record<string, FlagDefinition>;
}
```

This exactly matches OpenFeature's `TypedInMemoryProvider` input shape, so the frontend pipes it straight in.

---

## APIs

### Backend: `MongoFeatureFlagProvider`

**File**: `feature-flags/src/openFeatureProvider.ts` (new)

A custom OpenFeature server-side provider that delegates to the existing `evaluateFlag()` logic.

```typescript
import {
  type EvaluationContext,
  type JsonValue,
  OpenFeatureEventEmitter,
  type Provider,
  type ResolutionDetails,
} from "@openfeature/server-sdk";
import type {Model} from "mongoose";
import {evaluateFlag} from "./evaluate";
import type {FeatureFlagDocument, SegmentFunction} from "./types";

interface MongoFeatureFlagProviderOptions {
  flagModel: Model<FeatureFlagDocument>;
  segments?: Record<string, SegmentFunction>;
}

export class MongoFeatureFlagProvider implements Provider {
  readonly metadata = {name: "MongoFeatureFlagProvider"} as const;
  readonly runsOn = "server" as const;
  readonly events = new OpenFeatureEventEmitter();

  private flagModel: Model<FeatureFlagDocument>;
  private segments: Record<string, SegmentFunction>;

  constructor(options: MongoFeatureFlagProviderOptions) {
    this.flagModel = options.flagModel;
    this.segments = options.segments ?? {};
  }

  async resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext
  ): Promise<ResolutionDetails<boolean>> {
    return this.resolve<boolean>(flagKey, defaultValue, context, "boolean");
  }

  async resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext
  ): Promise<ResolutionDetails<string>> {
    return this.resolve<string>(flagKey, defaultValue, context, "variant");
  }

  async resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number
  ): Promise<ResolutionDetails<number>> {
    // Not supported in v1 — return default with FLAG_NOT_FOUND
    return {value: defaultValue, reason: "ERROR", errorCode: "FLAG_NOT_FOUND" as const};
  }

  async resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T
  ): Promise<ResolutionDetails<T>> {
    return {value: defaultValue, reason: "ERROR", errorCode: "FLAG_NOT_FOUND" as const};
  }

  private async resolve<T extends boolean | string>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
    expectedType: "boolean" | "variant"
  ): Promise<ResolutionDetails<T>> {
    // Use findOneOrNone per repo rule (never Model.findOne); the FeatureFlag schema has the plugin.
    const flag = await this.flagModel.findOneOrNone({key: flagKey, archived: {$ne: true}});
    if (!flag) {
      return {value: defaultValue, reason: "ERROR", errorCode: "FLAG_NOT_FOUND" as const};
    }
    if (flag.type !== expectedType) {
      return {value: defaultValue, reason: "ERROR", errorCode: "TYPE_MISMATCH" as const};
    }
    if (!flag.enabled) {
      return {value: defaultValue, reason: "DISABLED", variant: flag.defaultVariant};
    }
    const targetingKey = context.targetingKey ?? "";
    const user = context.user ?? context;  // accept either {targetingKey, user: {...}} or flat
    const result = evaluateFlag(flag, targetingKey, user, this.segments);
    if (expectedType === "boolean") {
      const value = (result as boolean) as T;
      return {value, reason: "TARGETING_MATCH", variant: value ? "on" : "off"};
    }
    if (result === null) {
      return {value: defaultValue, reason: "DISABLED", variant: flag.defaultVariant};
    }
    return {value: result as T, reason: "TARGETING_MATCH", variant: result as string};
  }

  /** Called by the live-updates hook when a flag doc changes. */
  emitConfigurationChanged(): void {
    this.events.emit("PROVIDER_CONFIGURATION_CHANGED");
  }
}
```

The existing `evaluate.ts` is unchanged. The provider is a thin adapter.

### Backend: `FeatureFlagsApp` (updated)

**File**: `feature-flags/src/featureFlagsApp.ts` (updated)

New responsibilities:
1. Construct `MongoFeatureFlagProvider` and call `OpenFeature.setProvider(provider, "feature-flags")` (using a domain so we don't stomp on consumer providers).
2. Register a new `GET /feature-flags/flagConfiguration` endpoint that returns the `FlagConfiguration` shape.
3. Keep the existing `GET /feature-flags/evaluate` endpoint working for one release with a deprecation warning header (`Deprecation: true`, `Sunset: <date>`).
4. Keep admin CRUD via `modelRouter` (unchanged).
5. If `liveUpdates.socketIoServer` is provided in options, start a Mongoose change stream on the FeatureFlag collection and emit a `featureFlagsChanged` socket event to all connected clients, plus call `provider.emitConfigurationChanged()`.

Updated options:

```typescript
interface FeatureFlagsOptions {
  basePath?: string;
  segments?: Record<string, SegmentFunction>;
  permissions?: ModelRouterOptions<FeatureFlagDocument>["permissions"];
  segmentsPermission?: (user: unknown) => boolean;
  /** Optional Socket.io Server instance for live updates. */
  liveUpdates?: {
    socketIoServer: SocketIOServer;
    /** Custom event name. Default: "featureFlagsChanged". */
    eventName?: string;
  };
  /** Optional. Defaults to a private domain ("feature-flags") so the global default provider is left alone. */
  openFeatureDomain?: string;
}
```

The `/flagConfiguration` endpoint:

```typescript
app.get(
  `${basePath}/flagConfiguration`,
  authenticateMiddleware(),
  asyncHandler(async (req, res) => {
    const user = req.user as {_id?: unknown; id?: string} | undefined;
    if (!user) throw new APIError({status: 401, title: "Authentication required"});
    const targetingKey = String(user._id ?? user.id);
    // Match existing evaluateAllFlags() filter — only enabled, non-archived flags ship to clients.
    // Disabled or archived flags are omitted, matching current behavior where Object.keys(flags)
    // does NOT include disabled flag keys.
    const flags = await FeatureFlag.find({archived: {$ne: true}, enabled: true});
    const config: Record<string, FlagDefinition> = {};
    for (const flag of flags) {
      config[flag.key] = buildFlagDefinition(flag, targetingKey, user, this.segments);
    }
    return res.json({data: config});
  })
);
```

`buildFlagDefinition` reuses `evaluateFlag()` to determine the resolved value for *this* user, then builds the OF variant shape. **Because `/flagConfiguration` only ships enabled, non-archived flags**, `disabled: false` for every entry in the response (we never embed disabled flags; consumers see them only via the admin panel). The `disabled` field stays in the type for parity with OF's `FlagConfiguration` shape:

- Boolean flag → `variants: {on: true, off: false}`, `defaultVariant: result ? "on" : "off"`, `disabled: false`
- Variant flag → `variants: {variantKey: variantKey, ...}` (identity map), `defaultVariant: result` (the existing `evaluateFlag()` guarantees a non-null string when `flag.enabled`), `disabled: false`

Setting `defaultVariant` to the *resolved* value for this user makes `useBooleanFlagValue` on the frontend Just Work without re-running targeting logic on the client.

### Backend: legacy `/evaluate` (deprecated, kept for one release)

The legacy endpoint stays. It calls `evaluateAllFlags()` exactly as today and returns the old `Record<string, boolean | string | null>` shape, plus a `Deprecation: true` header and a `Sunset` header set to 90 days out. A `logger.warn` fires once per process when first called.

---

## Frontend

### New hook: `useTerrenoFeatureFlags`

**File**: `rtk/src/useTerrenoFeatureFlags.ts` (new)

```typescript
import {OpenFeature, TypedInMemoryProvider} from "@openfeature/web-sdk";

interface UseTerrenoFeatureFlagsOptions {
  basePath?: string;             // default: "/feature-flags"
  skip?: boolean;                // skip fetch until userId is known
  userId?: string | null;        // current user id — when this changes, refetch & re-bucket
  socket?: Socket | null;        // optional socket for live updates
  socketEventName?: string;      // default: "featureFlagsChanged"
  domain?: string;               // OF provider domain — default: "feature-flags"
}

interface UseTerrenoFeatureFlagsResult {
  flags: FlagConfiguration;
  isLoading: boolean;             // true until BOTH RTK query resolves AND OF PROVIDER_READY
  error: unknown;
  refetch: () => void;
  client: Client;                 // OpenFeature client bound to this hook's domain
}

export const useTerrenoFeatureFlags = (
  api: Api<any, any, any, any>,
  options?: UseTerrenoFeatureFlagsOptions
): UseTerrenoFeatureFlagsResult => {
  // 1. RTK Query bulk fetch /feature-flags/flagConfiguration. Cache key INCLUDES userId so a
  //    different user gets a fresh fetch (no stale per-user resolved values).
  // 2. On userId change: api.util.invalidateTags(["feature-flags"]) AND OpenFeature.setContext(
  //    domain, {targetingKey: userId}) before the refetch lands.
  // 3. On data success: await OpenFeature.setProvider(domain, new TypedInMemoryProvider(flags)).
  //    isLoading stays true until the PROVIDER_READY event fires (subscribed via client.addHandler).
  // 4. If options.socket: subscribe to socketEventName → refetch.
  // 5. Cleanup: do NOT clear the provider on unmount of an individual instance — multiple
  //    components may use useFeatureFlags simultaneously. Use a small ref-count module-level
  //    counter; only clear (OpenFeature.clearProviders) when the count returns to zero.
  // 6. StrictMode safety: setProvider is idempotent for the same data, but track an in-flight
  //    promise with a ref to prevent double-setting during the StrictMode double-mount window.
};
```

Critical behaviors:
- **User switching**: the cache key for the RTK Query endpoint must include `userId` so different users get different cache entries. On `userId` change, the hook calls `OpenFeature.setContext(domain, {targetingKey: userId})` and `refetch()`. The provider is replaced with the new user's values once the new fetch lands. `isLoading` returns to `true` during the transition.
- **`isLoading` semantics**: `isLoading: true` until RTK Query has data AND OpenFeature has emitted `PROVIDER_READY` for the new provider. This avoids the race where `useBooleanFlagValue` returns `defaultValue` before the provider is ready.
- **No provider clearing on individual unmount** (avoids breaking other mounted consumers).

### Updated BC wrapper: `useFeatureFlags`

**File**: `rtk/src/useFeatureFlags.ts` (rewritten as a thin wrapper)

```typescript
export const useFeatureFlags = (
  api: Api<any, any, any, any>,
  basePathOrOptions?: string | UseFeatureFlagsOptions
): UseFeatureFlagsResult => {
  const {basePath, skip} = resolveFeatureFlagsOptions(basePathOrOptions);
  const {flags, isLoading, error, refetch, client} = useTerrenoFeatureFlags(api, {basePath, skip});

  const getFlag = useCallback(
    (key: string): boolean => client.getBooleanValue(key, false),
    [client]
  );

  const getVariant = useCallback(
    (key: string): string | null => {
      // The InMemoryProvider doesn't natively report reason "DISABLED" — disabled flags are
      // omitted from /flagConfiguration entirely. So absence in `flags` (the raw FlagConfiguration
      // map returned by useTerrenoFeatureFlags) means the flag is disabled/missing and we return null.
      if (!flags[key]) return null;
      const value = client.getStringValue(key, "");
      return value === "" ? null : value;
    },
    [client, flags]
  );

  // Build a Record<string, boolean | string | null> view from the FlagConfiguration to preserve
  // the existing flags API surface used by example-frontend profile.tsx (which iterates
  // Object.keys(flags) and renders {value: boolean|string|null}).
  //
  // Projection from FlagDefinition → BC value:
  //   - boolean flag → variants[defaultVariant]    // true or false
  //   - variant flag → defaultVariant              // string variant key
  // Disabled flags are omitted from /flagConfiguration so they never appear in this map,
  // which matches today's behavior where evaluateAllFlags filters enabled: true.
  const flatFlags = useMemo<Record<string, boolean | string | null>>(() => {
    const out: Record<string, boolean | string | null> = {};
    for (const [key, def] of Object.entries(flags)) {
      const value = def.variants[def.defaultVariant];
      out[key] = value ?? null;
    }
    return out;
  }, [flags]);

  return {flags: flatFlags, getFlag, getVariant, isLoading, error, refetch};
};
```

`useFeatureFlags`'s return type is unchanged from today, including `flags: Record<string, boolean | string | null>` whose **keys and values match the prior `/evaluate` payload byte-for-byte for enabled flags**. Existing consumers in `example-frontend/app/(tabs)/index.tsx:105` and `profile.tsx` keep working without edits.

A snapshot test in Phase 2 will lock down this projection against the existing `profile.tsx` rendering output.

### Direct OpenFeature usage (recommended for new code)

Consumers add `@openfeature/react-sdk` as a direct dep and use OF hooks directly:

```typescript
import {useBooleanFlagValue, useStringFlagValue, FeatureFlag} from "@openfeature/react-sdk";

const showSummary = useBooleanFlagValue("todo-summary-card", false);
const layout = useStringFlagValue("profile-layout", "compact");

return (
  <FeatureFlag flagKey="ai-features" defaultValue={false}>
    <AiFeaturesTab />
  </FeatureFlag>
);
```

`@terreno/rtk` does **not** re-export OpenFeature hooks. Consumers add `@openfeature/react-sdk` to their `package.json` and import directly. (Decision per shaping question.)

**Note for consumers**: `useNumberFlagValue` and `useObjectFlagValue` always return the `defaultValue` with this provider — `MongoFeatureFlagProvider` supports only boolean and string (variant) flags, so number/object resolution returns `FLAG_NOT_FOUND` `ResolutionDetails`. Documented in `feature-flags.md` reference.

### SDK regen and the new endpoint

Today's `useFeatureFlags` manually injects the `/evaluate` endpoint via RTK Query (`api.injectEndpoints`) because the hook lives in `@terreno/rtk` and runs without depending on consumer-app SDK codegen. We keep the same pattern for `useTerrenoFeatureFlags` — it manually injects `/flagConfiguration` via `api.injectEndpoints`. **The consumer's SDK regen (`bun run sdk`) will ALSO emit a generated hook for `/flagConfiguration`** — that's fine; the generated hook is unused but harmless. To prevent confusion, document in `feature-flags.md` that consumers should call `useTerrenoFeatureFlags`/`useFeatureFlags`, not the generated `useGetFeatureFlagsFlagConfigurationQuery` hook from `openApiSdk.ts`. No rip-out of manual injection.

### Wiring in `example-frontend`

**File**: `example-frontend/app/_layout.tsx` (updated)

Wrap the app in `<OpenFeatureProvider domain="feature-flags">`. Add `useTerrenoFeatureFlags(api, {socket})` at the top level after auth so the provider is set as soon as the user is known. Both must come *after* the Redux Provider since the hook uses RTK Query.

---

## Live Updates

### Backend

Inside `FeatureFlagsApp.register()`, if `liveUpdates.socketIoServer` is provided:

1. Start a Mongoose change stream: `FeatureFlag.watch([], {fullDocument: "updateLookup"})`.
2. On any change event, emit `liveUpdates.socketIoServer.emit("featureFlagsChanged", {key: change.fullDocument?.key})`.
3. Also call `provider.emitConfigurationChanged()` so any server-side OF clients with cached values invalidate (mostly future-proofing; we don't cache on the server today).
4. Handle the stream's `error` event by logging and attempting one reconnect; subsequent errors disable the stream and log a warning to the consumer.
5. On `app.close()` (if `TerrenoApp` exposes a shutdown hook — add one if not), call `stream.close()`.

**Requirement to document**: Mongoose change streams require MongoDB to run as a replica set (even a single-node replica set is fine). The `add-feature-flags.md` how-to gets a new "Live updates" section that calls this out.

### Frontend

Inside `useTerrenoFeatureFlags`, if `options.socket` is provided:

1. Subscribe to `socket.on(options.socketEventName ?? "featureFlagsChanged", handler)`.
2. Handler calls `refetch()` on the RTK Query endpoint.
3. The fresh data triggers a fresh `OpenFeature.setProvider(domain, new TypedInMemoryProvider(...))`.
4. OpenFeature React SDK auto-re-renders all `useBooleanFlagValue` / `useStringFlagValue` consumers (this is its built-in behavior on `PROVIDER_CONFIGURATION_CHANGED`).
5. Cleanup: `socket.off(eventName, handler)` on unmount.

If `options.socket` is not provided, the hook falls back to RTK Query's existing refetch-on-mount behavior. Live updates are strictly opt-in.

---

## Type-Safe Flag Keys

Document in `docs/reference/feature-flags.md` how consumers can narrow flag-key types using module augmentation:

```typescript
// example-frontend/types/openfeature.d.ts
declare module "@openfeature/core" {
  export type BooleanFlagKey = "todo-summary-card" | "dark-mode-toggle" | "ai-features" | "todo-priority";
  export type StringFlagKey = "profile-layout";
}
```

After this, `useBooleanFlagValue("typo", false)` fails at compile time. Optional per-consumer; not required to use the feature flag package.

---

## Notifications

None needed (live updates use Socket.io directly, not the notifier system).

---

## UI

No new dedicated screens. The admin panel (auto-generated from `FeatureFlag` schema via `@terreno/admin-backend`) continues to work as today and now also exposes the new `defaultVariant` field automatically because `mongoose-to-swagger` picks up its description.

`example-frontend/app/(tabs)/profile.tsx` gets a small additional debug view: alongside the existing "all flags" card, display each flag's `reason` (TARGETING_MATCH / DISABLED / ERROR) via `useBooleanFlagDetails` to demonstrate OF metadata is available.

---

## Phases

### Phase 1 — Backend OpenFeature integration

Goal: server-side provider is in place and the new endpoint returns OF-shape responses; existing tests still pass; legacy endpoint kept.

- Add `@openfeature/server-sdk` to `feature-flags/package.json`.
- Add `defaultVariant` field + validation + computed-default getter to `FeatureFlag` schema. Update `types.ts` accordingly. Update existing pre-save validation to also check `defaultVariant` shape (boolean → "on"/"off"; variant → must be in variants).
- Create `feature-flags/src/openFeatureProvider.ts` with `MongoFeatureFlagProvider` as specified above.
- Update `feature-flags/src/featureFlagsApp.ts`:
  - On `register()`, construct the provider with `{flagModel: FeatureFlag, segments: this.segments}` and call `OpenFeature.setProvider(domain, provider)` (domain = `openFeatureDomain ?? "feature-flags"`).
  - Add the new `/flagConfiguration` route.
  - Keep the existing `/evaluate` route but emit the deprecation headers + one-shot warn log.
- Add tests:
  - `feature-flags/src/tests/openFeatureProvider.test.ts` — boolean and variant resolution, disabled flags, type mismatch, missing flag, targetingKey hashing, rule + segment paths, missing targetingKey.
  - Extend `featureFlagsApp.test.ts` — `/flagConfiguration` returns the right OF shape for both boolean and variant flags; respects archived/enabled; verifies `defaultVariant` propagation; verifies `/evaluate` still works and includes `Deprecation` header.
- Update `feature-flags/src/index.ts` to export `MongoFeatureFlagProvider`.

**Exit criteria**: `bun run test --filter=@terreno/feature-flags` and `bun run compile` pass. The new endpoint returns a valid `FlagConfiguration` for a logged-in user.

### Phase 2 — Frontend OpenFeature integration

Goal: `useTerrenoFeatureFlags` exists; legacy `useFeatureFlags` works as a thin BC wrapper; example app renders identically.

- Add `@openfeature/web-sdk`, `@openfeature/react-sdk`, and `@openfeature/core` to `rtk/package.json` (peer dep `react`).
- Create `rtk/src/useTerrenoFeatureFlags.ts` (RTK Query bulk fetch → `TypedInMemoryProvider` → `OpenFeature.setProvider(domain, ...)` + `setContext(domain, {targetingKey})`).
- Rewrite `rtk/src/useFeatureFlags.ts` as a thin wrapper preserving today's `{flags, getFlag, getVariant, isLoading, error, refetch}` API. Same overload signature (string | options object). `getVariant` returns `null` when `reason === "DISABLED" || "ERROR"`.
- Update `rtk/src/useFeatureFlags.test.ts` to validate against the new `FlagConfiguration` payload shape. Add `useTerrenoFeatureFlags.test.ts` covering: success path, skip behavior, refetch, domain isolation (doesn't affect the global default provider).
- Update `rtk/src/index.ts` to export `useTerrenoFeatureFlags`. **Do not** re-export OpenFeature hooks per shaping decision.

**Exit criteria**: `bun run test --filter=@terreno/rtk` and `bun run compile` pass. Calling code in `example-frontend` works without code edits.

### Phase 3 — Live updates (opt-in)

Goal: admin edits propagate to connected clients without a page refresh.

- Backend: in `FeatureFlagsApp.register()`, if `liveUpdates.socketIoServer` is provided, start `FeatureFlag.watch()` and emit `featureFlagsChanged` on each change. Wire to `provider.emitConfigurationChanged()` too.
- Backend tests: `featureFlagsApp.liveUpdates.test.ts` — given a mocked socket.io server, mutating a flag triggers an emission with the expected event payload. Use the in-memory MongoDB test rig and a real replica set if available; otherwise mock the change stream.
- Frontend: in `useTerrenoFeatureFlags`, if `options.socket` is provided, subscribe to the event name and call `refetch()` on each. Verify the OF re-render is triggered (component snapshot test).
- Documentation: add a "Live updates" section to `docs/how-to/add-feature-flags.md` (Mongoose replica-set requirement, Socket.io setup).

**Exit criteria**: opt-in via constructor options; default off; tests cover both opt-in and opt-out paths.

### Phase 4 — Example apps + docs + SDK regen

Goal: example apps run, docs reflect the new shape, downstream consumers have a migration path.

- `example-backend`: pass `liveUpdates: {socketIoServer: io}` to `FeatureFlagsApp` (the example-backend already constructs a Socket.io server for the existing `useSocketConnection` flow).
- `example-frontend`: wrap `_layout.tsx` in `<OpenFeatureProvider domain="feature-flags">`. Call `useTerrenoFeatureFlags(terrenoApi, {socket})` once at the top of the layout after auth. Update `profile.tsx` to add the `useBooleanFlagDetails` debug row showing `reason` per flag.
- Add a `types/openfeature.d.ts` file in `example-frontend` demonstrating the type-safe flag keys augmentation. Update SEED_FLAGS in `example-backend/src/scripts/seed-feature-flags.ts` to include `defaultVariant` on each flag, exercising the new field.
- Regenerate SDK: `cd example-frontend && bun run sdk`.
- Update `docs/reference/feature-flags.md` to describe the new endpoint shape, the `MongoFeatureFlagProvider` export, the `defaultVariant` field, and how to use OpenFeature hooks directly. Note `/evaluate` is deprecated.
- Update `docs/how-to/add-feature-flags.md` to recommend OpenFeature hooks for new code, with `useFeatureFlags` shown as the BC path.
- Add a new section "Migrating to OpenFeature" describing the breaking wire change for anyone calling `/evaluate` directly (no SDK update required if using `useFeatureFlags` — the BC wrapper handles it).
- Update `docs/implementationPlans/feature-flags.md` with a note linking to this new IP at the top.

**Exit criteria**: `bun run frontend:web` + `bun run backend:dev` runs end-to-end. Flags render with the same values as before. Admin edits propagate live to the open frontend. All workspace tests pass: `bun run lint && bun run compile && bun run test`.

---

## Feature Flags & Migrations

- No data migration: legacy `FeatureFlag` docs without `defaultVariant` get a computed value via Mongoose getter at read time.
- The wire-protocol change is at the SDK boundary — consumers using `useFeatureFlags(api)` get the new behavior automatically because the hook handles both shapes via the BC wrapper. Direct `/evaluate` callers (none expected internally) hit the deprecated endpoint until they migrate.
- No new feature flag is needed to gate this change since the package already gates itself.

---

## Activity Log & User Updates

None.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **User switching pours wrong-user data into globally-shared InMemoryProvider** | RTK Query cache key includes `userId`; on `userId` change the hook re-fetches AND calls `OpenFeature.setContext(domain, {targetingKey})` before swapping the provider. `isLoading` returns to `true` during the transition so consumers don't render stale values. Explicit test required. |
| **`@openfeature/react-sdk` may not work in React Native** | Phase 2.1 includes a spike: import the package in a `bun test` using `@testing-library/react-native` and assert `useBooleanFlagValue` returns expected value. If it fails on RN, fall back to importing from `@openfeature/web-sdk` directly and writing a tiny React adapter in `@terreno/rtk`. **Blocking before Phase 2 proceeds.** |
| **`OpenFeature.setProvider` is async; consumers can render with `defaultValue` before `PROVIDER_READY`** | `useTerrenoFeatureFlags` subscribes to `PROVIDER_READY` via `client.addHandler` and only flips `isLoading` to `false` once that event fires. Tested explicitly. |
| **`OpenFeature` is a global singleton — two copies of `@openfeature/web-sdk` create two singletons** | Declare `@openfeature/web-sdk` and `@openfeature/react-sdk` as **peerDependencies** (not direct deps) in `rtk/package.json`. Consumers install once; bun dedupes automatically. Direct deps remain on `@openfeature/core` for types. |
| **Mongoose change streams need a replica set; default test mongo is standalone** | The live-updates tests mock `FeatureFlag.watch()` to return a fake EventEmitter. We do NOT spin up a real replica set in tests. Production deployments must use a replica set — documented in `add-feature-flags.md` "Live updates" section as a prerequisite. Startup logs a warning if `watch()` throws. |
| **Provider's `resolveStringEvaluation` could be called with a key whose stored type is `boolean`** | Provider returns `{value: defaultValue, reason: "ERROR", errorCode: "TYPE_MISMATCH"}`. Tested explicitly. |
| **`defaultVariant` validation could reject legacy docs on edit** | Pre-save hook auto-populates `defaultVariant` for legacy docs before validation runs; validation only enforces shape constraints, not presence. Tested with both legacy-update and new-create paths. |
| **Provider's per-flag `findOneOrNone` is N+1 for server-side OF consumers** | Acknowledged as a regression vs. `evaluateAllFlags` (one query). For our frontend bulk fetch this is fine because `/flagConfiguration` does ONE query and loops in-memory. Document that direct backend OF usage is not for hot paths; add LRU caching in a follow-up if needed. |
| **`OpenFeature.setProvider` cleanup on unmount could break other consumers** | Do not clear on unmount of an individual instance. Use a module-level ref count; only clear when the count returns to zero. Documented in `useTerrenoFeatureFlags.ts`. |
| **React StrictMode double-mount sets the provider twice** | Use a ref to track the in-flight `setProvider` promise; if a second mount fires while the first is in-flight, skip the second call. Tested with `<StrictMode>` wrapper. |
| **Socket.io broadcast leaks flag keys to all connected clients** | Documented behavior. Payload contains only `{key}` (no user data). Acceptable since flag keys are not secrets — the same keys ship to every authenticated client via `/flagConfiguration` anyway. |
| **Socket reconnects miss change events during disconnect** | After socket reconnect, hook automatically `refetch()`s once (already happens via RTK Query refetch-on-focus and via socket connection event). Document the gap is "at most one stale render" in practice. |
| **Type-safe flag keys union can drift from runtime flag set** | Documented in `feature-flags.md` reference: the type union is a compile-time hint only; admin changes to flags may add/remove runtime keys without the TS types updating. Recommend syncing periodically. |

---

## Not included / Future work

- Server-side flag value caching keyed by `(flagKey, userId)` for very hot paths.
- Anonymous evaluation (would require deriving a stable `targetingKey` from device id or similar).
- Object/number flag types (currently return `FLAG_NOT_FOUND` from the provider; can be added by extending the schema and provider).
- Native flagd or GrowthBook provider — out of scope; vendor-portability is unlocked by the OF abstraction.
- Experiment-results tracking via `useTrack` and analytics integration.
- Multi-tenant flag scopes (e.g., per-org overrides).
- Flag scheduling (enable/disable at a future date) and audit log of who changed what when.
