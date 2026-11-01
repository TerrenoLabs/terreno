# Terreno Overview

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

Terreno's AI-native story has two layers. The tool layer is a Model Context
Protocol (MCP) server that gives coding agents codegen, documentation search,
and component reference for the framework's conventions. The process layer is the
`/terreno-*` SDLC pipeline — plan, implement test-first, verify in a fresh
context, submit with evidence, then own the review loop — which today runs inside
the Terreno repository while its consumer-installable packaging is finished.
Django gives you `manage.py startapp`; Terreno is building a reviewed path from a
request to a mergeable pull request.

## Packages

- **@terreno/api** — REST API framework for Express/Mongoose (modelRouter, auth, OpenAPI)
- **@terreno/ui** — React Native UI component library for iOS, Android, and web
- **@terreno/syncdb** — Local-first data layer (primary path for collection CRUD)
- **@terreno/rtk** — OpenAPI SDK, Better Auth Redux, feature flags (legacy for data sync)
- **@terreno/ai** — Provider-agnostic AI service
- **@terreno/admin-backend** / **@terreno/admin-frontend** / **@terreno/admin-spa** — Admin panel stack

New apps: **syncdb + Better Auth** for data and auth; **rtk** for generated SDK hooks on non-synced routes only.

## MCP development tools

Use the hosted Terreno MCP for documentation and generators, and `terreno-mcp-local` for package
versions, read-only Mongo inspection, merged logs, client state, and Metro/CDP runtime tools.
Configure both with
[Set up Terreno MCP](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/set-up-terreno-mcp.md);
follow [Debug with MCP](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/debug-with-mcp.md)
for the diagnostic workflow. The `terreno` CLI exposes the same
local tools for terminal use.

## Development

Uses [Bun](https://bun.sh/) as the package manager. Use `bun` commands, not `npm`.

```bash
bun install              # Install dependencies
bun run compile          # Compile all packages
bun run lint             # Lint all packages
bun run lint:fix         # Fix lint issues
bun run test             # Run tests in api and ui
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
