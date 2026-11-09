# Expo SDK loop log

Handoff file for `/track-upstream-expo`. The next morning reads this before
changing code. Keep it on the `release-*` branch once a loop starts.

Template: `.rulesync/skills/track-upstream-expo/references/loop-log.md`.

## Status

- sdkLine: 58.0.0
- expoVersion: 58.0.14
- releaseBranch: release-58.0.0
- loopStatus: ready
- updatedAt: 2026-10-18T12:00:00.000Z

## Next

Merge the open Terreno 58 PRs into `release-58.0.0`, then cut `58.0.0` with the `release` skill (merge `release-58.0.0` to master first).

## Open

- [ ] (non-blocking) TinyBase still peers `expo-sqlite ^57` (latest `10.0.1` and `10.1.0-beta.0` as of 2026-10-18); `defaultPersisterFactory.native.ts` keeps the `unknown` cast. Drop it when a TinyBase release peers `expo-sqlite ^58`.

## Tried (newest first)

### 2026-10-18T12:00:00.000Z — 58.0.14 (stable)
- Action: Expo SDK 58 went stable (`latest` = `58.0.14`, 2026-10-16). Merged `origin/master` (140 commits; RN 0.88 ref-type conflicts in `GPTChat`, `TextField`, `Common`, `Box`, demo root layout). Pinned catalog to Expo 58.0.14 `bundledNativeModules.json`: RN `0.88.0`, RNGH `~3.3.0`, reanimated `4.7.1` + worklets `0.13.0`, screens `~4.30.0`, safe-area `~5.10.1`, svg `15.16.0`, flash-list `2.3.2`, skia `2.14.0`, `@sentry/react-native` `~8.28.0`, every catalog `expo-*` to its bundled patch, `babel-preset-expo` `~58.0.17`, `@expo/metro-runtime` `~58.0.14`, `@expo/config-plugins` `~58.0.9`, override `expo-image-loader` `58.0.3`. `@terreno/ui` peer `react-native` `0.88.0`. `create-terreno-app` scaffolds Expo `~58.0.14` / RN `0.88.0` / React `19.3.0`. Kept catalog `@expo/vector-icons` `^15.1.1` (newer than bundled).
- Result: worked
- Evidence: `bun run compile` exit 0; `bun run lint` exit 0; `bun run frontend:lint` exit 0; `bun run ui:test` 3000 pass / 0 fail; `bun run frontend:test` exit 0; `create-terreno-app` 52 pass; `cd example-frontend && bunx expo-doctor` 20/20; `cd demo && bunx expo-doctor` 20/20 (after deleting stale nested `node_modules/@expo/metro/node_modules`); `bunx expo install --check` "Dependencies are up to date". `syncdb:test` 675 pass / 1 fail: `a different-user login still wipes local data (regression)` fails identically on `origin/master` in this sandbox, so it is not caused by the Expo bump.
- Follow-up: see Open


### 2026-09-22T12:09:26.000Z — 58.0.0-preview.4
- Action: Resume loop. Merged `origin/master` (`ROADMAP.md`). Skipped Expo bump (catalog already `58.0.0-preview.4`). Skipped TinyBase 9.7.1 / `10.0.0-beta.4` (still peer `expo-sqlite ^57`). Did not retry nested Bun overrides, `tinybase>expo` keys, or TinyBase `10.0.0-beta.1` / `10.0.0-beta.2` / `10.0.0-beta.3`. Catalog native packages still match Expo 58 `bundledNativeModules.json` (shared keys; catalog `@expo/vector-icons` `^15.1.1` and `react-native-web` `^0.21.2` stay newer than bundled). Did not bump `create-terreno-app` Expo 57 scaffold.
- Result: worked
- Evidence: `bun run compile` exit 0; `bun run lint` exit 0; `bun run frontend:lint` exit 0; `bun run ui:test` 2437 pass / 0 fail; `cd example-frontend && bunx expo-doctor` 20/20; `cd demo && bunx expo-doctor` 20/20; `bunx expo install --check` "Dependencies are up to date". `npm view tinybase version` 9.7.1 peers `expo-sqlite ^57.0.2`; dist-tag `beta` moved to `10.0.0-beta.4` peers `expo-sqlite ^57.0.3` / `expo ^57.0.24`. Catalog Expo stays `58.0.0-preview.4`. `npm view expo@next version` still `58.0.0-preview.4`.
- Follow-up: see Open

