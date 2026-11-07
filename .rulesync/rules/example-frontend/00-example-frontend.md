---
targets: ["cursor", "devin", "copilot", "claudecode"]
description: "example-frontend - Expo app demonstrating full-stack Terreno usage"
globs: ["**/*"]
---

# example-frontend

Example Expo app demonstrating full-stack usage with @terreno/api backend, @terreno/syncdb for data, session, and requests, and @terreno/ui for components. There is no Redux. This is a **frontend-only** app — no Express, no Mongoose, no backend code.

## Commands

```bash
bun run start            # Start Expo dev server (port 8082)
bun run web              # Start web version
bun run ios              # Start iOS simulator
bun run android          # Start Android emulator
bun run sdk              # Generate request hooks (store/apiSdk.ts) from the backend OpenAPI spec
bun run sync-sdk         # Generate synced collection hooks (store/syncDbSdk.ts)
bun run test             # Run tests
bun run lint             # Lint code
bun run lint:fix         # Fix lint issues
```

## Architecture

### File Structure

```
app/
  _layout.tsx            # Root layout: SessionProvider, ApiClientProvider, theme, auth routing,
                         #   syncdb start/stop, consents and announcements
  login.tsx / signup.tsx # Better Auth sign-in / sign-up, then useSession().refresh()
  forgotPassword.tsx, resetPassword.tsx, verifyEmail.tsx  # Account recovery (Better Auth + JWT fallback)
  (tabs)/
    _layout.tsx          # Tab navigation
    index.tsx            # Todos (syncdb)
    profile.tsx          # User profile
store/
  apiClient.ts           # Request client for non-synced routes (onError → errors.ts)
  apiSdk.ts              # Generated request hooks (DO NOT EDIT MANUALLY)
  errors.ts              # reportApiError: request client onError with Sentry filtering
  syncdb.ts              # syncdb clients, shared authProvider, getAdminAuthHeaders
  syncDbSdk.ts           # Generated synced collection hooks (DO NOT EDIT MANUALLY)
lib/
  betterAuth.ts          # Better Auth client
types/                   # Hand-written types layered on generated ones (e.g. gptHistory.ts)
```

### Key Integration Points

1. **Root layout** (`app/_layout.tsx`): `SessionProvider` (Better Auth) → `ApiClientProvider` → `AppThemeProvider`. Reads `userId` / `isLoading` from `useSession()`, redirects to `/login` when signed out, starts and stops `syncDb` and calls `apiClient.reset()` whenever `userId` changes.
2. **Request client** (`store/apiClient.ts`): `createApiClient` from `@terreno/syncdb/api` with the same `authProvider` as syncdb, `appHeaders`, and `onError: reportApiError`.
3. **SDK** (`store/apiSdk.ts`): Generated hooks for every non-synced route, from `terreno-syncdb` codegen (`--api-out`). Synced collections use `store/syncDbSdk.ts` and syncdb hooks.

## API Usage Patterns

Use generated hooks for non-synced routes and syncdb for synced collections — never axios:

```typescript
import {useSession} from "@terreno/syncdb/auth";
import {useGetAuthMeQuery, usePatchAuthMeMutation} from "@/store/apiSdk";

const {userId} = useSession();
const {data: profile, isLoading, error, refetch} = useGetAuthMeQuery(undefined, {skip: !userId});
const [updateProfile, {isLoading: isUpdating}] = usePatchAuthMeMutation();

const handleRename = useCallback(async (name: string): Promise<void> => {
  try {
    await updateProfile({name}).unwrap();
  } catch (error) {
    console.error("Failed to update profile", error);
  }
}, [updateProfile]);
```

- Mutations invalidate the tags their queries provide; call `useApiClient().invalidateTags([...])` only for changes made outside the request client (e.g. a Better Auth call).
- When a generated hook cannot express a call (per-call headers), wrap the generated `…Request` builder with `useApiMutation` / `useApiQuery` from `@terreno/syncdb/react`.
- Errors are `ApiError` (`status`, `data.title`).
- `fetch` is only for SSE streams and multipart uploads that the client cannot express; authenticate with the session token.

## Authentication Flow

1. `SessionProvider` reads the Better Auth session on mount (`useSession().isLoading` until it resolves)
2. No `userId` → root layout redirects to `/login`
3. Login calls `betterAuthClient.signIn.email`, then `useSession().refresh()`
4. `userId` set → root layout starts syncdb and navigates to the tabs
5. Logout: `useSession().logout()` signs the `SessionProvider` `syncDbs` (`syncDb`, `adminSyncDb`) out first (wiping local data), then ends the Better Auth session

## App State

- Session: `useSession()`; never store auth state elsewhere
- Synced data: syncdb hooks; request results: the request client cache
- Device preferences: `useStoredState` from `@terreno/ui` (theme via `ThemePreferenceContext`)
- Local form state: `useState`

## Expo Router Navigation

- File-based routing in `app/` directory
- `(tabs)/` group for bottom tab navigation
- Conditional routing based on session state in root `_layout.tsx`
- Tab icons use FontAwesome via `@expo/vector-icons`

## Conventions

- Use @terreno/ui components (Box, Text, Button, Card) — never raw View/Text
- Use generated SDK hooks or syncdb for all API calls
- Use `useCallback` for all event handlers
- Handle loading, error, and empty states in all screens
- Keep testIDs stable; e2e specs depend on them
- Use `console.info/debug/warn/error` for permanent logs
- Use Luxon for date operations
- Always support React Native Web
