# Test isolation in Bun suites

`bun test` runs every test file of a package in one process. `mock.module` replaces a
module for that whole process, and `mock.restore()` does not undo it. A test that
mocks a module can pass on its own, then break other files, or be broken by them,
when the whole package runs. CI always runs the whole package, so this kind of
failure shows up only after a push.

## The rule

A branch may not add a `mock.module` call to a shared suite, meaning any `*.test.*` or
`*.spec.*` file outside an `isolated/` directory. Existing calls are grandfathered. The
check only counts lines the branch adds.

```bash
bun run check:test-isolation            # vs merge-base with origin/master
```

`bun run prepush` and the CircleCI `repo-policies` job both run it.

## Fixes, in order of preference

1. **Inject the dependency.** Pass a fake through props, options, or a parameter
   instead of replacing the module.
2. **Isolate the file.** Move the test to `src/isolated/<name>.isolated.ts(x)`. Packages
   whose `test:coverage` uses `scripts/check-coverage.ts` run each isolated file in its
   own `bun test` process and merge the coverage.
3. **Mock once in the preload.** Register the mock in the package's bun preload (for
   example `src/tests/bunSetup.ts`) so every file sees the same module.
4. **Mark an identical mock.** When the call matches the preload exactly, put
   `// isolation-safe: <reason>` on the line above it.

## Why a ratchet

Terreno has about 80 existing shared-suite files that call `mock.module`. Most mock
native modules the same way everywhere, which is harmless. Blocking new calls stops
the problem from growing without forcing a migration of working tests. Both
"passes alone, fails in the suite" fixes on the AI observability branch (#1196) came
from new module mocks.

Roast also runs the package's full CI test command, not only the changed test file,
so any remaining order-dependent failure shows up before push.
