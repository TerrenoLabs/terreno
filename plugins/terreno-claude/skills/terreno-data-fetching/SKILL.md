---
name: terreno-data-fetching
description: >-
  Use when implementing or debugging ANY network request, API call, or data
  fetching in a Terreno app. Covers syncdb collection CRUD, generated request
  hooks (store/apiSdk.ts) for non-synced routes, session auth, socket pushes,
  feature flags, admin's host-bound fetch client, and SDK regeneration. Replaces direct fetch, axios, React Query, and SWR in
  application code.
  Lifecycle composition: Grow for data-flow shape, Pick for implementation, Roast
  for independent network/cache behavior proof.
---
# Terreno Data Fetching

**You MUST use this skill for ANY networking work in Terreno apps.** Everything goes
through `@terreno/syncdb`: `useQuery` / `useMutate` for synced collection CRUD, and
generated hooks on the `@terreno/syncdb/api` request client for every other route.
Never call `axios`, raw `fetch`, React Query, or SWR from application screens.
`@terreno/rtk` and Redux were removed in Terreno 58; upgrade old code with
`docs/how-to/migrate-rtk-to-syncdb.md`.

**Related skills:** `generate-sdk` (regenerate hooks after backend changes), `terreno-backend-api` (create backend routes), `building-terreno-apps` (screen integration).

## Documentation

1. Read `docs/reference/syncdb.md`, `docs/how-to/migrate-rtk-to-syncdb.md`, `docs/how-to/use-syncdb-correctly.md`, and auth/realtime explanation pages before changing fetch, cache, or session behavior.
2. Implement against that design.
3. Update those pages in the same slice with `update-docs`.
4. Ship without matching docs is a failed slice.

## References

```
references/
  auth-and-tokens.md     SessionProvider/useSession, login/logout, token refresh, JWT
  realtime.md            Socket events, feature flags, sync status
  sdk-customization.md   Generated apiSdk.ts, ad-hoc useApiQuery/useApiMutation, cache tags
```

## When to Use

- Implementing API requests in screens or hooks
- Setting up authentication (login, logout, token refresh)
- Debugging network failures or stale data
- Connecting realtime updates (sockets, feature flags)
- Configuring API URLs and environment variables
- After any backend route or model change (regenerate SDK)

## Core Rules

1. **Use syncdb hooks** (`useQuery`, `useEntity`, `useWindowQuery`, `useMutate`) for synced collection CRUD.
2. **Use generated hooks** from `store/apiSdk.ts` (`terreno-syncdb-codegen --api-out`) for every
   non-synced route: `/auth/me`, modelRouter actions, AI, consents, announcements.
3. **Never edit `store/apiSdk.ts` or `store/syncDbSdk.ts`** — regenerate with `generate-sdk`.
4. **Ad-hoc routes not in OpenAPI** use `useApiQuery` / `useLazyApiQuery` / `useApiMutation`
   from `@terreno/syncdb/react`. Prefer documenting the route in OpenAPI and regenerating.
5. **Never use `axios` or raw `fetch`** in app code. Exceptions: SSE streams (`/gpt/prompt`)
   authenticated with `authProvider.getToken()`, and framework-owned admin requests
   (`@terreno/admin-frontend` binds `adminRequest` from `AdminProvider` `credentials` /
   `getAuthHeaders` / `apiOrigin`).
6. **Admin uses its own fetch client.** String-`_id` models with `adminBroadcast` use
   windowed syncdb; ObjectId/API-only CRUD uses `useAdminModelApi`; admin RPC uses
   `useAdminRpc`. Admin components take no `api` prop (removed in Terreno 58).

## Quick Start

### Synced collection read

```tsx
import {useQuery} from "@terreno/syncdb/react";

const TodosScreen: React.FC = () => {
  const todos = useQuery<Todo>("todos", {
    filter: (todo) => !todo.completed,
  });
};
```

### Synced collection write

```tsx
import {generateMutationId} from "@terreno/syncdb";
import {useMutate} from "@terreno/syncdb/react";

const {create, update} = useMutate("todos");

const handleCreate = useCallback((): void => {
  create({data: {_id: generateMutationId(), title: "New todo", completed: false}});
}, [create]);

const handleToggle = useCallback((id: string, completed: boolean): void => {
  update({id, data: {completed: !completed}});
}, [update]);
```

### Non-synced route

```tsx
import {useGetAuthMeQuery, usePatchAuthMeMutation} from "@/store/apiSdk";

const {data: me, isLoading} = useGetAuthMeQuery(undefined, {skip: !userId});
const [updateMe, {isLoading: isSaving}] = usePatchAuthMeMutation();
await updateMe({name}).unwrap();
```

### Auth

```tsx
import {useSession} from "@terreno/syncdb/auth";

const {userId, isAuthenticated, isLoading, logout} = useSession();
```

See `./references/auth-and-tokens.md` for the full auth flow.

## Client Setup

One `authProvider` feeds the sync client and the request client, so both send the same
token and refresh on a 401 the same way. Reference: `example-frontend/store/syncdb.ts`,
`store/apiClient.ts`, `app/_layout.tsx`.

