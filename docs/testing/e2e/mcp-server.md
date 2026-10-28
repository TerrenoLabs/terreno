# @terreno/mcp e2e tests

Run the mcp smoke after a compile:

```bash
bun run compile && bun run --cwd mcp-server smoke
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | Tools, prompts, resources, doc search, upgrade notes, and the local server's tools over an in-memory MCP transport (`src/**/*.test.ts`, `src/local/localServer.e2e.test.ts`) | `bun run --cwd mcp-server test` |
| Smoke | Both compiled binaries, each started as a child process and driven by the real MCP client over its own transport | `bun run --cwd mcp-server smoke` |
| E2E | None. Agents are the only client, and the smoke already uses the real client and transports | none |
| Manual regression | Cases in `docs/regression/` | none |

## The smoke

[`mcp-server/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/mcp-server/e2e/smoke.ts)
drives each binary with the `Client` from `@modelcontextprotocol/client`. The package ships two
binaries on two transports, so the smoke checks each one: the stdio binary at the `process`
layer (it talks MCP over stdin and stdout instead of exiting, so the transport owns the child,
not `runBin`) and the HTTP binary at the `http` layer.

1. **`terreno-mcp-local` over stdio.** `StdioClientTransport` starts `dist/local/index.js`
   with Bun. The client completes `initialize`, the server reports its name as
   `terreno-mcp-local`, and `tools/list` returns at least one tool, including `browser`.
2. **`terreno-mcp` over Streamable HTTP.** `terreno-mcp` is the hosted docs server and serves
   HTTP, not stdio. `spawnUntilReady` starts `dist/index.js` on a `freePort()` bound to
   `127.0.0.1`, with `SENTRY_DSN` unset, and waits for `GET /` to answer. The client connects
   to `/mcp`, completes `initialize`, the server reports `terreno-mcp`, and `tools/list`
   returns at least one tool, including `terreno_search_docs`.

It prints one `✅` line per check and exits 1 on the first failure, after printing the
server's stderr or output. Each MCP request times out after 15 s instead of the SDK's 60 s
default, so a hung server fails inside the budget. The smoke kills the stdio child by pid on
the way out, because after a failed `initialize` the SDK signals it only seconds later, after
the smoke has exited.

`bun run compile` type-checks and emits `dist/` but does not copy `src/docs` into
`dist/docs`; only `bun run build` does. Without docs, `terreno-mcp` crashes at startup reading
`resources/overview.md`. The smoke therefore starts it with `TERRENO_MCP_DOCS_DIR` set to
`mcp-server/src/docs`, the override the [mcp reference](../../reference/mcp-server.md#resources)
documents, so it runs after the CI `smoke` job's plain compile.

The smoke needs no MongoDB: listing tools touches no database.

**Measured time:** 5.5–6 s in three root `bun run smoke` runs (the [guide's](../e2e.md#package-pages) figure), excluding the compile. Single runs on a loaded
4-CPU container took 9–24 s. About 10 s of that is
the hosted server reading its docs at startup. Budget: 30 s.

## Add an e2e test

- **New tool, prompt, or resource:** add a test in `mcp-server/src/`, next to the code. The
  smoke stays one happy path per binary; do not add per-tool checks to it.
- **A transport or startup change** (for example, a new endpoint path, a new binary in `bin`,
  or a new required environment variable): update `mcp-server/e2e/smoke.ts` and keep it
  within 30 s.

See [the mcp reference](../../reference/mcp-server.md) for the tools and transports and
[the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for the smoke helpers.
