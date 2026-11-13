# Explicit `any` policy

Terreno discourages `any` in TypeScript. Biome blocks **new** unsuppressed explicit `any` at lint time; this document describes how we inventory existing usages and track remediation.

## Why

- **Type safety**: `any` disables checking and hides bugs at compile time.
- **Refactor confidence**: precise types make API and UI changes safer.
- **Consistency**: one convention for when `any` is acceptable and how it is documented.

Prefer `unknown` (and narrow) or a precise type. Use `as unknown as T` over `as any as T` when a cast is unavoidable.

## Allowed uses

Explicit `any` is acceptable only at **framework or library boundaries** where types are not expressible in TypeScript today, for example:

- Mongoose model boundaries that inspect consumer-defined schemas (`api/src/populate.ts`)
- RTK Query `Api<any, any, any, any>` in generic middleware (`rtk/src/offlineMiddleware.ts`)
- Dynamic RTK hook lookup where endpoint names are not statically known (`admin-frontend`)
- Test mocks with type-erased doubles (`*.test.ts`, `*.isolated.tsx`)

Every allowed use must be **lint-clean** and **documented** (see below).

## Remediation status

The audit script (`bun run check:explicit-any`) classifies each explicit `any`:

| Status | Meaning |
|--------|---------|
| `violation` | No `biome-ignore` — fails Biome lint |
| `suppressed-only` | Has `biome-ignore` but missing `// noExplicitAny:` rationale |
| `fully-documented` | Has both `biome-ignore` and `// noExplicitAny:` |
| `file-blanket` | File-level `biome-ignore-all` without file-level `noExplicitAny:` |
| `out-of-scope` | In Biome-excluded source (e.g. `api/src/populate.ts`) |

## How to document an `any`

When `any` cannot be removed, add **both** comments on the line above (or a file header for tests):

```typescript
// noExplicitAny: RTK Query generates hook names dynamically; not statically expressible
// biome-ignore lint/suspicious/noExplicitAny: dynamic hook lookup on RTK Query enhanced API
const hook = (api as any)[`useGet${name}Query`];
```

For test files with many mocks, a file-level header is fine:

```typescript
// noExplicitAny: test mocks use type-erased RTK Query API doubles
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
```

## Commands

```bash
bun run check:explicit-any                         # summary report
bun run check:explicit-any:json                    # JSON inventory
bun run check:explicit-any:lint                    # fail on unmarked or unsuppressed any
bun run check:explicit-any:baseline                # fail if global or per-file counts regress
bun run check:explicit-any -- --undocumented       # only suppressed-but-undocumented
bun run check:explicit-any -- --list --undocumented  # file:line list for remediation
bun run check:explicit-any -- --production-only --undocumented --list
bun run check:explicit-any -- --package=api        # filter to one package
bun run check:explicit-any -- --include-excluded   # include Biome-excluded files
bun run check:explicit-any -- --write-baseline     # refresh scripts/check-explicit-any/baseline.json
bun run check:explicit-any:remediate               # auto-add missing noExplicitAny: comments
```

## Enforcement

| Layer | What it does |
|-------|----------------|
| **Biome `noExplicitAny: error`** | Blocks new unsuppressed `any` in every linted package |
| **`bun run check:explicit-any:lint`** | Blocks suppressions without a `noExplicitAny:` rationale, including undocumented file-level suppressions |
| **`bun run check:explicit-any:baseline`** | CI ratchet — total, per-file, undocumented, and violation counts must not increase; a new file starts with an allowance of zero |
| **`bun run lint`** | Runs package lint, then the strict explicit-any marker check |

Baseline file: `scripts/check-explicit-any/baseline.json`. Its per-file counts prevent a new or existing file from adding explicit `any` even when another file removes the same number. After intentional reductions (removing or properly documenting `any`), refresh with `--write-baseline` and commit the updated baseline.

## Remediation workflow

1. Run `bun run check:explicit-any -- --list --undocumented --production-only` for a work queue.
2. For each hit, either **replace** `any` with a proper type or **document** with `noExplicitAny:` + `biome-ignore`.
3. Prefer line-level suppressions over file-level `biome-ignore-all` in production code.
4. Run `bun run check:explicit-any:baseline` before opening a PR.
5. If counts decreased, run `--write-baseline` and commit the new baseline.

## Exclusions

The audit skips generated and template files (`openApiSdk.ts`, `*.template.ts`). Biome-excluded paths (see `!!` patterns in `biome.jsonc`) are omitted unless `--include-excluded` is passed.
