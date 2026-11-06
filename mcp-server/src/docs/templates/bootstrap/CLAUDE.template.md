# {{appDisplayName}}

A full-stack application built with the Terreno framework.

## Project Structure

- **{{appName}}-frontend/** - Expo/React Native frontend
- **{{appName}}-backend/** - Express/Mongoose backend

## Development

```bash
# Install dependencies
cd {{appName}}-backend && bun install
cd {{appName}}-frontend && bun install

# Start backend (port 4000)
cd {{appName}}-backend && bun run dev

# Start frontend (port 8082)
cd {{appName}}-frontend && bun run web

# Regenerate store/apiSdk.ts after backend changes (backend running)
cd {{appName}}-frontend && bun run sdk
```

## Adding Features

1. Create model in `{{appName}}-backend/src/models/`
2. Create route in `{{appName}}-backend/src/api/`
3. Register route in `{{appName}}-backend/src/server.ts`
4. Regenerate API hooks: `cd {{appName}}-frontend && bun run sdk` (writes `store/apiSdk.ts`)
5. Create screens in `{{appName}}-frontend/app/`

## Code Style

- Use TypeScript with ES modules
- Use Luxon for dates
- Prefer const arrow functions
- Named exports preferred
- Use interfaces over types
