---
trigger: always_on
---
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
- **syncdb/** - Local-first data layer (TinyBase store, durable outbox, delta sync) for @terreno/api backends (`@terreno/syncdb`)
- **admin-backend/** - Admin panel backend plugin for @terreno/api (`@terreno/admin-backend`)
- **admin-frontend/** - Admin panel frontend screens for @terreno/api backends (`@terreno/admin-frontend`)
- **admin-spa/** - Standalone admin SPA (Expo Router web app) + Express plugin to serve it from a backend (`@terreno/admin-spa`)
- **blocks/** - Shared contracts for agent-driven UI: ask schemas, answer validation, simple cards, and JSON Schemas for native clients (`@terreno/blocks`)
- **comms/** - Pluggable transactional communications (`@terreno/comms`)
- **cli/** - Operator CLI (`@terreno/cli`, bin `terreno`) for docs, codegen, bootstrap, and OpenAPI REST
- **jobs/** - Durable background jobs plugin for `@terreno/api` (`@terreno/jobs`)
- **mcp-server/** - MCP server for AI assistant integration (`@terreno/mcp`, bins `terreno-mcp` + `terreno-mcp-local`)
- **demo/** - Demo app for showcasing and testing UI components
- **example-frontend/** - Example Expo app demonstrating full stack usage
- **example-backend/** - Example Express backend using @terreno/api

## Agentic lifecycle

The reusable planning plugin uses five bounded transitions:
**Grow** (shape) → **Pick** (build) ⇄ **Roast** (prove) until tasks are done →
**Brew** (submit) → **Taste** (react once; invoked directly, it repeats bounded
reactions until a terminal verdict and never tells you to run it later). Pick owns the inner loop: one task, roast
it, next task. Roast never invokes Pick. The outer loop owns state persistence,
retry, stop, and escalation. Taste waits in-process for review bots and for product
CI (`gh` / `circleci` watch loop). Before any push it fetches latest `master` (merging it only when needed),
records last-run failed tests and re-verifies them locally, then
spawns a no-context subagent to run the root `prepush` package script when present
(otherwise lint, typecheck, and locally affected tests in affected packages), then
pushes and watches CI. Brew also waits until
review bots such as Bugbot or CodeQL finish so they can react in the same invocation.
Taste observes product CI on every discovered host (GitHub Actions, CircleCI,
Buildkite, and similar), not only GitHub checks. See `plugins/README.md` and
`docs/reference/lifecycle-plugin.md`.

The installed planning plugin also ships the reusable Terreno app, docs, upgrade,
deployment, and verification skills used by consumer projects. Repository-only roadmap,
release, and maintenance workflows remain under `.rulesync/skills/`.

## Documentation

Human-facing docs are the architecture source. Before changing code, read the
explanation and reference pages for the affected area. Update those pages in the
same slice using the `update-docs` skill. Missing docs for a user-visible or
architectural change fails the slice. Install the published skill set with
`npx skills add TerrenoLabs/terreno`; regenerate `skills/` with
`bun run skills:sync`. The combined lifecycle and Terreno app skill set installs as the Cursor plugin
`terreno-planning` from `.cursor-plugin/marketplace.json` (invoke `/terreno-1-grow`),
as the Codex plugin `terreno-planning` from `.agents/plugins/marketplace.json`
(invoke `$terreno-1-grow`), or as the Claude Code plugin `terreno` via
`/plugin marketplace add TerrenoLabs/terreno` then
`/plugin install terreno@terreno-plugins` (invoke `/terreno:1-grow`). The Claude copy under
`plugins/terreno-claude/` is generated; never hand-edit it.

## Development

Uses [Bun](https://bun.sh/) as the package manager.

```bash
bun run bootstrap        # Install dependencies + compile all packages (dev-ready setup)
bun run bootstrap:update # Reinstall + recompile after pulling changes or switching branches
bun install              # Install dependencies
bun run compile          # Compile all packages
bun run lint             # Lint all packages
bun run lint:fix         # Fix lint issues
bun run test             # Run all workspace test suites
bun run test:agent       # Run all tests with passing cases suppressed
```

- **`bootstrap`**: Run when first cloning the repo or creating a new dev environment. Installs all dependencies and compiles every package so the workspace is ready for development.
- **`bootstrap:update`**: Run when resuming work after pulling changes, switching branches, or when dependencies have changed.

### Package-specific commands

```bash
bun run api:test         # Test API package
bun run ui:test          # Test UI package
bun run syncdb:compile   # Compile syncdb package
bun run syncdb:test      # Test syncdb package
bun run demo:start       # Start demo app
bun run frontend:web     # Start frontend example
bun run backend:dev      # Start backend example
bun run mcp:build        # Build MCP server
bun run mcp:start        # Start MCP server
bun run admin-backend:compile   # Compile admin backend
bun run admin-frontend:compile  # Compile admin frontend
bun run comms:compile           # Compile communications package
bun run comms:test              # Test communications package
bun run jobs:compile            # Compile jobs package
bun run jobs:test               # Test jobs package
bun run jobs:worker             # Example-backend standalone jobs worker
```

### Static analysis

Agent post-edit hooks run `bun run analyze:fast`; agent stop hooks run
`bun run analyze:full`. `.rulesync/hooks.json` is the canonical hook configuration.
Knip has no baseline: every finding must be fixed or documented as a narrow exception in
`knip.jsonc`, and `bun run check:knip` enforces zero findings in CI. dependency-cruiser
keeps a ratcheted baseline; run `bun run analyze:dependency-baseline` only after reviewing
an intentional repository-wide dependency-graph change. See
`docs/explanation/static-analysis.md`.

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
  - Feature flags + sockets
                              +
  @terreno/ui
  - React Native components (Box, Button, TextField, etc.)
  - TerrenoProvider for theming
```

> **Legacy:** `@terreno/rtk` RTK Query hooks for **collection CRUD** are deprecated — use syncdb. See [migrate-rtk-to-syncdb.md](../../docs/how-to/migrate-rtk-to-syncdb.md). `modelRouter` `realtime` and RTK `realtimeList` / `realtimeDocument` are removed in Terreno 58; `RealtimeApp` stays for sync sockets.

### Integration Flow

1. **Backend (api)**: Define Mongoose models with `syncPlugin` + `isDeletedPlugin`; use `modelRouter` with a `sync` config; register `SyncApp` and `RealtimeApp`
2. **OpenAPI Generation**: `setupServer` generates `/openapi.json` for non-synced routes
3. **SDK Codegen**: Frontend runs `bun run sdk` for auth, admin, AI, and custom endpoints — **not** for synced collections
4. **Frontend (syncdb + ui)**: Use `useQuery` / `useMutate` for synced data; use generated SDK hooks only for non-synced routes; Better Auth via `@terreno/rtk`

## Example Apps (Keep These Updated!)

The `example-frontend/` and `example-backend/` directories serve as both documentation and integration tests. When adding features to api, ui, syncdb, or rtk:

1. **Add examples** demonstrating new features
2. **Update SDK** after backend changes: `cd example-frontend && bun run sdk`
3. **Update docs** in the same slice (`docs/explanation/`, `docs/reference/`, `docs/how-to/`)
4. **Verify integration** by running both examples together

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
- **No barrel imports** — import concrete module files, not directory `index` re-export barrels. See [no-barrel-imports.md](../docs/explanation/no-barrel-imports.md). Cross-package `@terreno/*` package roots are allowed; internal barrel `index.ts` files are banned (Biome `noBarrelFile` override) and paths like `../models`, `@/store`, or `@components` without a file are not allowed. Enforced by Biome lint and `bun run check:no-barrel-imports` in CI.

### Dates and Time
- Always use Luxon instead of Date or dayjs

### Error Handling
- Check error conditions at start of functions and return early
- Limit nested if statements
- Use multiline syntax with curly braces for all conditionals

### Testing
- Use Bun for tests.
- Agents should use `bun run test:agent` for the full suite. It preserves failures and the final summary while suppressing passing test cases.
- Use the closest package or file-level `bun test --only-failures <path>` command during red/green cycles.

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
- **Frontend verification is mandatory** for any feature touching frontend packages: launch the app, log in when required, exercise the changed feature, save screenshots/videos to `/opt/cursor/artifacts/`, and attach them to the PR. See `02-frontend-verification.md` and the `verify-ui-changes` skill.

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

#### Custom endpoints (modelRouter actions)

Do **not** use `app.get` / `app.post` / `router.get` / `router.post` for application
APIs. Use `collectionActions` and `instanceActions` on `modelRouter`:

```typescript
import {modelRouter, Permissions, z} from "@terreno/api";

export const todoRouter = modelRouter("/todos", Todo, {
  collectionActions: {
    bulkComplete: {
      method: "POST",
      permissions: [Permissions.IsAuthenticated],
      body: z.object({ids: z.array(z.string()).min(1)}).strict(),
      handler: async ({body, user}) => {
        return {matched: 0, modified: 0};
      },
    },
  },
  instanceActions: {
    markComplete: {
      method: "POST",
      permissions: [Permissions.IsOwner],
      handler: async ({doc}) => doc,
    },
  },
  permissions: {
    list: [Permissions.IsAuthenticated],
    create: [Permissions.IsAuthenticated],
    read: [Permissions.IsOwner],
    update: [Permissions.IsOwner],
    delete: [Permissions.IsOwner],
  },
});
```

See `docs/explanation/model-router-actions.md`. Exceptions: `WebhooksApp`, static SPA,
auth/health/version plugins, SSE.

#### API Conventions

- Throw `APIError` with appropriate status codes: `throw new APIError({status: 400, title: "Message"})`
- Do not use `Model.findOne` - use `Model.findExactlyOne` or `Model.findOneOrThrow`
- Define statics/methods by direct assignment: `schema.methods = {bar() {}}`
- All model types live in `src/modelInterfaces.ts`
- In routes: `req.user` is `UserDocument | undefined`
- In @terreno/api callbacks: cast with `const user = u as unknown as UserDocument`

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

### @terreno/syncdb

Local-first data layer (primary path for collection CRUD):

- **createSyncDb**: Client with durable outbox, socket sync, encrypted persistence
- **React hooks**: `useQuery`, `useEntity`, `useMutate`, `useSyncStatus`, `useConflicts`
- **betterAuthAdapter**: Session auth for sync sockets

Key imports:
```typescript
import {createSyncDb, betterAuthAdapter} from "@terreno/syncdb";
import {SyncDbProvider, useQuery, useMutate} from "@terreno/syncdb/react";
```

For running-app SyncDB bugs, invoke the `debug-syncdb-with-mcp` skill and use
`get_syncdb_state`, `syncdb_snapshot`, and `syncdb_action` from
`terreno-mcp-local`. Enable the client with `debug: true`; set
`TERRENO_MCP_EVAL=1` only for state-changing actions. See
`docs/how-to/debug-with-mcp.md`.

### @terreno/rtk (legacy data sync; still required for SDK + auth)

Redux Toolkit Query integration for **non-synced** routes and session state:

- **generateBetterAuthSlice**: Better Auth session Redux (default for new apps)
- **emptyApi**: Base RTK Query API for OpenAPI codegen
- **useTerrenoFeatureFlags**, **useSocketConnection**: Feature flags and realtime

Use generated SDK hooks for non-synced routes only — never use `axios` or `request` directly.

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

## Cursor Cloud specific instructions

### Bootstrap

From the repo root after clone or when dependencies change:

```bash
bun bootstrap
```

Installs workspace dependencies and compiles all packages (`bun install && bun run compile`).

### Cloud VM toolchain

Shared install script (in **flourish** repo): `bash /agent/repos/flourish/scripts/install-cloud-dev-tools.sh` then `source ~/.cloud-dev-tools.env`. Provides **terraform**, **gcloud**, **gh**, **Playwright** (after `bun bootstrap` in packages with `@playwright/test`), **Appium**, and **Android emulator** helpers. Terreno/terraform details: `terraform/README.md`.

### Example full stack

| Service | Port | Start command |
|---------|------|---------------|
| example-backend | 4000 | `bun run backend:dev` (from repo root) |
| example-frontend web | 8082 | `bun run frontend:web` |

The running `example-backend` needs a **real MongoDB replica set** (change streams power the realtime/feature-flag sync) at `MONGO_URI`, plus auth secrets `TOKEN_SECRET`, `TOKEN_ISSUER`, `REFRESH_TOKEN_SECRET`, `SESSION_SECRET`. (Only the bun **test** suites use the auto-managed in-memory Mongo from `@terreno/test`; the dev server does not.)

A standalone `mongod` binary is available from the `mongodb-memory-server` cache (e.g. `~/.cache/mongodb-binaries/mongod-*`) after the test suites have run once. Run it as a single-node replica set, then point the backend at it:

```bash
# 1. start mongod (replica set required for change streams)
"$(ls ~/.cache/mongodb-binaries/mongod-* | head -1)" \
  --replSet rs0 --port 27017 --bind_ip 127.0.0.1 --dbpath /workspace/.devdata/mongo &
# 2. initiate the replica set once (use node, not bun — the mongodb driver's bson
#    package hits a "node:v8 isBuildingSnapshot" error under bun). From example-backend/:
#    node -e 'import("mongodb").then(async ({MongoClient})=>{const c=new MongoClient("mongodb://127.0.0.1:27017/?directConnection=true");await c.connect();await c.db("admin").command({replSetInitiate:{_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]}}).catch(()=>{});await c.close();})'
# 3. run backend + frontend
MONGO_URI="mongodb://127.0.0.1:27017/terreno-example?replicaSet=rs0" \
  TOKEN_SECRET=dev-token-secret TOKEN_ISSUER=terreno-dev \
  REFRESH_TOKEN_SECRET=dev-refresh-secret SESSION_SECRET=dev-session-secret \
  PORT=4000 bun run backend:dev
EXPO_PUBLIC_API_URL=http://localhost:4000 bun run frontend:web
```

Seed login users with `bun run backend:seed` (same env vars): creates `test@example.com` and admin `admin@example.com`, both password `testpassword123`. Health check: `curl localhost:4000/health` → `"healthy":true`. The web app shows one-time Terms/Privacy/Consent modals (with a signature draw) on first login before the Todos screen.

### Tests and lint

Every CircleCI test job has a local command. Map and run them with
[`docs/how-to/run-tests-locally.md`](../../docs/how-to/run-tests-locally.md).

```bash
bun run test              # every workspace test:ci (including example-frontend)
bun run test:agent        # same suites; passing cases suppressed
bun run frontend:test     # example-frontend unit tests
bun run frontend:e2e      # Playwright (needs replica-set mongod; starts backend+web)
bun run maestro:test      # Maestro web flows
bun run prepush           # local mirror of every CI job this branch triggers
```

Install Playwright browsers once: `cd example-frontend && bunx playwright install --with-deps chromium`.
Taste: copy failed tests from the last CI log, run that exact local command, then
`git push`. `prepush` does not replace that re-verify.

- `demo:start` serves the UI component demo on port **8085**.

### GCP service account secrets

When present, these are injected as environment variables holding GCP service-account credentials (each scoped with viewer plus some write permissions for its environment):

- `GCP_SA_TERRENO` — terreno GCP service account (viewer + some write); use it for gcloud / GCP API access for terreno.
- The sibling apps in this workspace have their own: `GCP_SA_PRD` (flourish production), `GCP_SA_STG` (flourish staging), and `GCP_SA_ZAPLING` (zapling).

### Sentry API access

When present, `SENTRY_CLIENT_SECRET` is injected as an environment variable holding the Sentry API key (auth token) for programmatic Sentry API access.

### CircleCI API access

When present, `CIRCLECI_TOKEN` is a CircleCI personal API token (`CIRCLE_TOKEN` is the
CLI name). Use it to list jobs and fetch logs for Taste. Project slug:
`circleci/6UHiK7pThPXbhnNi3umQNe/LdjghuhydHjFMyFjcEXMA2` (not `gh/TerrenoLabs/terreno`).
See [`docs/how-to/circleci.md`](../../docs/how-to/circleci.md).

### Gotchas

- **Port 8082** is shared by `example-frontend` and the separate **gitsight** app in this workspace — run only one web UI on 8082 at a time.
- Use `$HOME/.bun/bin/bun` if `bun` is not on `PATH` in non-interactive shells (install via https://bun.sh).