### 2026-09-22T12:04:09.000Z — probe
- Action: `bun run expo:track-probe` from `origin/master`
- Result: worked
- Evidence: exit 0, `action: resume-loop`, `expoVersion: 58.0.0-preview.4`, `releaseBranch: release-58.0.0`, `loopStatus: open`. Merged `origin/master` into `release-58.0.0`.
- Follow-up: see Open

### 2026-09-21T12:09:00.000Z — 58.0.0-preview.4
- Action: Continue branch. Merged `origin/master` (in-app notification center). Pin catalog Expo `58.0.0-preview.4`, RN `0.88.0-rc.1`, React `19.3.0`, `react-native-screens ~4.28.0`, and Expo 58.0.4–58.0.7 module patches from `bundledNativeModules.json`. `@terreno/ui` peer `react-native` `0.88.0-rc.1`. Bump demo `@babel/core` `^7.29.7` so expo-doctor matches SDK. Skipped TinyBase 9.7.1 / `10.0.0-beta.3` (still peer `expo-sqlite ^57`). Did not retry nested Bun overrides, `tinybase>expo` keys, or TinyBase `10.0.0-beta.1` / `10.0.0-beta.2`. Catalog `@expo/vector-icons` `^15.1.1` and `react-native-web` `^0.21.2` stay newer than bundled. Did not bump `create-terreno-app` Expo 57 scaffold.
- Result: worked
- Evidence: `bun run compile` exit 0; `bun run lint` exit 0; `bun run frontend:lint` exit 0; `bun run ui:test` 2437 pass / 0 fail; `cd example-frontend && bunx expo-doctor` 20/20; `cd demo && bunx expo-doctor` 20/20; `bunx expo install --check` "Dependencies are up to date". `npm view tinybase version` 9.7.1 peers `expo-sqlite ^57.0.2`; dist-tag `beta` still `10.0.0-beta.3` peers `expo-sqlite ^57.0.3` / `expo ^57.0.24`. Catalog Expo `58.0.0-preview.4`. `npm view expo@next version` `58.0.0-preview.4`.
- Follow-up: see Open

### 2026-09-21T12:02:00.000Z — probe
- Action: `bun run expo:track-probe` from `origin/master`
- Result: worked
- Evidence: exit 0, `action: continue-branch`, `expoVersion: 58.0.0-preview.4`, `releaseBranch: release-58.0.0`, `loopStatus: open`. Merged `origin/master` into `release-58.0.0`.
- Follow-up: see Open

### 2026-09-20T12:05:07.678Z — 58.0.0-preview.3
- Action: Resume loop. Merged `origin/master` (`ROADMAP.md`). Skipped Expo bump (catalog already `58.0.0-preview.3`). Skipped TinyBase 9.7.1 / `10.0.0-beta.3` (still peer `expo-sqlite ^57`). Did not retry nested Bun overrides, `tinybase>expo` keys, or TinyBase `10.0.0-beta.1` / `10.0.0-beta.2`. Catalog native packages still match Expo 58 `bundledNativeModules.json` (shared keys; catalog `@expo/vector-icons` `^15.1.1` and `react-native-web` `^0.21.2` stay newer than bundled). Did not bump `create-terreno-app` Expo 57 scaffold.
- Result: worked
- Evidence: `bun run compile` exit 0; `bun run lint` exit 0; `bun run frontend:lint` exit 0; `bun run ui:test` 2424 pass / 0 fail; `cd example-frontend && bunx expo-doctor` 20/20; `cd demo && bunx expo-doctor` 20/20; `bunx expo install --check` "Dependencies are up to date". `npm view tinybase version` 9.7.1 peers `expo-sqlite ^57.0.2`; dist-tag `beta` moved to `10.0.0-beta.3` peers `expo-sqlite ^57.0.3` / `expo ^57.0.24`. Catalog Expo stays `58.0.0-preview.3`. `npm view expo@next version` still `58.0.0-preview.3`.
- Follow-up: see Open

