# Production source rules

Terreno production TypeScript follows six mechanical conventions. This page is the
policy those conventions implement. CI fails a PR that introduces a new production
file (or a new hit in an existing file) that would trip them.

## Scope

`{api,ui,rtk,ai,admin-backend,admin-frontend,example-backend}/src/**/*.{ts,tsx}`

`example-frontend` and `demo` are listed in the original align glob but have no `src/`
tree (`app/`, `components/`, `stories/` instead), so this scanner does not cover them.

Skipped: tests (`*.test.*`, `*.spec.*`, `*.isolated.*`, `__tests__`), generated SDKs
(`openApiSdk.ts`, `*OpenApiSdk.ts`), declaration files (`*.d.ts`), `node_modules`, `dist`,
and test harness files such as `bunSetup.ts`.

## Rules

| Rule | Ban | Use instead |
| --- | --- | --- |
| Arrow functions | `function` declarations | `const name = (…) => {…}` |
| Luxon | `new Date(`, `Date.now()` | `DateTime` from `luxon` |
| API errors (backend) | `throw new Error(` | `throw new APIError({…})` |
| Logging | `console.log(` | Backend `logger.*`; frontend `console.info` / `warn` / `error` |
| Mongoose reads (backend) | `Model.findOne(` | `findExactlyOne`, `findOneOrNone`, `findOneOrNoneFor` |
| Explicit any | `as any` | Precise types, or `as unknown as T` |

## Allowed leftovers

These still match a naive grep and are **not** violations:

- Mongoose hooks, statics, methods, and virtuals that need `this` (`schema.pre`, `.post`, `.method`, `.statics`, `.virtual`). A nearby hook does not whitelist a later `function` in the same file.
- TypeScript overload signatures plus their implementation (`modelRouter`)
- `React.forwardRef(function …)` and `*.prototype.* = function` patches that close over `this`
- Raw Mongo `collection.findOne`
- `as any` with a line-level `biome-ignore lint/suspicious/noExplicitAny`
- Hits inside comments or string literals

## Commands

```bash
bun run check:source-rules
bun test scripts/check-source-rules/
```

## Enforcement

| Layer | What it does |
| --- | --- |
| **`bun run check:source-rules`** | Scans scoped production sources and fails on any remaining hit |
| **Repository policies CI** | CircleCI job `repo-policies` (includes `check:source-rules`) |
| **`bun run check`** | Local aggregate that includes this scanner |

A **new** production file that uses `export function`, `Date.now()`, `throw new Error`, `console.log`, `Model.findOne`, or unsuppressed `as any` fails CI.

Do not add suppress comments for these rules. Fix the code, or use one of the allowed leftovers above.
