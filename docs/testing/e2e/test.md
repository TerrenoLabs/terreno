# E2E testing `@terreno/test`

`@terreno/test` is the helper package every other package's smoke imports, so its own e2e test
is one real-process smoke that proves those helpers work outside `bun test`.

## Run it

```bash
bun run compile                # builds test/dist, which the smoke imports
bun run --cwd test smoke       # or, from the root: bun run smoke test
```

It takes about 12 s warm. The first run on a machine also downloads or unpacks the
`mongod` binary for the in-memory replica set, which can add 20 s or more.

## What it proves

`test/e2e/smoke.ts` imports `@terreno/test` by package name, so it runs against the built
`dist/` output, not the sources. It checks, in order:

1. **Replica set.** `smokeMongoUri({databaseName: "testSmoke"})` returns a URI for that
   database. A Mongoose connection to it opens a change stream filtered to one marker value,
   inserts a document with that marker, and receives the insert as a change event within 10 s. Change streams need a
   replica set, so a standalone `mongod` fails here.
2. **Readiness.** `spawnUntilReady` starts a child process (the same file re-run with
   `serve`) that runs a plain `Bun.serve` HTTP server. The child answers its first three
   `/ready` requests with 503, then answers 200 with its pid and how many 503s it served. The
   smoke checks that the child served all three 503s (so `spawnUntilReady` kept polling past
   them), that a follow-up `GET /ready` answers 200, and that the answering pid is the
   `pid` that `spawnUntilReady` returned.
3. **Teardown.** After `stop()`, the child no longer answers on its port.

The smoke exits 0 when every check passes. It exits 1 on the first failure and prints the
child's output when the child was involved.

## In CI

Set `TERRENO_TEST_MONGODB_URI` to a replica-set URI (the CI Mongo sidecar) and the smoke uses
it instead of starting an in-memory replica set. With a standalone (non-replica-set) Mongo
there, check 1 fails, which is the intended signal.

## Changing it

- Keep the smoke on the package's public exports from `@terreno/test`. Testing an internal
  module belongs in `test/src/smoke/smoke.test.ts`.
- When a new smoke helper is added to `@terreno/test`, add a check for it here only if other
  packages' smokes depend on it outside a server (for example a new process or database
  helper).

See [the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for the helper APIs.
