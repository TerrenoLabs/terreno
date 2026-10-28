# No barrel imports

Terreno avoids **barrel imports** — imports that resolve through an `index.ts` / `index.tsx` file that only re-exports other modules.

## Why

- **Clearer dependencies**: each import names the file that defines the symbol.
- **Faster tooling**: bundlers and TypeScript do less re-export chasing.
- **Fewer cycles**: internal barrels (especially package `index` files) are a common source of circular dependencies.

## Allowed

- **Published package APIs** — cross-package imports like `@terreno/api`, `@terreno/ui`, and `@terreno/rtk` use each package's public `src/index` entry. That is intentional.
- **Package public entry files** — `api/src/index.ts`, `ui/src/index.tsx`, etc. may re-export for npm consumers. Do not import those barrels from *inside* the same package.
- **Expo Router routes** — `app/**/index.tsx` files are route entries, not barrels.

## Not allowed

Internal barrel `index` files do not exist in this repo — the Biome `noBarrelFile` override bans creating them, so a directory import like `../models` has nothing to resolve to and fails to compile.

Importing a directory that resolves to a re-exporting index file:

```typescript
// Bad — resolves to models/index.ts
import {User} from "../models";

// Good — imports the defining module
import {User} from "../models/user";
```

```typescript
// Bad — store/index.ts was a barrel of sdk/appState/utils
import {useGetMeQuery} from "@/store";

// Good
import {useGetMeQuery} from "@/store/sdk";
import store, {useAppDispatch} from "@/store/index";
```

## Enforcement

No generation step is required — internal barrel `index` files are banned outright, so there is never a list of barrels to keep in sync.

- **Biome `noBarrelFile` override** (root `biome.jsonc`): bans internal barrel `index.ts` / `index.tsx` files during lint. Package public entries (`src/index.ts[x]`) and Expo Router routes (`app/**`) are exempt.
- **Biome plugin**: `biome/plugins/no-barrel-imports.grit` — a small static GritQL plugin that flags path-alias directory imports (`@/store`, `@components`, …) in the packages that define those aliases (`example-frontend`, `admin-spa`, `demo`).
- **CI**: `bun run check:no-barrel-imports` — resolution-based safety net that fails if any internal barrel index file exists or any import resolves through one (see root `package.json` → `terreno.policies.noBarrelImports`).
- **AI rules**: `.rulesync/rules/00-root.md` and package `.ai/guidelines/core.md` files

When scaffolding new code (MCP bootstrap, examples), always generate direct module paths — never `models/index`, `@/store`, or `@components` without a concrete file.
