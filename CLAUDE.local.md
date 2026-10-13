# Terreno

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

## Packages

- **api/** - REST API framework built on Express/Mongoose (`@terreno/api`)
- **ui/** - React Native UI component library (`@terreno/ui`)
- **rtk/** - Redux Toolkit Query utilities for API backends (`@terreno/rtk`, legacy for data sync)
- **syncdb/** - Local-first data layer (`@terreno/syncdb`)
- **admin-backend/** - Admin panel backend plugin for @terreno/api (`@terreno/admin-backend`)
- **admin-frontend/** - Admin panel frontend screens for @terreno/api backends (`@terreno/admin-frontend`)
- **blocks/** - Shared contracts for agent-driven UI: ask schemas, answer validation, simple cards (`@terreno/blocks`)
- **demo/** - Demo app for showcasing and testing UI components
- **example-frontend/** - Example Expo app demonstrating full stack usage
- **example-backend/** - Example Express backend using @terreno/api

## Development

Uses [Bun](https://bun.sh/) as the package manager.

### Bootstrap

Run these commands when setting up or updating the project:

```bash
bun run bootstrap        # Initial setup: install deps + compile all packages
bun run bootstrap:update # Update after changes: install deps + recompile all packages
```

- **`bootstrap`**: Run when first cloning the repo or creating a new dev environment (e.g. a container image). Installs all dependencies and compiles every package.
- **`bootstrap:update`**: Run when resuming work after pulling changes, switching branches, or when dependencies have changed. Reinstalls dependencies and recompiles to pick up any changes.

### Common Commands

```bash
bun install              # Install dependencies
bun run compile          # Compile all packages
bun run lint             # Lint all packages
bun run lint:fix         # Fix lint issues
bun run test             # Run tests in api and ui
```

### Package-specific commands

```bash
bun run api:test         # Test API package
bun run ui:test          # Test UI package
bun run demo:start       # Start demo app
bun run frontend:web     # Start frontend example
bun run backend:dev      # Start backend example
bun run admin-backend:compile   # Compile admin backend
bun run admin-frontend:compile  # Compile admin frontend
```

## How the Packages Work Together

The three core packages form a complete full-stack framework:

```
                           BACKEND
  @terreno/api
  - Mongoose models with modelRouter -> CRUD + sync endpoints
  - Better Auth (default) + legacy JWT/Passport
  - Automatic OpenAPI spec generation
                              |
              +---------------+---------------+
              |                               |
     /openapi.json                    sync protocol
              |                               |
     RTK Query SDK Codegen            @terreno/syncdb
     (non-synced routes)              (collection CRUD)
              |                               |
                           FRONTEND
  @terreno/rtk                         @terreno/syncdb
  - Generated hooks (auth, admin, AI)  - useQuery / useMutate (local-first)
  - Better Auth session Redux          - Offline outbox + conflict UI
                              +
  @terreno/ui
  - React Native components
```

### Integration Flow

1. **Backend (api)**: `syncPlugin` + `isDeletedPlugin`, `modelRouter` with `sync` config, `SyncApp` + `RealtimeApp`
2. **OpenAPI**: `/openapi.json` for non-synced routes; `bun run sdk` for auth/admin/AI hooks
3. **Frontend**: `useQuery` / `useMutate` for synced collections; Better Auth via `@terreno/rtk`

## Example Apps (Keep These Updated!)

The `example-frontend/` and `example-backend/` directories serve as both documentation and integration tests. When adding features to api, ui, syncdb, or rtk:

1. **Add examples** demonstrating new features
2. **Update SDK** after backend changes: `cd example-frontend && bun run sdk`
3. **Verify integration** by running both examples together

### Running the Full Stack

```bash
# Terminal 1: Start backend
bun run backend:dev

# Terminal 2: Start frontend
bun run frontend:web
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

### Logging
- Frontend: Use `console.info`, `console.debug`, `console.warn`, or `console.error` for permanent logs
- Backend: Use `logger.info/warn/error/debug` for permanent logs
- Use `console.log` only for debugging (to be removed)

### Development Practices
- Don't apologize for errors: fix them
- Prioritize modularity, DRY, performance, and security
- Focus on readability over performance
- Write complete, functional code without TODOs when possible
- Comments should describe purpose, not effect

## Package Reference

### @terreno/api

REST API framework providing:

- **modelRouter**: Auto-generates CRUD endpoints for Mongoose models
- **Permissions**: `IsAuthenticated`, `IsOwner`, `IsAdmin`, `IsAuthenticatedOrReadOnly`
- **Query Filters**: `OwnerQueryFilter` for filtering list queries by owner
- **setupServer**: Express server setup with auth, OpenAPI, and middleware
- **APIError**: Standardized error handling
- **logger**: Winston-based logging

Key imports:
```typescript
import {
  modelRouter,
  setupServer,
  Permissions,
  OwnerQueryFilter,
  APIError,
  logger,
  asyncHandler,
  authenticateMiddleware,
} from "@terreno/api";
```

#### Custom endpoints (modelRouter actions)

Do **not** use `app.get` / `app.post` / `router.get` / `router.post` for application
APIs. Use `collectionActions` and `instanceActions` on `modelRouter`:

```typescript
export const todoRouter = modelRouter("/todos", Todo, {
  collectionActions: {
    bulkComplete: {
      method: "POST",
      permissions: [Permissions.IsAuthenticated],
      handler: async ({body, user}) => ({matched: 0, modified: 0}),
    },
  },
  instanceActions: {
    markComplete: {
      method: "POST",
      permissions: [Permissions.IsOwner],
      handler: async ({doc}) => doc,
    },
  },
  permissions: { /* CRUD */ },
});
```

See `docs/explanation/model-router-actions.md`. Exceptions: `WebhooksApp`, static SPA,
auth/health/version plugins, SSE.

### @terreno/ui

React Native UI component library (a large component library):

- **Layout**: Box, Page, SplitPage, Card
- **Forms**: TextField, SelectField, DateTimeField, CheckBox
- **Display**: Text, Heading, Badge, DataTable
- **Actions**: Button, IconButton, Link
- **Feedback**: Spinner, Modal, Toast
- **Theming**: TerrenoProvider, useTheme

Key imports:
```typescript
import {
  Box,
  Button,
  Card,
  Page,
  Text,
  TextField,
  TerrenoProvider,
} from "@terreno/ui";
```

### @terreno/rtk

Redux Toolkit Query integration:

- **generateAuthSlice**: Creates auth reducer and middleware with JWT handling
- **emptyApi**: Base RTK Query API for code generation
- **Platform utilities**: Secure token storage (expo-secure-store for native, AsyncStorage for web)

Key imports:
```typescript
import {generateAuthSlice} from "@terreno/rtk";
```

## CI/CD Workflows

### Required Secret Validation

GitHub Actions workflows that use secrets or environment variables must validate all required variables are set before using them. Add a validation step early in the job that fails fast with a clear error message listing any missing variables.

```yaml
- name: Validate required secrets
  run: |
    missing=()
    if [ -z "$VAR_NAME" ]; then missing+=("VAR_NAME"); fi
    if [ ${#missing[@]} -ne 0 ]; then
      echo "::error::Missing required secrets: ${missing[*]}"
      exit 1
    fi
```

## Short Attention Span (always on)

The reader has a short attention span. Output is not just brief. It is shaped so they can act on it without losing the thread.

This section is always active. Turn it off only when the reader says "stop focus mode" or "normal mode". Confirm in one line, then return to your default style.

### What a short attention span changes about reading

Five facts drive every rule below:

1. Working memory is small. Anything not on screen is forgotten. Do not ask the reader to "keep in mind X."
2. Knowing the answer is not doing the answer. The friction between "got it" and "done it" is where work dies.
3. Starting is the hardest step. The first action must be obvious, small, and doable now.
4. Time estimates feel uniform. "A bit of work" and "a few hours" register the same. Vague estimates fail.
5. Visible progress matters. Buried wins do not register.

### Output rules

1. **Lead with the next action.** The first line is something the reader can do — not context, not a plan. If the answer is a command, path, or snippet, it goes first.
2. **Number multi-step tasks.** One bounded action per step. Use the fewest steps that still work.
3. **End with one concrete next action** if anything is left open — something doable in under two minutes.
4. **Suppress tangents.** Finish the first issue, then offer the second as a separate question.
5. **Restate state every turn.** The reader cannot hold "step 3 of 5" between messages.
6. **Give specific time estimates** in concrete units, not "a bit of work."
7. **Make completed work visible** in concrete terms. Do not bury wins in a recap.
8. **Matter-of-fact tone for errors.** State cause and fix. No "Uh oh" or "There seems to be a problem."
9. **Cap lists at 5 items.** Split longer lists into "do now" vs "later."
10. **No preamble, recap, or closing pleasantries.** Start with the answer. End when the answer is done.

### When to break these rules

- User asks to "explain" or "walk me through" — explain fully with headers, still no preamble or closer.
- Destructive action ahead — confirm before acting.
- Debug spiral (three "still broken" turns) — name the wrong assumption; ask one diagnostic question.
- Real ambiguity — one short clarifying question beats guessing.
- A rule fights the task or harness — the task/harness wins; keep the action-first shape where possible.

### Pre-send check

Before sending: delete any opener that announces what you are about to do, any closer that asks "anything else?", any tangent sidebar, and empty hedges. Verify the first and last lines tell the reader what to do next and what just happened.

## Dependency Management

Uses [Bun Catalogs](https://bun.sh/docs/install/catalogs) - shared versions defined in root `package.json` under `catalog`. Reference with `catalog:` in workspace packages.