### 2026-09-20T12:01:30.000Z — probe
- Action: `bun run expo:track-probe` from `origin/master`
- Result: worked
- Evidence: exit 0, `action: resume-loop`, `expoVersion: 58.0.0-preview.3`, `releaseBranch: release-58.0.0`, `loopStatus: open`. Merged `origin/master` into `release-58.0.0`.
- Follow-up: see Open

### 2026-09-19T12:08:48.000Z — 58.0.0-preview.3
- Action: Resume loop. Merged `origin/master` (announcements admin, org/RBAC, agent UI blocks, CI). Skipped Expo bump (catalog already `58.0.0-preview.3`). Skipped TinyBase 9.7.1 / `10.0.0-beta.2` (still peer `expo-sqlite ^57`). Did not retry nested Bun overrides or `tinybase>expo` keys. Catalog native packages match Expo 58 `bundledNativeModules.json` (including `@react-native-picker/picker` `2.11.4`).
- Result: worked
- Evidence: `bun run compile` exit 0; `bun run lint` exit 0; `bun run frontend:lint` exit 0; `bun run ui:test` 2424 pass / 0 fail; `cd example-frontend && bunx expo-doctor` 20/20; `cd demo && bunx expo-doctor` 20/20; `bunx expo install --check` "Dependencies are up to date". `npm view tinybase version` 9.7.1 peers `expo-sqlite ^57.0.2`; dist-tag `beta` still `10.0.0-beta.2` peers `expo-sqlite ^57.0.3`. Catalog Expo stays `58.0.0-preview.3`. `npm view expo@next version` still `58.0.0-preview.3`.
- Follow-up: see Open

### 2026-09-19T12:03:29.000Z — probe
- Action: `bun run expo:track-probe` from `origin/master`
- Result: worked
- Evidence: exit 0, `action: resume-loop`, `expoVersion: 58.0.0-preview.3`, `releaseBranch: release-58.0.0`, `loopStatus: open`. Merged `origin/master` into `release-58.0.0`.
- Follow-up: see Open


### 2026-09-18T12:19:09.000Z — 58.0.0-preview.3
- Action: Resume loop. Merged `origin/master` (password TextField visibility toggle). Typed `TextField` internal ref as RN 0.88 `TextInputInstance` so `focus()` and the instance callback compile. Skipped TinyBase 9.7.1 / `10.0.0-beta.2` (still peer `expo-sqlite ^57`). Did not retry nested Bun overrides or `tinybase>expo` keys.
- Result: worked
- Evidence: `bun run compile` exit 0; `bun run lint` exit 0; `bun run frontend:lint` exit 0; `bun run ui:test` 2334 pass / 0 fail; `cd example-frontend && bunx expo-doctor` 20/20; `cd demo && bunx expo-doctor` 20/20; `bunx expo install --check` "Dependencies are up to date". `npm view tinybase version` 9.7.1 peers `expo-sqlite ^57.0.2`; dist-tag `beta` still `10.0.0-beta.2`. Catalog Expo stays `58.0.0-preview.3`.
- Follow-up: see Open

### 2026-09-18T12:11:36.000Z — probe
- Action: `bun run expo:track-probe` from `origin/master`
- Result: worked
- Evidence: exit 0, `action: resume-loop`, `expoVersion: 58.0.0-preview.3`, `releaseBranch: release-58.0.0`, `loopStatus: open`. Merged `origin/master` into `release-58.0.0` (TextField password toggle).
- Follow-up: see Open

