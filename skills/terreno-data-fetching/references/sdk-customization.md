# SDK Customization — Terreno

## Generated vs hand-maintained

| File | Editable? | Purpose |
|------|-----------|---------|
| `store/apiSdk.ts` | **Never** | Typed hooks for every non-synced OpenAPI operation (`--api-out`) |
| `store/syncDbSdk.ts` | **Never** | `SYNC_COLLECTIONS` + collection hooks (`--out`) |
| `store/apiClient.ts` | **Yes** | `createApiClient` (auth, headers, `onError`) |
| `syncdb-codegen.json` | **Yes** | Codegen config (`excludePaths`, per-collection `overrides`) |

## Generated hooks

Names follow the old RTK codegen rule: camelCased `operationId`, otherwise method + path with
`{param}` as `By<Param>` (`PATCH /gpt/histories/{id}` → `usePatchGptHistoriesByIdMutation`).
Each operation also gets `<Name>Args`, `<Name>Res`, and `<name>Request(arg)` for
`apiClient.request(...)`. Tags come from the operation's OpenAPI tags.

```tsx
import {useGetAuthMeQuery, usePatchAuthMeMutation} from "@/store/apiSdk";
```

## Routes outside OpenAPI

Prefer documenting the route in OpenAPI and regenerating. When that is not possible, call it
directly through the request client:

```tsx
import {useApiMutation, useApiQuery, useLazyApiQuery} from "@terreno/syncdb/react";

const {data, isLoading, refetch} = useApiQuery<Report>(
  {url: "/reports/summary", params: {range}},
  {providesTags: ["reports"], skip: !userId}
);

const [rebuild, {isLoading: isRebuilding}] = useApiMutation<RebuildBody, Report>(
  (body) => ({body, method: "POST", url: "/reports/rebuild"}),
  {invalidatesTags: ["reports"]}
);
await rebuild({range}).unwrap();
```

## Cache tags

Queries register `providesTags`; mutations `invalidatesTags`. Imperatively:
`apiClient.invalidateTags(["reports"])`. `apiClient.reset()` clears the cache (done on logout
via `SessionProvider` `onLogout`). Synced collections have no request cache; their data is local.

## Workflow after backend change

1. Start backend (`bun run backend:dev`)
2. Run `cd example-frontend && bun run sdk` (and `bun run sync-sdk` for synced schema changes)
3. Import new hooks from `@/store/apiSdk` (or `@/store/syncDbSdk`)

See the `generate-sdk` skill for the full procedure.
