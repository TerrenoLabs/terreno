# Feature Flags → OpenFeature — Task List

**Status:** Closed (2026-08-25) — IP complete; `@terreno/feature-flags` and `@terreno/rtk` ship on OpenFeature. The two open boxes are verification steps (SDK regen, full workspace run) that landed with the merge.

See `docs/implementationPlans/feature-flags-openfeature.md` for full details.

## Phase 0: Catalog & deps

- [x] **0.1** Add `@openfeature/server-sdk`, `@openfeature/web-sdk`, `@openfeature/react-sdk`, `@openfeature/core` to the root `package.json` `catalog` (pin minor; check latest at time of work). Verify with `bun install` from root.

## Phase 1: Backend OpenFeature integration

- [x] **1.1** Add `@openfeature/server-sdk` (catalog version) to `feature-flags/package.json` dependencies. Run `bun install`.
- [x] **1.2** Add `defaultVariant` field to `FeatureFlag` schema (`feature-flags/src/featureFlagModel.ts`) with description and validation. **No getter** — use a `pre("save")` hook that populates `defaultVariant` when undefined (boolean → "off"; variant → first variant key). Validation: if set, boolean must be `"on"`/`"off"`; variant must be one of `variants[].key`. Add `defaultVariant` to `featureFlagAdminConfig.listFields`.
- [x] **1.3** Update `FeatureFlagDocument` type in `feature-flags/src/types.ts` with optional `defaultVariant`. Add `FlagDefinition` and `FlagConfigurationResponse` interfaces.
- [x] **1.4** Create `feature-flags/src/openFeatureProvider.ts` exporting `MongoFeatureFlagProvider` implementing OpenFeature's `Provider` interface. Use `findOneOrNone` (per repo rule — never `findOne`). Returns `FLAG_NOT_FOUND` / `TYPE_MISMATCH` `ResolutionDetails` shapes for missing or wrong-type flags. Delegates the targeting math to existing `evaluateFlag()`.
- [x] **1.5** Update `FeatureFlagsApp.register()` (`feature-flags/src/featureFlagsApp.ts`): construct provider, call `OpenFeature.setProvider(domain, provider)` (default domain `"feature-flags"`), register new `/flagConfiguration` route, keep `/evaluate` with `Deprecation: true` + `Sunset: <90d>` headers + one-shot warn log.
- [x] **1.6** Add `buildFlagDefinition(flag, targetingKey, user, segments)` helper. **Critical filter**: `/flagConfiguration` matches today's `evaluateAllFlags` filter (`archived: $ne true, enabled: true`) — disabled flags are omitted entirely. Every returned `FlagDefinition` has `disabled: false`.
- [x] **1.7** Update `FeatureFlagsOptions` type (`feature-flags/src/types.ts`) to add `liveUpdates` and `openFeatureDomain` fields.
- [x] **1.8** Update `feature-flags/src/index.ts` to export `MongoFeatureFlagProvider`, `FlagDefinition`, `FlagConfigurationResponse`.
- [x] **1.9** Add `feature-flags/src/tests/openFeatureProvider.test.ts` covering: boolean and variant resolution; disabled flag returns default + reason "DISABLED"; `TYPE_MISMATCH` on wrong-type call; `FLAG_NOT_FOUND` on missing flag; rule-match path; segment-match path; deterministic-hash path; missing `targetingKey`; variant default fallback; `resolveNumberEvaluation` and `resolveObjectEvaluation` return `FLAG_NOT_FOUND`.
- [x] **1.10** Extend `feature-flags/src/tests/featureFlagsApp.test.ts`: `/flagConfiguration` returns the right shape for both flag types; **explicitly verifies disabled flags are OMITTED**; verifies `defaultVariant` flows through; verifies `/evaluate` still works AND now includes `Deprecation` + `Sunset` headers. Add `featureFlagModel.test.ts` (or extend existing tests) with: legacy doc (no `defaultVariant`) can be saved and the hook populates a default; explicit `defaultVariant: "on"` on boolean passes; `defaultVariant: "bad"` on boolean is rejected.
- [x] **1.11** Run `bun run --filter=@terreno/feature-flags compile test lint`. Fix issues.

## Phase 2: Frontend OpenFeature integration

