# Implementation Plan: Native module baseline for the next major release

**Status:** Draft
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1026
**Priority:** High
**Effort:** Small batch (code) — coordination cost is the release itself
**Owner:** unassigned
**Created:** 2026-08-09
**Program:** [B2B platform](b2b-platform-program.md)
**Depends on:** decisions D1/D3/D7 (resolved 2026-08-09)
**RTK deprecation flag:** None

## Goal

Adding a native module to an Expo app invalidates every existing dev-client and store
binary, so each addition after a release costs consumers a rebuild cycle. This IP lands
**all** native dependencies the B2B program needs in one breaking (major) release, so every
subsequent program feature — billing UI, MFA, dark mode, SSO, push, mobile IAP — ships as a
JS/OTA update against the same binary.

## Non-Goals

- Implementing any feature that uses these modules (their own IPs).
- Expo SDK version upgrades (separate effort; this IP targets the current SDK).
- `@10play/tentap-editor` — excluded by decision D3 (markdown stays).

## Decisions

| Question | Decision |
|----------|----------|
| Manifest (D7, resolved) | `@stripe/stripe-react-native`, `react-native-purchases` + `react-native-purchases-ui`, `expo-device`, `expo-crypto`, `expo-local-authentication`, `expo-system-ui`, `react-native-otp-verify` |
| Where dependencies live | Root catalog entries; linked in `example-frontend` and `demo` app manifests; `@terreno/ui`/feature packages reference them only when their feature IPs land (this IP is binary readiness, not usage) |
| Stripe Android constraints | Pin Kotlin 2.x / `compileSdkVersion` 36 via `expo-build-properties` per stripe-react-native requirements |
| Expo Go story | Document which flows degrade in Expo Go (purchases → RevenueCat Preview API mode; stripe/local-auth → dev build required); CI smoke keeps web unaffected |
| Release process | Follows the `release` skill + the upgrade-notes-for-breaking-releases CI gate (PR #987): major tag, upgrade note required |

## Architecture

Changes are dependency + config only:

1. **Root `package.json` catalog:** add the seven packages (sorted), per the dependency
   catalog rule (shared by `example-frontend` + `demo`).
2. **`example-frontend/app.json` + `demo/app.json` plugins:**
   `@stripe/stripe-react-native` (merchantIdentifier placeholder, `enableGooglePay:
   true`), `react-native-purchases`, and `expo-build-properties` with the Kotlin/compileSdk
   pins.
3. **EAS builds:** refresh dev-client profiles via the existing `eas-dev-build` workflow;
   verify Android + iOS builds compile with the new pods/gradle deps.
4. **Upgrade note:** `docs` upgrade note describing the new binary requirement and the
   consumer checklist (rebuild dev clients, add config plugins, set merchant id when using
   Stripe).

## Models / APIs / Notifications

None.

## UI

None visible — binary-only change. `demo` gains a hidden diagnostics story listing
resolved native module versions so builds are verifiable at runtime.

## Phases

1. **Dependencies + config:** catalog entries, app.json plugins, build-properties pins,
   `bun install` + compile green, web export unaffected.
2. **Builds + verification:** EAS dev builds for iOS/Android; diagnostics story confirms
   modules resolve on device; Expo Go degradation documented.
3. **Release:** upgrade note, coordinate the major tag via the release process.

## Feature Flags & Migrations

None. Runtime behavior is unchanged until feature IPs consume the modules.

## Activity Log & User Updates

None.

## Not Included / Future Work

- TenTap (revisit in a later major if WYSIWYG is adopted — decision D3).
- Any feature wiring of the added modules.

## Files to Create / Modify

- Root `package.json` (catalog), `example-frontend/package.json`, `demo/package.json`
- `example-frontend/app.json`, `demo/app.json`
- `demo` diagnostics story
- `docs/` upgrade note for the major release
- (No `@terreno/ui` source changes)

## Task List

See [docs/tasks/native-module-baseline.md](../tasks/native-module-baseline.md).

## Acceptance Criteria

- [ ] `bun install`, full compile, and `example-frontend` web export succeed with the
      seven packages added.
- [ ] iOS and Android EAS dev builds compile; the diagnostics story shows all seven
      modules resolved on device.
- [ ] Android build carries the Kotlin 2.x / compileSdk 36 pins without breaking
      gesture-handler or other existing native deps.
- [ ] Expo Go still launches the app with documented degradations only.
- [ ] The release PR carries the required upgrade note and the breaking-release CI gate
      passes.
