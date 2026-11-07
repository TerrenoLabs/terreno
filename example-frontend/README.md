# Example Frontend

Example Expo app demonstrating full-stack Terreno usage with @terreno/api backend, @terreno/syncdb for data, session, and requests, and @terreno/ui for components. Deployed to Netlify and, during an evaluation period, to Vercel on push to master (see [Deployment](#deployment)).

## Features

- **Authentication**: Better Auth email/password and social login; session state from `SessionProvider` / `useSession()` (`@terreno/syncdb/auth`)
- **No Redux**: session lives in `SessionProvider`, synced data in syncdb, request results in the syncdb request client's cache, and preferences in `useStoredState`
- **Type-safe API**: Generated request hooks (`store/apiSdk.ts`) for every non-synced route
- **Todo CRUD**: Local-first todo list on syncdb (works offline, syncs over the socket)
- **Profile Management**: User profile viewing and editing
- **Appearance**: Persisted Light, Dark, or Follow system theme choice under Profile → Appearance. The splash stays up until that stored choice is ready, and the status bar follows the resolved scheme.
- **Tab Navigation**: Expo Router with file-based routing
- **Cross-platform**: Runs on web, iOS, and Android
- **Admin UI v2**: Profile → Admin uses `@terreno/admin-frontend` with `AdminShellLayout` (sidebar + `AdminHome` dashboard from `/admin/config`), tools/model cards, configuration, scripts, and a static “Admin UI v2 map” screen — backed by the rich `AdminApp` setup in `example-backend`

## Prerequisites

- [Bun](https://bun.sh/) installed
- Backend server running (see `../example-backend/README.md`)
- For iOS: macOS with Xcode
- For Android: Android Studio with emulator

## Quick Start

1. **Install dependencies**:
   ```bash
   bun install
   ```

2. **Configure environment** (optional for local development):
   ```bash
   cp .env.example .env
   ```
   The app works out-of-the-box with default settings (connects to `http://localhost:4000`).

3. **Start the backend** (in a separate terminal):
   ```bash
   cd ../example-backend
   bun run dev
   ```

4. **Run the app**:
   ```bash
   # Web (recommended for first time)
   bun run web

   # iOS simulator
   bun run ios

   # Android emulator
   bun run android
   ```

## Environment Variables

The app uses Expo's environment variable system. Configuration is resolved in this priority order:

1. `app.json` `extra` field (for production/staging builds)
2. `process.env.EXPO_PUBLIC_API_URL` (for local web development)
3. `Constants.expoConfig.hostUri` + `:4000` (for simulator/device)
4. `http://localhost:4000` (fallback)

### Available Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `EXPO_PUBLIC_API_URL` | Backend API base URL | Auto-detected based on platform |
| `OPENAPI_URL` | OpenAPI spec URL for SDK generation | `http://localhost:4000/openapi.json` |

### For Web Development

Create a `.env` file:
```bash
EXPO_PUBLIC_API_URL=http://localhost:4000
OPENAPI_URL=http://localhost:4000/openapi.json
```

### For Production Builds

Edit `app.json` to add the `extra` field:
```json
{
  "expo": {
    "extra": {
      "BASE_URL": "https://api.example.com"
    }
  }
}
```

## Scripts

| Command | Description |
|---------|-------------|
| `bun run start` | Start Expo dev server (port 8082) |
| `bun run web` | Start web version |
| `bun run ios` | Start iOS simulator |
| `bun run android` | Start Android emulator |
| `bun run sdk` | Generate request hooks (`store/apiSdk.ts`) from the backend OpenAPI spec |
| `bun run sync-sdk` | Generate synced collection hooks (`store/syncDbSdk.ts`) |
| `bun run export` | Export static web build |
| `bun run build:vercel` | Vercel build: bake `EXPO_PUBLIC_API_URL` into `app.json` `extra`, then export |
| `bun run test` | Run tests |
| `bun run lint` | Lint code |
| `bun run lint:fix` | Fix lint issues |

## Deployment

The web app deploys from CI to two hosts on every push to `master`, plus a preview per PR:

- **Netlify** (`public/_redirects`), against the Cloud Run backend.
- **Vercel** (`vercel.json`), at https://terrenolabs-frontend.vercel.app against the Vercel backend at https://terrenolabs-backend.vercel.app. This runs in parallel with Netlify while the Vercel topology is evaluated.

`vercel.json` is wired to the real `terreno-frontend` Vercel project. It sets `"git": {"deploymentEnabled": false}`, so Vercel does not build on push; CircleCI runs `scripts/ci/vercel-deploy.sh frontend <production|preview>`. Its build command, `bun run build:vercel` (`scripts/vercelBuild.ts`), requires `EXPO_PUBLIC_API_URL` and writes `extra.BASE_URL`, `extra.apiBaseUrl`, and `extra.SOCKET_TRANSPORTS=websocket` into `app.json` before `expo export`. Run it in CI or a throwaway checkout: it rewrites `app.json`.

See [Deploy to Vercel](../docs/how-to/deploy-to-vercel.md).

## Project Structure

```
app/
  _layout.tsx          # Root layout: SessionProvider, ApiClientProvider, theme, auth routing,
                       #   syncdb start/stop, consents and announcements
  login.tsx            # Login screen (Better Auth)
  signup.tsx           # Sign-up screen (Better Auth)
  forgotPassword.tsx   # Password reset request
  resetPassword.tsx    # Password reset with a token
  verifyEmail.tsx      # Email verification with a token
  (tabs)/              # Tab navigation group
    _layout.tsx        # Tab layout
    index.tsx          # Todos list screen (syncdb)
    profile.tsx        # User profile screen
store/
  apiClient.ts         # Request client for non-synced routes; reports failures via errors.ts
  apiSdk.ts            # Generated request hooks (DO NOT EDIT)
  errors.ts            # Request client onError: logs failures, sends actionable ones to Sentry
  syncdb.ts            # syncdb clients + the auth provider shared with the request client
  syncDbSdk.ts         # Generated synced collection hooks (DO NOT EDIT)
lib/
  betterAuth.ts        # Better Auth client
  logout.ts            # Explicit logout: wipe syncdb, then end the session
components/            # Reusable React components
contexts/
  ThemePreferenceContext.tsx # Persisted light/dark/system theme provider
constants/             # App constants
hooks/                 # Custom React hooks
types/                 # Hand-written types layered on generated ones
utils/                 # Utility functions
```

## SDK Generation Workflow

After making changes to the backend API:

1. **Start the backend** (if not already running):
   ```bash
   cd ../example-backend
   bun run dev
   ```

2. **Generate the SDK**:
   ```bash
   bun run sdk
   ```

This fetches the OpenAPI spec from the backend and writes typed request hooks for every
non-synced route to `store/apiSdk.ts` (`useGetAuthMeQuery`, `usePatchAuthMeMutation`,
`useLazy…Query`, …). Synced collections (todos, notifications) use `bun run sync-sdk` and
syncdb's local-first hooks instead.

**Important**:
- Never modify `store/apiSdk.ts` or `store/syncDbSdk.ts` manually - they are generated
- A call the generated hook cannot express (for example per-call headers) wraps the
  generated request builder with `useApiMutation` / `useApiQuery` from `@terreno/syncdb/react`
  (see `components/TodoSummaryCard.tsx`)
- Always use generated hooks or syncdb for API calls (never use `axios` or `fetch` directly)

### Example Usage

```typescript
import {useGetAuthMeQuery, usePatchAuthMeMutation} from "@/store/apiSdk";

// In your component
const {data: profile, isLoading, error, refetch} = useGetAuthMeQuery(undefined, {skip: !userId});
const [updateProfile, {isLoading: isUpdating}] = usePatchAuthMeMutation();

const handleRename = async (name: string): Promise<void> => {
  try {
    await updateProfile({name}).unwrap();
  } catch (error) {
    console.error("Failed to update profile", error);
  }
};
```

Every hook shares one cache per request client. Mutations invalidate the tags their query
hooks provide (`usePatchAuthMeMutation` refreshes every `useGetAuthMeQuery`), and the root
layout calls `apiClient.reset()` whenever the signed-in user changes.

## Authentication Flow

1. App loads → `SessionProvider` reads the Better Auth session (`useSession().isLoading` until it resolves)
2. No `userId` → the root layout redirects to the login screen
3. Login calls `betterAuthClient.signIn.email`, then `useSession().refresh()`
4. With a `userId`, the root layout starts syncdb and navigates to the tabs
5. Logout (Profile) calls `useSession().logout()`: the syncdb clients passed to `SessionProvider`
   sign out and wipe this user's local data, then the Better Auth session ends → back to login

## App State

There is no Redux store:
- **Session**: `SessionProvider` / `useSession()` from `@terreno/syncdb/auth`
- **Synced data**: syncdb (`store/syncdb.ts`), persisted and encrypted on device
- **Request results**: the request client cache (`store/apiClient.ts`), cleared on user change
- **Preferences**: `useStoredState` from `@terreno/ui` (theme in `ThemePreferenceContext`,
  Gemini API key on the Profile screen)
- **Errors**: `store/errors.ts` is the request client's `onError`. It skips 401, 404, network
  failures, known auth/permission messages, and `disableExternalErrorTracking` errors; it sends
  everything else to Sentry with the method, URL, and summarized args.

## Development Tips

### Running on Physical Device

For iOS/Android devices on the same network:

1. Find your computer's local IP address
2. Set `EXPO_PUBLIC_API_URL` to `http://YOUR_LOCAL_IP:4000`
3. Run `bun run ios` or `bun run android`

### Debugging API Calls

Every failed request through the request client logs `METHOD url rejected query|mutation:
<title> (args: …)` at `console.debug` (see `store/errors.ts`). For synced collections, use the
`/syncdb-debug` screen in dev builds, or the `terreno-mcp-local` SyncDB tools.

### Hot Reloading

- Frontend: Hot reload works automatically with Expo dev server
- Backend: Backend has watch mode with `bun run dev`
- SDK: Regenerate after backend route changes with `bun run sdk`

## Common Issues

### "Network request failed"

**Problem**: App can't connect to backend.

**Solutions**:
- Ensure backend is running on port 4000
- For web: Use `http://localhost:4000`
- For simulator: Backend auto-detected via `Constants.expoConfig.hostUri`
- For physical device: Set `EXPO_PUBLIC_API_URL` to your computer's local IP

### "Invalid credentials"

**Problem**: Login fails.

**Solution**: Create a user first via backend:
```bash
# In example-backend directory
bun run dev
# Then use the API to create a user or sign up via the app
```

### SDK Generation Fails

**Problem**: `bun run sdk` errors.

**Solutions**:
- Ensure backend is running and accessible
- Check `OPENAPI_URL` in `.env`
- Verify backend's OpenAPI endpoint: `curl http://localhost:4000/openapi.json`

## Testing

```bash
# Run tests once
bun test

# Watch mode (during development)
bun test --watch
```

## Building for Production

### Web

```bash
bun run export
```

Output: `dist/` directory with static files ready for deployment.

### iOS/Android

Requires EAS (Expo Application Services):

1. Install EAS CLI: `npm install -g eas-cli`
2. Configure: `eas build:configure`
3. Build: `eas build --platform ios` or `eas build --platform android`

See [Expo documentation](https://docs.expo.dev/build/introduction/) for details.

### Native builds vs OTA updates (fingerprint)

The app uses `"runtimeVersion": {"policy": "fingerprint"}` (`app.json`). The
[fingerprint](https://docs.expo.dev/versions/latest/sdk/fingerprint/) is a hash
of everything that affects the **native** binary (native dependencies, config
plugins, app icon/scheme, SDK version, etc.). CI (`.github/workflows/eas-pr.yml`)
publishes an EAS Update for every PR and only triggers a **new native dev build**
when a fingerprint is brand-new — i.e. when *no* finished matching build exists
yet for that hash. The iOS and Android hashes are tracked separately, so an
iOS-only native change still builds iOS while Android stays on the fast path.
Once a fingerprint has a finished build, later JS-only PRs stay on the
update-only fast path even if one platform never got an artifact; seed those via
the manual **Trigger EAS Workflow** job instead of from every PR.

To keep this fast, `fingerprint.config.js` skips the Expo config `extra` section
and the `package.json` scripts section. Values in `extra` (e.g. `BASE_URL`,
`AUTH_DEBUG`, the EAS `projectId`) ship in the JS bundle, while package scripts
are development/build commands. Neither changes the native binary, so
`sourceSkips` includes `ExpoConfigExtraSection` and `PackageJsonScriptsAll`.

**Rule of thumb:** if your change only touches JS/TS (screens, components, store,
SDK), expect a quick OTA update. Only native dependency/config changes should
produce a long native build.

## Learn More

- [Terreno Documentation](../docs/README.md)
- [@terreno/ui Reference](../docs/reference/ui.md)
- [@terreno/syncdb Reference](../docs/reference/syncdb.md) (request client, auth, codegen)
- [Expo Router Documentation](https://docs.expo.dev/router/introduction/)

## Support

For issues or questions:
- Check the [main documentation](../docs/README.md)
- Review the [backend README](../example-backend/README.md)
- Examine the code - this example app demonstrates best practices

