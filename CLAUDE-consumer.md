# CLAUDE.md Template for Terreno Projects

Copy this file as `CLAUDE.md` to projects that use @terreno/api, @terreno/ui, and @terreno/syncdb.

---

# [Project Name]

Terreno is Django/Rails for TypeScript — with universal app support.

Terreno is Django/Rails for TypeScript — a batteries-included, full-stack
framework where the undifferentiated 80% of an app is already written. On the
backend you get Mongoose models, auto-generated REST APIs, permissions, an admin
panel, authentication, and an AI service. On the frontend you get one universal
app — a single React Native codebase that ships to iOS, Android, and web. It is
built to be driven by AI coding agents from the first prompt to a production
deploy.

- Batteries included — auth, CRUD APIs, admin, permissions, AI, realtime,
  feature flags, and consent are already built, so your code is business logic.
- Universal by default — one React Native codebase ships to iOS, Android, and
  web. Not a web framework with a mobile bolt-on.
- AI-native — agents are a first-class client of the framework, not an
  afterthought.

Full-stack application built with Terreno packages.

## Tech Stack

- **Backend**: Express + Mongoose using @terreno/api (`SyncApp`, `RealtimeApp`, Better Auth)
- **Frontend**: React Native/Expo using @terreno/ui and `@terreno/syncdb` (collection data, generated API hooks, auth session, feature flags)
- **Database**: MongoDB (replica set required for sync)

## Commands

```bash
# Backend
bun run backend:dev      # Start backend dev server
bun run backend:test     # Run backend tests

# Frontend
bun run frontend:web     # Start frontend web
bun run frontend:ios     # Start iOS simulator
bun run sdk              # Regenerate API SDK from backend
bun run sync-sdk         # Regenerate synced collection hooks
bun run frontend:test    # Run frontend tests

# Both
bun run lint             # Lint all code
bun run lint:fix         # Fix lint issues
bun run compile          # Type check
```

## Architecture

### Backend (@terreno/api)

Uses modelRouter for automatic CRUD endpoints:

```typescript
import {modelRouter, Permissions, OwnerQueryFilter, APIError, logger} from "@terreno/api";

// Example: Creating a model route
router.use(
  "/items",
  modelRouter(Item, {
    permissions: {
      create: [Permissions.IsAuthenticated],
      delete: [Permissions.IsOwner],
      list: [Permissions.IsAuthenticated],
      read: [Permissions.IsOwner],
      update: [Permissions.IsOwner],
    },
    preCreate: (body, req) => ({
      ...body,
      ownerId: req.user?._id,
    }),
    queryFields: ["status", "ownerId"],
    queryFilter: OwnerQueryFilter,
    sort: "-created",
  })
);
```

#### Backend Conventions

- **Errors**: Throw `APIError` with status and title: `throw new APIError({status: 400, title: "Invalid input"})`
- **Mongoose**: Use `Model.findExactlyOne()` or `Model.findOneOrThrow()` (not `findOne`)
- **Logging**: Use `logger.info/warn/error/debug` for permanent logs
- **User casting**: In routes use `req.user as UserDocument`

### Frontend (@terreno/syncdb + @terreno/ui)

`@terreno/syncdb` is the only data layer. There is no Redux.

#### Clients

```typescript
// store/syncdb.ts
import {betterAuthAdapter, bridgeBetterAuthReactClient, createSyncDb} from "@terreno/syncdb";
import {createApiClient} from "@terreno/syncdb/api";
import {appHeaders, baseUrl} from "@terreno/syncdb/config";
import {betterAuthClient} from "@/lib/betterAuth"; // createBetterAuthClient from @terreno/syncdb/auth
import {SYNC_COLLECTIONS} from "@/store/syncDbSdk";

export const authProvider = betterAuthAdapter(bridgeBetterAuthReactClient(betterAuthClient));

export const syncDb = createSyncDb({
  authProvider,
  baseUrl,
  collections: [...SYNC_COLLECTIONS],
  name: "my-app",
  wipeOnSignOut: true,
});

export const apiClient = createApiClient({authProvider, baseUrl, headers: appHeaders});
```

#### Root Layout

```typescript
import {SessionProvider} from "@terreno/syncdb/auth";
import {ApiClientProvider, SyncDbProvider} from "@terreno/syncdb/react";
import {TerrenoProvider} from "@terreno/ui";

const App: React.FC = () => (
  <SessionProvider authClient={betterAuthClient} syncDbs={[syncDb]} onLogout={() => apiClient.reset()}>
    <ApiClientProvider client={apiClient}>
      <SyncDbProvider client={syncDb}>
        <TerrenoProvider openAPISpecUrl={`${baseUrl}/openapi.json`}>
          <RootNavigator />
        </TerrenoProvider>
      </SyncDbProvider>
    </ApiClientProvider>
  </SessionProvider>
);
```