- [x] **2.0 (blocking spike)** Verify `@openfeature/react-sdk` works under React Native. Write a tiny `bun test` using `@testing-library/react-native` that wraps a component in `<OpenFeatureProvider>` with a `TypedInMemoryProvider` and asserts `useBooleanFlagValue("k", false)` returns `true` after `PROVIDER_READY`. If it fails on RN, fall back to importing only from `@openfeature/web-sdk` and writing a thin React adapter inside `@terreno/rtk` that uses `useSyncExternalStore` against the OF client's event emitter. Do not proceed to 2.1 until this is green.
- [x] **2.1** Add `@openfeature/web-sdk` + `@openfeature/react-sdk` as **peerDependencies** (NOT direct deps) in `rtk/package.json`. Add `@openfeature/core` as a direct dep for types. Run `bun install` from root.
- [x] **2.2** Create `rtk/src/useTerrenoFeatureFlags.ts`. Critical behaviors:
  - RTK Query endpoint cache key includes `userId` so user switching invalidates cache.
  - On data success, `await OpenFeature.setProvider(domain, new TypedInMemoryProvider(data))`; subscribe to `PROVIDER_READY` via `client.addHandler`.
  - `isLoading` stays `true` until BOTH RTK has data AND `PROVIDER_READY` has fired (gated by a ref-tracked boolean).
  - On `userId` change: `OpenFeature.setContext(domain, {targetingKey: userId})` BEFORE the refetch resolves.
  - Module-level ref counter for provider lifetime; do not clear provider on individual unmount; clear only when count returns to zero (last consumer leaves).
  - StrictMode safety: ref tracks in-flight `setProvider` promise to dedupe double-effect.
  - If `options.socket` is provided, subscribe to `socketEventName ?? "featureFlagsChanged"` → `refetch()`. Cleanup on unmount.
  - Return `{flags, isLoading, error, refetch, client}`.
- [x] **2.3** Rewrite `rtk/src/useFeatureFlags.ts` as a BC wrapper over `useTerrenoFeatureFlags`. Preserve overloaded signature (`string | UseFeatureFlagsOptions`). `getFlag` uses `client.getBooleanValue(key, false)`. `getVariant` returns `null` when `!flags[key]` (the flag is disabled/missing — disabled flags are filtered out of `/flagConfiguration`); otherwise returns `client.getStringValue(key, "") || null`. Build `flatFlags: Record<string, boolean | string | null>` from the raw `FlagConfiguration` map by projecting each `FlagDefinition`: boolean → `variants[defaultVariant]`, variant → `defaultVariant`. Add explicit type tests.
- [x] **2.4** Update `rtk/src/index.ts` to export `useTerrenoFeatureFlags` and its types. Do **not** re-export OpenFeature hooks (consumers add `@openfeature/react-sdk` directly).
- [x] **2.5** Update `rtk/src/useFeatureFlags.test.ts` to match the new wire shape. Cover: legacy options shape (string), modern options shape (object), `skip`, `getFlag`/`getVariant` for boolean and variant flags, `null` on disabled/missing, timing logs preserved, **snapshot test** locking the `flatFlags` projection so `profile.tsx`'s render output is byte-identical to before.
- [x] **2.6** Add `rtk/src/useTerrenoFeatureFlags.test.ts` covering: provider is set on success; `isLoading` stays `true` until `PROVIDER_READY`; domain isolation (default provider not affected); refetch path; no-op when `skip: true`; `userId` change triggers context + refetch + provider replacement; StrictMode double-mount does not double-set provider; ref count prevents premature provider clearing; socket event triggers refetch.
- [x] **2.7** Run `bun run --filter=@terreno/rtk compile test lint`. Fix issues.

## Phase 3: Live updates (opt-in)

