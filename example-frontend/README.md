# Example Frontend

Example Expo app demonstrating full-stack Terreno usage with @terreno/api backend, @terreno/rtk for state management, and @terreno/ui for components. Deployed to Netlify on push to master.

## Features

- **Authentication**: Email/password login with JWT tokens
- **Redux State**: Redux Toolkit with persistence and auth management
- **Type-safe API**: Generated RTK Query hooks from backend OpenAPI spec
- **Todo CRUD**: Complete todo list with create, read, update, delete
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
| `bun run sdk` | Generate API SDK from backend OpenAPI spec |
| `bun run export` | Export static web build |
| `bun run test` | Run tests |
| `bun run lint` | Lint code |
| `bun run lint:fix` | Fix lint issues |

## Project Structure

```
app/
  _layout.tsx          # Root layout with Redux, auth, theme providers
  login.tsx            # Login screen
  (tabs)/              # Tab navigation group
    _layout.tsx        # Tab layout (Todos, Profile)
    index.tsx          # Todos list screen
    profile.tsx        # User profile screen
store/
  index.ts             # Redux store configuration
  appState.ts          # App-level state (language)
  openApiSdk.ts        # Generated RTK Query hooks (DO NOT EDIT)
  sdk.ts               # SDK exports with custom endpoints
  errors.ts            # Error handling middleware
components/            # Reusable React components
contexts/
  ThemePreferenceContext.tsx # Persisted light/dark/system theme provider
constants/             # App constants
hooks/                 # Custom React hooks
utils/                 # Utility functions
openapi-config.ts      # SDK generation configuration
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

This fetches the OpenAPI spec from the backend and generates type-safe RTK Query hooks in `store/openApiSdk.ts`.

**Important**: 
- Never modify `store/openApiSdk.ts` manually - it's auto-generated
- Custom endpoints go in `store/sdk.ts`
- Always use generated hooks for API calls (never use `axios` or `fetch` directly)

### Example Usage

```typescript
import {useGetTodosQuery, usePostTodosMutation} from "@/store/sdk";

// In your component
const {data, isLoading, error, refetch} = useGetTodosQuery({completed: false});
const [createTodo, {isLoading: isCreating}] = usePostTodosMutation();

// Create a todo
const handleCreate = async () => {
  try {
    await createTodo({title: "New todo", completed: false}).unwrap();
  } catch (err) {
    console.error("Failed to create todo", err);
  }
};
```

## Authentication Flow

1. App loads → Redux state rehydrates from AsyncStorage
2. No `userId` in auth state → navigate to login screen
3. Login screen calls `useEmailLoginMutation`
4. On success → tokens stored automatically → `setUserId` dispatched
5. App navigates to tabs
6. Logout → `logout` action dispatched → tokens cleared → back to login

## Redux Store

The store combines:
- **auth**: JWT authentication (from `@terreno/rtk`)
- **appState**: Language preferences
- **openapi**: RTK Query API slice with all endpoints

### Persistence

Uses `redux-persist` with AsyncStorage:
- Auth state persists across app restarts
- Blacklisted slices: tracking, terreno-rtk, profiles
- SSR-safe storage wrapper (checks `typeof window`)

## Development Tips

### Running on Physical Device

For iOS/Android devices on the same network:

1. Find your computer's local IP address
2. Set `EXPO_PUBLIC_API_URL` to `http://YOUR_LOCAL_IP:4000`
3. Run `bun run ios` or `bun run android`

### Debugging API Calls

Enable debug logging in `app.json`:
```json
{
  "expo": {
    "extra": {
      "AUTH_DEBUG": "true",
      "WEBSOCKETS_DEBUG": "true"
    }
  }
}
```

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
- Check `OPENAPI_URL` in `.env` or `openapi-config.ts`
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
- [@terreno/rtk Reference](../docs/reference/rtk.md)
- [Expo Router Documentation](https://docs.expo.dev/router/introduction/)
- [RTK Query Documentation](https://redux-toolkit.js.org/rtk-query/overview)

## Support

For issues or questions:
- Check the [main documentation](../docs/README.md)
- Review the [backend README](../example-backend/README.md)
- Examine the code - this example app demonstrates best practices
