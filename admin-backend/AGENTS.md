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
- **rtk/** - Redux Toolkit Query utilities for API backends (`@terreno/rtk`)
- **admin-backend/** - Admin panel backend plugin for @terreno/api (`@terreno/admin-backend`)
- **admin-frontend/** - Admin panel frontend screens for @terreno/api backends (`@terreno/admin-frontend`)
- **mcp-server/** - MCP server for AI assistant integration (`@terreno/mcp`, bins `terreno-mcp` / `terreno-mcp-local`)
- **demo/** - Demo app for showcasing and testing UI components
- **example-frontend/** - Example Expo app demonstrating full stack usage
- **example-backend/** - Example Express backend using @terreno/api

## Development

Uses [Bun](https://bun.sh/) as the package manager.

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
bun run mcp:build        # Build MCP server
bun run mcp:start        # Start MCP server
bun run admin-backend:compile   # Compile admin backend
bun run admin-frontend:compile  # Compile admin frontend
```

## How the Packages Work Together

The three core packages form a complete full-stack framework:

```
                           BACKEND
  @terreno/api
  - Mongoose models with modelRouter -> CRUD endpoints
  - Built-in auth (JWT + Passport)
  - Automatic OpenAPI spec generation
                              |
                     /openapi.json
                              |
                    RTK Query SDK Codegen
                              |
                           FRONTEND
  @terreno/rtk
  - Generated hooks from OpenAPI spec
  - Auth slice with JWT token management
  - Automatic token refresh
                              +
  @terreno/ui
  - React Native components (Box, Button, TextField, etc.)
  - TerrenoProvider for theming
```

### Integration Flow

1. **Backend (api)**: Define Mongoose models, use `modelRouter` to create CRUD endpoints with permissions
2. **OpenAPI Generation**: `setupServer` automatically generates `/openapi.json`
3. **SDK Codegen**: Frontend runs `bun run sdk` to generate RTK Query hooks from OpenAPI spec
4. **Frontend (rtk + ui)**: Use generated hooks with UI components for type-safe API calls

## Example Apps (Keep These Updated!)

The `example-frontend/` and `example-backend/` directories serve as both documentation and integration tests. When adding features to api, ui, or rtk:

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

#### modelRouter Usage

```typescript
import {modelRouter, modelRouterOptions, Permissions} from "@terreno/api";

const router = modelRouter(YourModel, {
  permissions: {
    list: [Permissions.IsAuthenticated],
    create: [Permissions.IsAuthenticated],
    read: [Permissions.IsOwner],
    update: [Permissions.IsOwner],
    delete: [],  // Disabled
  },
  sort: "-created",
  queryFields: ["_id", "type", "name"],
});
```

#### Custom Routes

For non-CRUD endpoints, use the OpenAPI builder:

```typescript
import {asyncHandler, authenticateMiddleware, createOpenApiBuilder} from "@terreno/api";

router.get("/yourRoute/:id", [
  authenticateMiddleware(),
  createOpenApiBuilder(options)
    .withTags(["yourTag"])
    .withSummary("Brief summary")
    .withPathParameter("id", {type: "string"})
    .withResponse(200, {data: {type: "object"}})
    .build(),
], asyncHandler(async (req, res) => {
  return res.json({data: result});
}));
```

#### API Conventions

- Throw `APIError` with appropriate status codes: `throw new APIError({status: 400, title: "Message"})`
- Do not use `Model.findOne` - use `Model.findExactlyOne` or `Model.findOneOrThrow`
- Define statics/methods by direct assignment: `schema.methods = {bar() {}}`
- All model types live in `src/modelInterfaces.ts`
- In routes: `req.user` is `UserDocument | undefined`
- In @terreno/api callbacks: cast with `const user = u as unknown as UserDocument`

### @terreno/ui

React Native UI component library (a large component library):

- **Layout**: Box, Page, ListDetailLayout, SplitPage, Card
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

#### UI Component Examples

Layout with Box:
```typescript
<Box direction="row" padding={4} gap={2} alignItems="center">
  <Text>Content</Text>
  <Button text="Action" />
</Box>
```

Buttons:
```typescript
<Button
  text="Submit"
  variant="primary"  // 'primary' | 'secondary' | 'outline' | 'ghost'
  onClick={handleSubmit}
  loading={isLoading}
  iconName="check"
/>
```

Forms:
```typescript
<TextField
  label="Email"
  value={email}
  onChangeText={setEmail}
  error={emailError}
  helperText="Enter a valid email"
/>
```

Modals:
```typescript
<Modal
  title="Confirm Action"
  visible={isVisible}
  primaryButtonText="Confirm"
  secondaryButtonText="Cancel"
  onDismiss={() => setIsVisible(false)}
  onPrimaryAction={handleConfirm}
>
  <Text>Are you sure?</Text>
</Modal>
```

#### UI Common Pitfalls

- Don't use inline styles when theme values are available
- Don't use raw `View`/`Text` when `Box`/@terreno/ui `Text` are available
- Don't forget loading and error states
- Don't use `style` prop when equivalent props exist (`padding`, `margin`)
- Never modify `openApiSdk.ts` manually

### @terreno/rtk

Redux Toolkit Query integration:

- **generateAuthSlice**: Creates auth reducer and middleware with JWT handling
- **emptyApi**: Base RTK Query API for code generation
- **Platform utilities**: Secure token storage (expo-secure-store for native, AsyncStorage for web)

Key imports:
```typescript
import {generateAuthSlice} from "@terreno/rtk";
```

Always use generated SDK hooks - never use `axios` or `request` directly:

```typescript
// Correct
import {useGetYourRouteQuery} from "@/store/openApiSdk";
const {data, isLoading, error} = useGetYourRouteQuery({id: "value"});

// Wrong - don't use axios directly
// const result = await axios.get("/api/yourRoute/value");
```

## React Best Practices (Frontend Packages)

- Use functional components with `React.FC` type
- Import hooks directly: `import {useEffect, useMemo} from 'react'`
- Always provide return types for functions
- Add explanatory comment above each `useEffect`
- Wrap callbacks in `useCallback`
- Prefer const arrow functions
- Use inline styles over `StyleSheet.create`
- Use Luxon for date operations
- Place static content and interfaces at beginning of file
- Minimize `use client`, `useEffect`, and `setState`
- Always support React-Native Web

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

## @terreno/admin-backend — tests

`bunfig.toml` preloads [`src/tests/testEnv.ts`](./src/tests/testEnv.ts) (sets `TERRENO_TEST_USE_MEMORY_MONGO`) then [`api/src/tests/bunSetup.ts`](../api/src/tests/bunSetup.ts), which starts **mongodb-memory-server** and connects Mongoose (no local `mongod` required). To use a real MongoDB instead, remove or edit `testEnv.ts`, or set `TERRENO_TEST_MONGODB_URI` before running tests. Set `BUN_TEST_DISABLE_DB=true` to skip DB hooks entirely.

## Dependency Management

Uses [Bun Catalogs](https://bun.sh/docs/install/catalogs) - shared versions defined in root `package.json` under `catalog`. Reference with `catalog:` in workspace packages.
