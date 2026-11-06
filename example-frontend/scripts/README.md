# Frontend Scripts

SDK generation no longer lives here. Both SDKs come from the `@terreno/syncdb` codegen CLI
(`../syncdb/src/codegen/cli.ts`) run against the backend's OpenAPI spec:

- `bun run sdk` (alias of `bun run api-sdk`) writes `store/apiSdk.ts`: typed request hooks for
  every non-synced route.
- `bun run sync-sdk` writes `store/syncDbSdk.ts`: collection hooks for the synced collections.

Start the backend on port 4000 first, or set `OPENAPI_URL`.

## fingerprintConfig.test.ts

Checks that `fingerprint.config.js` in `demo` and `example-frontend` skips JavaScript-only
sources, so JS changes do not change the Expo native fingerprint.