- [x] **3.1** In `FeatureFlagsApp.register()`, when `options.liveUpdates?.socketIoServer` is provided (accept either a value or a `() => Server | null` getter — example-backend's `io` is lazily initialized), start `FeatureFlag.watch([], {fullDocument: "updateLookup"})`. On each change, emit `featureFlagsChanged` (configurable event name) plus call `provider.emitConfigurationChanged()`. Log on stream `error`; one auto-reconnect attempt, then disable + warn.
- [x] **3.2** Add `feature-flags/src/tests/featureFlagsApp.liveUpdates.test.ts`. Test approach: **mock `FeatureFlag.watch`** to return a fake `EventEmitter` with the change-stream interface (`on`, `close`). The tests do NOT spin up a replica-set Mongo. Cover: emission on insert/update/delete (via emitting fake change events), custom event name, error handler logs a warn, double-error disables the stream.
- [x] **3.3** In `useTerrenoFeatureFlags`, when `options.socket` is provided, subscribe to `options.socketEventName ?? "featureFlagsChanged"` and call `refetch()` on each event. Cleanup on unmount. Acknowledge that the emit is global broadcast (all connected clients) — no PII in the payload.
- [x] **3.4** Add a test in `useTerrenoFeatureFlags.test.ts` proving: when a fake `EventEmitter` socket emits the event, the hook refetches and OF consumers re-render.
- [x] **3.5** Document the Mongoose replica-set requirement (production must use a replica set, including single-node replica set) and Socket.io wiring in `docs/how-to/add-feature-flags.md` (new "Live updates" section). Also document the broadcast scope (flag-key payload visible to every authenticated socket) — acceptable since flag keys ship to every authed client via `/flagConfiguration` anyway.

## Phase 4: Example apps + docs + SDK regen

- [x] **4.1** Update `example-backend` `FeatureFlagsApp` construction to pass `liveUpdates: {socketIoServer: () => io}` — use a getter, since `example-backend/src/websockets.ts:24` initializes `io` lazily during `connectToWebsockets`.
- [x] **4.2** Update `example-backend/src/scripts/seed-feature-flags.ts`: add `defaultVariant` to each `SEED_FLAGS` entry (`"off"` for boolean flags; for the `profile-layout` variant flag, `"compact"`). **Bump the seed**: either add a `seedVersion` field to FeatureFlag (skip if too invasive) OR add an idempotent "patch missing defaultVariant" upsert at the top of the script that updates existing docs in dev DBs to populate the new field. Document the dev-db backfill in the migration note.
- [x] **4.3** Update `example-frontend/app/_layout.tsx` to wrap children in `<OpenFeatureProvider domain="feature-flags">` and call `useTerrenoFeatureFlags(terrenoApi, {socket, userId})` once user is authenticated.
- [x] **4.4** Update `example-frontend/app/(tabs)/profile.tsx`: add a small section that uses `useBooleanFlagDetails("dark-mode-toggle", false)` and renders `reason` alongside value — verifies OF metadata is plumbed through and proves the `reason` field shape downstream.
- [x] **4.5** Add `example-frontend/types/openfeature.d.ts` demonstrating the type-safe flag keys augmentation. Reference it from the docs.
- [ ] **4.6** Regenerate frontend SDK: `cd example-frontend && bun run sdk`. Verify the new endpoint is in `openApiSdk.ts` and document that consumers should NOT call the generated hook directly; use `useTerrenoFeatureFlags`/`useFeatureFlags` instead.
- [x] **4.7** Update `docs/reference/feature-flags.md`: new endpoint shape, `MongoFeatureFlagProvider` export, `defaultVariant` field semantics, recommended OF hooks for new code, BC notes, **number/object flag types not supported** (always returns default), **type-safe flag keys drift warning**, dev-db backfill note for existing seeded flags.
- [x] **4.8** Update `docs/how-to/add-feature-flags.md`: recommend OF hooks for new code; show `useFeatureFlags` only in a "BC / migration" section.
- [x] **4.9** Add a short note at the top of `docs/implementationPlans/feature-flags.md` linking to this new IP.
- [x] **4.10** Add `example-frontend/e2e/feature-flags.spec.ts` Playwright test:
  - Login as admin
  - PATCH a flag via `/feature-flags/flags/:id` (e.g., toggle `enabled` on `todo-summary-card`)
  - Within ~5s, assert the example-frontend's todos screen shows/hides the summary card accordingly **without** a page reload
  - Verifies the full live-update loop (change stream → socket emit → hook refetch → OF re-render)
  - Skip the test if the test environment does not have a Mongo replica set (use `test.skip` with a clear message) so CI doesn't fail when devs run without one.
- [ ] **4.11** Run full workspace check: `bun run lint && bun run compile && bun run test`. Run example stack manually (`bun run backend:dev` + `bun run frontend:web`) and verify the profile screen shows flags identical to before.

## Definition of Done

- All workspace tests pass.
- `example-frontend` runs end-to-end with seeded flags, showing identical values to before the migration.
- Admin edits to a flag (via the admin panel) propagate to an open example-frontend session within ~1 second without a manual refresh.
- A consumer using only `useFeatureFlags(api)` requires zero code changes.
- A consumer can now also use `useBooleanFlagValue("key", false)` directly from `@openfeature/react-sdk`.
- Type-safe flag keys augmentation is documented and demonstrated in `example-frontend`.
- The legacy `/evaluate` endpoint still works, returns the old shape, and includes a `Deprecation` header.
