# @terreno/blocks e2e tests

Run the blocks smoke after a compile:

```bash
bun run compile && bun run --cwd blocks smoke   # or, from the root: bun run smoke blocks
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | Ask and block schemas, parsing (whole and partial), lint, validation and its error codes, the prompt sections, plain text, JSON Schemas, and `runBlocksCli` in-process, against the fixtures in `src/fixtures/` and `src/asks/fixtures/` (`src/**/*.test.ts`) | `bun run blocks:test` |
| Smoke | The compiled `terreno-blocks` binary validating documents in a real process | `bun run --cwd blocks smoke` |
| E2E | Rendering blocks and asks in GPTChat belongs to `@terreno/ui` and example-frontend's Playwright suite (`ai-chat.spec.ts`) | `bun run frontend:e2e` |
| Manual regression | Cases in `docs/regression/` | none |

## The smoke

[`blocks/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/blocks/e2e/smoke.ts)
runs at the `process` layer. It resolves `@terreno/blocks` by package name, reads the `bin`
field of that package's `package.json`, and runs the `terreno-blocks` entry it names
(`dist/cli.js`) with `runBin`, the way a consumer's package manager links it. It writes two
YAML documents to a temp dir and checks:

1. `terreno-blocks validate valid.yaml` exits 0 with no output. The document is a `text` block
   and an `actions` block with a `reply` button.
2. `terreno-blocks validate invalid.yaml` exits non-zero and prints a line naming
   `blocks[0].markdown` and `MISSING_REQUIRED`. The document is a `text` block with no
   `markdown`.

It prints one `✅` line per check and exits 1 on the first failure, with the binary's stdout
and stderr. A compiled CLI that stops failing on validation errors fails check 2. A `bin` entry
that points at a missing file fails check 1. The smoke needs no Mongo, network, or server.

**Measured time:** 1–2 s for the two checks and about 5 s for `bun run --cwd blocks smoke` end
to end, excluding the compile. One root `bun run smoke blocks` run under load from parallel
builds took 25 s. Budget: 30 s.

## Add an e2e test

- **New block type, field, limit, or error code:** add fixtures under `blocks/src/fixtures/`
  and unit tests next to the code, as the
  [block documents reference](../../reference/blocks.md) describes. The smoke stays one valid
  and one invalid document; do not add edge cases to it.
- **The CLI's contract changed** (a new subcommand, the output format, or the exit codes):
  update `runBlocksCli` tests in `blocks/src/cli.test.ts`, then the checks in
  `blocks/e2e/smoke.ts`.
- **A user-visible rendering flow:** add a Playwright spec in `example-frontend/e2e/`, following
  [Write a Playwright spec](../e2e.md#write-a-playwright-spec).

See [the `terreno-blocks` CLI reference](../../reference/blocks.md#cli) and
[the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for `runBin`.