Start `syncDb` when `useSession().userId` is set and stop it on sign-out.

#### Data and Generated Hooks

After backend changes, regenerate both SDKs (never edit the generated files):

```bash
bun run sdk       # terreno-syncdb-codegen --api-out -> store/apiSdk.ts (non-synced routes)
bun run sync-sdk  # terreno-syncdb-codegen --out -> store/syncDbSdk.ts (synced collections)
```

Synced collections read and write locally; other routes use generated hooks. Never use raw axios/fetch:

```typescript
import {generateMutationId} from "@terreno/syncdb";
import {useMutate, useQuery} from "@terreno/syncdb/react";
import {useGetAuthMeQuery} from "@/store/apiSdk";

const ItemsScreen: React.FC = () => {
  const items = useQuery<Item>("items", {sort: "-created"});
  const {create, update, remove} = useMutate("items");
  const {data: me} = useGetAuthMeQuery();

  const handleCreate = (): void => {
    create({data: {_id: generateMutationId(), title: "New Item"}});
  };

  const handleUpdate = (id: string): void => {
    update({id, data: {status: "done"}});
  };
};
```

#### UI Components

```typescript
import {
  Box,
  Button,
  Card,
  CheckBox,
  Heading,
  IconButton,
  Page,
  Spinner,
  Text,
  TextField,
} from "@terreno/ui";

const MyComponent = () => (
  <Page navigation={undefined}>
    <Box padding={4} gap={3}>
      <Heading size="xl">Title</Heading>
      <Card>
        <Box direction="row" alignItems="center" gap={2}>
          <CheckBox selected={isSelected} />
          <Text>Item text</Text>
          <IconButton iconName="trash" variant="destructive" onClick={handleDelete} />
        </Box>
      </Card>
      <Button text="Submit" onClick={handleSubmit} loading={isLoading} />
    </Box>
  </Page>
);
```

## Code Style

### TypeScript/JavaScript
- Use ES module syntax and TypeScript for all code
- Prefer interfaces over types; avoid enums, use maps
- Prefer const arrow functions over `function` keyword
- Use descriptive variable names with auxiliary verbs (e.g., `isLoading`)
- Use camelCase directories (e.g., `components/authWizard`)
- Favor named exports
- Use the RORO pattern (Receive an Object, Return an Object)

### Dates and Time
- Always use Luxon instead of Date or dayjs

### Error Handling
- Check error conditions at start of functions and return early
- Limit nested if statements
- Use multiline syntax with curly braces for all conditionals

### Testing
- Use bun test with expect for testing
- Never mock @terreno packages directly

### Logging
- Frontend: Use `console.info`, `console.debug`, `console.warn`, or `console.error` for permanent logs
- Backend: Use `logger.info/warn/error/debug` for permanent logs
- Use `console.log` only for debugging (to be removed)

### React Best Practices
- Use functional components with `React.FC` type
- Import hooks directly: `import {useEffect, useMemo} from 'react'`
- Always provide return types for functions
- Add explanatory comment above each `useEffect`
- Wrap callbacks in `useCallback`
- Use React context or `useStoredState` for app state; syncdb for server data
- Always support React-Native Web

### Development Practices
- Don't apologize for errors: fix them
- Prioritize modularity, DRY, performance, and security
- Focus on readability over performance
- Write complete, functional code without TODOs when possible
- Comments should describe purpose, not effect

## Workflow

### Adding a New Feature

1. **Backend**: Create Mongoose model in `models/`
2. **Backend**: Add route using `modelRouter` in `api/`
3. **Backend**: Register route in server setup
4. **Frontend**: Run `bun run sdk` and `bun run sync-sdk` to regenerate hooks
5. **Frontend**: Build UI using syncdb hooks, generated hooks, and @terreno/ui components

### Common Permissions Patterns

```typescript
// Public read, authenticated write
permissions: {
  create: [Permissions.IsAuthenticated],
  delete: [Permissions.IsAuthenticated],
  list: [],  // Public
  read: [],  // Public
  update: [Permissions.IsAuthenticated],
}

// Owner-only access
permissions: {
  create: [Permissions.IsAuthenticated],
  delete: [Permissions.IsOwner],
  list: [Permissions.IsAuthenticated],
  read: [Permissions.IsOwner],
  update: [Permissions.IsOwner],
}
queryFilter: OwnerQueryFilter,

// Admin-only
permissions: {
  create: [Permissions.IsAdmin],
  delete: [Permissions.IsAdmin],
  list: [Permissions.IsAdmin],
  read: [Permissions.IsAdmin],
  update: [Permissions.IsAdmin],
}
```

## Reference

- **@terreno/api docs**: See backend-example in Terreno repo
- **@terreno/ui components**: See demo app in Terreno repo
- **@terreno/syncdb integration**: See example-frontend in the Terreno repo and `docs/reference/syncdb.md`
