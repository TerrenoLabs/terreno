---
trigger: glob
globs: 'blocks/**,**/blocks/**'
---
# @terreno/blocks

Human architecture: `docs/explanation/agent-ui-asks.md`, `docs/reference/agent-ui-asks.md`, and
`docs/how-to/agent-ui-asks.md`.

Shared, runtime-agnostic contracts for agent-driven UI: Zod schemas for every ask kind and its
answer, validators with stable error codes, limits, simple cards for small screens, the headless
endpoint bodies, and JSON Schema documents plus fixtures for native clients. `@terreno/ai`
(server) and `@terreno/ui` (renderer) both import from here. The only runtime dependency is
`zod` — no React, no Express, no Mongoose.

## Commands

```bash
bun run blocks:compile   # From repo root
bun run blocks:test
bun run blocks:lint
bun run schemas          # In blocks/: regenerate blocks/schemas/*.schema.json
```

## Architecture

```
src/
  index.ts               # Package exports (guarded by index.test.ts)
  asks/
    schema.ts            # Ask input and answer schemas per kind, answer envelope, ASK_KINDS
    limits.ts            # ASK_LIMITS — every number in schemas, prompts, and errors
    errors.ts            # ASK_ERROR_CODES and AskValidationError builders
    validateInput.ts     # validateAskInput
    validateResponse.ts  # validateAskResponse
    simpleCard.ts        # toSimpleCard, resolveButtonAnswer
    headless.ts          # pendingAsks / turn request and result schemas
    files.ts             # files ask accept lists, data URL parsing, byte sniffing
    formValues.ts        # form defaults and value checks
    prompt.ts            # askPromptSection for the offered kinds
    jsonSchema.ts        # askJsonSchemas() — source of blocks/schemas/*
    fixtures/valid|invalid/*.json  # Shared fixtures, exported as @terreno/blocks/fixtures/*
schemas/                 # Committed JSON Schemas, exported as @terreno/blocks/schemas/*
```

## Conventions

- One source of truth: never redefine ask schemas, limits, or error codes in `@terreno/ai`,
  `@terreno/ui`, or apps — import them from `@terreno/blocks`.
- Take every number from `ASK_LIMITS`; error `fix` text and the prompt section must quote it.
- Schemas are strict: an unknown key fails with `UNKNOWN_KEY`. Text fields reject
  whitespace-only values.
- Error codes are part of the public contract. Add codes; do not rename or reuse them.
- After changing a schema, run `bun run schemas` in `blocks/` and commit `schemas/`
  (`jsonSchema.test.ts` fails on drift), and add or update fixtures under `src/asks/fixtures/`.
- `docParity.test.ts` checks `docs/reference/agent-ui-asks.md` against `ASK_LIMITS` and
  `ASK_ERROR_CODES` — update the reference in the same change.
- A new export goes in `src/index.ts` and in the expected list in `src/index.test.ts`.

## Testing

- Framework: `bun test` with `expect`
- Validate every fixture in `src/asks/fixtures/valid` passes and every one in `invalid` fails
  with its expected code.
