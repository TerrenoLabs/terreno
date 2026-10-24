# create-terreno-app e2e tests

Run the create-terreno-app smoke after a compile:

```bash
bun run compile && bun run --cwd create-terreno-app smoke   # or, from the root: bun run smoke create-terreno-app
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | Argument parsing, `--yes` defaults, the overwrite guard, and the content of every generated file, through `runCli`, `writeScaffold`, and `generateAllFiles`, plus the CLI's exit codes as a subprocess (`src/__tests__/*.test.ts`). None of them builds the generated app | `bun run --cwd create-terreno-app test:ci` |
| Smoke | The compiled binary generates an app, and the generated backend bundles against the workspace packages | `bun run --cwd create-terreno-app smoke` |
| E2E | none: the generated frontend and backend are not booted. Booting them needs a network `bun install` | none |
| Manual regression | Cases in `docs/regression/` | none |

## The smoke

[`create-terreno-app/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/create-terreno-app/e2e/smoke.ts)
runs at the `process` layer. It never imports the package's source. It finds the compiled CLI
through the `create-terreno-app` entry in the package's `bin`, the way `bunx` does, and runs it
with `runBin`. Then it:

1. Runs `create-terreno-app smoke-app --yes` in a new, empty temp directory. `runBin` gives the
   CLI end-of-input on stdin, so it must finish on its flags alone: a prompt would get no answer
   and the CLI would not print `Created <dir>`. The CLI must exit 0, print `Created <dir>`, and
   write the backend and frontend entry files (`backend/src/index.ts`, `backend/src/server.ts`,
   `frontend/app/_layout.tsx`, both `package.json` files, and `README.md`).
2. Reads the runtime imports of every `backend/src/**/*.ts` file with `Bun.Transpiler`
   (type-only imports are dropped) and checks that each package they name, other than Node
   built-ins, is in the generated `backend/package.json` `dependencies`. Step 3 links the whole
   monorepo `node_modules`, so the build alone would not catch an undeclared import that a
   scaffolded app's `bun install` would leave out.
3. Links the generated `backend/node_modules` to the monorepo's `node_modules`, and checks that
   each `@terreno/*` dependency in the generated `backend/package.json` (`admin-backend`, `api`,
   `api-health`) resolves to a workspace package inside the repo, not a hoisted copy under
   `node_modules`, and that the workspace version satisfies the declared range. Nothing is
   installed, so the smoke needs no network.
4. Runs the generated backend's own `build` script (`bun build src/index.ts --outdir ./dist
   --target node`) and checks that it exits 0 and writes `dist/index.js`. From the `// <path>`
   comments Bun writes above each bundled module, it checks that the bundle holds modules from
   each of those workspace packages' `dist/`.

It prints one `✅` line per check, exits 1 on the first failure, and deletes the temp directory
either way. The build fails when the generated backend imports a module or a package path that
does not exist. The workspace packages compile to CommonJS, so Bun does not check named imports
from them: a generated import of a removed `@terreno/api` export still builds. The generated
backend's own `tsc` (`bun run compile` in a scaffolded app) catches that; the smoke skips `tsc`
because it takes about 30 s on its own. The smoke runs the CLI and packages from `dist/`, so
compile first: against a stale `dist/` it tests the old output.

**Measured time:** 3.5–11 s on an idle container, and 15–21 s while other builds ran,
excluding the compile. Generating and the import check take under 1 s; bundling the backend
(about 3,300 modules) takes most of the rest. Budget: 30 s.

## Add an e2e test

- **New flag, default, or generated file content:** add a unit test in
  `create-terreno-app/src/__tests__/`. The smoke stays one happy path; do not add edge cases to
  it.
- **The generated backend gains a `@terreno/*` dependency:** the smoke checks it with no edit,
  because it reads the dependency list from the generated `backend/package.json`. The
  dependency must be a workspace package.
- **The generated backend's entry or `build` script changes:** update `EXPECTED_FILES` or the
  build step in `create-terreno-app/e2e/smoke.ts`, and keep it within 30 s.

See [the create-terreno-app reference](../../reference/create-terreno-app.md) for the CLI flags,
[Create a Terreno app](../../how-to/create-a-terreno-app.md) for the user guide, and
[the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for `runBin`.
