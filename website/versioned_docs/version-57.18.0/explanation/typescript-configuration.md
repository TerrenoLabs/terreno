# TypeScript configuration

Copy the `tsconfig.json` of the closest profile below when you add a package. Every config
builds on TypeScript 6 with no `ignoreDeprecations`, so `tsc` fails fast on any option that
TypeScript 7 removes.

## Profiles

| Profile | Packages | `module` | `target` | Emits |
| --- | --- | --- | --- | --- |
| Node library | `api`, `ai`, `admin-backend`, `announcements`, `api-health`, `blocks`, `comms`, `feature-flags`, `jobs`, `test`, `admin-spa` server (`tsconfig.server.json`) | `nodenext` | `es2023` | CommonJS `dist/` |
| Node ESM tool | `mcp-server`, `create-terreno-app` | `nodenext` | `es2023` | ESM `dist/` (`"type": "module"`) |
| Frontend library | `ui`, `admin-frontend`, `rtk`, `syncdb` | `esnext` + `moduleResolution: bundler` | `es2022` | ESM `dist/` for Metro |
| Bun CLI | `cli` | `esnext` + `moduleResolution: bundler` + `customConditions: ["bun"]` | `es2022` | ESM `dist/` for Bun |
| Expo app | `example-frontend`, `demo`, `admin-spa` | extends `expo/tsconfig.base` | from Expo | nothing (`noEmit`) |
| Bun app | `example-backend` | `preserve` | `esnext` | nothing (`noEmit`) |
| Docs site | `website` | extends `@docusaurus/tsconfig` | from Docusaurus | nothing (`noEmit`) |

Each workspace keeps a self-contained config. Packages without a `files` allowlist publish
their `tsconfig.json`, so an `extends` into a repo-root base would ship a broken path.

## Why these settings

| Setting | Reason |
| --- | --- |
| `module: nodenext` for Node packages | Models Node's real resolution, including `exports` conditions. CommonJS output keeps dynamic `import()` as a real ESM import. `module: commonjs` rewrote it to `require()`, which cannot load `file://` URLs or ESM-only code. |
| `target: es2023` for Node packages | Node 20+ (the Mongoose 9 floor) runs ES2023 natively, so `tsc` emits readable code with no downleveling or helpers. |
| `target: es2022` for frontend libraries | Metro and Babel transform consumer bundles, and ES2022 class-field semantics match what Babel and Hermes expect. |
| `isolatedModules` | Bun, Metro, and Babel transpile one file at a time. `tsc` flags code that only works with whole-program compilation. `syncdb` leaves it off because TinyBase's `Persists` is an ambient `const enum` that `tsc` must inline. |
| No `baseUrl` | Deprecated in TypeScript 6 and removed in 7. `paths` resolve from the tsconfig's own directory, as do Bun, Expo's Metro resolver, and `check:no-barrel-imports`. `website` sets `"baseUrl": null` to clear the value `@docusaurus/tsconfig` still sets. |
| Explicit `types` | TypeScript 6 defaults `types` to `[]`. List ambient packages (`node`, `bun`) instead of loading every `@types/*` package. |
| `strict: true` | Already the TypeScript 6 default. It stays explicit because it is the most important check. |

## Do not add

| Option | Why |
| --- | --- |
| `ignoreDeprecations` | Hides options that stop working in TypeScript 7. |
| `baseUrl` | Deprecated. Write `paths` entries relative to the tsconfig (`"./src/*"`). |
| `moduleResolution: node` / `node10` / `classic` | Deprecated. Use `nodenext` for Node or `bundler` for bundled code. |
| `target: es5`, `downlevelIteration` | Deprecated. No supported runtime needs ES5 output. |
| `esModuleInterop`, `allowSyntheticDefaultImports`, `forceConsistentCasingInFileNames` | Already `true` by default in TypeScript 6. Setting them to `false` is deprecated. |

`create-terreno-app` scaffolds follow the Expo app and Bun app profiles. Its
`tsconfig.codegen.json` pairs `module: commonjs` with `moduleResolution: bundler`, because
the RTK codegen CLI forces CommonJS when it registers `ts-node`.
