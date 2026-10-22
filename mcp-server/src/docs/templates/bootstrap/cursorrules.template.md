# {{appDisplayName}}

A full-stack application built with the Terreno framework.

## Project Structure

- **{{appName}}-frontend/** - Expo/React Native frontend using @terreno/ui and @terreno/syncdb
- **{{appName}}-backend/** - Express/Mongoose backend using @terreno/api

## Development

Uses [Bun](https://bun.sh/) as the package manager.

```bash
# Backend
cd {{appName}}-backend && bun run dev    # Start backend on port 4000

# Frontend
cd {{appName}}-frontend && bun run web   # Start web frontend
cd {{appName}}-frontend && bun run sdk   # Regenerate store/apiSdk.ts after backend changes
```

## Code Style

### TypeScript/JavaScript
- Use ES module syntax and TypeScript for all code
- Prefer interfaces over types; avoid enums, use maps
- Prefer const arrow functions over `function` keyword
- Use descriptive variable names with auxiliary verbs (e.g., `isLoading`)
- Favor named exports
- Use the RORO pattern (Receive an Object, Return an Object)

### Dates and Time
- Always use Luxon instead of Date or dayjs

### Error Handling
- Check error conditions at start of functions and return early
- Limit nested if statements
- Use multiline syntax with curly braces for all conditionals

### React Best Practices
- Use functional components with `React.FC` type
- Add explanatory comment above each `useEffect`
- Wrap callbacks in `useCallback`
- Use React context, local state, or `useStoredState` for app state (no Redux)

### Backend Conventions
- Use `modelRouter` for CRUD endpoints
- Use `APIError` for error responses
- Use `logger.info/warn/error/debug` for logging
- Use `Model.findExactlyOne` or `Model.findOneOrNone` (not `Model.findOne`)

### Frontend Conventions
- Use `@terreno/syncdb/react` hooks (`useQuery`, `useMutate`) for synced collection CRUD
- Use generated hooks from `@/store/apiSdk` for non-synced routes only
- Read the session with `useSession()` from `@terreno/syncdb/auth`
- Use @terreno/ui components (Box, Page, Button, TextField, etc.)
- Never modify `apiSdk.ts` manually - regenerate with `bun run sdk`

## AI Assistance

This project is configured to use the Terreno MCP server for AI-assisted development.
Use the MCP tools and prompts for:
- Generating new models and routes
- Creating screens and forms
- Following Terreno patterns and best practices
