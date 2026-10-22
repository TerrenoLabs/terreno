# Auth and Tokens — Terreno

Session state lives in `@terreno/syncdb/auth`. There is no Redux store. Reference:
`docs/reference/syncdb.md#auth`, `example-frontend/lib/betterAuth.ts`, `app/login.tsx`.

## Better Auth client

```tsx
// lib/betterAuth.ts
import {createBetterAuthClient} from "@terreno/syncdb/auth";
import {baseUrl} from "@terreno/syncdb/config";

export const betterAuthClient = createBetterAuthClient({
  baseURL: baseUrl,
  scheme: "myapp",
  storagePrefix: "myapp",
});
```

Storage is `expo-secure-store` on native and AsyncStorage on web. Never store tokens in
plain AsyncStorage on native or in `EXPO_PUBLIC_*` env vars.

## Session provider

```tsx
<SessionProvider authClient={betterAuthClient} syncDbs={[syncDb]} onLogout={() => apiClient.reset()}>
  <App />
</SessionProvider>
```

```tsx
import {useSession} from "@terreno/syncdb/auth";

const {userId, user, isAuthenticated, isLoading, error, logout, refresh} = useSession();
```

## Login

```tsx
const {refresh} = useSession();

const result = await betterAuthClient.signIn.email({email, password});
if (!result.error) {
  await refresh(); // resolve userId now instead of waiting for the session atom
}
```

Use `SocialLoginButton` from `@terreno/ui` with `betterAuthClient.signIn.social({provider})`
for OAuth.

## Logout

```tsx
const {logout} = useSession();
await logout();
```

`logout()` signs out each `syncDbs` client first (wiping local rows when created with
`wipeOnSignOut: true`), then the auth server, then runs `onLogout`.

## Token refresh

`betterAuthAdapter(bridgeBetterAuthReactClient(betterAuthClient))` is the shared
`AuthProvider` for `createSyncDb` and `createApiClient`. The request client adds
`Authorization: Bearer`, and on a 401 calls `authProvider.refresh()` once and retries.
No manual refresh logic in app code. Code outside the client (SSE streams, `AdminProvider`
`getAuthHeaders`) reads `authProvider.getToken()`.

## JWT backends (legacy)

Apps on `@terreno/api` JWT routes use `jwtAuthAdapter` as both the `authProvider` and the
`SessionProvider` `source`, plus `useJwtAuth({adapter})` for `login`, `signup`,
`googleLogin`, `resetPassword`. It refreshes when under 130 s remain and on a 401, with one
shared refresh in flight. See `docs/reference/syncdb.md#jwt-auth-legacy`.

## Current user

```tsx
import {useGetAuthMeQuery} from "@/store/apiSdk";

const {userId} = useSession();
const {data: me} = useGetAuthMeQuery(undefined, {skip: !userId});
```

## Protected routes

Gate navigation on `useSession().userId` in root `_layout.tsx`. Redirect unauthenticated
users to `/login`. For admin routes, check `canOpenAdminPage({admin: me?.admin, permissions:
me?.permissions})` from `@terreno/syncdb/app`.