### 2026-09-17T12:08:20.000Z — 58.0.0-preview.3
- Action: Pin catalog Expo `58.0.0-preview.3` and Expo 58.0.3–58.0.5 module patches from `bundledNativeModules.json` (`expo-constants ~58.0.3`, `expo-dev-client ~58.0.3`, `expo-image-manipulator ~58.0.4`, `expo-image-picker ~58.0.3`, `expo-linking ~58.0.3`, `expo-modules-core ~58.0.3`, `expo-notifications ~58.0.3`, `expo-router ~58.0.4`, `expo-sharing ~58.0.5`, `expo-updates ~58.0.5`, `babel-preset-expo ~58.0.3`, `@expo/metro-runtime ~58.0.3`). RN stays `0.88.0-rc.0`. Skip TinyBase 10 (`10.0.0-beta.2` still peers `expo-sqlite ^57`).
- Result: worked
- Evidence: `bun run compile` exit 0; `bun run lint` exit 0; `bun run frontend:lint` exit 0; `bun run ui:test` 2326 pass / 0 fail; `cd example-frontend && bunx expo-doctor` 20/20; `cd demo && bunx expo-doctor` 20/20; `bunx expo install --check` "Dependencies are up to date". TinyBase 9.7.1 peers `expo-sqlite ^57.0.2`; TinyBase `10.0.0-beta.2` peers `expo-sqlite ^57.0.3` / `expo ^57.0.22`.
- Follow-up: see Open

### 2026-09-17T12:01:23.000Z — probe
- Action: `bun run expo:track-probe` from `origin/master`
- Result: worked
- Evidence: exit 0, `action: continue-branch`, `expoVersion: 58.0.0-preview.3`, `releaseBranch: release-58.0.0`, `loopStatus: open`. Merged `origin/master` into `release-58.0.0` (bun.lock conflict regenerated after catalog bump).
- Follow-up: see Open

### 2026-09-16T12:24:52.000Z — 58.0.0-preview.2
- Action: Pin catalog Expo `58.0.0-preview.2` and Expo 58.0.1–58.0.4 module patches from `bundledNativeModules.json` (`expo-sqlite ~58.0.3`, `expo-router ~58.0.3`, `expo-updates ~58.0.4`, `babel-preset-expo ~58.0.2`, `@expo/config-plugins ~58.0.1`). RN stays `0.88.0-rc.0`. Skip TinyBase 10 (still peers `expo-sqlite ^57`). Merge conflict in `ui/src/DataTable.tsx`: keep `ScrollViewInstance` refs and master's server-side filter query.
- Result: worked
- Evidence: `bun run compile` exit 0; `bun run lint` exit 0; `bun run frontend:lint` exit 0; `bun run ui:test` 2322 pass / 0 fail; `cd example-frontend && bunx expo-doctor` 20/20; `cd demo && bunx expo-doctor` 20/20; `bunx expo install --check` "Dependencies are up to date". TinyBase 9.7.1 peers `expo-sqlite ^57.0.2`; TinyBase `10.0.0-beta.1` peers `expo-sqlite ^57.0.3`.
- Follow-up: see Open

### 2026-09-16T12:12:00.000Z — probe
- Action: `bun run expo:track-probe` from `origin/master`
- Result: worked
- Evidence: exit 0, `action: continue-branch`, `expoVersion: 58.0.0-preview.2`, `releaseBranch: release-58.0.0`, `loopStatus: open`. Merged `origin/master` into `release-58.0.0` (`ui/src/DataTable.tsx` conflict: `ScrollViewInstance` + master filter query).
- Follow-up: see Open

### 2026-09-15T12:11:14.000Z — 58.0.0-preview.1
- Action: Pin catalog Expo `58.0.0-preview.1`, RN `0.88.0-rc.0`, and Expo 58.0.1–58.0.3 module patches from `bundledNativeModules.json`. Update `@terreno/ui` peer to `0.88.0-rc.0`. Skip TinyBase 10 (still peers `expo-sqlite ^57`).
- Result: worked
- Evidence: `bun run compile` exit 0; `bun run lint` exit 0; `bun run frontend:lint` exit 0; `bun run ui:test` 2257 pass / 0 fail; `cd example-frontend && bunx expo-doctor` 20/20; `cd demo && bunx expo-doctor` 20/20; `bunx expo install --check` "Dependencies are up to date". TinyBase 9.7.1 peers `expo-sqlite ^57.0.2`; TinyBase `10.0.0-beta.1` peers `expo-sqlite ^57.0.3`.
- Follow-up: see Open

