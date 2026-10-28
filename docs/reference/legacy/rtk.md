# @terreno/rtk (removed)

`@terreno/rtk` was removed in **Terreno 58.0.0**. It is not published for 58 or later, and no
Terreno package depends on Redux. To upgrade, follow
[How to upgrade from @terreno/rtk to @terreno/syncdb](../../how-to/migrate-rtk-to-syncdb.md),
which maps every former export to its replacement.

| Former `@terreno/rtk` area | Terreno 58 home |
|----------------------------|-----------------|
| RTK Query base API and `@rtk-query/codegen-openapi` SDK | `createApiClient` (`@terreno/syncdb/api`) and `terreno-syncdb-codegen --api-out` → `store/apiSdk.ts` |
| Collection CRUD hooks | `useQuery` / `useMutate` (`@terreno/syncdb/react`) |
| Better Auth client and Redux slice | `createBetterAuthClient`, `SessionProvider`, `useSession` (`@terreno/syncdb/auth`) |
| JWT `generateAuthSlice` | `jwtAuthAdapter`, `useJwtAuth` (`@terreno/syncdb/auth`) |
| `baseUrl`, `baseWebsocketsUrl`, base URL resolution | `@terreno/syncdb/config` |
| `useSocketConnection` | The syncdb socket: `useSocketEvent` (`@terreno/syncdb/react`) |
| `useFeatureFlags`, `useTerrenoFeatureFlags` | `@terreno/syncdb/flags` |
| `useUpgradeCheck`, permissions helpers, dev console logger, `useMCPTools` | `@terreno/syncdb/app` |
| `@terreno/rtk/buildNumber` | `@terreno/syncdb/buildNumber` |
| Offline middleware, `useOfflineStatus`, `useServerStatus` | The syncdb outbox and `useSyncStatus` (`@terreno/syncdb/react`) |

Apps that stay on Terreno 57.x keep using `@terreno/rtk` 57.x. Its reference is in the 57.x
docs snapshot.

See also: [`@terreno/syncdb` reference](../syncdb.md) and the
[58.0.0 upgrade note](https://github.com/TerrenoLabs/terreno/blob/master/mcp-server/src/docs/upgrades/58.0.0.md#terrenortk-and-redux-are-removed).