```tsx
// store/syncdb.ts
export const authProvider = betterAuthAdapter(bridgeBetterAuthReactClient(betterAuthClient));
export const syncDb = createSyncDb({authProvider, baseUrl, collections: [...SYNC_COLLECTIONS], name: "myapp", wipeOnSignOut: true});

// store/apiClient.ts
export const apiClient = createApiClient({authProvider, baseUrl, credentials: "include", headers: appHeaders});

// app/_layout.tsx — no Redux store
<SessionProvider authClient={betterAuthClient} syncDbs={[syncDb]} onLogout={() => apiClient.reset()}>
  <ApiClientProvider client={apiClient}>
    <SyncDbProvider client={syncDb}>{children}</SyncDbProvider>
  </ApiClientProvider>
</SessionProvider>
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `EXPO_PUBLIC_API_URL` | Backend URL for web dev (e.g. `http://localhost:4000`) |
| `EXPO_PUBLIC_DEV_API_PORT` | Dev API port when using Expo host URI (default `4000`) |
| `expo.extra.BASE_URL` | Production/staging API URL in `app.json` |

Base URL resolution priority (`baseUrl` from `@terreno/syncdb/config`):

1. `expo.extra.BASE_URL`
2. `EXPO_PUBLIC_API_URL`
3. Expo dev server host + dev API port
4. `http://localhost:4000`

Never put server secrets in `EXPO_PUBLIC_*` variables.

## Error Handling

Request hooks expose `ApiError` (`@terreno/syncdb/api`) on the result:

```tsx
const {error, isError} = useGetAuthMeQuery();

if (isError) {
  // error.status, error.data.title, error.data.detail; status 0 = network error or timeout
  console.error("Query failed", error);
}
```

For mutations, use `.unwrap()`:

```tsx
try {
  await updateMe({name}).unwrap();
} catch (error) {
  if (isApiError(error)) {
    console.error("Mutation failed", error.data.title);
  }
}
```

Report every request failure once with `createApiClient({onError})` (skip Sentry when
`error.data.disableExternalErrorTracking` is `true`). Synced writes never throw: rejected
writes surface in `useConflicts()` and `useSyncStatus().failedCount`.

## SDK Regeneration

After a backend API change, run the `generate-sdk` skill.

```bash
# Backend running on :4000, then:
cd example-frontend && bun run sdk        # store/apiSdk.ts (non-synced routes)
cd example-frontend && bun run sync-sdk   # store/syncDbSdk.ts (synced collections)
```

Triggers: custom routes, modelRouter actions, non-synced `modelRouter` routes, and OpenAPI
edits (`sdk`); synced schema or `sync` config changes (`sync-sdk`).

## Decision Tree

```
Need data in a Terreno app?
  |-- Synced collection CRUD?
  |   \-- @terreno/syncdb hooks
  |
  |-- Non-synced API route?
  |   \-- useGet*/usePost* from store/apiSdk.ts
  |
  |-- Built-in admin?
  |   |-- String id + adminBroadcast -> windowed syncdb
  |   |-- Framework RPC -> AdminProvider adminRequest (useAdminRpc)
  |   \-- ObjectId / API-only CRUD -> useAdminModelApi
  |
  |-- Login/logout?
  |   \-- references/auth-and-tokens.md
  |
  |-- Server push / feature flags?
  |   \-- references/realtime.md (useSocketEvent, @terreno/syncdb/flags)
  |
  |-- Custom endpoint not in SDK?
  |   |-- Backend exists? -> generate-sdk first
  |   \-- Route outside OpenAPI? -> references/sdk-customization.md (useApiQuery)
  |
  |-- Backend doesn't exist?
  |   \-- terreno-backend-api, then generate-sdk
  |
  \-- Using axios/direct fetch/React Query?
      \-- STOP — choose syncdb or a generated hook
```

## Common Mistakes

**Wrong: axios**

```tsx
const result = await axios.get("/todos");
```

**Right: syncdb for a synced collection**

```tsx
const todos = useQuery<Todo>("todos");
```

**Wrong: manual token in fetch**

```tsx
fetch(url, {headers: {Authorization: `Bearer ${token}`}});
```

**Right: a generated hook handles auth for a non-synced route**

```tsx
const {data: profile} = useGetAuthMeQuery();
```

**Wrong: editing store/apiSdk.ts**

```tsx
// Adding a new endpoint by hand
```

**Right: regenerate**

```bash
cd example-frontend && bun run sdk
```

**Wrong: refusing a synced write with 403 from a router hook**

```typescript
throw new APIError({status: 403, title: "Not a member"}); // in preCreate — halts the client outbox
```

**Right: 422, so syncdb nacks it as `validation`**

```typescript
throw new APIError({status: 422, title: "Not a member"});
```

**Wrong: rendering the empty state from `useQuery` before the stream bootstraps.** An empty array before bootstrap looks the same as an empty collection. Gate on the stream's `bootstrapped` cell. See `docs/how-to/use-syncdb-correctly.md` for this and the other pitfalls (cold-start cost per stream, dropped ack warnings, phantom creates, unresolved conflicts).

## Example Invocations

- "How do I fetch todos?" → `useQuery("todos")` from `@terreno/syncdb/react`
- "How do I handle login?" → `betterAuthClient.signIn.email` then `useSession().refresh()`
- "Should I use React Query?" → No — syncdb for collections, generated `store/apiSdk.ts` hooks for non-synced routes
- "API calls return 401" → Check the shared `authProvider`; see auth-and-tokens.md
- "Old code imports `@terreno/rtk`" → `docs/how-to/migrate-rtk-to-syncdb.md`
- "Hooks are missing after backend change" → Run `generate-sdk` skill
- "How do I add a custom endpoint?" → Backend route + OpenAPI, then regenerate the SDK