### 2026-09-15T12:03:05.000Z — probe
- Action: `bun run expo:track-probe` from `origin/master`
- Result: worked
- Evidence: exit 0, `action: continue-branch`, `expoVersion: 58.0.0-preview.1`, `releaseBranch: release-58.0.0`, `loopStatus: open`. Merged `origin/master` into `release-58.0.0` (bun.lock conflict regenerated).
- Follow-up: see Open

### 2026-09-14T12:09:18.000Z — 58.0.0-preview.0
- Action: After master merge + `bun install`, confirm catalog Expo `58.0.0-preview.0`. `cd example-frontend && bunx expo install --check`. `npm view tinybase@9.7.1` and `tinybase@10.0.0-beta.1` peerDependencies.
- Result: skipped dropping the TinyBase `unknown` cast (peers still `expo-sqlite ^57`). Native catalog matches Expo 58 `bundledNativeModules.json`.
- Evidence: `expo install --check` "Dependencies are up to date". TinyBase 9.7.1 peers `expo-sqlite ^57.0.2`; TinyBase `10.0.0-beta.1` peers `expo-sqlite ^57.0.3` / `expo ^57.0.22`. `bun run compile` exit 0; `bun run lint` exit 0; `bun run frontend:lint` exit 0; `bun run ui:test` 2245 pass / 0 fail; `cd example-frontend && bunx expo-doctor` 20/20; `cd demo && bunx expo-doctor` 20/20.
- Follow-up: see Open

### 2026-09-14T12:02:36.000Z — probe
- Action: `bun run expo:track-probe` from `origin/master`
- Result: worked
- Evidence: exit 0, `action: resume-loop`, `expoVersion: 58.0.0-preview.0`, `releaseBranch: release-58.0.0`, `loopStatus: open`. Merged `origin/master` into `release-58.0.0` (ROADMAP.md).
- Follow-up: see Open

### 2026-09-13T12:18:46.000Z — 58.0.0-preview.0
- Action: Drop `customConditions: ["react-native-legacy-deep-imports"]` from `ui/tsconfig.json` and `admin-frontend/tsconfig.json`. Adopt RN 0.87 generated types (`ViewInstance` / `ScrollViewInstance` / `TextInputInstance`, `DimensionValue` from `react-native`, Readonly `TextStyle`, `ImageErrorEvent`, `TextInput.State.currentlyFocusedInput` with `currentlyFocusedField` fallback). Set `unstable_settings.initialRouteName` on `demo/app/demo/sidebar-navigation/_layout.tsx`.
- Result: worked
- Evidence: `bun run compile` exit 0; `cd ui && bun run lint` exit 0; `bun run frontend:lint` exit 0; `cd ui && bun run test:ci` 2245 pass / 0 fail; `cd example-frontend && bunx expo-doctor` 20/20; `cd demo && bunx expo-doctor` 20/20.
- Follow-up: see Open

### 2026-09-13T12:03:52.000Z — probe
- Action: `bun run expo:track-probe` from `origin/master`
- Result: worked
- Evidence: exit 0, `action: resume-loop`, `expoVersion: 58.0.0-preview.0`, `releaseBranch: release-58.0.0`, `loopStatus: open`. Merged `origin/master` into `release-58.0.0`.
- Follow-up: see Open

### 2026-09-12T12:27:18.000Z — 58.0.0-preview.0
- Action: Override `expo-image-loader` to `58.0.1`, bump catalog `expo-image-manipulator` to `~58.0.1`, delete stale `node_modules/expo-image-picker/node_modules/expo-image-loader@58.0.0`. Exclude `@react-native-community/blur` from `expo.doctor.reactNativeDirectoryCheck` in example-frontend + demo.
- Result: worked
- Evidence: `cd example-frontend && bunx expo-doctor` 20/20; `cd demo && bunx expo-doctor` 20/20. `bun run compile` exit 0; `bun run lint` exit 0; `bun run frontend:lint` exit 0; `bun run ui:test` 2245 pass / 0 fail.
- Follow-up: see Open

