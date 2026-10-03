# Upgrade ordering

Why the `upgrading-terreno` skill bumps packages in a fixed order. Packages below are every published job in `.github/workflows/publish-on-tag.yml`.

## Package classes

| Class | Packages (`publish-on-tag.yml` job) |
| --- | --- |
| Backend | `api`, `test`, `admin-backend`, `blocks`, `ai`, `api-health`, `comms`, `feature-flags`, `mcp` |
| Frontend | `ui`, `rtk`, `syncdb`, `admin-frontend`, `admin-spa` |

`blocks` holds contracts that both `ai` and `ui` depend on, so it moves with the backend step.

`demo` and the example apps are not published.

## Backend before frontend

The OpenAPI document from the running backend is the contract `bun run sdk` consumes. Regenerating the client against an **un-upgraded** backend produces hooks for the old surface: new routes and fields are missing, and consumer screens fail at **compile** (`Property X does not exist on type …` or a missing generated hook).

Bump and compile backend packages first, then start that backend, then regenerate.

## Typed client only after the new backend is up

`example-frontend` codegen reads `http://localhost:4000/openapi.json` (or `OPENAPI_URL`). If the process is still the old binary, the file `store/openApiSdk.ts` is silently stale. Symptom: runtime 404 on new paths or TypeScript errors after you edit screens to call new endpoints that the SDK never emitted.

## Expo before `@terreno/ui`

`ui/package.json` `peerDependencies` pin `react-native` to the Expo line (for example `~0.86.0` on Terreno 57). Installing `@terreno/ui@57` while the app is still on Expo 54 / RN 0.81 fails peer resolution or breaks at Metro/native build. Symptom: `ERESOLVE` / unmet peer, or a native module ABI mismatch after `expo start`.

Run `upgrading-expo` (skill name) before bumping Terreno frontend packages when the Terreno major tracks a new Expo SDK.

## Violation symptoms

| If you… | What breaks |
| --- | --- |
| Bump `@terreno/ui` before Expo | Unmet `react-native` peers; native rebuild required anyway |
| Run `bun run sdk` before upgrading/starting the backend | Generated client missing new operations; compile errors in screens |
| Bump frontend `@terreno/*` before backend compile | Client types and server handlers disagree; 4xx/5xx on new fields |
| Mix `@terreno/api@57` with `@terreno/ui@0.31` | Unsupported; lockstep publish tags one version for every package |
| Continue after a failed `compile` | Half-upgraded lockfile; rollback is unclear |
