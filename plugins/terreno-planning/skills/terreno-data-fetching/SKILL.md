---
name: terreno-data-fetching
description: >-
  Use when implementing or debugging ANY network request, API call, or data
  fetching in a Terreno app. Covers syncdb collection CRUD, RTK Query generated
  hooks for non-synced routes, admin's host-bound fetch client, auth, caching,
  and SDK regeneration. Replaces direct fetch, axios, React Query, and SWR in
  application code.
  Lifecycle composition: Grow for data-flow shape, Pick for implementation, Roast
  for independent network/cache behavior proof.
---
# Terreno Data Fetching

**You MUST use this skill for ANY networking work in Terreno apps.** Use syncdb
for synced collection CRUD and generated RTK Query hooks for non-synced routes.
Never call `axios`, raw `fetch`, React Query, or SWR from application screens.

**Related skills:** `generate-sdk` (regenerate hooks after backend changes), `terreno-backend-api` (create backend routes), `building-terreno-apps` (screen integration).

## Documentation

1. Read `docs/reference/syncdb.md`, `docs/how-to/migrate-rtk-to-syncdb.md`, `docs/how-to/use-syncdb-correctly.md`, and auth/realtime explanation pages before changing fetch, cache, or session behavior.
2. Implement against that design.
3. Update those pages in the same slice with `update-docs`.
4. Ship without matching docs is a failed slice.

## References

```
references/
  auth-and-tokens.md     generateAuthSlice, login/logout, token refresh
  realtime.md             Sockets, feature flags, server status
  sdk-customization.md   injectEndpoints, cache tags, hand-maintained sdk.ts
```

## When to Use

- Implementing API requests in screens or hooks
- Setting up authentication (login, logout, token refresh)
- Debugging network failures or stale data
- Connecting realtime updates (sockets, feature flags)
- Configuring API URLs and environment variables
- After any backend route or model change (regenerate SDK)

## Core Rules

1. **Use syncdb hooks** (`useQuery`, `useEntity`, `useMutate`) for synced collection CRUD.
2. **Use generated hooks** from `store/openApiSdk.ts` (or `store/sdk.ts`) for non-synced routes.
3. **Never edit `openApiSdk.ts` manually** — regenerate with `generate-sdk`.
4. **Never use `axios` or raw `fetch`** in app code. Framework-owned admin RPC
   is the exception: `@terreno/admin-frontend` binds `adminRequest` from host
   `credentials` / `getAuthHeaders`.
5. **Do not add new admin `injectEndpoints`.** String-`_id` models with
   `adminBroadcast` use windowed syncdb; ObjectId compatibility CRUD remains RTK
   until Terreno 58 removes `useAdminApi` and the required `api` prop.

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
import {useMutate} from "@terreno/syncdb/react";

const {create, update} = useMutate("todos");

const handleCreate = useCallback((): void => {
  create({data: {title: "New todo", completed: false}});
}, [create]);

const handleToggle = useCallback((id: string, completed: boolean): void => {
  update({id, data: {completed: !completed}});
}, [update]);
```

### Auth

```tsx
import {generateAuthSlice} from "@terreno/rtk";
import {terrenoApi} from "@/store/sdk";

const {authReducer, logout, middleware} = generateAuthSlice(terrenoApi);

// In a component:
import {useEmailLoginMutation} from "@/store/sdk";
import {useSelectCurrentUserId} from "@terreno/rtk";

const [login] = useEmailLoginMutation();
const userId = useSelectCurrentUserId();
```

See `./references/auth-and-tokens.md` for the full auth flow.

## Redux Store Setup

```tsx
import {configureStore} from "@reduxjs/toolkit";
import {generateAuthSlice} from "@terreno/rtk";
import {terrenoApi} from "./sdk";

const authSlice = generateAuthSlice(terrenoApi);

const store = configureStore({
  reducer: {
    auth: authSlice.authReducer,
    [terrenoApi.reducerPath]: terrenoApi.reducer,
  },
  middleware: (getDefault) =>
    getDefault().concat(terrenoApi.middleware, ...authSlice.middleware),
});

export const {logout} = authSlice;
```

See `example-frontend/store/index.ts` for persist and Sentry integration.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `EXPO_PUBLIC_API_URL` | Backend URL for web dev (e.g. `http://localhost:4000`) |
| `EXPO_PUBLIC_DEV_API_PORT` | Dev API port when using Expo host URI (default `4000`) |
| `expo.extra.BASE_URL` | Production/staging API URL in `app.json` |

Base URL resolution priority (from `@terreno/rtk`):

1. `expo.extra.BASE_URL`
2. `EXPO_PUBLIC_API_URL`
3. Expo dev server host + dev API port
4. `http://localhost:4000`

Never put server secrets in `EXPO_PUBLIC_*` variables.

## Error Handling

RTK Query exposes errors on the hook result:

```tsx
const {error, isError} = useGetMeQuery();

if (isError) {
  // error is FetchBaseQueryError | SerializedError
  console.error("Query failed", error);
}
```

For mutations, use `.unwrap()`:

```tsx
try {
  await updateMe({name}).unwrap();
} catch (err) {
  // Handle APIError-shaped responses from @terreno/api
  console.error("Mutation failed", err);
}
```

Use `isNetworkFetchError` from `@terreno/rtk` to detect connectivity issues in error UI.

## SDK Regeneration

After a non-synced backend API change, run the `generate-sdk` skill. Synced
collection CRUD does not belong in the OpenAPI SDK.

```bash
# Backend running on :4000, then:
cd example-frontend && bun run sdk
```

Triggers: custom routes, non-synced `modelRouter` routes, and OpenAPI builder
edits. Regenerate syncdb collection types/hooks with its codegen when a synced
schema changes.

## Decision Tree

```
Need data in a Terreno app?
  |-- Synced collection CRUD?
  |   \-- @terreno/syncdb hooks
  |
  |-- Non-synced API route?
  |   \-- useGet*/usePost* from generated SDK
  |
  |-- Built-in admin?
  |   |-- String id + adminBroadcast -> windowed syncdb
  |   |-- Framework RPC -> host-bound adminRequest
  |   \-- ObjectId compatibility CRUD -> useAdminApi until Terreno 58
  |
  |-- Login/logout?
  |   \-- references/auth-and-tokens.md
  |
  |-- Realtime updates?
  |   \-- references/realtime.md (useSocketConnection)
  |
  |-- Custom endpoint not in SDK?
  |   |-- Backend exists? -> generate-sdk first
  |   \-- App-only extension? -> references/sdk-customization.md
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
const {data: profile} = useGetMeQuery();
```

**Wrong: editing openApiSdk.ts**

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
- "How do I handle login?" → `useEmailLoginMutation` + `generateAuthSlice`
- "Should I use React Query?" → No — syncdb for collections, generated RTK hooks for non-synced routes
- "API calls return 401" → Check token refresh; see auth-and-tokens.md
- "Hooks are missing after backend change" → Run `generate-sdk` skill
- "How do I add a custom endpoint?" → Backend route + OpenAPI, then regenerate the SDK