### 2026-09-12T12:22:00.000Z — 58.0.0-preview.0
- Action: Remove `tinybase>expo` / `tinybase>expo-sqlite` override keys. Keep global `expo` / `expo-sqlite` overrides. Nested object form `"tinybase": { "expo": "..." }` is ignored on Bun 1.3.11.
- Result: worked
- Evidence: `npm explain expo-cli --json` no longer `EINVALIDTAGNAME` (`Invalid tag name "tinybase>expo"`). expo-doctor npm-explain checks pass.
- Follow-up: none

### 2026-09-12T12:19:00.000Z — 58.0.0-preview.0
- Action: Merge `origin/master` into `release-58.0.0`, `bun install` with `linker = "hoisted"`.
- Result: worked
- Evidence: `example-frontend/node_modules/expo` gone; single `node_modules/expo@58.0.0-preview.0`. Duplicate `expo@58` copies that blocked 2026-09-11 doctor are gone.
- Follow-up: none

### 2026-09-12T12:14:25.000Z — probe
- Action: `bun run expo:track-probe` from `origin/master`
- Result: worked
- Evidence: exit 0, `action: resume-loop`, `expoVersion: 58.0.0-preview.0`, `releaseBranch: release-58.0.0`, `loopStatus: open`
- Follow-up: see Open

### 2026-09-11T12:42:45.000Z — 58.0.0-preview.0
- Action: Mock `expo-constants` / `expo-modules-core` / `expo-router/build/views/Screen` in `ui/src/bunSetup.ts` so bun never loads Expo 58's empty `expo-modules-core/build/ts-declarations/SharedRef.js` (`export {}`)
- Result: worked
- Evidence: `bun run ui:test` — 2243 pass, 0 fail (was 2 fail / 2 errors: `SyntaxError: Export named 'SharedRef' not found`)
- Follow-up: none

### 2026-09-11T12:35:00.000Z — 58.0.0-preview.0
- Action: Prune leftover nested `expo@57` / `expo-*@57` trees (not in `bun.lock`) then `bun install`; re-run expo-doctor
- Result: failed
- Evidence: `cd example-frontend && bunx expo-doctor` exit 1. Version mismatches (57 vs 58) gone. First remaining line: `✖ Check that no duplicate dependencies are installed` / `Found duplicates for expo:` `expo@58.0.0-preview.0` at `node_modules/expo` and `../node_modules/expo`. Also `npm explain` failures under bun.
- Follow-up: see Open

### 2026-09-11T12:30:00.000Z — 58.0.0-preview.0
- Action: `bun run compile`, `bun run lint`, `bun run frontend:lint` after RN 0.87 / Router 58 source fixes
- Result: worked
- Evidence: compile exit 0; lint exit 0 (warnings only, same as master); `bun run frontend:lint` exit 0
- Follow-up: none

### 2026-09-11T12:20:00.000Z — 58.0.0-preview.0
- Action: Pin root catalog + overrides to Expo `58.0.0-preview.0` and native fingerprint packages; `bun install`
- Result: worked
- Evidence: catalog `expo` is `58.0.0-preview.0`; `react-native` `0.87.1`; apps still use `"catalog:"`
- Follow-up: see Open

### 2026-09-11T12:15:08.999Z — probe
- Action: `bun run expo:track-probe` from `origin/master`
- Result: worked
- Evidence: exit 0, `action: create-branch`, `expoVersion: 58.0.0-preview.0`, `releaseBranch: release-58.0.0`
- Follow-up: see Open

## Do not retry

