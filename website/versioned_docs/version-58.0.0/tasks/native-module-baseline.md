# Tasks: Native module baseline for the next major release

IP: [native-module-baseline](../implementationPlans/native-module-baseline.md)

## Phase 1 — Dependencies + config

- [x] **Task 1.1**: Catalog + app package manifests
  - Description: add the seven packages to root catalog (sorted) and to example-frontend + demo deps via `catalog:`
  - Files: root `package.json`, `example-frontend/package.json`, `demo/package.json`
  - Depends on: none
  - Acceptance: `bun install` + full compile green
  - Done: six of seven manifest entries landed; `react-native-otp-verify` dropped (no New Architecture support). See IP Implementation notes.
- [x] **Task 1.2**: Config plugins + build properties
  - Description: stripe + purchases plugins; `expo-build-properties` Kotlin 2.x / compileSdk 36 pins
  - Files: `example-frontend/app.json`, `demo/app.json`
  - Depends on: 1.1
  - Acceptance: `expo config` resolves without errors; web export unaffected
  - Done: stripe + local-authentication + build-properties plugins. `react-native-purchases` ships no config plugin. compileSdk pinned to 37 (RN 0.88 default), not 36.

## Phase 2 — Builds + verification

- [ ] **Task 2.1**: EAS dev builds
  - Description: iOS + Android dev-client builds via existing eas-dev-build workflow
  - Files: `eas.json` profiles if needed
  - Depends on: Phase 1
  - Acceptance: both builds compile
- [x] **Task 2.2**: Diagnostics story
  - Description: hidden demo story listing resolved native module versions
  - Files: `demo/stories/NativeModules.stories.tsx`, `demo/demoConfig.tsx`
  - Depends on: 2.1
  - Acceptance: story shows all seven modules on a dev build; screenshot evidence
  - Done: hidden `Native Modules` page (`hidden: true` config, routable at `/demo/Native%20Modules`). Web screenshot only; on-device check waits on Task 2.1.
- [x] **Task 2.3**: Expo Go degradation doc
  - Description: document which flows need a dev build (stripe, local-auth) vs preview modes (purchases)
  - Files: `docs/` upgrade note draft
  - Depends on: 2.1
  - Acceptance: reviewed checklist in the note
  - Done: Expo Go table in `mcp-server/src/docs/upgrades/58.0.0.md`.

## Phase 3 — Release

- [ ] **Task 3.1**: Upgrade note + major release coordination
  - Description: consumer checklist (rebuild dev clients, add plugins, merchant id); breaking-release CI gate
  - Files: upgrade notes location per release process
  - Depends on: Phase 2
  - Acceptance: breaking-release CI gate passes on the release PR
