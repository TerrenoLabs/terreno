# @terreno/cli e2e tests

Run the cli smoke after a compile:

```bash
bun run compile && bun run --cwd cli smoke   # or, from the root: bun run smoke cli
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | Argument parsing, help text, every command's handler through `runCli` with an injected `CliIo`, the generators, and the OpenAPI REST client (`src/**/*.test.ts`) | `bun run --cwd cli test` |
| Smoke | The compiled `terreno` binary run as a child process: `--version` and one offline generator | `bun run --cwd cli smoke` |
| E2E | Commands that need a running app (`api`, `logs`, `state`, `eval`, `navigate`, `web`, `db`) are exercised by hand against example-backend and example-frontend | none |
| Manual regression | Cases in `docs/regression/` | none |

## The smoke

[`cli/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/cli/e2e/smoke.ts) runs
at the `process` layer. It reads the `bin.terreno` entry from `cli/package.json`
(`dist/bin.js`) and runs it with `runBin()` from `@terreno/test`, from a fresh temp directory.
It needs no network, MongoDB, or secrets. It checks:

1. `dist/bin.js` starts with `#!/usr/bin/env bun`, which an installed `terreno` needs (`runBin`
   runs the file through Bun, so the shebang is not exercised otherwise). `terreno --version`
   exits 0 and prints the version in `cli/package.json`.
2. `terreno --version --json` prints `{name: "@terreno/cli", version}` with the same version.
3. `terreno generate model --name SmokeWidget --field title:String:required --out
   models/smokeWidget.ts --json` exits 0 and reports the absolute path it wrote (`--out`
   resolved against the working directory). The file parses as TypeScript (`Bun.Transpiler`),
   exports `SmokeWidget`, and declares `title` as a required `String`.

Each check prints one `✅` line. The smoke exits 1 on the first failure, with the command's
output. The temp directory is removed afterwards.

### MCP docs

The CLI imports `@terreno/mcp`, and `@terreno/mcp` reads its bundled markdown as soon as it
loads, so even `terreno --version` exits 1 when that markdown is missing. Only the mcp-server
`build` script copies the markdown into `mcp-server/dist/docs`. `bun run compile` (and the
CircleCI `smoke` job) does not. When `mcp-server/dist/docs` is missing, the smoke sets
`TERRENO_MCP_DOCS_DIR` to `mcp-server/src/docs`, the directory `build` copies. After a full
`bun run --cwd mcp-server build`, the smoke uses the bundled copy, as the published package
does. The cli unit tests hit the same gap: run them after an mcp-server `build`, or with
`TERRENO_MCP_DOCS_DIR` set the same way.

**Measured time:** 3–5 s warm, excluding the compile. The first run after a compile can take
about 10 s while Bun loads the CLI's dependency graph cold. Budget: 30 s.

## Add an e2e test

- **New command, flag, or generator option:** add a unit test in `cli/src/` that calls
  `runCli` with an injected `CliIo`. The smoke stays one happy path; do not add edge cases to it.
- **The binary's entry changed** (the `bin` path, `main`, or the `--version` contract): update
  the checks in `cli/e2e/smoke.ts` and keep it within 30 s.
- **A command that needs a running app:** keep it out of the smoke, which stays offline. Add a
  case to `docs/regression/` with exact steps against example-backend and example-frontend.

See [the `@terreno/cli` reference](../../reference/cli.md) for the commands and
[the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for `runBin`.