- Bun 1.3.11 nested override object (`"tinybase": { "expo": "58.0.0-preview.0" }`): `warn: Bun currently does not support nested "overrides"`. Wait for Bun 1.4 or a new Expo preview. Global `overrides.expo` / `overrides.expo-sqlite` already pin the tree.
- pnpm-style `"tinybase>expo"` override keys: `npm explain` fails with `EINVALIDTAGNAME: Invalid tag name "tinybase>expo"`, which made expo-doctor's npm-explain checks error. Removed 2026-09-12.
- TinyBase `10.0.0-beta.1` still peers `expo-sqlite ^57.0.3` / `expo ^57.0.22`. Do not bump TinyBase to 10 on this train to drop the `unknown` cast. Wait for a 9.x or 10.x that peers `expo-sqlite ^58`.
- TinyBase `10.0.0-beta.2` (checked 2026-09-17 with Expo `58.0.0-preview.3`; rechecked 2026-09-19) still peers `expo-sqlite ^57.0.3` / `expo ^57.0.22`. Same skip.
- TinyBase `10.0.0-beta.3` (checked 2026-09-20 with Expo `58.0.0-preview.3`; rechecked 2026-09-21 with `58.0.0-preview.4`) still peers `expo-sqlite ^57.0.3` / `expo ^57.0.24`. Same skip. Do not bump TinyBase to 10 on this train to drop the `unknown` cast.
- TinyBase `10.0.0-beta.4` (checked 2026-09-22 with Expo `58.0.0-preview.4`) still peers `expo-sqlite ^57.0.3` / `expo ^57.0.24`. Same skip. Do not bump TinyBase to 10 on this train to drop the `unknown` cast.

## Worked

- Catalog Expo `58.0.0-preview.4` (`npmTag: next`); RN `0.88.0-rc.1`; React `19.3.0`; RNGH `~3.2.1`; webview `14.0.1`; reanimated `4.6.0` + worklets `0.12.2`; screens `~4.28.0`; safe-area `~5.9.1`; svg `15.15.5`; drawer-layout `4.2.10`; skia `2.11.2`; sentry-native `~7.11.0` (Expo bundled, not 8.x); datetimepicker `9.2.1`; slider `5.2.1`; flash-list `2.0.2`; async-storage `2.2.0`. Overrides pin `expo`, `expo-sqlite@58.0.4`, and `expo-image-loader@58.0.1`. Catalog `expo-image-manipulator` `~58.0.5`.
- `@react-native-picker/picker` `2.11.4` (Expo 58 bundled pin; already cataloged).
- `@terreno/ui` peer `react-native` `0.88.0-rc.1`.
- Expo Router 58: `initialRouteName` moved off `<Navigator>` / `<Slot>` to layout `unstable_settings` (`demo/app/_layout.tsx`, `demo/app/demo/sidebar-navigation/_layout.tsx`). `SidebarNavigation` stopped passing the prop.
- ActionSheet maps boolean `keyboardShouldPersistTaps` to `"always"` / `"never"` (RN 0.87 FlatList).
- `useUpgradeCheck` coalesces `AppState.current` with `?? ""`.
- TinyBase native persister: cast DB through `unknown` for expo-sqlite 58 vs TinyBase's `^57` peer types.
- 2026-09-18: `TextField` password-toggle internal ref is `TextInputInstance` (RN 0.88), not the `TextInput` component type. Master used `useRef<TextInput | null>` which failed `tsc` (`Property 'focus' does not exist on type 'TextInputType'`).
- 2026-09-13: dropped `customConditions: ["react-native-legacy-deep-imports"]`. ui + admin-frontend compile against RN 0.87 `types_generated`. Refs use `ViewInstance` / `ScrollViewInstance` / `TextInputInstance`. Deep import `react-native/Libraries/StyleSheet/StyleSheetTypes` replaced with `DimensionValue` from `react-native`.
- bun tests: mock Expo 58 `SharedRef` hole (`export {}` in `build/ts-declarations/SharedRef.js`).
- 2026-09-12: `example-frontend` and `demo` `bunx expo-doctor` 20/20. Same-version bun `expo` duplicates gone after hoisted reinstall. `tinybase>expo` keys removed so `npm explain` works. Directory check excludes `@react-native-community/blur` (unmaintained, used by `@terreno/ui`).

## Release notes draft

### Breaking

- Expo SDK 58 / React Native 0.88. `@terreno/ui` peer is `react-native` `0.88.0`. React is `19.3.0`.
- `react-native-gesture-handler` major 2 → 3 (`~3.3.0`).
- `@sentry/react-native` major 7 → 8 (`~8.28.0`).
- `react-native-webview` major 13 → 14 (`14.0.1`).
- Expo Router: `initialRouteName` is no longer a `<Navigator>` / `<Slot>` prop. Set `export const unstable_settings = { initialRouteName: "..." }` on the layout. `SidebarNavigation` `initialRouteName` is ignored. In-repo layouts set this (`demo/app/_layout.tsx`, `demo/app/demo/sidebar-navigation/_layout.tsx`, `example-frontend/app/_layout.tsx`).
- RN 0.87 generated types (no `react-native-legacy-deep-imports`): type refs as `ViewInstance` / `ScrollViewInstance` / `TextInputInstance` (re-exported from `@terreno/ui`). `Box.scrollRef` and `TextField.inputRef` use those. `TextStyle` is Readonly — build style objects instead of mutating `{}`. `Image.onError` is `ImageErrorEvent`. `TextInput.State.currentlyFocusedInput()` replaces deprecated `currentlyFocusedField()`.

### Native fingerprint

- `expo` `~58.0.14` (stable, npm `latest`)
- `react-native` `0.88.0`; `react` / `react-dom` `19.3.0`
- `react-native-gesture-handler` `~3.3.0`
- `react-native-reanimated` `4.7.1` + `react-native-worklets` `0.13.0`
- `react-native-screens` `~4.30.0`
- `react-native-safe-area-context` `~5.10.1`
- `react-native-webview` `14.0.1`
- `react-native-svg` `15.16.0`
- `@shopify/react-native-skia` `2.14.0`
- `@shopify/flash-list` `2.3.2`
- `@sentry/react-native` `~8.28.0` (major 7 → 8)
- every catalog `expo-*` / `@expo/*` / `babel-preset-expo` at its Expo 58.0.14 `bundledNativeModules.json` pin; override `expo-image-loader` `58.0.3`

### Expo API

- Router `unstable_settings.initialRouteName` replaces Navigator/Slot `initialRouteName`.
- RN 0.87 FlatList `keyboardShouldPersistTaps` is `"always" | "never" | "handled"`, not boolean.

### Other

- Created `release-58.0.0` from `origin/master` for Expo `58.0.0-preview.0`; continued to `58.0.0-preview.4` on 2026-09-21 (`npmTag: next`). Do not merge to master until the loop is `ready`.
- `create-terreno-app` emits Expo `~58.0.14`, RN `0.88.0`, React `19.3.0`.
- TinyBase still declares `expo-sqlite ^57` (9.7.1 and `10.0.0-beta.4`, rechecked 2026-09-22).
- 2026-09-22: merged master `ROADMAP.md`; compile/lint/doctor stayed green. TinyBase dist-tag `beta` moved to `10.0.0-beta.4` and still peers `expo-sqlite ^57`.
- 2026-09-21: pinned `58.0.0-preview.4`, RN `0.88.0-rc.1`, React `19.3.0`, screens `~4.28.0`. compile/lint/doctor green with no new RN type edits. TinyBase still peers `expo-sqlite ^57`.
- 2026-09-20: merged master `ROADMAP.md`; compile/lint/doctor stayed green with no new RN 0.88 type edits. TinyBase dist-tag `beta` moved to `10.0.0-beta.3` and still peers `expo-sqlite ^57`.
- 2026-09-19: merged master announcements admin, org/RBAC, and agent UI blocks; compile/lint/doctor stayed green with no new RN 0.88 type edits.
- Password `TextField` visibility toggle (merged from master) uses `TextInputInstance` on this train.
- example-frontend / demo `expo.doctor.reactNativeDirectoryCheck.exclude`: `@react-native-community/blur`.
